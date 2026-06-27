// Generate an operational plan from live data, grouped by Miami Team / Broward Team.
// Reads context (reservations, approvals, open work), asks Claude for structured items,
// and persists a plan + items (service role). Logged-in users only. Needs ANTHROPIC_API_KEY.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const source = body?.source === 'morning-auto' ? 'morning-auto' : 'manual'

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const in7 = addDays(today, 7)

  let context: any = { today: todayStr }
  try {
    const [
      { count: pendingCount }, { count: openCount }, { count: arrivals7 },
      { data: arrivals }, { data: openWork }, { data: listings }
    ] = await Promise.all([
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).gt('check_in', todayStr).lte('check_in', in7),
      supabase.from('guesty_reservations').select('guest_name,listing_name,nights,check_in,check_out').gte('check_in', todayStr).lte('check_in', in7).order('check_in').limit(40),
      supabase.from('field_requests').select('title,building,unit,priority,due_at,status').in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(40),
      supabase.from('guesty_listings').select('nickname,title').limit(300)
    ])
    const overdue = (openWork || []).filter((r: any) => r.due_at && r.due_at < todayStr)
    context = {
      today: todayStr,
      approvalsPending: pendingCount ?? 0,
      openWork: openCount ?? 0,
      overdue: overdue.length,
      arrivalsNext7: arrivals7 ?? 0,
      upcomingArrivals: (arrivals || []).slice(0, 30),
      openItems: (openWork || []).slice(0, 30),
      buildings: Array.from(new Set((listings || []).map((l: any) => (l.nickname || l.title || '').split(/[#\d]/)[0].trim()).filter(Boolean))).slice(0, 40)
    }
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
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8', max_tokens: 2000, system: SYSTEM,
        messages: [{ role: 'user', content: `Live snapshot (JSON):\n${JSON.stringify(context)}\n\nGenerate the plan JSON now.` }]
      })
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || '').slice(0, 200)}` }, { status: 502 })
    let txt = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('') : ''
    const a = txt.indexOf('{'); const b = txt.lastIndexOf('}')
    if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
    parsed = JSON.parse(txt)
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not parse plan: ' + (e?.message || String(e)) }, { status: 502 })
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : []
  if (!items.length) return NextResponse.json({ error: 'No plan items generated.' }, { status: 502 })

  try {
    const sb = supabaseAdmin()
    const { data: plan, error: pErr } = await sb.from('ops_plans').insert({
      created_by: user.email || null,
      title: String(parsed.title || `Ops Plan — ${todayStr}`).slice(0, 200),
      summary: String(parsed.summary || '').slice(0, 1000),
      source, status: 'open'
    }).select('id').single()
    if (pErr) throw pErr

    const rows = items.slice(0, 30).map((it: any) => ({
      plan_id: plan.id,
      team: ['ccs', 'miami', 'broward'].includes(String(it.team || '').toLowerCase()) ? String(it.team).toLowerCase() : 'miami',
      building: String(it.building || '').slice(0, 120) || null,
      title: String(it.title || 'Action').slice(0, 200),
      detail: String(it.detail || '').slice(0, 600) || null,
      source: ['feedback', 'reservation', 'breezeway', 'kpi', 'other'].includes(String(it.source)) ? it.source : 'other',
      priority: [1, 2, 3].includes(Number(it.priority)) ? Number(it.priority) : 2,
      status: 'open'
    }))
    const { error: iErr } = await sb.from('ops_plan_items').insert(rows)
    if (iErr) throw iErr

    return NextResponse.json({ id: plan.id, count: rows.length })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const hint = /relation .*ops_plan/.test(msg) ? ' (Run the ops_plans SQL in Supabase first.)' : ''
    return NextResponse.json({ error: 'Save failed: ' + msg + hint }, { status: 500 })
  }
}
