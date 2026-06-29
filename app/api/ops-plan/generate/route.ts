// Generate an operational plan. Two modes:
//  - default (AI): a free-form daily ops plan grouped by team (legacy).
//  - mode:"weekly": a DATA-DRIVEN Action Plan for the WEEK AHEAD, built from the real Health
//    actions, with each field task scheduled on the unit's NEXT VACANT day (checkout-based),
//    so the team can take it, inspect/fix on those days, push to Breezeway, and manage it.
// Persists a plan + items (service role). Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeListingHealth, type HealthReview } from '@/lib/health-score'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function mondayOf(dStr: string) { const d = new Date(dStr + 'T12:00:00'); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10) }

// Field-task department from a health issue (null = desk task, not in the weekly plan).
function departmentFor(key: string, owner: string): string | null {
  const k = String(key || '').toLowerCase(); const o = String(owner || '').toLowerCase()
  if (k === 'clean' || o.includes('housekeep')) return 'housekeeping'
  if (k === 'ac' || k === 'maint' || k === 'checkin') return 'maintenance'
  if (k === 'noise' || k === 'ops') return 'inspection'
  if (o.includes('maintenance')) return 'maintenance'
  if (o.includes('field') || o.includes('ops')) return 'inspection'
  return null
}
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

async function generateWeekly(user: any) {
  const sb = supabaseAdmin()
  const today = todayET()
  const horizon = 14

  // Pull listings + reviews + open work + upcoming reservations.
  const fetchAllReviews = async () => {
    let all: any[] = []
    for (let from = 0; from < 12000; from += 1000) {
      const { data } = await sb.from('guesty_reviews').select('listing_id, rating, content, has_reply, created_at, channel').eq('excluded_from_score', false).range(from, from + 999)
      if (!data || data.length === 0) break
      all = all.concat(data); if (data.length < 1000) break
    }
    return all
  }
  const [revRows, { data: listings }, { data: work }, { data: resv }] = await Promise.all([
    fetchAllReviews(),
    sb.from('guesty_listings').select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, pictures, address_city, raw').limit(2000),
    sb.from('field_requests').select('building, priority, status').in('status', ['open', 'in_progress']).limit(2000),
    sb.from('guesty_reservations').select('listing_id, check_in, check_out, status').gte('check_out', today).limit(8000),
  ])

  const openByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => { const b = rollupBuilding(w.building); if (!b || b === 'Unassigned') return; const wt = String(w.priority).toLowerCase() === 'high' || w.priority === 1 ? 2 : 1; openByBuilding[b] = (openByBuilding[b] || 0) + wt })

  const byListing = new Map<string, HealthReview[]>()
  ;(revRows ?? []).forEach((r: any) => { if (!r.listing_id) return; const a = byListing.get(r.listing_id) || []; a.push({ rating: r.rating != null && r.rating !== '' ? Number(r.rating) : null, channel: r.channel, content: r.content, created_at: r.created_at, hasReply: !!r.has_reply }); byListing.set(r.listing_id, a) })

  // Upcoming reservations per listing -> next vacant day.
  const resvByListing = new Map<string, { check_in: string; check_out: string }[]>()
  ;(resv ?? []).forEach((r: any) => { if (!r.listing_id || /cancel|declin/i.test(String(r.status || ''))) return; const a = resvByListing.get(String(r.listing_id)) || []; a.push({ check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10) }); resvByListing.set(String(r.listing_id), a) })
  const nextVacant = (lid: string) => {
    const rs = resvByListing.get(lid) || []
    for (let i = 0; i <= horizon; i++) { const d = addDays(new Date(), i); if (!rs.some(r => r.check_in <= d && d < r.check_out)) return d }
    return today
  }

  const active = (listings ?? []).filter((l: any) => !DEAD.includes(String(l.status || '').toLowerCase()) && rollupBuilding(l.building).toLowerCase() !== 'waves')

  type Item = { team: string; market: string; building: string | null; title: string; detail: string; priority: number; listing_id: string; issue_key: string; scheduled_date: string }
  const items: Item[] = []
  for (const l of active) {
    const building = rollupBuilding(l.building)
    const nm = l.title || l.nickname || l.id
    const h = computeListingHealth(l, byListing.get(l.id) || [], { openWork: openByBuilding[building] || 0 })
    const market = marketOf(l.building || building, l.address_city, nm)
    for (const i of h.issues) {
      if (!departmentFor(i.key, i.owner)) continue // field tasks only
      const pri = i.severity === 'critical' ? 1 : i.severity === 'high' ? 1 : i.severity === 'medium' ? 2 : 3
      const team = market === 'Broward' ? 'broward' : 'miami'
      items.push({ team, market, building: building !== 'Unassigned' ? building : null, title: `${nm} — ${i.title}`, detail: i.action, priority: pri, listing_id: l.id, issue_key: i.key, scheduled_date: nextVacant(l.id) })
    }
  }
  items.sort((a, b) => (a.priority - b.priority) || a.scheduled_date.localeCompare(b.scheduled_date))
  const top = items.slice(0, 60)
  if (!top.length) return NextResponse.json({ error: 'No field actions to plan right now — the portfolio is clean.' }, { status: 200 })

  const weekOf = mondayOf(today)
  const plan = await sb.from('ops_plans').insert({ created_by: user.email || null, title: `Action Plan — week of ${weekOf}`, summary: `${top.length} field actions scheduled across the week, organized by each unit's next vacant day.`, source: 'manual', status: 'open', kind: 'weekly', week_of: weekOf }).select('id').single()
  if (plan.error) { const hint = /relation .*ops_plan|column .*(kind|week_of|scheduled_date)/.test(plan.error.message) ? ' (Run migrations 009 + 010 in Supabase first.)' : ''; return NextResponse.json({ error: 'Save failed: ' + plan.error.message + hint }, { status: 500 }) }
  const rows = top.map(it => ({ plan_id: plan.data.id, team: it.team, market: it.market, building: it.building, title: it.title.slice(0, 200), detail: it.detail.slice(0, 600), source: 'kpi', priority: it.priority, status: 'open', listing_id: it.listing_id, issue_key: it.issue_key, scheduled_date: it.scheduled_date }))
  const ins = await sb.from('ops_plan_items').insert(rows)
  if (ins.error) { const hint = /column .*(listing_id|issue_key|scheduled_date|market)/.test(ins.error.message) ? ' (Run migration 010 in Supabase first.)' : ''; return NextResponse.json({ error: 'Save failed: ' + ins.error.message + hint }, { status: 500 }) }
  return NextResponse.json({ id: plan.data.id, count: rows.length })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  if (body?.mode === 'weekly') {
    try { return await generateWeekly(user) } catch (e: any) { return NextResponse.json({ error: e?.message || String(e) }, { status: 500 }) }
  }

  // ---- Legacy AI ops plan (default) ----
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })
  const source = body?.source === 'morning-auto' ? 'morning-auto' : 'manual'
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const in7 = addDays(today, 7)

  let context: any = { today: todayStr }
  try {
    const [{ count: pendingCount }, { count: openCount }, { count: arrivals7 }, { data: arrivals }, { data: openWork }, { data: listings }] = await Promise.all([
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).gt('check_in', todayStr).lte('check_in', in7),
      supabase.from('guesty_reservations').select('guest_name,listing_name,nights,check_in,check_out').gte('check_in', todayStr).lte('check_in', in7).order('check_in').limit(40),
      supabase.from('field_requests').select('title,building,unit,priority,due_at,status').in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(40),
      supabase.from('guesty_listings').select('nickname,title').limit(300)
    ])
    const overdue = (openWork || []).filter((r: any) => r.due_at && r.due_at < todayStr)
    context = { today: todayStr, approvalsPending: pendingCount ?? 0, openWork: openCount ?? 0, overdue: overdue.length, arrivalsNext7: arrivals7 ?? 0, upcomingArrivals: (arrivals || []).slice(0, 30), openItems: (openWork || []).slice(0, 30), buildings: Array.from(new Set((listings || []).map((l: any) => (l.nickname || l.title || '').split(/[#\d]/)[0].trim()).filter(Boolean))).slice(0, 40) }
  } catch (e) { /* minimal context */ }

  const SYSTEM = `You are the operations planner for Stay Hospitality (South Florida short-term rentals). Teams: "ccs" (central guest communications & customer service - handles guest messaging, reviews, and customer service across all markets), "miami" (field/turnover/maintenance team for the Miami market), and "broward" (field/turnover/maintenance team for the Broward market). From the live snapshot, produce a concise, actionable daily operations plan as STRICT JSON only (no prose, no markdown), shaped exactly:
{"title": string, "summary": string, "items": [{"team": "ccs"|"miami"|"broward", "building": string, "title": string, "detail": string, "source": "feedback"|"reservation"|"breezeway"|"kpi"|"other", "priority": 1|2|3}]}
Rules:
- 6-16 items total. Prioritize turnovers for today/tomorrow check-ins, overdue work, approvals, and guest-impacting issues.
- Route guest-messaging, review-response, and customer-service items to "ccs". Route field/turnover/cleaning/maintenance items to "miami" or "broward" by the building's market.
- If a building's market is unknown, make your best guess and note it in detail.
- priority 1 = urgent/guest-impacting, 2 = normal, 3 = nice-to-have.
- Be specific and operational ("Stage early check-in cleaning for ...", "Confirm door code works for arrival ..."). Never invent guest names or numbers not in the snapshot.
- Output ONLY the JSON object.`

  let parsed: any = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: `Live snapshot (JSON):\n${JSON.stringify(context)}\n\nGenerate the plan JSON now.` }] }) })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || '').slice(0, 200)}` }, { status: 502 })
    let txt = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('') : ''
    const a = txt.indexOf('{'); const b = txt.lastIndexOf('}'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
    parsed = JSON.parse(txt)
  } catch (e: any) { return NextResponse.json({ error: 'Could not parse plan: ' + (e?.message || String(e)) }, { status: 502 }) }

  const items = Array.isArray(parsed?.items) ? parsed.items : []
  if (!items.length) return NextResponse.json({ error: 'No plan items generated.' }, { status: 502 })

  try {
    const sb = supabaseAdmin()
    const { data: plan, error: pErr } = await sb.from('ops_plans').insert({ created_by: user.email || null, title: String(parsed.title || `Ops Plan — ${todayStr}`).slice(0, 200), summary: String(parsed.summary || '').slice(0, 1000), source, status: 'open' }).select('id').single()
    if (pErr) throw pErr
    const rows = items.slice(0, 30).map((it: any) => ({ plan_id: plan.id, team: ['ccs', 'miami', 'broward'].includes(String(it.team || '').toLowerCase()) ? String(it.team).toLowerCase() : 'miami', building: String(it.building || '').slice(0, 120) || null, title: String(it.title || 'Action').slice(0, 200), detail: String(it.detail || '').slice(0, 600) || null, source: ['feedback', 'reservation', 'breezeway', 'kpi', 'other'].includes(String(it.source)) ? it.source : 'other', priority: [1, 2, 3].includes(Number(it.priority)) ? Number(it.priority) : 2, status: 'open' }))
    const { error: iErr } = await sb.from('ops_plan_items').insert(rows)
    if (iErr) throw iErr
    return NextResponse.json({ id: plan.id, count: rows.length })
  } catch (e: any) { const msg = e?.message || String(e); const hint = /relation .*ops_plan/.test(msg) ? ' (Run the ops_plans SQL in Supabase first.)' : ''; return NextResponse.json({ error: 'Save failed: ' + msg + hint }, { status: 500 }) }
}
