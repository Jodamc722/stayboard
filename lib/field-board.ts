// THE FIELD BOARD — a configurable, brief-shaped live board (Jon, 2026-08-25: "where do these live
// links live… should be able to select the units per area, who can see them" + "it should look a
// lot like the daily brief").
//
// The two hardcoded URLs (/day?market=Miami|Broward) were a start, not an answer: the market list
// lived in code and every share link opened with one global password. A board is now a ROW in
// `share_links` — the same table, builder and hub as every other link Jon shares — so a board can
// cover a market, a building, a set of buildings or hand-picked units ("Gehron's route"), carries
// its own passcode, shows only the sections it was given, and can be revoked on its own.
//
// ACCESS, BOTH WAYS (Jon's choice): a signed-in Lighthouse user walks straight in; everyone else
// types the board's own passcode. A board with no passcode still accepts the standing share
// password, so nothing that works today stops working.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildDaySheet } from './daysheet'
import { marketOf, buildingOf } from './segments'
import { getShifts, nameMatches } from './homebase'
import { getTimecards } from './homebase-labor'

const TZ = 'America/New_York'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

/** The five things a field board can carry. A board shows exactly what it was ticked for. */
export const BOARD_SECTIONS = ['today', 'units', 'crew', 'cleans', 'verify', 'vacant', 'work', 'issues', 'requests', 'add'] as const
export type BoardSection = typeof BOARD_SECTIONS[number]
export const isBoardLink = (sections: any): boolean =>
  !!sections && BOARD_SECTIONS.some(k => sections[k] === true)

export type BoardLink = {
  id: string; code: string; label: string
  scope_type: string; scope_ids: string[]
  sections: Record<string, boolean>
  passcode: string | null
}

export async function getBoardLink(code: string): Promise<BoardLink | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('share_links').select('*').eq('code', code).is('revoked_at', null).limit(1)
  const row = (data || [])[0] as any
  if (!row || !isBoardLink(row.sections)) return null
  return {
    id: str(row.id), code: str(row.code), label: str(row.label) || 'Field board',
    scope_type: str(row.scope_type) || 'portfolio',
    scope_ids: Array.isArray(row.scope_ids) ? row.scope_ids.map(str) : [],
    sections: (row.sections || {}) as Record<string, boolean>,
    passcode: row.passcode ? str(row.passcode) : null,
  }
}

/**
 * WHICH UNITS THIS BOARD IS ABOUT. Buildings resolve through the canonical `buildingOf()` registry
 * (lib/segments), never the raw Guesty column — that column holds 78 spellings for 23 buildings and
 * is exactly why "Botanica" once meant 15 of 53 units on a share link.
 */
async function scopeIds(link: BoardLink): Promise<{ ids: Set<string> | null; label: string }> {
  const db = supabaseAdmin()
  if (link.scope_type === 'portfolio') return { ids: null, label: 'Whole portfolio' }
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(3000)
  const rows = (lRows || []) as any[]
  const ids = new Set<string>()
  if (link.scope_type === 'listing') {
    for (const id of link.scope_ids) ids.add(str(id))
    return { ids, label: `${ids.size} unit${ids.size === 1 ? '' : 's'}` }
  }
  if (link.scope_type === 'owner') {
    const { data: owners } = await db.from('guesty_owners').select('id, listing_ids').in('id', link.scope_ids).limit(200)
    for (const o of ((owners || []) as any[])) for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) ids.add(str(id))
    return { ids, label: 'Owner units' }
  }
  const want = link.scope_ids.map(s => str(s).toLowerCase())
  for (const l of rows) {
    const nm = l.nickname || l.title || ''
    const hit = link.scope_type === 'market'
      ? want.includes(str(marketOf(l.building, l.address_city, nm)).toLowerCase())
      : want.includes(str(buildingOf(str(l.building), nm) || '').toLowerCase())
    if (hit) ids.add(str(l.id))
  }
  return { ids, label: link.scope_ids.join(' · ') }
}

/** Live crew for this board's units: on shift, clocked in, what each person is on right now. */
async function crewFor(ids: Set<string> | null, scopeWords: string[]) {
  const today = ymdET(new Date())
  const [shifts, cards] = await Promise.all([
    getShifts(today, TZ).catch(() => [] as any[]),
    getTimecards(today, today).catch(() => [] as any[]),
  ])
  const db = supabaseAdmin()
  const [{ data: tRows }, { data: lRows }] = await Promise.all([
    db.from('breezeway_tasks_sync')
      .select('id,name,status,assignees,reference_property_id,started_at,finished_at')
      .eq('scheduled_date', today).limit(3000),
    db.from('guesty_listings').select('id,nickname,title').limit(3000),
  ])
  const unitOf: Record<string, string> = {}
  for (const l of ((lRows || []) as any[])) unitOf[str(l.id)] = l.nickname || l.title || 'Unit'
  type Job = { id: string; lid: string; unit: string; task: string; state: 'done' | 'running' | 'open' }
  const jobsFor: Record<string, Job[]> = {}
  for (const t of ((tRows || []) as any[])) {
    const st = str(t.status).toLowerCase()
    if (/delete|cancel/.test(st)) continue
    const lid = str(t.reference_property_id)
    if (ids && !ids.has(lid)) continue
    const job: Job = {
      id: str(t.id), lid, unit: unitOf[lid] || 'Unit', task: str(t.name).slice(0, 80),
      state: (t.finished_at || /complete|finish|close|approv/.test(st)) ? 'done'
        : (t.started_at || /progress|started/.test(st)) ? 'running' : 'open',
    }
    for (const a of (Array.isArray(t.assignees) ? t.assignees : [])) {
      const who = str(a?.name || a).trim()
      if (who) (jobsFor[who] = jobsFor[who] || []).push(job)
    }
  }
  // CLOCKED IN NOW = an open card dated today. `open` alone also matches a card somebody forgot
  // to close last week (reference-homebase-and-kpis).
  const openNow = ((cards || []) as any[]).filter(c => (c as any).open && str((c as any).date).slice(0, 10) === today).map(c => str((c as any).name))
  const all = (shifts as any[]).filter(s => !s.open && s.startAt).map(s => {
    const name = str(s.name)
    const jobs = Object.keys(jobsFor).filter(k => nameMatches(k, name)).flatMap(k => jobsFor[k])
    const seen = new Set<string>()
    const uniq = jobs.filter(j => (seen.has(j.id) ? false : (seen.add(j.id), true)))
    return {
      name, role: str(s.role), shift: str(s.label),
      clockedIn: openNow.some(n => nameMatches(n, name)),
      onNow: uniq.filter(j => j.state === 'running'),
      done: uniq.filter(j => j.state === 'done').length,
      left: uniq.filter(j => j.state !== 'done').length,
      jobs: uniq,
    }
  }).sort((a, b) => (b.clockedIn ? 1 : 0) - (a.clockedIn ? 1 : 0) || a.name.localeCompare(b.name))
  // Homebase is ONE location — a shift carries no market. Somebody belongs on this board when they
  // hold work in it, or when Homebase's own role text names the scope; the rest are a count.
  const belongs = (p: any) => !ids || p.jobs.length > 0 || scopeWords.some(w => w && new RegExp(w, 'i').test(p.role || ''))
  const people = all.filter(belongs)
  return {
    people, elsewhere: all.length - people.length,
    onShift: people.length, clockedIn: people.filter(p => p.clockedIn).length,
    openShifts: (shifts as any[]).filter(s => s.open).length,
    notClocked: people.filter(p => !p.clockedIn && p.left > 0).map(p => p.name),
  }
}

/**
 * TODAY'S PRIORITIES — the brief's Act-now list, for this board's units.
 * The day sheet already computes exceptions in plain English with the action attached ("checks out
 * at 10:00 and a guest arrives at 4:00 — nothing on the board to clean it"), so the board reads
 * the SAME source the 7am email does rather than inventing a second opinion. On top of those:
 * doors with nobody's name on them, same-day turns not started, and work booked into an occupied
 * unit — the three things that break a field day.
 */
function boardPriorities(sheet: any, keep: (r: any) => boolean) {
  const out: { tone: 'red' | 'amber'; lid: string; unit: string; what: string; how: string }[] = []
  const arrivingToday = new Set(((sheet.arrivals || []) as any[]).filter(keep).map((a: any) => String(a.listingId)))
  const deps = ((sheet.departures || []) as any[]).filter(keep)

  for (const d of deps) {
    const hot = arrivingToday.has(String(d.listingId))
    const st = String(d.clean?.status || '')
    const who = (d.clean?.assignees || []).filter(Boolean)
    if (!d.clean) {
      out.push({ tone: 'red', lid: String(d.listingId || ''), unit: String(d.unit), what: hot ? 'checks out today and a guest arrives — nothing on the board to clean it' : 'checks out today with no clean scheduled', how: 'Book the clean and put a name on it.' })
    } else if (!who.length) {
      out.push({ tone: 'red', lid: String(d.listingId || ''), unit: String(d.unit), what: 'clean has nobody assigned', how: hot ? 'Guest lands today — assign it first.' : 'Assign it before the crew splits up.' })
    } else if (hot && /not started/i.test(st)) {
      out.push({ tone: 'amber', lid: String(d.listingId || ''), unit: String(d.unit), what: 'same-day turn, not started', how: 'With ' + who.join(', ') + '. The guest lands this afternoon.' })
    }
  }
  // The day sheet's own exceptions — high severity first, and never duplicating a unit already named.
  const named = new Set(out.map(o => o.unit))
  for (const e of ((sheet.exceptions || []) as any[]).filter(keep)) {
    const unit = String(e.unit || '')
    if (named.has(unit)) continue
    out.push({ tone: e.severity === 'high' ? 'red' : 'amber', lid: String(e.listingId || ''), unit, what: String(e.detail || ''), how: String(e.action || '') })
    named.add(unit)
  }
  return out.slice(0, 12)
}

/**
 * WORTH KNOWING — the arrivals that change how a unit is treated, and the units to keep an eye on.
 * Same thresholds as the briefs and Slack (slack_rules): one definition of a long stay and a big
 * booking, everywhere. Reviews are the other half — a unit a guest just scored badly is a unit the
 * next guest must not find in the same state.
 */
async function worthKnowing(ids: Set<string> | null, today: string, unitName: (lid: string) => string) {
  const db = supabaseAdmin()
  let LONG_N = 14, BIG_USD = 3000, LOOK_D = 3
  try {
    const { getSlackRules } = await import('./slack-rules')
    const R: any = await getSlackRules()
    LONG_N = R.longStayNights || 14
    BIG_USD = R.bigBookingUsd || 3000
  } catch { /* defaults stand */ }
  const until = ymdET(new Date(Date.now() + LOOK_D * 86400000))
  const big: { lid: string; unit: string; guest: string; when: string; nights: number | null; total: number; why: string }[] = []
  try {
    const { data } = await db.from('guesty_reservations')
      .select('listing_id,check_in,nights,status,guest_name,money_total,source')
      .gte('check_in', today).lte('check_in', until).limit(600)
    for (const r of ((data || []) as any[])) {
      const lid = str(r.listing_id)
      if (ids && !ids.has(lid)) continue
      if (/cancel|declin/i.test(str(r.status))) continue
      const nights = r.nights != null ? Number(r.nights) : null
      const total = Math.round(Number(r.money_total) || 0)
      const owner = /^owner/i.test(str(r.source))
      const long = nights != null && nights >= LONG_N
      const isBig = total >= BIG_USD
      if (!owner && !long && !isBig) continue
      big.push({
        lid, unit: unitName(lid), guest: str(r.guest_name).split(' ')[0] || 'Guest',
        when: str(r.check_in).slice(0, 10), nights, total,
        why: owner ? 'Owner stay' : long ? nights + '-night stay' : 'Big booking',
      })
    }
  } catch { /* the card simply does not appear */ }
  big.sort((a, b) => a.when.localeCompare(b.when) || b.total - a.total)

  const watch: { lid: string; unit: string; why: string; said: string }[] = []
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data } = await db.from('guesty_reviews')
      .select('listing_id,rating,content,channel,created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(400)
    const { ratingToStars } = await import('./optimize-score')
    const seen = new Set<string>()
    for (const r of ((data || []) as any[])) {
      const lid = str(r.listing_id)
      if (ids && !ids.has(lid)) continue
      if (seen.has(lid)) continue
      const stars = ratingToStars(Number(r.rating))
      if (stars == null || stars > 3) continue
      seen.add(lid)
      watch.push({
        lid, unit: unitName(lid),
        why: stars.toFixed(1) + '★ ' + (str(r.channel) || 'review') + ' · ' + str(r.created_at).slice(5, 10),
        said: str(r.content).replace(/\s+/g, ' ').slice(0, 140),
      })
    }
  } catch { /* reviews are a bonus */ }
  return { big: big.slice(0, 8), watch: watch.slice(0, 6) }
}

/**
 * WHO A JOB CAN GO TO (Jon, 2026-08-25: "need to be able to assign and pick a date").
 *
 * Breezeway's people list, narrowed to the crews that actually work this board. A cleaner filing a
 * leak should see the handful of names they know, not 300 rows — so the list is ordered: people on
 * shift in this market today first (they can pick it up now), then everyone else on the right team.
 *
 * The department filter is applied in the BROWSER, not here, so switching Team on the form
 * re-narrows the list without another round trip.
 */
async function assignablePeople(scopeWords: string[]) {
  try {
    const { listBreezewayPeople } = await import('./breezeway')
    const people = await listBreezewayPeople()
    if (!people.length) return []
    // Who is on shift right now — those names float to the top of the picker.
    let onShift: string[] = []
    try {
      const shifts = await getShifts(ymdET(new Date()))
      onShift = (shifts || []).map((sh: any) => str(sh.name || sh.employee || '')).filter(Boolean)
    } catch { /* the picker still works, just unsorted by presence */ }
    const words = scopeWords.map(w => str(w).toLowerCase()).filter(Boolean)
    const near = (p: any) => !words.length || words.some(w =>
      str(p.region).toLowerCase().includes(w) || str(p.role).toLowerCase().includes(w))
    return people
      .map(p => ({
        id: p.id, name: p.name, departments: p.departments || [],
        region: p.region || '',
        here: onShift.some(n => nameMatches(n, p.name)),
        near: near(p),
      }))
      .sort((a, b) => Number(b.here) - Number(a.here) || Number(b.near) - Number(a.near) || a.name.localeCompare(b.name))
      .slice(0, 200)
  } catch { return [] }
}

/**
 * GUEST ORDERS & REQUESTS (Jon, 2026-08-25: "should also have guest orders / requests tab there").
 *
 * Two different things the crew is asked to carry, on one tab because from the field they feel the
 * same — somebody wants something in a unit:
 *
 *   ORDERS   a guest paid for water, a crib, late checkout. Already charged, already pushed to
 *            Breezeway on the delivery date, already assigned. What the board adds is the WHY and
 *            the WHAT — the basket itself, so the person carrying it knows what to carry, and the
 *            date, so nobody delivers a Thursday order on Tuesday.
 *   REQUESTS an open field request on one of these units — the ops side of "somebody wants
 *            something", raised by staff rather than a guest.
 *
 * Money shows because the order is already paid; the crew is not collecting. Delivered orders stay
 * for 36 hours so a shift that starts after one landed can still see it went.
 */
async function guestRequests(ids: Set<string> | null, today: string) {
  const db = supabaseAdmin()
  const soon = ymdET(new Date(Date.now() + 7 * 86400000))
  const mine = (lid: any) => !ids || ids.has(str(lid))
  const dayLabel = (d: string) => (!d ? '' : d === today ? 'today' : d < today ? 'overdue · ' + d : d === ymdET(new Date(Date.now() + 86400000)) ? 'tomorrow' : d)

  const orders: any[] = []
  try {
    // Everything still owed (paid/pushed, due within a week or already late) plus anything a
    // human still has to approve, plus what landed in the last 36h.
    const { data } = await db.from('guest_orders')
      .select('id,unit,listing_id,guest_name,status,items,total_usd,delivery_date,delivery_note,assignee_names,guest_note,submitted_at,delivered_at,check_in')
      .in('status', ['submitted', 'approved', 'awaiting_payment', 'paid', 'pushed', 'delivered'])
      .order('delivery_date', { ascending: true })
      .limit(300)
    const cut = Date.now() - 36 * 3_600_000
    for (const o of ((data || []) as any[])) {
      if (!mine(o.listing_id)) continue
      const st = str(o.status)
      const dd = str(o.delivery_date || '').slice(0, 10)
      if (st === 'delivered') {
        if (!o.delivered_at || new Date(o.delivered_at).getTime() < cut) continue
      } else if (st === 'paid' || st === 'pushed') {
        if (dd && dd > soon) continue          // further out than the board's week — not today's problem
      }
      const items = (Array.isArray(o.items) ? o.items : []).map((i: any) =>
        (Number(i?.qty) > 1 ? Number(i.qty) + '× ' : '') + str(i?.name || i?.sku)).filter(Boolean)
      orders.push({
        id: str(o.id), lid: str(o.listing_id), unit: str(o.unit) || 'Unit',
        guest: str(o.guest_name), status: st, items,
        total: Number(o.total_usd) || 0,
        when: dd, whenLabel: dayLabel(dd), note: str(o.delivery_note),
        guestNote: str(o.guest_note),
        assigned: (Array.isArray(o.assignee_names) ? o.assignee_names : []).map(str).filter(Boolean),
        // Rank: late first, then today, then waiting on a human, then the rest.
        rank: dd && dd < today && st !== 'delivered' ? 0
          : dd === today && st !== 'delivered' ? 1
          : st === 'submitted' || st === 'approved' || st === 'awaiting_payment' ? 2
          : st === 'delivered' ? 9 : 4,
      })
    }
  } catch { /* the orders table may not be reachable — the tab simply shows requests */ }
  orders.sort((a, b) => a.rank - b.rank || String(a.when).localeCompare(String(b.when)) || a.unit.localeCompare(b.unit))

  const requests: any[] = []
  try {
    const { data } = await db.from('field_requests')
      .select('id,type,title,description,listing_id,unit,building,priority,status,assignee_email,created_by_email,due_at,created_at,vendor,amount_usd')
      .not('status', 'in', '(done,cancelled)')
      .order('created_at', { ascending: false })
      .limit(400)
    const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    for (const r of ((data || []) as any[])) {
      if (!mine(r.listing_id)) continue
      const age = r.created_at ? Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 86400000)) : null
      requests.push({
        id: str(r.id), lid: str(r.listing_id), unit: str(r.unit) || 'Unit',
        title: str(r.title) || 'Request', detail: str(r.description).slice(0, 240),
        type: str(r.type), priority: str(r.priority) || 'medium', status: str(r.status) || 'open',
        who: str(r.assignee_email).split('@')[0], from: str(r.created_by_email).split('@')[0],
        due: str(r.due_at || '').slice(0, 10), dueLabel: dayLabel(str(r.due_at || '').slice(0, 10)),
        age, vendor: str(r.vendor),
        rank: (RANK[str(r.priority)] ?? 2) - (r.due_at && str(r.due_at).slice(0, 10) <= today ? 4 : 0),
      })
    }
  } catch { /* ditto */ }
  requests.sort((a, b) => a.rank - b.rank || (b.age ?? 0) - (a.age ?? 0))

  return { orders: orders.slice(0, 60), requests: requests.slice(0, 60) }
}

/**
 * TODAY IN OPS, SCOPED (Jon, 2026-08-25: "organized as today in ops"). One row per unit that has
 * anything happening today — a checkout, an arrival, open work, or an empty night — carrying the
 * chips that decide the order of the day. Grouped by building, because that is how a crew drives.
 */
function unitRows(sheet: any, keep: (r: any) => boolean, nameOf: Record<string, string>, buildingOf2: Record<string, string>) {
  const by: Record<string, any> = {}
  const touch = (lid: any, unit: any) => {
    const id = str(lid)
    if (!id) return null
    return (by[id] = by[id] || {
      lid: id, unit: nameOf[id] || str(unit) || 'Unit', building: buildingOf2[id] || 'Other',
      chips: [] as string[], clean: null as any, arrival: null as any, out: '', guest: '',
      jobs: 0, jobsOpen: 0, vacant: false, nextIn: null as number | null,
    })
  }
  for (const d of ((sheet.departures || []) as any[]).filter(keep)) {
    const u = touch(d.listingId, d.unit); if (!u) continue
    u.clean = d.clean || null; u.out = str(d.checkOutTime); u.guest = str(d.guest)
  }
  const arriving = new Set<string>()
  for (const a of ((sheet.arrivals || []) as any[]).filter(keep)) {
    const u = touch(a.listingId, a.unit); if (!u) continue
    u.arrival = { at: str(a.checkInTime), guest: str(a.guest).split(' ')[0], nights: a.nights ?? null }
    arriving.add(str(a.listingId))
  }
  for (const w of ((sheet.work || []) as any[]).filter(keep)) {
    const u = touch(w.listingId, w.unit); if (!u) continue
    u.jobs++; if (w.status !== 'done') u.jobsOpen++
  }
  for (const v of ((sheet.vacants || []) as any[]).filter(keep)) {
    const u = touch(v.listingId, v.unit); if (!u) continue
    u.vacant = true; u.nextIn = v.daysUntilArrival ?? null
  }
  const rows = Object.values(by).map((u: any) => {
    const st = str(u.clean?.status)
    const same = !!u.clean && arriving.has(u.lid)
    if (same) u.chips.push('same-day')
    if (u.clean && !(u.clean.assignees || []).length) u.chips.push('unassigned')
    if (u.clean) u.chips.push(/done/i.test(st) ? 'clean done' : /progress/i.test(st) ? 'cleaning' : 'to clean')
    if (u.arrival) u.chips.push('arrives ' + (u.arrival.at || 'today'))
    if (u.jobsOpen) u.chips.push(u.jobsOpen + ' job' + (u.jobsOpen === 1 ? '' : 's'))
    if (u.vacant) u.chips.push(u.nextIn == null ? 'empty' : 'empty · guest in ' + u.nextIn + 'd')
    // Rank: what breaks the day first.
    u.rank = same && !/done/i.test(st) ? 0
      : (u.clean && !(u.clean.assignees || []).length) ? 0
        : u.clean && !/done/i.test(st) ? 1
          : u.jobsOpen ? 2 : u.arrival ? 3 : 4
    return u
  }).sort((a: any, b: any) => a.rank - b.rank || a.unit.localeCompare(b.unit))
  const groups: Record<string, any[]> = {}
  for (const r of rows) (groups[r.building] = groups[r.building] || []).push(r)
  return Object.keys(groups)
    .sort((a, b) => Math.min(...groups[a].map((r: any) => r.rank)) - Math.min(...groups[b].map((r: any) => r.rank)) || a.localeCompare(b))
    .map(building => ({ building, rows: groups[building] }))
}

export async function buildFieldBoard(link: BoardLink) {
  const today = ymdET(new Date())
  const { ids, label: scopeLabel } = await scopeIds(link)
  // A market-scoped board hands the market straight to the day sheet; everything else builds the
  // whole day and filters, because the day sheet only knows markets.
  const marketArg = link.scope_type === 'market' && link.scope_ids.length === 1 ? link.scope_ids[0] : 'all'
  const sheet: any = await buildDaySheet(today, marketArg)
  const keep = (r: any) => !ids || ids.has(str(r.listingId ?? r.listing_id ?? r.id))
  const sections = link.sections || {}
  // Unit names and canonical buildings, read once. DECLARED BEFORE ANY CONSUMER: worthKnowing()
  // is handed a lookup into these maps and calls it during its own await, so a later `const`
  // would leave it in the temporal dead zone and every big booking would vanish into a catch.
  const nameOfUnit: Record<string, string> = {}
  const buildingOfUnit: Record<string, string> = {}
  try {
    const dbU = supabaseAdmin()
    const { data } = await dbU.from('guesty_listings').select('id,nickname,title,building').limit(3000)
    for (const l of ((data || []) as any[])) {
      const nm = l.nickname || l.title || 'Unit'
      nameOfUnit[str(l.id)] = nm
      buildingOfUnit[str(l.id)] = buildingOf(str(l.building), nm) || 'Other'
    }
  } catch { /* names fall back to whatever the rows carry */ }

  const crew = sections.crew ? await crewFor(ids, link.scope_type === 'listing' ? [] : link.scope_ids).catch(() => null) : null
  const notable = (sections.today || sections.units)
    ? await worthKnowing(ids, today, (lid) => nameOfUnit[lid] || 'Unit').catch(() => ({ big: [], watch: [] }))
    : { big: [], watch: [] }
  // The picker for Add — only built when the board can actually file work.
  const people = sections.add
    ? await assignablePeople(link.scope_type === 'listing' ? [] : link.scope_ids).catch(() => [])
    : []
  const asks = sections.requests
    ? await guestRequests(ids, today).catch(() => ({ orders: [], requests: [] }))
    : { orders: [], requests: [] }


  // The units this board may act on — the picker for Add, and the guard the add route enforces.
  // Always sent: a unit sheet needs names even when the board cannot add work.
  let units: { id: string; name: string }[] = []
  {
    const db = supabaseAdmin()
    const { data } = await db.from('guesty_listings').select('id,nickname,title').limit(3000)
    units = ((data || []) as any[])
      .filter(l => !ids || ids.has(str(l.id)))
      .map(l => ({ id: str(l.id), name: l.nickname || l.title || 'Unit' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    ok: true,
    label: link.label,
    scopeLabel,
    date: str(sheet.date || today),
    sections,
    lastSync: sheet.lastSync ?? null,
    sync: sheet.sync ?? null,
    crew,
    departures: sections.cleans ? ((sheet.departures || []) as any[]).filter(keep) : [],
    arrivals: sections.cleans || sections.verify ? ((sheet.arrivals || []) as any[]).filter(keep) : [],
    vacants: sections.vacant ? ((sheet.vacants || []) as any[]).filter(keep) : [],
    priorities: sections.today ? boardPriorities(sheet, keep) : [],
    bigBookings: notable.big,
    watchUnits: notable.watch,
    people,
    orders: asks.orders,
    requests: asks.requests,
    unitRows: sections.units ? unitRows(sheet, keep, nameOfUnit, buildingOfUnit) : [],
    units,
    work: sections.work ? ((sheet.work || []) as any[]).filter(keep) : [],
    glitches: sections.issues ? ((sheet.glitches || []) as any[]).filter(keep) : [],
    exceptions: sections.issues ? ((sheet.exceptions || []) as any[]).filter(keep) : [],
  }
}
