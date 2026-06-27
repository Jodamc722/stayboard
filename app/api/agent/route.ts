// Eve — Stay Hospitality's GM brain. A TOOL-USING agent: she gets a light headline snapshot for instant
// situational awareness, plus read tools to query ANY live data on demand (reviews, reservations,
// listings, conversations, field work, revenue, full listing detail). She loops, pulling whatever she
// needs, then answers. Logged-in users only. Model: claude-opus-4-8.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}
function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function daysAgoISO(n: number) { return new Date(Date.now() - n * 86400000).toISOString() }
function clampLimit(n: any, def = 25, max = 50) { const x = Number(n); return Math.min(Math.max(Number.isFinite(x) ? x : def, 1), max) }

const DEAD = /inactive|disabled|archived|deleted/i

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const messages = Array.isArray(body?.messages) ? body.messages.filter((m: any) => m && m.role && m.content).slice(-12) : []
  if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 })

  const db = supabaseAdmin()
  const today = todayET()

  // Listing id -> {name, status, building} map for joins / friendly names.
  const listingMeta: Record<string, { name: string; status: string; building: string }> = {}
  try {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building')
    for (const l of (data || [])) listingMeta[String((l as any).id)] = { name: (l as any).nickname || (l as any).title || '', status: String((l as any).status || '').toLowerCase(), building: String((l as any).building || '') }
  } catch { /* table may be empty */ }
  const nameOf = (lid: any) => listingMeta[String(lid)]?.name || 'Unknown'
  const buildingOf = (lid: any) => rollupBuilding(listingMeta[String(lid)]?.building)
  const reviewable = (lid: any) => { const m = listingMeta[String(lid)]; return !!m && !DEAD.test(m.status) && m.building.toLowerCase() !== 'waves' }

  const safe = async <T>(p: PromiseLike<T>, fb: T): Promise<T> => { try { return await p } catch { return fb } }
  const cnt = async (q: any) => { const r = await safe(q, { count: 0 } as any); return (r as any).count || 0 }

  // --- Light headline snapshot (cheap counts) for instant awareness ---
  const cutoff60 = daysAgoISO(60)
  const [unansweredRows, unreadCount, checkinCount, checkoutCount, inhouseCount, openFW, apprFW, activeListings] = await Promise.all([
    safe(db.from('guesty_reviews').select('listing_id').eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', cutoff60).limit(500), { data: [] } as any),
    cnt(db.from('guesty_conversations').select('*', { count: 'exact', head: true }).gt('unread_count', 0)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', today).gt('check_out', today)),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).eq('approval_required', true).neq('approval_status', 'approved')),
    cnt(db.from('guesty_listings').select('*', { count: 'exact', head: true })),
  ])
  const unansweredActionable = (unansweredRows.data || []).filter((r: any) => reviewable(r.listing_id)).length
  const headline = { today, unanswered_reviews_60d: unansweredActionable, unread_guest_threads: unreadCount, checkins_today: checkinCount, checkouts_today: checkoutCount, in_house_now: inhouseCount, open_field_work: openFW, approvals_waiting: apprFW, listings_total: activeListings }

  // --- Tool implementations (read-only queries over the live data) ---
  async function runTool(name: string, input: any): Promise<any> {
    try {
      if (name === 'search_reviews') {
        let q = db.from('guesty_reviews').select('listing_id,rating,content,channel,guest_name,created_at,has_reply').eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(clampLimit(input?.limit))
        if (input?.answered === 'unanswered') q = q.eq('has_reply', false)
        if (input?.answered === 'answered') q = q.eq('has_reply', true)
        if (input?.days) q = q.gte('created_at', daysAgoISO(Number(input.days)))
        if (input?.min_rating != null) q = q.gte('rating', Number(input.min_rating))
        if (input?.max_rating != null) q = q.lte('rating', Number(input.max_rating))
        const { data } = await q
        let rows = (data || []).filter((r: any) => reviewable(r.listing_id)).map((r: any) => ({ property: nameOf(r.listing_id), building: buildingOf(r.listing_id), rating: r.rating, channel: r.channel, guest: r.guest_name, answered: !!r.has_reply, date: String(r.created_at).slice(0, 10), text: String(r.content || '').slice(0, 280) }))
        if (input?.building) rows = rows.filter((x: any) => x.building.toLowerCase().includes(String(input.building).toLowerCase()))
        return { count: rows.length, reviews: rows.slice(0, clampLimit(input?.limit)) }
      }
      if (name === 'search_reservations') {
        let q = db.from('guesty_reservations').select('guest_name,listing_name,nights,money_total,status,source,check_in,check_out').limit(clampLimit(input?.limit, 30))
        const t = input?.type
        if (t === 'checkin') q = q.eq('check_in', input?.date || today)
        else if (t === 'checkout') q = q.eq('check_out', input?.date || today)
        else if (t === 'inhouse') q = q.lte('check_in', today).gt('check_out', today)
        else { if (input?.from) q = q.gte('check_in', input.from); if (input?.to) q = q.lte('check_in', input.to); q = q.order('check_in') }
        if (input?.status) q = q.ilike('status', `%${input.status}%`)
        const { data } = await q
        let rows = (data || [])
        if (input?.building) rows = rows.filter((r: any) => String(r.listing_name || '').toLowerCase().includes(String(input.building).toLowerCase()))
        return { count: rows.length, reservations: rows.slice(0, clampLimit(input?.limit, 30)) }
      }
      if (name === 'search_listings') {
        const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_city')
        let rows = (data || []).map((l: any) => ({ id: l.id, name: l.nickname || l.title, building: rollupBuilding(l.building), status: l.status, beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy, city: l.address_city }))
        if (input?.building) rows = rows.filter((x: any) => x.building.toLowerCase().includes(String(input.building).toLowerCase()))
        if (input?.status) rows = rows.filter((x: any) => String(x.status || '').toLowerCase().includes(String(input.status).toLowerCase()))
        if (input?.query) rows = rows.filter((x: any) => String(x.name || '').toLowerCase().includes(String(input.query).toLowerCase()))
        return { count: rows.length, listings: rows.slice(0, clampLimit(input?.limit, 50)) }
      }
      if (name === 'listing_detail') {
        let q = db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_city,amenities,pictures,raw')
        if (input?.id) q = q.eq('id', input.id)
        else if (input?.name) q = q.or(`nickname.ilike.%${input.name}%,title.ilike.%${input.name}%`)
        const { data } = await q.limit(1)
        const l: any = (data || [])[0]
        if (!l) return { error: 'listing not found' }
        const raw = l.raw || {}; const pub = raw.publicDescription || {}
        const { data: revs } = await db.from('guesty_reviews').select('rating').eq('listing_id', l.id).eq('excluded_from_score', false)
        const rr = (revs || []).map((x: any) => Number(x.rating)).filter(Number.isFinite)
        return { name: l.nickname || l.title, building: rollupBuilding(l.building), status: l.status, beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy, city: l.address_city, amenities_count: Array.isArray(l.amenities) ? l.amenities.length : (Array.isArray(raw.amenities) ? raw.amenities.length : 0), photo_count: Array.isArray(l.pictures) ? l.pictures.length : (Array.isArray(raw.pictures) ? raw.pictures.length : 0), has_title: !!l.title, description_sections_filled: Object.keys(pub).filter(k => pub[k]), review_count: rr.length, avg_rating: rr.length ? Math.round((rr.reduce((a, b) => a + b, 0) / rr.length) * 100) / 100 : null, last_optimized: raw._lastOptimized || null }
      }
      if (name === 'unread_conversations') {
        const { data } = await db.from('guesty_conversations').select('guest_name,channel,unread_count,last_message_preview,last_message_at').gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(clampLimit(input?.limit, 40))
        return { count: (data || []).length, threads: data || [] }
      }
      if (name === 'field_work') {
        let q = db.from('field_requests').select('title,type,priority,building,status,due_at,vendor,amount_usd,assignee_email,approval_required,approval_status').limit(clampLimit(input?.limit, 50))
        if (input?.status) q = q.eq('status', input.status); else q = q.in('status', ['open', 'in_progress'])
        if (input?.approval_only) q = q.eq('approval_required', true)
        q = q.order('due_at', { ascending: true, nullsFirst: false })
        const { data } = await q
        let rows = (data || [])
        if (input?.building) rows = rows.filter((r: any) => String(r.building || '').toLowerCase().includes(String(input.building).toLowerCase()))
        return { count: rows.length, field_work: rows }
      }
      if (name === 'revenue') {
        let q = db.from('guesty_reservations').select('money_total,nights,status,check_in,listing_name')
        if (input?.from) q = q.gte('check_in', input.from)
        if (input?.to) q = q.lte('check_in', input.to)
        const { data } = await q.limit(5000)
        let rows = (data || []).filter((r: any) => !/cancel|declin/i.test(String(r.status || '')))
        if (input?.building) rows = rows.filter((r: any) => String(r.listing_name || '').toLowerCase().includes(String(input.building).toLowerCase()))
        const rev = rows.reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)
        const nights = rows.reduce((s: number, r: any) => s + (Number(r.nights) || 0), 0)
        return { reservations: rows.length, revenue: Math.round(rev), nights, adr: nights ? Math.round(rev / nights) : null }
      }
      return { error: `unknown tool ${name}` }
    } catch (e: any) { return { error: String(e?.message || e).slice(0, 160) } }
  }

  const tools = [
    { name: 'search_reviews', description: 'Search guest reviews. Filter by answered ("answered"|"unanswered"|"all"), days (lookback), min_rating, max_rating, building. Returns property, rating, channel, guest, text, answered.', input_schema: { type: 'object', properties: { answered: { type: 'string' }, days: { type: 'number' }, min_rating: { type: 'number' }, max_rating: { type: 'number' }, building: { type: 'string' }, limit: { type: 'number' } } } },
    { name: 'search_reservations', description: 'Search reservations. type: "checkin"|"checkout"|"inhouse"|"range". For range use from/to (YYYY-MM-DD on check_in). Filter by building, status. Returns guest, listing, nights, money_total, dates.', input_schema: { type: 'object', properties: { type: { type: 'string' }, date: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, building: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } } } },
    { name: 'search_listings', description: 'List/search listings (units). Filter by building, status, query (name match). Returns id, name, building, status, beds/baths/sleeps, city.', input_schema: { type: 'object', properties: { building: { type: 'string' }, status: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } } } },
    { name: 'listing_detail', description: 'Full detail for ONE listing by name or id: amenities count, photo count, description sections filled, review count + avg rating, last optimized.', input_schema: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } } },
    { name: 'unread_conversations', description: 'Guest message threads with unread messages.', input_schema: { type: 'object', properties: { limit: { type: 'number' } } } },
    { name: 'field_work', description: 'Field work / maintenance requests. Filter by status (default open+in_progress), building, approval_only.', input_schema: { type: 'object', properties: { status: { type: 'string' }, building: { type: 'string' }, approval_only: { type: 'boolean' }, limit: { type: 'number' } } } },
    { name: 'revenue', description: 'Revenue summary over reservations in a check-in date range (from/to YYYY-MM-DD), optional building. Returns reservations, revenue, nights, ADR.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, building: { type: 'string' } } } },
  ]

  const SYSTEM = `You are Eve — the operating brain for Stay Hospitality, a ~235-unit South Florida short-term-rental manager. You work directly with Jon (owner / GM) as his sharp, trusted right hand.

Talk like a real, smart operator — the way an excellent chief of staff actually talks: natural, direct, plain English. Short sentences. Say what matters and get to the point. NO flowery hotel-concierge language, no corporate filler, no "I'd be delighted to," no "rest assured." You're a person who's great at this job, not a brochure.

Be genuinely smart: interpret data, don't just repeat it. Find what matters, reason about WHY, connect signals across reviews, messages, field work and revenue, and tell Jon what you'd do and why.

YOU HAVE LIVE DATA TOOLS. Use them. The headline snapshot below is only a starting glance — whenever Jon asks about anything specific (a building, a unit, a date range, revenue, a guest, low reviews, who's arriving, what's overdue), CALL THE TOOLS to pull the real records before answering. Chain several tool calls if needed. NEVER say you don't have access to something without trying a tool first. Cite the real figures you pull. If a tool returns empty, say that data isn't synced rather than guessing.

TEAMS: work is run by three teams — CCS, Miami, Broward. Organize dispatched actions by team. Refer to buildings by rolled-up name (Botanica, Oasis, Arya).

HEADLINE SNAPSHOT (a glance, not the whole picture — use tools for depth):
${JSON.stringify(headline)}

REVIEW-REPLY SAFETY (when drafting any guest-facing reply/message): never admit fault; never mention unit numbers; never affirm/name bed bugs, pests, break-ins, intrusion or anyone "walking in" — thank the guest and note the team is looking into it; keep it gracious and brief; redirect serious claims to a private channel.

STYLE: human and natural, short sentences, lead with the answer or the call, bullets only when they truly help. Make Jon's next decision obvious.`

  // --- Tool-use loop ---
  const convo: any[] = messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 8000) }))
  try {
    let finalText = ''
    for (let turn = 0; turn < 6; turn++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 2048, system: SYSTEM, tools, messages: convo }),
      })
      const d: any = await r.json()
      if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
      convo.push({ role: 'assistant', content: d.content })
      if (d.stop_reason === 'tool_use') {
        const results: any[] = []
        for (const block of (d.content || [])) {
          if (block?.type === 'tool_use') {
            const out = await runTool(block.name, block.input || {})
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 7000) })
          }
        }
        convo.push({ role: 'user', content: results })
        continue
      }
      finalText = (d.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      break
    }
    return NextResponse.json({ reply: finalText || '(no response)' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
