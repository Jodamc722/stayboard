// THE 360s — EVERYTHING ABOUT ONE UNIT, OR ONE BUILDING, IN ONE CALL (Eve reorganisation, 2026-11-10).
//
// Jon's goal for the reorganisation: Eve "should be better than anybody on the team when it comes to
// the knowledge base", and should help with "more informed decisions, property upkeep decisions".
// An upkeep decision is a JOIN — what the unit earns, what guests say about it, what keeps breaking,
// what we have spent fixing it, what is overdue — and until now those lived in six tools at four
// different grains (revenue stopped at the building; billing was by owner; reviews had no window).
// "Which units cost the most to maintain per booked night and have falling reviews" could not be
// answered at all.
//
// unit_360 and building_360 do that join in code. Every section is read through the same lib the page
// reads through, and each carries its own `_meta` — { source, window, as_of, n, truncated } — so she
// can say where each number came from. A section that cannot be read says `unavailable` with the
// reason and the other sections still answer: one slow read never costs the whole picture.
//
// THE NUMBERS, STATED ONCE:
//   revenue      lib/unit-revenue.ts unitRevenue(…, 'net') — accommodation after the channel fee
//                (lib/basis.ts, THE ONE NET), real stays only, prorated to the window. Owner stays hold
//                the unit, so their nights count in occupancy at $0 — the section says so.
//   reviews      lib/eve/reviews.ts — active units, current channel listing only, per channel.
//   billed       lib/billing.ts billingRange — what was BILLED TO THE OWNER for Breezeway work on the
//                unit. It is not what the work cost us (labor is in labor_economics, by person).
//   upkeep       lib/pm-calendar.ts — the PM ledger: last done / next due / days late per cadence.
import 'server-only'
import { unitRevenue, windowRange, type UnitRevenue } from '@/lib/unit-revenue'
import { billingRange } from '@/lib/billing'
import { isTaskDone, isTaskGone } from '@/lib/task-categories'
import { NET_BASIS_NOTE, LIVE_STAY_STATUSES } from '@/lib/basis'
import type { DueItem } from '@/lib/pm-calendar'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { clampDays, shiftDay, lc, num, round2, chunk, pageRows, resolveListing, DEAD_LISTING, toolMeta } from './ctx'
import { reviewStats } from './reviews'
import { brainDims, brainFresh, freshAll, brainMeta, readUnitDays, readEvents, readHealthLatest, newAcc, addDayRow, perfOf, physName, BRAIN_NIGHTS_BASIS, BILLED_NOTE, type Acc, type BrainTable } from './brain-data'
import { etDay } from '@/lib/brain/shared'
import { dueCalendarCached, blockedReportCached } from './reach'

type Sect<T> = { ok: true; v: T } | { ok: false; why: string }

/** Run one section with its own clock. A failure or a timeout is a labelled gap, never a thrown turn. */
async function sect<T>(what: string, ms: number, fn: () => Promise<T>): Promise<Sect<T>> {
  return new Promise<Sect<T>>(resolve => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, why: `${what} did not answer within ${Math.round(ms / 1000)} seconds` }) } }, ms)
    fn().then(
      v => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: true, v }) } },
      (e: any) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, why: `${what} could not be read (${String(e?.message || e).slice(0, 120)})` }) } },
    )
  })
}
const gap = (why: string) => ({ unavailable: why + ' — say you could not check this part.' })
const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** An upkeep line, compact — the 360 result has to fit the tool budget whole (upkeep_due has the long form). */
const dueShort = (it: DueItem) => {
  const o: any = { cadence: it.label, last_done: it.lastDone || (it.newUnit ? `none — new unit, clock from ${it.newUnit.goLive}` : it.clock ? `none — clock from ${it.clock.started}` : 'no record'), next_due: it.dueOn, state: it.band === 'late' ? `LATE ${it.daysOver}d` : it.band === 'week' ? 'due this week' : it.band === 'unknown' ? 'no record' : `in ${-it.daysOver}d` }
  if (it.scheduled) o.scheduled = it.scheduled.date
  return o
}
const closedGlitch = (st: any) => /^(closed|done|resolved)$/i.test(String(st || ''))
const inSet = (ids: string[]): Record<string, true> => { const o: Record<string, true> = {}; for (const id of ids) o[id] = true; return o }

/** Read rows for a set of listing ids, in chunks short enough for a URL, paged to completion. */
async function readForListings(ctx: EveCtx, ids: string[], make: (part: string[], a: number, b: number) => PromiseLike<any>, maxPages = 6): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = []
  let truncated = false
  for (const part of chunk(ids, 60)) {
    const got = await pageRows<any>((a, b) => make(part, a, b), maxPages)
    rows.push(...got.rows)
    if (got.truncated) truncated = true
  }
  return { rows, truncated }
}

const GLITCH_COLS = 'id,listing_id,category,status,overview,created_at,closed_at,closed_at_estimated,refund_approved'
const TASK_COLS = 'id,reference_property_id,name,status,scheduled_date,finished_at,total_minutes'

function glitchRollup(rows: any[]): any[] {
  const by: Record<string, { n: number; open: number; hours: number[]; refunds: number; last: string }> = {}
  for (const g of rows) {
    const c = String(g.category || 'uncategorised')
    if (!by[c]) by[c] = { n: 0, open: 0, hours: [], refunds: 0, last: '' }
    by[c].n++
    const day = String(g.created_at || '').slice(0, 10)
    if (day > by[c].last) by[c].last = day
    if (g.refund_approved) by[c].refunds++
    if (!closedGlitch(g.status)) by[c].open++
    else if (g.closed_at && !g.closed_at_estimated) {
      const h = (Date.parse(String(g.closed_at)) - Date.parse(String(g.created_at))) / 3600_000
      if (Number.isFinite(h) && h >= 0) by[c].hours.push(h)
    }
  }
  return Object.keys(by).map(c => {
    const med = median(by[c].hours)
    return { category: c, issues: by[c].n, still_open: by[c].open, median_hours_to_close: med == null ? null : round2(med), closed_with_a_recorded_time: by[c].hours.length, with_refund_approved_count: by[c].refunds, most_recent: by[c].last }
  }).sort((a, b) => b.issues - a.issues)
}

function taskRollup(rows: any[]): { live: any[]; done: number; open: number; minutes: number; repeats: { job: string; times: number }[] } {
  const live = rows.filter(t => !isTaskGone(t.status))
  let done = 0, open = 0, minutes = 0
  const names: Record<string, { label: string; n: number }> = {}
  for (const t of live) {
    if (isTaskDone(t.status, t.finished_at)) done++; else open++
    minutes += num(t.total_minutes)
    const label = String(t.name || '').replace(/\s+/g, ' ').trim()
    const k = lc(label).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!k) continue
    if (!names[k]) names[k] = { label: label.slice(0, 80), n: 0 }
    names[k].n++
  }
  const repeats = Object.keys(names).map(k => ({ job: names[k].label, times: names[k].n })).filter(x => x.times >= 2).sort((a, b) => b.times - a.times).slice(0, 5)
  return { live, done, open, minutes, repeats }
}

const perf = (r: UnitRevenue | undefined, windowNights: number) => ({
  net_revenue: r ? r.revenue : 0, adr: r ? r.adr : 0, revpar: r ? r.revpar : 0,
  occupancy_pct: r ? r.occupancy : 0, nights_booked: r ? r.nights : 0, nights_available: r ? r.available : windowNights,
})

const REV_BASIS = `${NET_BASIS_NOTE}; real stays only (${LIVE_STAY_STATUSES.join(' / ')}), prorated to the window. Owner stays hold the unit: their nights count as booked at zero revenue, which lowers ADR in an owner-heavy window. The Properties page shows ADR before the channel fee, so it reads a little higher.`

// ───────────────────────────────────────────────────────────── the business brain, when fresh
// (2026-11-10) Performance and maintenance come from the nightly brain (lib/eve/brain-data.ts) when
// fact_unit_day, fact_maintenance_event and dim_unit were all built in the last 36 hours, so the 360s
// quote the same numbers as measure / upkeep_rank. A unit is its whole apartment (physical_unit_id).
// Otherwise — or if the brain read fails — the live readers above answer, exactly as before.
const SYS_WORD: Record<string, string> = { hvac: 'A/C (HVAC)', lock_access: 'locks / access', wifi_tv: 'Wi-Fi / TV' }
const sysWord = (s: any): string => SYS_WORD[String(s || '')] || String(s || 'other')
const BRAIN_TABLES: BrainTable[] = ['fact_unit_day', 'fact_maintenance_event', 'dim_unit']

type EventsRoll = { events: number; open: number; repeats: number; billed: number; hours: number[]; bySystem: Record<string, { n: number; repeats: number; last: string }>; latest: any[] }
function rollEvents(rows: any[]): EventsRoll {
  const out: EventsRoll = { events: 0, open: 0, repeats: 0, billed: 0, hours: [], bySystem: {}, latest: [] }
  for (const e of rows) {
    out.events++
    if (e.is_open === true) out.open++
    if (e.is_repeat === true) out.repeats++
    out.billed += num(e.billed_owner)
    if (e.hours_to_close != null && Number.isFinite(Number(e.hours_to_close))) out.hours.push(Number(e.hours_to_close))
    const s = String(e.system || 'other')
    const b = (out.bySystem[s] = out.bySystem[s] || { n: 0, repeats: 0, last: '' })
    b.n++
    if (e.is_repeat === true) b.repeats++
    const day = etDay(e.opened_at)
    if (day > b.last) b.last = day
  }
  out.latest = rows.slice().sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))).slice(0, 4)
  return out
}
const eventsBlock = (r: EventsRoll, win: string, asOf: string, truncated: boolean) => {
  const med = median(r.hours)
  return {
    what_this_is: 'Everything that broke or was fixed: guest issues, non-routine Breezeway maintenance tasks and work orders (a guest issue and the task pushed from it are one event; routine PM is not counted).',
    events: r.events, still_open: r.open, repeat_failures: r.repeats, median_hours_to_close: med == null ? null : round2(med),
    by_system: Object.keys(r.bySystem).sort((a, b) => r.bySystem[b].n - r.bySystem[a].n).slice(0, 8).map(s => ({ system: sysWord(s), events: r.bySystem[s].n, repeats: r.bySystem[s].repeats || undefined, most_recent: r.bySystem[s].last })),
    latest: r.latest.map(e => ({ opened: etDay(e.opened_at), system: sysWord(e.system), what: String(e.title || '').replace(/\s+/g, ' ').slice(0, 90), resolution: e.resolution || undefined, open: e.is_open === true || undefined })),
    truncated,
    _meta: brainMeta({ source: 'fact_maintenance_event (business brain)', window: win, n: r.events, truncated, as_of: asOf }),
  }
}

type BrainUnit = { pid: string; label: string; rolled: string[] | undefined; mine: Acc; prior: Acc; peers: { pid: string; acc: Acc }[]; ev: EventsRoll; evTruncated: boolean; truncated: boolean; health: any | null; asOf: string }
async function brainUnit(ctx: EveCtx, id: string, from: string, to: string, priorFrom: string, priorTo: string, asOf: string): Promise<BrainUnit> {
  const d = await brainDims(ctx)
  const du = d.byListing[id]
  const pid = du ? du.physical_unit_id : id
  const sibs = (d.byPhys[pid] || []).map(x => x.listing_id)
  const mineIds = sibs.length ? sibs : [id]
  const bld = du ? du.building_id : null
  const peerIds = bld ? d.units.filter(u => u.building_id === bld && (u.status !== 'inactive' || u.physical_unit_id === pid)).map(u => u.listing_id) : mineIds
  const hFresh = await brainFresh(ctx, 'unit_health_daily')
  const [cur, prior, ev, h] = await Promise.all([
    readUnitDays(ctx, from, to, peerIds),
    readUnitDays(ctx, priorFrom, priorTo, mineIds),
    readEvents(ctx, { sinceDay: from, untilDay: to, physId: pid }),
    hFresh.ok ? readHealthLatest(ctx, [pid]).catch(() => null) : Promise.resolve(null),
  ])
  const accs: Record<string, Acc> = {}
  for (const r of cur.rows) {
    const p = String(r.physical_unit_id || r.listing_id)
    addDayRow((accs[p] = accs[p] || newAcc()), r, p)
  }
  const priorAcc = newAcc()
  for (const r of prior.rows) addDayRow(priorAcc, r, pid)
  return {
    pid, label: du ? physName(ctx, d, pid) : ctx.nameOf(id), rolled: mineIds.length > 1 ? mineIds.map(x => ctx.nameOf(x)) : undefined,
    mine: accs[pid] || newAcc(), prior: priorAcc,
    peers: Object.keys(accs).filter(p => (d.byPhys[p] || []).some(u => u.status !== 'inactive')).map(p => ({ pid: p, acc: accs[p] })),
    ev: rollEvents(ev.rows), evTruncated: ev.truncated, truncated: cur.truncated || prior.truncated,
    health: h && h.rows.length ? h.rows[0] : null, asOf,
  }
}

type BrainBuilding = { byListing: Record<string, Acc>; total: Acc; prior: Acc; events: any[]; evTruncated: boolean; truncated: boolean; asOf: string }
async function brainBuilding(ctx: EveCtx, ids: string[], from: string, to: string, priorFrom: string, priorTo: string, asOf: string): Promise<BrainBuilding> {
  const d = await brainDims(ctx)
  const [cur, prior, ev] = await Promise.all([
    readUnitDays(ctx, from, to, ids),
    readUnitDays(ctx, priorFrom, priorTo, ids),
    readEvents(ctx, { sinceDay: from, untilDay: to, listingIds: ids }),
  ])
  const byListing: Record<string, Acc> = {}
  const total = newAcc(), priorAcc = newAcc()
  const apt = (r: any) => String(r.physical_unit_id || (d.byListing[String(r.listing_id)] ? d.byListing[String(r.listing_id)].physical_unit_id : r.listing_id))
  for (const r of cur.rows) {
    const lid = String(r.listing_id)
    addDayRow((byListing[lid] = byListing[lid] || newAcc()), r, lid)
    addDayRow(total, r, apt(r))
  }
  for (const r of prior.rows) addDayRow(priorAcc, r, apt(r))
  return { byListing, total, prior: priorAcc, events: ev.rows, evTruncated: ev.truncated, truncated: cur.truncated || prior.truncated, asOf }
}
const brainPerf = (a: Acc) => { const p = perfOf(a); return { net_revenue: p.net_revenue, adr: p.adr, revpar: p.revpar, occupancy_pct: p.occupancy_pct, nights_booked: p.nights_booked, nights_available: p.nights_available, owner_nights: p.owner_nights } }

// ───────────────────────────────────────────────────────────── unit_360
const UNIT_360: EveTool = {
  name: 'unit_360',
  money: true,
  description: 'EVERYTHING ABOUT ONE UNIT IN ONE CALL — the starting point for any question about a unit\'s health, cost or upkeep, and for any repair / replace / retire decision. Pass unit (name) or id, and days (window, default 90, up to 365). Returns, each with its own source / window / as-of: PERFORMANCE (net revenue, ADR, RevPAR, occupancy, booked nights — against the window before and against the other units in its building); REVIEWS (average and count in the window vs the window before, per channel, sub-scores, lifetime, current channel listing only); GUEST ISSUES by category with how many are open and the median time to close; MAINTENANCE (Breezeway maintenance tasks done and open, jobs that repeat, minutes logged) and what was BILLED TO THE OWNER for work on the unit (that is not our true cost); UPKEEP (every cadence: last done, next due, days late); INSPECTIONS (latest checklists, pass %, what fails); open CLAIMS; BLOCKED nights ahead; open FF&E fixes; and a plain list of what stands out. A section that could not be read says `unavailable` — say so rather than guessing. If the name fits more than one unit it comes back as "which one?".',
  input_schema: obj({ unit: S.str, id: S.str, building: S.str, days: S.num }),
  run: async (input, ctx) => {
    const unit = resolveListing(ctx, { id: input?.id, name: input?.unit, building: input?.building })
    if (!unit) return { error: `No unit matches "${input?.unit || input?.id || ''}". Give the unit as building AND number, or use resolve.` }
    const id = unit.id
    const days = clampDays(input?.days, 90, 365)
    const { from, to } = windowRange(days, ctx.today)
    const priorTo = shiftDay(from, -1)
    const priorFrom = shiftDay(priorTo, -(days - 1))
    const win = `${from} → ${to} (${days} days)`
    const peers = Object.keys(ctx.listingMeta).filter(x => ctx.listingMeta[x].rollup === unit.meta.rollup && !DEAD_LISTING.test(ctx.listingMeta[x].status))

    // The business brain answers performance and maintenance when it is fresh; the live readers are
    // then not run (and run after all if the brain read fails).
    const brainOn = await freshAll(ctx, BRAIN_TABLES)
    const useBrain = brainOn.ok
    const brainAsOf = brainOn.ok ? brainOn.as_of : ''
    const brainP = useBrain ? sect('business brain', 30_000, () => brainUnit(ctx, id, from, to, priorFrom, priorTo, brainAsOf)) : Promise.resolve(null)
    const SKIP = 'not read — the business brain answered'
    const readRev = async () => { if (useBrain) throw new Error(SKIP); return unitRevenue(from, to, 'net') }
    const readRevPrior = async () => { if (useBrain) throw new Error(SKIP); return unitRevenue(priorFrom, priorTo, 'net') }
    const tasksQuery = async () => {
      const { data, error, count } = await ctx.db.from('breezeway_tasks_sync').select(TASK_COLS, { count: 'exact' }).eq('reference_property_id', id).eq('type_department', 'maintenance').gte('scheduled_date', from).order('scheduled_date', { ascending: false }).order('id').limit(400)
      if (error) throw error
      return { rows: (data as any[]) || [], total: typeof count === 'number' ? count : null }
    }
    const readTasks = async () => { if (useBrain) throw new Error(SKIP); return tasksQuery() }
    const readBill = async () => { if (useBrain) throw new Error(SKIP); return billingRange(from, to) }

    const [revS0, revPriorS0, reviewsS, lifetimeS, glitchS, taskS0, billS0, dueS, inspS, claimS, blockS, ffeS] = await Promise.all([
      sect('revenue', 30_000, readRev),
      sect('revenue (prior window)', 30_000, readRevPrior),
      sect('reviews', 25_000, () => reviewStats(ctx, { ids: [id], days, withPrior: true })),
      sect('reviews (lifetime)', 25_000, () => reviewStats(ctx, { ids: [id] })),
      sect('guest issues', 20_000, async () => {
        const { data, error, count } = await ctx.db.from('glitches').select(GLITCH_COLS, { count: 'exact' }).eq('listing_id', id).gte('created_at', from + 'T00:00:00Z').order('created_at', { ascending: false }).limit(300)
        if (error) throw error
        return { rows: (data as any[]) || [], total: typeof count === 'number' ? count : null }
      }),
      sect('maintenance tasks', 20_000, readTasks),
      sect('owner billing', 40_000, readBill),
      sect('the upkeep ledger', 40_000, () => dueCalendarCached(ctx.today)),
      sect('inspection results', 20_000, async () => {
        const { data, error } = await ctx.db.from('inspection_results').select('task_id,kind,finished_at,inspector,subject_name,yes_count,no_count,pass_rate,score,misses').eq('listing_id', id).order('finished_at', { ascending: false }).limit(12)
        if (error) throw error
        return (data as any[]) || []
      }),
      sect('claims', 20_000, async () => {
        const { data, error } = await ctx.db.from('claims').select('id,stage,channel,check_out,amount_sought,amount_paid,waiting_on,created_at').eq('listing_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(40)
        if (error) throw error
        return (data as any[]) || []
      }),
      sect('blocked nights', 40_000, () => blockedReportCached(30)),
      sect('FF&E fixes', 20_000, async () => {
        const { data, error } = await ctx.db.from('ffe_fixes').select('room,title,note,est_cost,status,created_at').eq('listing_id', id).in('status', ['open', 'doing']).order('created_at', { ascending: false }).limit(40)
        if (error) throw error
        return (data as any[]) || []
      }),
    ])

    const brainS = await brainP
    const bu: BrainUnit | null = brainS && brainS.ok ? brainS.v : null
    // The brain was fresh but its read failed: the live readers answer after all.
    const fb = useBrain && !bu ? await Promise.all([
      sect('revenue', 30_000, () => unitRevenue(from, to, 'net')),
      sect('revenue (prior window)', 30_000, () => unitRevenue(priorFrom, priorTo, 'net')),
      sect('maintenance tasks', 20_000, tasksQuery),
      sect('owner billing', 40_000, () => billingRange(from, to)),
    ]) : null
    const revS = fb ? fb[0] : revS0
    const revPriorS = fb ? fb[1] : revPriorS0
    const taskS = fb ? fb[2] : taskS0
    const billS = fb ? fb[3] : billS0

    const stands: string[] = []
    const windowNights = days

    // ── performance
    let performance: any
    let nightsBooked: number | null = null
    if (bu) {
      const mine = brainPerf(bu.mine)
      nightsBooked = mine.nights_booked
      const peerRows = bu.peers.map(p => ({ pid: p.pid, ...brainPerf(p.acc) }))
      const n = peerRows.length
      const avg = (k: 'adr' | 'revpar' | 'occupancy_pct') => { const xs = peerRows.map(r => r[k]).filter((x): x is number => x != null); return xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null }
      const ranked = peerRows.slice().sort((a, b) => (b.revpar ?? -1) - (a.revpar ?? -1))
      const pos = ranked.findIndex(r => r.pid === bu.pid) + 1
      performance = {
        apartment: bu.label, listings_rolled_together: bu.rolled,
        ...mine,
        prior_window: { window: `${priorFrom} → ${priorTo}`, ...brainPerf(bu.prior) },
        building_peers: n > 1 ? { building: unit.meta.rollup, apartments: n, avg_adr: avg('adr'), avg_revpar: avg('revpar'), avg_occupancy_pct: avg('occupancy_pct'), position_in_building: pos ? `${pos} of ${n} by net revenue per available night (1 = best)` : null } : undefined,
        basis: BRAIN_NIGHTS_BASIS,
        _meta: brainMeta({ source: 'fact_unit_day (business brain)', window: win, n: mine.nights_booked, truncated: bu.truncated, basis: 'net accommodation after channel fee · real stays', as_of: bu.asOf }),
      }
      if (n >= 4 && pos && pos > Math.ceil(n * 0.75)) stands.push(`Earning in the bottom quarter of ${unit.meta.rollup}: ${pos} of ${n} by net revenue per available night.`)
      if (mine.nights_booked === 0) stands.push(`No booked nights in the last ${days} days.`)
    } else if (!revS.ok) performance = gap(revS.why)
    else {
      const mine = perf(revS.v[id], windowNights)
      nightsBooked = mine.nights_booked
      const peerRows = peers.map(p => ({ id: p, ...perf(revS.v[p], windowNights) }))
      const n = peerRows.length
      const avg = (k: 'adr' | 'revpar' | 'occupancy_pct') => (n ? round2(peerRows.reduce((s, r) => s + r[k], 0) / n) : null)
      const ranked = peerRows.slice().sort((a, b) => b.revpar - a.revpar)
      const pos = ranked.findIndex(r => r.id === id) + 1
      performance = {
        ...mine,
        prior_window: revPriorS.ok ? { window: `${priorFrom} → ${priorTo}`, ...perf(revPriorS.v[id], windowNights) } : gap(revPriorS.why),
        building_peers: n > 1 ? { building: unit.meta.rollup, active_units: n, avg_adr: avg('adr'), avg_revpar: avg('revpar'), avg_occupancy_pct: avg('occupancy_pct'), position_in_building: pos ? `${pos} of ${n} by net revenue per available night (1 = best)` : null } : undefined,
        basis: REV_BASIS,
        _meta: toolMeta({ source: 'guesty_reservations via lib/unit-revenue', window: win, n: mine.nights_booked, truncated: false, basis: 'net accommodation after channel fee · real stays' }),
      }
      if (n >= 4 && pos && pos > Math.ceil(n * 0.75)) stands.push(`Earning in the bottom quarter of ${unit.meta.rollup}: ${pos} of ${n} by net revenue per available night.`)
      if (mine.nights_booked === 0) stands.push(`No booked nights in the last ${days} days.`)
    }

    // ── reviews
    let reviews: any
    if (!reviewsS.ok) reviews = gap(reviewsS.why)
    else {
      const st = reviewsS.v
      const life = lifetimeS.ok ? lifetimeS.v : null
      reviews = {
        in_window: { window: st.window, avg_rating: st.avg_rating, rated: st.rated_count, unanswered: st.unanswered, low_reviews_3_stars_or_below: (st.distribution_by_star['1'] || 0) + (st.distribution_by_star['2'] || 0) + (st.distribution_by_star['3'] || 0) },
        window_before: st.prior || undefined,
        by_channel_in_window: st.by_channel,
        sub_scores_in_window: st.sub_scores.length ? st.sub_scores : undefined,
        lifetime: life ? { avg_rating: life.avg_rating, rated: life.rated_count, by_channel: life.by_channel.map(c => ({ channel: c.channel, avg: c.avg, reviews: c.reviews })), older_listing_reviews_left_out: life.older_listing_left_out } : gap(lifetimeS.ok ? 'lifetime reviews' : lifetimeS.why),
        rating_scale: '/5 (Booking normalized from /10)',
        current_listing_check: st.current_listing_check === 'checked' ? undefined : 'UNAVAILABLE — reviews from a replaced channel listing may be included.',
        _meta: toolMeta({ source: 'guesty_reviews', window: st.window, n: st.rated_count, truncated: st.truncated, basis: 'current channel listing only' }),
      }
      if (st.prior && st.prior.avg_rating != null && st.avg_rating != null && st.rated_count >= 3 && st.prior.rated_count >= 3 && st.avg_rating <= st.prior.avg_rating - 0.2) {
        stands.push(`Reviews are down: ${st.avg_rating} over ${st.rated_count} in this window against ${st.prior.avg_rating} over ${st.prior.rated_count} in the one before.`)
      }
      const low = reviews.in_window.low_reviews_3_stars_or_below
      if (low >= 2) stands.push(`${low} reviews at three stars or below in the last ${days} days.`)
    }

    // ── guest issues
    let guest_issues: any
    if (!glitchS.ok) guest_issues = gap(glitchS.why)
    else {
      const rows = glitchS.v.rows
      const cut = glitchS.v.total != null ? glitchS.v.total > rows.length : rows.length >= 300
      const roll = glitchRollup(rows)
      guest_issues = {
        count: rows.length, total_rows: glitchS.v.total, truncated: cut,
        still_open: rows.filter(g => !closedGlitch(g.status)).length,
        by_category: roll.slice(0, 8),
        by_category_not_listed: roll.length > 8 ? roll.length - 8 : undefined,
        latest: rows.slice(0, 4).map(g => ({ opened: String(g.created_at).slice(0, 10), category: g.category, issue: String(g.overview || '').replace(/\s+/g, ' ').slice(0, 100), status: g.status })),
        _meta: toolMeta({ source: 'glitches (guest-issue board)', window: win, n: rows.length, truncated: cut }),
      }
      for (const c of roll) if (c.issues >= 3) stands.push(`${c.issues} "${c.category}" guest issues in ${days} days${c.still_open ? `, ${c.still_open} still open` : ''} — a repeat, not a one-off.`)
    }

    // ── maintenance + what was billed
    let maintenance: any
    let health: any = undefined
    if (bu) {
      const billed = bu.mine.billed
      maintenance = {
        events: eventsBlock(bu.ev, win, bu.asOf, bu.evTruncated),
        billed_to_owner: {
          what_this_is: `Billed to the owner for Breezeway maintenance tasks finished on this apartment in the window — ${BILLED_NOTE}.`,
          owner_billed_amount: Math.round(billed),
          owner_billed_amount_per_booked_night: nightsBooked && nightsBooked > 0 ? round2(billed / nightsBooked) : null,
          billed_on_the_events_amount: Math.round(bu.ev.billed),
          _meta: brainMeta({ source: 'fact_unit_day.maint_cost_billed (business brain)', window: win, n: bu.mine.rows, truncated: bu.truncated, basis: BILLED_NOTE, as_of: bu.asOf }),
        },
      }
      for (const s of Object.keys(bu.ev.bySystem)) if (bu.ev.bySystem[s].repeats > 0) stands.push(`${sysWord(s)} failed again within 90 days (${bu.ev.bySystem[s].n} events in the window) — upkeep_advise has the repair-or-replace evidence.`)
      if (bu.health) {
        const h = bu.health
        health = {
          score: h.score, band: h.band, day: String(h.day || '').slice(0, 10),
          what_took_points_off: (Array.isArray(h.drivers) ? h.drivers : []).map((x: any) => `−${Math.abs(round2(num(x?.points)))} ${String(x?.key || '')}: ${String(x?.why || '')}`),
          _meta: brainMeta({ source: 'unit_health_daily (business brain)', window: 'today, 90-day inputs', n: 1, as_of: bu.asOf }),
        }
        if (h.score != null && num(h.score) < 70) stands.push(`Health ${h.score} (${h.band}).`)
      }
    } else {
      const tasks = taskS.ok ? taskRollup(taskS.v.rows) : null
      const taskCut = taskS.ok ? (taskS.v.total != null ? taskS.v.total > taskS.v.rows.length : taskS.v.rows.length >= 400) : false
      let billed: any
      if (!billS.ok) billed = gap(billS.why)
      else {
        const mine = billS.v.tasks.filter(t => String(t.listingId || '') === id && !t.excluded)
        const total = mine.reduce((s, t) => s + num(t.billedAmount), 0)
        const byDept: Record<string, { tasks: number; amount: number }> = {}
        for (const t of mine) {
          const d = String(t.department || 'other')
          if (!byDept[d]) byDept[d] = { tasks: 0, amount: 0 }
          byDept[d].tasks++; byDept[d].amount += num(t.billedAmount)
        }
        const noDetail = mine.filter(t => !t.hasDetail).length
        billed = {
          what_this_is: 'Billed to the owner for Breezeway work on this unit in the window — NOT what the work cost us.',
          billed_task_count: mine.length,
          owner_billed_amount: Math.round(total),
          owner_billed_amount_per_booked_night: nightsBooked && nightsBooked > 0 ? round2(total / nightsBooked) : null,
          by_department: Object.keys(byDept).map(d => ({ department: d, billed_task_count: byDept[d].tasks, owner_billed_amount: Math.round(byDept[d].amount) })).sort((a, b) => b.owner_billed_amount - a.owner_billed_amount),
          tasks_missing_billing_detail: noDetail || undefined,
          largest: mine.slice().sort((a, b) => num(b.billedAmount) - num(a.billedAmount)).slice(0, 3).filter(t => num(t.billedAmount) > 0).map(t => ({ job: String(t.name || '').slice(0, 60), date: String(t.finishedAt || t.scheduledDate || '').slice(0, 10), owner_billed_amount: Math.round(num(t.billedAmount)) })),
          note: noDetail ? `${noDetail} task(s) have no billing detail pulled yet and read as $0 — the amount is a floor.` : undefined,
          _meta: toolMeta({ source: 'breezeway_tasks_sync + breezeway_billing_details via lib/billing', window: win, n: mine.length, truncated: noDetail > 0, basis: 'billed to owner, not true cost' }),
        }
      }
      maintenance = {
        tasks: tasks ? {
          maintenance_tasks: tasks.live.length, done: tasks.done, open: tasks.open, minutes_logged: tasks.minutes,
          repeat_jobs: tasks.repeats.length ? tasks.repeats : undefined,
          open_now: tasks.live.filter(t => !isTaskDone(t.status, t.finished_at)).slice(0, 5).map(t => ({ job: String(t.name || '').slice(0, 60), scheduled: t.scheduled_date })),
          total_rows: taskS.ok ? taskS.v.total : null, truncated: taskCut,
          _meta: toolMeta({ source: 'breezeway_tasks_sync (department = maintenance)', window: `${from} → ${to} (scheduled date)`, n: tasks.live.length, truncated: taskCut }),
        } : gap(taskS.ok ? 'maintenance tasks' : taskS.why),
        billed_to_owner: billed,
      }
      if (tasks) for (const r of tasks.repeats.slice(0, 2)) if (r.times >= 3) stands.push(`"${r.job}" was done ${r.times} times in ${days} days.`)
    }

    // ── upkeep
    let upkeep: any
    if (!dueS.ok) upkeep = gap(dueS.why)
    else {
      const items: DueItem[] = []
      for (const b of dueS.v.buildings) for (const it of b.items) if (it.listingId === id) items.push(it)
      items.sort((a, b) => b.daysOver - a.daysOver)
      const late = items.filter(i => i.band === 'late')
      const degraded = dueS.v.degraded.length > 0
      upkeep = {
        tracking_on: dueS.v.enabled,
        cadences: items.slice(0, 12).map(dueShort),
        cadences_not_listed: items.length > 12 ? items.length - 12 : undefined,
        late: late.length, due_this_week: items.filter(i => i.band === 'week').length, no_record: items.filter(i => i.band === 'unknown').length,
        note: (items.length ? '' : 'No cadence applies to this unit in the ledger (none switched on for it, or nothing due within 400 days). ') + '"no record" means unknown, not late.' + (degraded ? ' Some ledger reads stopped early — treat this as a floor.' : ''),
        _meta: toolMeta({ source: 'the upkeep ledger (lib/pm-calendar)', window: `as of ${dueS.v.today}`, n: items.length, truncated: degraded }),
      }
      for (const i of late.slice(0, 3)) stands.push(`${i.label} is ${i.daysOver} day${i.daysOver === 1 ? '' : 's'} late${i.lastDone ? ` (last done ${i.lastDone})` : ''}${i.scheduled ? `, scheduled ${i.scheduled.date}` : ', nothing scheduled'}.`)
    }

    // ── inspections
    let inspections: any
    if (!inspS.ok) inspections = gap(inspS.why)
    else {
      const rows = inspS.v
      let yes = 0, no = 0
      const miss: Record<string, { item: string; n: number }> = {}
      for (const r of rows) {
        yes += num(r.yes_count); no += num(r.no_count)
        for (const m of (Array.isArray(r.misses) ? r.misses : [])) {
          const item = String(m?.item_en || m?.item_es || '').trim()
          if (!item) continue
          const k = lc(item)
          if (!miss[k]) miss[k] = { item: item.slice(0, 120), n: 0 }
          miss[k].n++
        }
      }
      const hide = ctx.tier === 'vendor' || !!ctx.guestSafe
      inspections = {
        last_inspections_read: rows.length,
        checks_passed: yes, checks_failed: no, pass_pct: yes + no > 0 ? Math.round((yes / (yes + no)) * 1000) / 10 : null,
        top_misses: Object.keys(miss).map(k => ({ item: miss[k].item, times_failed: miss[k].n })).sort((a, b) => b.times_failed - a.times_failed).slice(0, 5),
        latest: rows.slice(0, 3).map(r => ({ kind: r.kind, finished: String(r.finished_at || '').slice(0, 10), inspector: hide ? undefined : r.inspector, passed: r.yes_count, failed: r.no_count, score_1_to_5: r.score })),
        note: rows.length ? 'The newest twelve checklists for the unit, whatever their date. A failed line is a finding about the unit, not a verdict on a person.' : 'No Breezeway inspection checklist is on file for this unit.',
        _meta: toolMeta({ source: 'inspection_results', window: rows.length ? `${String(rows[rows.length - 1].finished_at || '').slice(0, 10)} → ${String(rows[0].finished_at || '').slice(0, 10)} (newest ${rows.length})` : 'none on file', n: rows.length, truncated: rows.length >= 12 }),
      }
    }

    // ── claims
    let claims: any
    if (!claimS.ok) claims = gap(claimS.why)
    else {
      const open = claimS.v.filter(c => lc(c.stage) !== 'closed')
      claims = {
        open: open.length, closed_on_file: claimS.v.length - open.length,
        amount_sought_open: Math.round(open.reduce((s, c) => s + num(c.amount_sought), 0)),
        open_claims: open.slice(0, 4).map(c => ({ stage: c.stage, channel: c.channel, check_out: c.check_out, amount_sought: c.amount_sought, waiting_on: c.waiting_on || undefined })),
        note: open.length ? 'For each claim\'s filing deadline and what is blocking it, use claims_desk.' : undefined,
        _meta: toolMeta({ source: 'claims', window: 'newest 40 on file for the unit', n: claimS.v.length, truncated: claimS.v.length >= 40 }),
      }
      if (open.length) stands.push(`${open.length} damage claim${open.length === 1 ? '' : 's'} open.`)
    }

    // ── blocked
    let blocked: any
    if (!blockS.ok) blocked = gap(blockS.why)
    else {
      const runs = blockS.v.runs.filter(r => String(r.listingId) === id)
      const linked = blockS.v.linkedRuns.filter(r => String(r.listingId) === id)
      blocked = {
        out_of_service_today: runs.some(r => r.live),
        nights_blocked_next_30_days: runs.reduce((s, r) => s + (Number(r.nights) || 0), 0),
        blocks: runs.slice(0, 3).map(r => ({ from: r.from, to: r.to, nights: r.nights, reason: r.guestyLabel || r.reason, block_started: r.blockStart || undefined, ends: r.blockEnd || (r.openEnded ? 'no end date inside the window' : r.to) })),
        nights_auto_closed_by_a_linked_listing: linked.reduce((s, r) => s + (Number(r.nights) || 0), 0) || undefined,
        _meta: toolMeta({ source: 'Guesty multi-calendar (cached 10 min)', window: `${blockS.v.from} → ${blockS.v.to}`, n: runs.length, truncated: false }),
      }
      const live = runs.filter(r => r.live)[0]
      if (live) stands.push(`Blocked from sale today (${live.guestyLabel || live.reason}${live.openEnded ? ', no end date' : `, through ${live.to}`}).`)
    }

    // ── FF&E
    let ffe: any
    if (!ffeS.ok) ffe = gap(ffeS.why)
    else {
      ffe = {
        open_fixes: ffeS.v.length,
        est_cost_open: Math.round(ffeS.v.reduce((s, f) => s + num(f.est_cost), 0)),
        fixes: ffeS.v.slice(0, 5).map(f => ({ room: f.room, what: String(f.title || '').slice(0, 70), est_cost: f.est_cost, status: f.status })),
        _meta: toolMeta({ source: 'ffe_fixes (open + doing)', window: 'now', n: ffeS.v.length, truncated: ffeS.v.length >= 40 }),
      }
    }

    const gaps = [performance, reviews, guest_issues, upkeep, inspections, claims, blocked, ffe].filter((s: any) => s && s.unavailable).length
      + (maintenance.tasks && maintenance.tasks.unavailable ? 1 : 0) + (maintenance.billed_to_owner && maintenance.billed_to_owner.unavailable ? 1 : 0)
    return {
      unit: unit.meta.name, building: unit.meta.rollup, listing_id: id, status: unit.meta.status || 'unknown',
      window: win,
      what_stands_out: stands.length ? stands : ['Nothing in these records stands out for this window.'],
      performance, reviews, guest_issues, maintenance, health, upkeep, inspections, claims, blocked, ffe,
      sections_unavailable: gaps || undefined,
      numbers_from: bu ? `the business brain (built ${bu.asOf}) for performance, maintenance and health; live readers for the rest` : (brainOn.ok ? 'live readers (the business brain read failed)' : 'live readers (the business brain is not fresh: ' + brainOn.note.slice(0, 160) + ')'),
      how_to_use: 'Say the window with every number. what_stands_out lists facts from these records, not a recommendation. Billed-to-owner is not our cost.',
      _meta: toolMeta({ source: 'unit 360 (10 sections, each with its own source)', window: win, n: 10 - gaps, truncated: gaps > 0, basis: 'net accommodation after channel fee · current-listing reviews' }),
    }
  },
}

// ───────────────────────────────────────────────────────────── building_360
const BUILDING_360: EveTool = {
  name: 'building_360',
  money: true,
  description: 'EVERYTHING ABOUT ONE BUILDING IN ONE CALL, AND ITS UNITS RANKED — the tool for "how is Eden doing", "which units at Arya need attention", and for cross-cutting questions like "which units cost the most in maintenance per booked night and have falling reviews". Pass building, and days (window, default 90, up to 365). Returns the building roll-up — net revenue / ADR / RevPAR / occupancy vs the window before, reviews per channel vs the window before, guest issues by category, maintenance tasks and what was billed to owners, upkeep late / due by cadence, inspection pass % and the items that fail most, open claims, units blocked now — and a per-unit table (worst first) with each unit\'s revenue, RevPAR, occupancy, review average, guest issues, maintenance tasks, owner-billed amount per booked night and late upkeep, plus the reasons each unit is on the list. Same definitions as unit_360; use unit_360 to go deep on one.',
  input_schema: obj({ building: S.str, days: S.num, limit: S.num }),
  run: async (input, ctx) => {
    const b = String(input?.building || '').trim()
    if (!b) return { error: 'Which building?' }
    const all = ctx.idsForBuilding(b)
    if (!all.length) return { error: `No building matches "${b}".`, note: 'Check the name, or use resolve with kind "building".' }
    const ids = all.filter(x => !DEAD_LISTING.test(ctx.listingMeta[x].status))
    if (!ids.length) return { error: `"${b}" has no active units now (${all.length} retired).` }
    const rollups = Array.from(new Set(ids.map(x => ctx.listingMeta[x].rollup)))
    const days = clampDays(input?.days, 90, 365)
    const { from, to } = windowRange(days, ctx.today)
    const priorTo = shiftDay(from, -1)
    const priorFrom = shiftDay(priorTo, -(days - 1))
    const win = `${from} → ${to} (${days} days)`
    const mine = inSet(ids)

    // The business brain answers performance and maintenance when it is fresh (see brainBuilding).
    const brainOn = await freshAll(ctx, BRAIN_TABLES)
    const useBrain = brainOn.ok
    const brainAsOf = brainOn.ok ? brainOn.as_of : ''
    const brainP = useBrain ? sect('business brain', 40_000, () => brainBuilding(ctx, ids, from, to, priorFrom, priorTo, brainAsOf)) : Promise.resolve(null)
    const SKIP = 'not read — the business brain answered'
    const tasksQuery = () => readForListings(ctx, ids, (part, a, z) => ctx.db.from('breezeway_tasks_sync').select(TASK_COLS).in('reference_property_id', part).eq('type_department', 'maintenance').gte('scheduled_date', from).order('scheduled_date').order('id').range(a, z))
    const readRev = async () => { if (useBrain) throw new Error(SKIP); return unitRevenue(from, to, 'net') }
    const readRevPrior = async () => { if (useBrain) throw new Error(SKIP); return unitRevenue(priorFrom, priorTo, 'net') }
    const readTasks = async () => { if (useBrain) throw new Error(SKIP); return tasksQuery() }
    const readBill = async () => { if (useBrain) throw new Error(SKIP); return billingRange(from, to) }

    const [revS0, revPriorS0, reviewsS, glitchS, taskS0, billS0, dueS, inspS, claimS, blockS] = await Promise.all([
      sect('revenue', 30_000, readRev),
      sect('revenue (prior window)', 30_000, readRevPrior),
      sect('reviews', 30_000, () => reviewStats(ctx, { ids, days, withPrior: true })),
      sect('guest issues', 30_000, () => readForListings(ctx, ids, (part, a, z) => ctx.db.from('glitches').select(GLITCH_COLS).in('listing_id', part).gte('created_at', from + 'T00:00:00Z').order('id').range(a, z))),
      sect('maintenance tasks', 30_000, readTasks),
      sect('owner billing', 40_000, readBill),
      sect('the upkeep ledger', 40_000, () => dueCalendarCached(ctx.today)),
      sect('inspection results', 30_000, () => readForListings(ctx, ids, (part, a, z) => ctx.db.from('inspection_results').select('task_id,listing_id,kind,finished_at,yes_count,no_count,misses').in('listing_id', part).gte('finished_at', from + 'T00:00:00Z').order('task_id').range(a, z), 3)),
      sect('claims', 20_000, () => readForListings(ctx, ids, (part, a, z) => ctx.db.from('claims').select('id,listing_id,stage,amount_sought').in('listing_id', part).is('deleted_at', null).order('id').range(a, z), 2)),
      sect('blocked units', 40_000, () => blockedReportCached(30)),
    ])
    const brainS = await brainP
    const bb: BrainBuilding | null = brainS && brainS.ok ? brainS.v : null
    // The brain was fresh but its read failed: the live readers answer after all.
    const fb = useBrain && !bb ? await Promise.all([
      sect('revenue', 30_000, () => unitRevenue(from, to, 'net')),
      sect('revenue (prior window)', 30_000, () => unitRevenue(priorFrom, priorTo, 'net')),
      sect('maintenance tasks', 30_000, tasksQuery),
      sect('owner billing', 40_000, () => billingRange(from, to)),
    ]) : null
    const revS = fb ? fb[0] : revS0
    const revPriorS = fb ? fb[1] : revPriorS0
    const taskS = fb ? fb[2] : taskS0
    const billS = fb ? fb[3] : billS0

    // per-unit accumulators
    type Row = { id: string; unit: string; net_revenue: number | null; revpar: number | null; adr: number | null; occupancy_pct: number | null; nights: number | null; review_avg: number | null; reviews: number; glitches: number; glitches_open: number; maint_tasks: number; billed: number | null; late: number; blocked: boolean; reasons: string[] }
    const rows: Record<string, Row> = {}
    for (const id of ids) rows[id] = { id, unit: ctx.listingMeta[id].name, net_revenue: null, revpar: null, adr: null, occupancy_pct: null, nights: null, review_avg: null, reviews: 0, glitches: 0, glitches_open: 0, maint_tasks: 0, billed: null, late: 0, blocked: false, reasons: [] }
    const windowNights = days

    // ── performance
    let performance: any
    if (bb) {
      for (const id of ids) { const a = bb.byListing[id]; const p = a ? brainPerf(a) : null; rows[id].net_revenue = p ? p.net_revenue : 0; rows[id].revpar = p ? p.revpar : null; rows[id].adr = p ? p.adr : null; rows[id].occupancy_pct = p ? p.occupancy_pct : null; rows[id].nights = p ? p.nights_booked : 0 }
      performance = {
        ...brainPerf(bb.total),
        prior_window: { window: `${priorFrom} → ${priorTo}`, ...brainPerf(bb.prior) },
        note: 'Nights are counted once per apartment (a whole-and-parts set is one) and only on nights each listing was active; the per-unit table is per listing.',
        basis: BRAIN_NIGHTS_BASIS,
        _meta: brainMeta({ source: 'fact_unit_day (business brain)', window: win, n: ids.length, truncated: bb.truncated, basis: 'net accommodation after channel fee · real stays', as_of: bb.asOf }),
      }
    } else if (!revS.ok) performance = gap(revS.why)
    else {
      const total = (m: Record<string, UnitRevenue>) => {
        let rev = 0, nights = 0
        for (const id of ids) { const r = m[id]; if (r) { rev += r.revenue; nights += r.nights } }
        const avail = ids.length * windowNights
        return { net_revenue: Math.round(rev), adr: nights > 0 ? Math.round(rev / nights) : 0, revpar: avail > 0 ? Math.round(rev / avail) : 0, occupancy_pct: avail > 0 ? Math.round((nights / avail) * 1000) / 10 : 0, nights_booked: nights, nights_available: avail }
      }
      for (const id of ids) { const p = perf(revS.v[id], windowNights); rows[id].net_revenue = p.net_revenue; rows[id].revpar = p.revpar; rows[id].adr = p.adr; rows[id].occupancy_pct = p.occupancy_pct; rows[id].nights = p.nights_booked }
      performance = {
        ...total(revS.v),
        prior_window: revPriorS.ok ? { window: `${priorFrom} → ${priorTo}`, ...total(revPriorS.v) } : gap(revPriorS.why),
        note: 'nights_available assumes every currently-active unit was live for the whole window — a unit that went live part-way through makes occupancy and RevPAR read low.',
        basis: REV_BASIS,
        _meta: toolMeta({ source: 'guesty_reservations via lib/unit-revenue', window: win, n: ids.length, truncated: false, basis: 'net accommodation after channel fee · real stays' }),
      }
    }

    // ── reviews
    let reviews: any
    if (!reviewsS.ok) reviews = gap(reviewsS.why)
    else {
      const st = reviewsS.v
      for (const u of st.units) if (rows[u.listing_id]) { rows[u.listing_id].review_avg = u.avg; rows[u.listing_id].reviews = u.reviews }
      reviews = {
        window: st.window, avg_rating: st.avg_rating, rated: st.rated_count, unanswered: st.unanswered,
        window_before: st.prior || undefined,
        by_channel: st.by_channel, sub_scores: st.sub_scores.length ? st.sub_scores : undefined,
        older_listing_reviews_left_out: st.older_listing_left_out,
        rating_scale: '/5 (Booking normalized from /10)',
        current_listing_check: st.current_listing_check === 'checked' ? undefined : 'UNAVAILABLE — reviews from replaced channel listings may be included.',
        _meta: toolMeta({ source: 'guesty_reviews', window: st.window, n: st.rated_count, truncated: st.truncated, basis: 'active units · current channel listing' }),
      }
    }

    // ── guest issues
    let guest_issues: any
    if (!glitchS.ok) guest_issues = gap(glitchS.why)
    else {
      const gl = glitchS.v.rows.filter(g => mine[String(g.listing_id)])
      for (const g of gl) { const r = rows[String(g.listing_id)]; if (r) { r.glitches++; if (!closedGlitch(g.status)) r.glitches_open++ } }
      guest_issues = {
        count: gl.length, still_open: gl.filter(g => !closedGlitch(g.status)).length, truncated: glitchS.v.truncated,
        by_category: glitchRollup(gl).slice(0, 6),
        _meta: toolMeta({ source: 'glitches (guest-issue board)', window: win, n: gl.length, truncated: glitchS.v.truncated }),
      }
    }

    // ── maintenance + billed
    let maintenance: any
    if (bb) {
      const evs = bb.events.filter(e => mine[String(e.listing_id)])
      for (const e of evs) { const r = rows[String(e.listing_id)]; if (r) r.maint_tasks++ }
      let total = 0
      for (const id of ids) { const a = bb.byListing[id]; rows[id].billed = a ? a.billed : 0; total += a ? a.billed : 0 }
      maintenance = {
        events: eventsBlock(rollEvents(evs), win, bb.asOf, bb.evTruncated),
        billed_to_owner: {
          what_this_is: `Billed to owners for Breezeway maintenance tasks finished on these units in the window — ${BILLED_NOTE}.`,
          owner_billed_amount: Math.round(total),
          _meta: brainMeta({ source: 'fact_unit_day.maint_cost_billed (business brain)', window: win, n: ids.length, truncated: bb.truncated, basis: BILLED_NOTE, as_of: bb.asOf }),
        },
      }
    } else {
      let tasksOut: any
      if (!taskS.ok) tasksOut = gap(taskS.why)
      else {
        const roll = taskRollup(taskS.v.rows)
        for (const t of roll.live) { const r = rows[String(t.reference_property_id)]; if (r) r.maint_tasks++ }
        tasksOut = { maintenance_tasks: roll.live.length, done: roll.done, open: roll.open, minutes_logged: roll.minutes, repeat_jobs: roll.repeats.length ? roll.repeats : undefined, truncated: taskS.v.truncated, _meta: toolMeta({ source: 'breezeway_tasks_sync (department = maintenance)', window: `${from} → ${to} (scheduled date)`, n: roll.live.length, truncated: taskS.v.truncated }) }
      }
      let billed: any
      if (!billS.ok) billed = gap(billS.why)
      else {
        const bt = billS.v.tasks.filter(t => mine[String(t.listingId || '')] && !t.excluded)
        for (const id of ids) rows[id].billed = 0
        let total = 0
        for (const t of bt) { const r = rows[String(t.listingId)]; const a = num(t.billedAmount); total += a; if (r) r.billed = (r.billed || 0) + a }
        const noDetail = bt.filter(t => !t.hasDetail).length
        billed = {
          what_this_is: 'Billed to owners for Breezeway work on these units in the window — NOT what the work cost us.',
          billed_task_count: bt.length, owner_billed_amount: Math.round(total),
          tasks_missing_billing_detail: noDetail || undefined,
          _meta: toolMeta({ source: 'breezeway_tasks_sync + breezeway_billing_details via lib/billing', window: win, n: bt.length, truncated: noDetail > 0, basis: 'billed to owner, not true cost' }),
        }
      }
      maintenance = { tasks: tasksOut, billed_to_owner: billed }
    }

    // ── upkeep
    let upkeep: any
    if (!dueS.ok) upkeep = gap(dueS.why)
    else {
      const items: DueItem[] = []
      for (const bb of dueS.v.buildings) for (const it of bb.items) if (mine[it.listingId]) items.push(it)
      for (const it of items) if (it.band === 'late' && rows[it.listingId]) rows[it.listingId].late++
      const byCad: Record<string, DueItem[]> = {}
      for (const it of items) (byCad[it.label] = byCad[it.label] || []).push(it)
      const degraded = dueS.v.degraded.length > 0
      upkeep = {
        tracking_on: dueS.v.enabled,
        late: items.filter(i => i.band === 'late').length, due_this_week: items.filter(i => i.band === 'week').length, no_record: items.filter(i => i.band === 'unknown').length,
        by_cadence: Object.keys(byCad).map(k => ({ cadence: k, late: byCad[k].filter(i => i.band === 'late').length, due_this_week: byCad[k].filter(i => i.band === 'week').length, no_record: byCad[k].filter(i => i.band === 'unknown').length, worst_days_late: Math.max(0, ...byCad[k].map(i => i.daysOver)) })).sort((a, z) => z.late - a.late),
        most_overdue: items.filter(i => i.band === 'late').sort((a, z) => z.daysOver - a.daysOver).slice(0, 5).map(i => ({ unit: i.unit, ...dueShort(i) })),
        note: '"no record" means unknown, not late. upkeep_due lists every item.' + (degraded ? ' Some ledger reads stopped early — treat the counts as floors.' : ''),
        _meta: toolMeta({ source: 'the upkeep ledger (lib/pm-calendar)', window: `as of ${dueS.v.today}`, n: items.length, truncated: degraded }),
      }
    }

    // ── inspections
    let inspections: any
    if (!inspS.ok) inspections = gap(inspS.why)
    else {
      const ir = inspS.v.rows.filter(r => mine[String(r.listing_id)])
      let yes = 0, no = 0
      const miss: Record<string, { item: string; n: number }> = {}
      for (const r of ir) {
        yes += num(r.yes_count); no += num(r.no_count)
        for (const m of (Array.isArray(r.misses) ? r.misses : [])) {
          const item = String(m?.item_en || m?.item_es || '').trim()
          if (!item) continue
          const k = lc(item)
          if (!miss[k]) miss[k] = { item: item.slice(0, 120), n: 0 }
          miss[k].n++
        }
      }
      inspections = {
        inspections: ir.length, checks_passed: yes, checks_failed: no, pass_pct: yes + no > 0 ? Math.round((yes / (yes + no)) * 1000) / 10 : null,
        top_misses: Object.keys(miss).map(k => ({ item: miss[k].item, times_failed: miss[k].n })).sort((a, z) => z.times_failed - a.times_failed).slice(0, 6),
        truncated: inspS.v.truncated,
        _meta: toolMeta({ source: 'inspection_results', window: win, n: ir.length, truncated: inspS.v.truncated }),
      }
    }

    // ── claims, blocked
    let claims: any
    if (!claimS.ok) claims = gap(claimS.why)
    else {
      const open = claimS.v.rows.filter(c => mine[String(c.listing_id)] && lc(c.stage) !== 'closed')
      claims = { open: open.length, amount_sought_open: Math.round(open.reduce((s, c) => s + num(c.amount_sought), 0)), _meta: toolMeta({ source: 'claims', window: 'on file now', n: open.length, truncated: claimS.v.truncated }) }
    }
    let blocked: any
    if (!blockS.ok) blocked = gap(blockS.why)
    else {
      const runs = blockS.v.runs.filter(r => mine[String(r.listingId)])
      for (const r of runs) if (r.live && rows[String(r.listingId)]) rows[String(r.listingId)].blocked = true
      blocked = {
        units_out_of_service_today: Array.from(new Set(runs.filter(r => r.live).map(r => r.unit))),
        nights_blocked_next_30_days: runs.reduce((s, r) => s + (Number(r.nights) || 0), 0),
        _meta: toolMeta({ source: 'Guesty multi-calendar (cached 10 min)', window: `${blockS.v.from} → ${blockS.v.to}`, n: runs.length, truncated: false }),
      }
    }

    // ── the per-unit table: why each unit is on the list, then worst first
    const list = ids.map(id => rows[id])
    const quartile = (vals: number[], q: number): number | null => { if (vals.length < 4) return null; const s = vals.slice().sort((a, z) => a - z); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] }
    const revparLow = quartile(list.map(r => r.revpar).filter((v): v is number => v != null), 0.25)
    const perNight = (r: Row): number | null => (r.billed != null && r.nights && r.nights > 0 ? round2(r.billed / r.nights) : null)
    const perNightHigh = quartile(list.map(perNight).filter((v): v is number => v != null && v > 0), 0.75)
    for (const r of list) {
      if (r.blocked) r.reasons.push('blocked from sale today')
      if (r.late > 0) r.reasons.push(`${r.late} upkeep item${r.late === 1 ? '' : 's'} late`)
      if (r.glitches >= 3) r.reasons.push(`${r.glitches} guest issues in ${days} days`)
      if (r.review_avg != null && r.reviews >= 3 && r.review_avg < 4.5) r.reasons.push(`reviews ${r.review_avg} over ${r.reviews}`)
      if (revparLow != null && r.revpar != null && r.revpar <= revparLow) r.reasons.push('bottom quarter of the building by net revenue per available night')
      const pn = perNight(r)
      if (perNightHigh != null && pn != null && pn >= perNightHigh && pn > 0) r.reasons.push('top quarter by owner-billed work per booked night')
      if (r.nights === 0) r.reasons.push(`no booked nights in ${days} days`)
    }
    const lim = Math.min(Math.max(Math.round(Number(input?.limit) || 10), 5), 25)
    const ranked = list.slice().sort((a, z) => (z.reasons.length - a.reasons.length) || ((a.revpar ?? 1e9) - (z.revpar ?? 1e9)))
    return {
      building: rollups.length === 1 ? rollups[0] : b, matched_buildings: rollups.length > 1 ? rollups : undefined,
      active_units: ids.length, retired_units_left_out: all.length - ids.length || undefined,
      window: win,
      performance, reviews, guest_issues, maintenance, upkeep, inspections, claims, blocked,
      numbers_from: bb ? `the business brain (built ${bb.asOf}) for performance and maintenance; live readers for the rest` : (brainOn.ok ? 'live readers (the business brain read failed)' : 'live readers (the business brain is not fresh: ' + brainOn.note.slice(0, 160) + ')'),
      units: ranked.slice(0, lim).map(r => ({
        unit: r.unit, flags: r.reasons.length ? r.reasons : undefined,
        net_revenue: r.net_revenue, revpar: r.revpar, occupancy_pct: r.occupancy_pct, nights_booked: r.nights,
        review_avg: r.review_avg, reviews: r.reviews,
        guest_issues: r.glitches, ...(bb ? { maintenance_events: r.maint_tasks } : { maintenance_tasks: r.maint_tasks }),
        owner_billed_amount: r.billed == null ? null : Math.round(r.billed), owner_billed_amount_per_booked_night: perNight(r),
        upkeep_late: r.late,
      })),
      units_listed: Math.min(ranked.length, lim), total_rows: ranked.length, truncated: ranked.length > lim,
      how_to_use: `Units are ordered by how many flags they carry, then lowest net revenue per available night; review_avg / reviews are for the window. Flags are facts, not a verdict (a unit can earn little because it was blocked or went live late). ${ranked.length > lim ? `Only ${lim} of ${ranked.length} units are listed — say so; pass limit (up to 25) or use unit_360 for one. ` : ''}Owner-billed is not our cost.`,
      _meta: toolMeta({ source: 'building 360 (9 sections, each with its own source)', window: win, n: ids.length, truncated: ranked.length > lim, basis: 'net accommodation after channel fee · current-listing reviews' }),
    }
  },
}

export const UNIT360_TOOLS: EveTool[] = [UNIT_360, BUILDING_360]
