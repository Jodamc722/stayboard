// BUSINESS KPIs — the numbers the home page runs on.
//
// One endpoint, one window, everything compared against the SAME LENGTH period immediately before
// it — or, for a whole calendar month, the calendar month before — so "vs prior" always means
// something. Sources:
//   • guesty_reservations  → occupancy, ADR, RevPAR, cleaning revenue, arrivals/departures, welcome calls
//   • breezeway_tasks_sync → work completed (cleans / maintenance / inspections), minutes, rate_paid
//   • guesty_conversation_sentiment → guest sentiment
//   • guesty_reviews       → the recent low reviews (headline review KPIs come from /api/reviews/kpi)
//   • glitches             → service failures + what they cost us
//   • labor_timesheets     → Homebase hours/payroll once a CSV has been uploaded
//
// EVERY table read here is PAGED. PostgREST caps a request at 1000 rows no matter what .limit()
// says — that cap is what produced the fake "149% review rate" on the reviews page, so nothing in
// this file trusts a single request.
//
// Lives in lib/ (not in the route file) so the route stays a three-line wrapper.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from './breezeway'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { noBreezewayRegex, vendorRegex } from '@/lib/ops-presets'
import { rollupBuilding } from '@/lib/optimize-score'
import { canSeeMoney, type Access } from '@/lib/access'
import { redactMoney, pctOrCount } from '@/lib/money'
import { pageRows } from '@/lib/db-page'
import { isTaskDone, isTaskGone } from '@/lib/task-categories'
import { isLowReview } from '@/lib/review-scale'
import { welcomeRate, welcomeCallsDue } from '@/lib/call-desk'
import { wholeMonth } from '@/lib/money-source'


const DEAD_LISTING = ['inactive', 'disabled', 'archived', 'deleted']
const LIVE_RES = ['confirmed', 'checked_in', 'checked_out', 'closed']

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
function round(n: number, p = 1): number { const f = Math.pow(10, p); return Math.round(n * f) / f }
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function addDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function daysBetween(a: string, b: string): number {
  const x = new Date(a + 'T12:00:00Z').getTime(), y = new Date(b + 'T12:00:00Z').getTime()
  return Math.round((y - x) / 86400000) + 1
}
function isCancelled(s: any): boolean { return /cancel|declin|expir|denied|inquiry/i.test(str(s)) }
function deptOf(v: any): string {
  const s = str(v).toLowerCase()
  if (/housekeep|clean/.test(s)) return 'housekeeping'
  if (/maint|repair/.test(s)) return 'maintenance'
  if (/inspect/.test(s)) return 'inspection'
  return s || 'other'
}
// The app's one task-state rule (lib/task-categories) — this file had its own looser copies.
function isDone(t: any): boolean { return isTaskDone(t && t.status, t && t.finished_at) }
function isDead(t: any): boolean { return isTaskGone(t && t.status) }
// The same test the board and the labor engine use. `^clean` used to be in here, which counted
// "Clean common areas" as a turnover.
function isTurn(name: any): boolean { return isDepartureCleanName(name) }

/** Percentage change, guarding a zero base (which would otherwise read as an infinite gain). */
function pctChange(now: number, prev: number): number | null {
  if (!prev) return null
  return round(((now - prev) / Math.abs(prev)) * 100, 1)
}

// ── EVERY READ IS PAGED, AND A SHORT READ SAYS SO (2026-09-28 audit, P0-1) ────────────────────────
// This file had its own pager: 14 pages, stop on the first error, no flag. The tasks read runs over
// BOTH windows oldest-first at ~89 Breezeway tasks a day, so the 90-day view (~16,000 rows) lost the
// newest three weeks of the current window and the 12-month view (~65,000) loaded almost none of it —
// and a failed page read as "no more rows". Now every paged read goes through lib/db-page pageRows
// (a failed page reports `truncated`), reads NEWEST FIRST so a ceiling can only ever cut the oldest
// days of the PRIOR window, and gets a page budget sized to its span. Whatever still comes back short
// is named on the board ("partial") and its numbers are blanked rather than printed low.

/** Pages for `days` days of a table that grows by up to `perDay` rows a day — with room to spare. */
function pagesFor(days: number, perDay: number, min = 2): number {
  return Math.max(min, Math.ceil((Math.max(1, days) * perDay) / 1000) + 1)
}
/** The oldest day a newest-first read reached (the day itself may be only partly read). */
function oldestDay(rows: any[], dayOf: (r: any) => string): string {
  let min = ''
  for (const r of rows) { const d = dayOf(r); if (d && (!min || d < min)) min = d }
  return min
}
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
/** The Eastern calendar day of a timestamp — the day it happened on here, not in UTC. */
function etDayOf(ts: any): string {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? str(ts).slice(0, 10) : ET_DAY.format(d)
}

type Li = { id: string; name: string; building: string; market: string; active: boolean; full: boolean; listingFee: number }

export async function buildKpi(sp: URLSearchParams, access: Access): Promise<any> {
  // WHO SEES DOLLARS — one definition for the whole app (lib/access.ts). This used to be a second,
  // local rule: admin OR workspace admin/gm/data. That is the rule Jon replaced on 2026-08-10
  // ("only view of that data should be me ... toggle on and off per user"), so leaving it here
  // meant the home board and the labor board disagreed about the same person — and worse, it read
  // `workspace`, which normWorkspace() defaults to 'gm' when the column is missing, handing the
  // portfolio's revenue to every un-migrated user.
  //
  // Everything non-money on this board is unchanged: counts, completion, sentiment, reviews.
  const showMoney = canSeeMoney(access)

  {
    const db = supabaseAdmin()
    const today = todayET()
    const isDate = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(str(v))

    let to = isDate(sp.get('to')) ? str(sp.get('to')) : today
    let from = isDate(sp.get('from')) ? str(sp.get('from')) : ''
    if (!from) {
      const d = Math.max(1, Math.min(365, parseInt(str(sp.get('days')) || '30', 10) || 30))
      from = addDays(to, -(d - 1))
    }
    if (from > to) { const t = from; from = to; to = t }
    const span = daysBetween(from, to)
    // "VS PRIOR" (2026-09-28 audit, P1-7). A whole calendar month compares with the calendar month
    // before it — September against August, not against Aug 2–31 — which is also the only prior the
    // Revenue App (month-grained) can answer. Any other window compares with the same number of days
    // immediately before it. Occupancy, ADR and RevPAR are per-night rates, so a 30- vs 31-day pair
    // compares like with like.
    const prevTo = addDays(from, -1)
    const monthly = !!wholeMonth(from, to)
    const prevFrom = monthly ? prevTo.slice(0, 8) + '01' : addDays(prevTo, -(span - 1))
    const marketFilter = str(sp.get('market') || 'all')
    const buildingFilter = str(sp.get('building') || 'all')

    // ---------------------------------------------------------------- listings
    // Every number on the board is scoped through this map, so a partial read is not a partial board —
    // it is a wrong one. It fails loudly instead.
    const listingRead = await pageRows<any>((a, b) =>
      db.from('guesty_listings').select('id,nickname,title,building,address_city,status,listingFee:raw->prices->>cleaningFee').order('id').range(a, b), 3)
    if (listingRead.truncated) throw new Error('The listings read came back short — refusing to build the board on part of the portfolio. Try Refresh.')
    const listingRows = listingRead.rows
    const lmap: Record<string, Li> = {}
    for (const l of listingRows) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = {
        id: String(l.id),
        name,
        building: rollupBuilding(l.building, name) || 'Unassigned',
        market: marketOf(l.building, l.address_city, name),
        active: !DEAD_LISTING.includes(str(l.status).toLowerCase()),
        // A "Full …" combo listing sells units that also exist as listings of their own — Revenue
        // Center keeps it out of the unit count (app/revenue/page.tsx), and so does this board now.
        full: /\bfull\b/i.test(name),
        // Jon 2026-07-31: the cleaning fee also lives on the PROPERTY in Guesty (Fees). Some
        // channels fold cleaning into the nightly rate, so those checkouts carry no fareCleaning
        // and would otherwise read as a free clean. The listing fee is the fallback.
        listingFee: num(l.listingFee),
      }
    }
    const all = Object.keys(lmap).map(k => lmap[k])
    const inScope = (lid: any): boolean => {
      const li = lmap[String(lid)]
      if (!li) return marketFilter === 'all' && buildingFilter === 'all'
      if (marketFilter !== 'all' && li.market !== marketFilter) return false
      if (buildingFilter !== 'all' && li.building !== buildingFilter) return false
      return true
    }
    // THE STOCK — the units occupancy, ADR, RevPAR and revenue are measured over (2026-09-28 audit,
    // P0-4 interim). Both sides of every ratio come from it: active listings that are real units
    // (no `full` combos), in scope. The numerator used to take stays at inactive and unknown listings
    // too while the denominator counted active units only, and the combos sat in the denominator —
    // so Home's occupancy and ADR could not match Revenue Center's for the same window. The `closed`
    // status rule and Botanica's cleaning-as-ADR are deliberately unchanged here.
    const inStock = (lid: any): boolean => {
      const li = lmap[String(lid)]
      return !!li && li.active && !li.full && inScope(lid)
    }
    const scopedUnits = all.filter(l => l.active && !l.full && inScope(l.id))
    const unitCount = scopedUnits.length || 1

    // ---------------------------------------------------------------- reads
    const resFrom = prevFrom
    const resTo = addDays(to, 14)          // far enough forward for arrivals-next-7
    const readDays = daysBetween(prevFrom, to)
    const [resRead, taskRead, sentRead, lowReviews, glitchRows, openWork, syncRows, openGlitchRes, openTaskRes, welcome, welcomePrev, welcomeDue] = await Promise.all([
      // Live statuses only, filtered in the database (status is lowercased at sync): cancellations
      // and inquiries were read over both windows only to be thrown away here. No custom_fields any
      // more either — the welcome-call numbers come from the call log (lib/call-desk) — and that jsonb
      // column on two windows of reservations was the heaviest thing this read carried.
      // NEWEST FIRST (checkout desc, id to break ties) so a short read can only lose the oldest stays.
      pageRows<any>((a, b) => db.from('guesty_reservations')
        .select('id,listing_id,check_in,check_out,nights,status,source,money_total,cleaning:raw->money->>fareCleaning,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,channelFee:raw->money->>hostServiceFee')
        .in('status', LIVE_RES)
        .gte('check_out', resFrom).lte('check_in', resTo)
        .order('check_out', { ascending: false }).order('id', { ascending: false }).range(a, b), pagesFor(daysBetween(resFrom, resTo), 50)),
      // ~89 tasks a day (lib/task-done); budgeted at 120 over both windows. Only the columns this file
      // reads — `assignees` (jsonb) and `started_at` rode along on every row for nothing.
      pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
        .select('id,reference_property_id,name,status,type_department,scheduled_date,finished_at,total_minutes,rate_paid')
        .gte('scheduled_date', prevFrom).lte('scheduled_date', to)
        .order('scheduled_date', { ascending: false }).order('id', { ascending: false }).range(a, b), pagesFor(readDays, 120)),
      pageRows<any>((a, b) => db.from('guesty_conversation_sentiment')
        .select('conversation_id,listing_id,band,dissatisfied,awaiting_reply,status,top_issue,last_message_at')
        .gte('last_message_at', prevFrom + 'T00:00:00Z')
        .order('last_message_at', { ascending: false }).order('conversation_id').range(a, b), pagesFor(readDays, 50)),
      // LOW ON ITS OWN SCALE (2026-09-28): ≤3 stars, or ≤7/10 on Booking (stored 3.5) — the review
      // KPIs' isLowReview, applied below. Reviews excluded from the score stay off the list, as they
      // do everywhere else a review is judged.
      db.from('guesty_reviews')
        .select('id,listing_id,rating,content,guest_name,channel,created_at,has_reply')
        .gte('created_at', from + 'T00:00:00Z').lte('rating', 3.5).is('removed_at', null).eq('excluded_from_score', false)
        .order('created_at', { ascending: false }).limit(60),
      // PAGED (2026-09-03): both were .limit(1000) — the cap itself. Glitches over two windows
      // and open requests can exceed it; the counts under-reported exactly when they mattered.
      pageRows<any>((a, b) => db.from('glitches').select('id,status,category,market,unit,listing_id,created_at,refund_approved')
        .gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false }).order('id').range(a, b), pagesFor(readDays, 15, 6)),
      pageRows<any>((a, b) => db.from('field_requests').select('id,status,due_at,priority,building').in('status', ['open', 'in_progress']).order('id').range(a, b), 4),
      db.from('guesty_sync_status').select('entity,last_sync_at').order('entity'),
      // OPEN WORK, the honest version. Requests alone under-report badly — the same rule the day
      // sheet uses counts open glitches plus Breezeway tasks from the last 45 days that nobody
      // has finished. Open glitches are ROWS now, not a head count, so a filtered board can count
      // only its own (a few hundred at most — three columns).
      pageRows<any>((a, b) => db.from('glitches').select('id,listing_id,market')
        .not('status', 'in', '("done","resolved","closed")').order('id').range(a, b), 4),
      pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select('id,reference_property_id')
        .gte('scheduled_date', addDays(today, -45)).lte('scheduled_date', today)
        .is('finished_at', null)
        .not('status', 'ilike', '%complet%').not('status', 'ilike', '%finish%')
        .not('status', 'ilike', '%close%').not('status', 'ilike', '%approv%')
        .not('status', 'ilike', '%delete%').not('status', 'ilike', '%cancel%')
        .order('id').range(a, b), 8),
      // WELCOME CALLS — the call log's rate (lib/call-desk welcomeRate), the same number the Calls
      // desk and the Command Center strip print, narrowed to this board's scope.
      welcomeRate(db, from, to, inScope),
      welcomeRate(db, prevFrom, prevTo, inScope),
      welcomeCallsDue(db, today).catch(() => null),
    ])
    const reservations = resRead.rows
    const tasks = taskRead.rows
    const sentiment = sentRead.rows

    // ---------------------------------------------------------------- what each read covered
    // A newest-first read that stopped early still holds every day AFTER the oldest one it touched,
    // so a window is complete when the read finished or reached back past its first day. The current
    // window's stays are the board: if they did not load, it fails loudly rather than print a low
    // occupancy. Anything else short is blanked where it would mislead, and named in `partial`.
    const partial: string[] = []
    const covers = (truncated: boolean, oldest: string, a: string) => !truncated || (!!oldest && oldest < a)
    const resOld = oldestDay(reservations, r => str(r.check_out).slice(0, 10))
    if (!covers(resRead.truncated, resOld, from)) throw new Error('The reservations read came back short — occupancy and revenue would be understated. Try Refresh.')
    const resPrevOk = covers(resRead.truncated, resOld, prevFrom)
    if (!resPrevOk) partial.push('stays before ' + addDays(resOld, 1) + ' not read — revenue vs prior left blank')
    const taskOld = oldestDay(tasks, t => str(t.scheduled_date).slice(0, 10))
    const tasksCurOk = covers(taskRead.truncated, taskOld, from)
    const tasksPrevOk = covers(taskRead.truncated, taskOld, prevFrom)
    if (!tasksCurOk) partial.push('Breezeway tasks did not load in full — work figures left blank')
    else if (!tasksPrevOk) partial.push('Breezeway tasks before ' + addDays(taskOld, 1) + ' not read — work vs prior left blank')
    const sentOld = oldestDay(sentiment, s => etDayOf(s.last_message_at))
    const sentCurOk = covers(sentRead.truncated, sentOld, from)
    const sentPrevOk = covers(sentRead.truncated, sentOld, prevFrom)
    if (!sentCurOk) partial.push('guest sentiment did not load in full — left blank')
    else if (!sentPrevOk) partial.push('guest sentiment before ' + addDays(sentOld, 1) + ' not read — vs prior left blank')
    const glOld = oldestDay(glitchRows.rows || [], g => etDayOf(g.created_at))
    const glCurOk = covers(glitchRows.truncated, glOld, from)
    const glPrevOk = covers(glitchRows.truncated, glOld, prevFrom)
    if (!glCurOk) partial.push('glitches did not load in full — left blank')
    else if (!glPrevOk) partial.push('glitches before ' + addDays(glOld, 1) + ' not read — vs prior left blank')
    if (welcome.truncated || welcomePrev.truncated) partial.push('the call log read came back short — welcome rate left blank')
    if (welcomeDue == null) partial.push('welcome calls due could not be read')
    if (openWork.truncated || openTaskRes.truncated || openGlitchRes.truncated) partial.push('open work read came back short — the count is a floor')

    // ---------------------------------------------------------------- today
    const live = reservations.filter(r => !isCancelled(r.status) && LIVE_RES.indexOf(str(r.status).toLowerCase()) >= 0 && inScope(r.listing_id))
    // ── EXPEDIA CLEANING BACK-FILL (2026-08-20, mirrored from lib/labor-econ) ──────────────
    // Expedia-family channels bundle the cleaning fee INTO the fare, so fareCleaning arrives 0.
    // The old listing-fee fallback priced those turns while the fare STILL CONTAINED the bundled
    // fee — the same clean counted twice inside total revenue. The engine's rule, applied here so
    // the KPI board and the Labor board tell one story: rebuild the fee from the unit's OWN
    // non-Expedia bookings (the MODAL fee, capped at the fare) and MOVE it out of the fare —
    // totals unchanged, nothing duplicated. Listing fee only as a last resort for an Expedia
    // unit with no history to learn from.
    const EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/
    const feePool: Record<string, Record<string, number>> = {}
    for (const r of live) {
      const c0 = num(r.cleaning)
      if (c0 > 0 && !EXPEDIA_RE.test(str(r.source).toLowerCase())) {
        const id = String(r.listing_id), k = String(Math.round(c0))
        feePool[id] = feePool[id] || {}; feePool[id][k] = (feePool[id][k] || 0) + 1
      }
    }
    const modalFee: Record<string, number> = {}
    for (const id in feePool) { let best = 0, bn = 0; for (const k in feePool[id]) if (feePool[id][k] > bn) { bn = feePool[id][k]; best = Number(k) }; modalFee[id] = best }
    for (const r of live) {
      if (!EXPEDIA_RE.test(str(r.source).toLowerCase())) continue
      if (num(r.cleaning) > 0) continue
      const li0 = lmap[String(r.listing_id)]
      const m = modalFee[String(r.listing_id)] || (li0 && li0.listingFee > 0 ? li0.listingFee : 0)
      const gf = num(r.fare)
      const take = Math.min(m, gf)
      if (!(take > 0)) continue
      ;(r as any).cleaning = take
      ;(r as any).fare = gf - take        // it was inside the fare; move it, never duplicate it
      ;(r as any).__backfilled = true
    }
    // Vendor-cleaned buildings — their checkouts earn a fee but no in-house hour touches them,
    // so cleaning turns are split in-house vs vendor instead of blended.
    const VENDOR_K = vendorRegex((await getOpsPresets()).vendorBuildings)
    const vendorLi: Record<string, boolean> = {}
    const botLi: Record<string, boolean> = {}
    for (const l of all) {
      vendorLi[l.id] = VENDOR_K.test(l.building) || VENDOR_K.test(l.name)
      // BOTANICA (Jon, 2026-08-22): "the cleaning fee goes back into ADR. We don't even get
      // invoiced for that... It's just part of ADR and our management agreement." Its fee is
      // ROOM revenue by contract — it never touches a cleaning line anywhere in the app.
      botLi[l.id] = /botanica/i.test(l.building) || /botanica/i.test(l.name)
    }
    const dOf = (v: any) => str(v).slice(0, 10)
    const arrivalsToday = live.filter(r => dOf(r.check_in) === today)
    const departuresToday = live.filter(r => dOf(r.check_out) === today)
    const inHouseNow = live.filter(r => dOf(r.check_in) <= today && dOf(r.check_out) > today)
    // The count above is operational (every guest in house); the occupancy % is over the stock.
    const inHouseStock = inHouseNow.filter(r => inStock(r.listing_id)).length
    const sameDayTurns = departuresToday.filter(d => arrivalsToday.some(a => String(a.listing_id) === String(d.listing_id))).length
    const in7 = addDays(today, 7)
    const arrivals7 = live.filter(r => dOf(r.check_in) >= today && dOf(r.check_in) <= in7)
    const booked7 = arrivals7.reduce((s, r) => s + num(r.money_total), 0)

    const scopedTasks = tasks.filter(t => !isDead(t) && inScope(t.reference_property_id))
    // DEPARTURE CLEANS (2026-09-28 audit, P1-11) — the turnover the 4pm deadline is about, by the
    // shared name rule. It counted every housekeeping-department task, so common-area cleans,
    // restocks and linen drops padded "X/Y cleans".
    const cleansToday = scopedTasks.filter(t => dOf(t.scheduled_date) === today && isTurn(t.name))
    const cleansTodayDone = cleansToday.filter(isDone).length

    // ---------------------------------------------------------------- window helpers
    const inWin = (d: string, a: string, b: string) => !!d && d >= a && d <= b
    // Nights of a stay that fall inside [a,b]. Occupancy has to be measured on nights, not bookings.
    const nightsIn = (r: any, a: string, b: string): number => {
      const ci = dOf(r.check_in), co = dOf(r.check_out)
      if (!ci || !co) return 0
      const s = ci > a ? ci : a
      const e = co < addDays(b, 1) ? co : addDays(b, 1)
      const n = Math.round((new Date(e + 'T12:00:00Z').getTime() - new Date(s + 'T12:00:00Z').getTime()) / 86400000)
      return n > 0 ? n : 0
    }
    // Nights in the whole stay — Guesty's count, else the dates. Both the headline and the market
    // table prorate the fare by it (the market table used to fall back to 1 night, which put a whole
    // stay's fare on every in-window night of a row with no `nights`).
    const stayNights = (r: any): number => Math.max(1, Number(r.nights) || Math.round((new Date(dOf(r.check_out) + 'T12:00:00Z').getTime() - new Date(dOf(r.check_in) + 'T12:00:00Z').getTime()) / 86400000) || 1)

    const stayBlock = (a: string, b: string) => {
      const days = daysBetween(a, b)
      let nights = 0, room = 0, cleaning = 0, turns = 0, arrivals = 0, turnsFromListingFee = 0, turnsUnpriced = 0
      let cleaningNet = 0, cleaningGrossIn = 0, cleaningNetIn = 0, turnsIn = 0, turnsVen = 0, turnsBackfilled = 0
      const byChannel: Record<string, { nights: number; revenue: number }> = {}
      const byBuilding: Record<string, { nights: number; revenue: number; cleaning: number; units: Record<string, true> }> = {}
      for (const r of live) {
        // Numerator and denominator from the same stock (see inStock): a stay at an inactive,
        // unknown or `full` combo listing is not a night of the units `available` counts.
        if (!inStock(r.listing_id)) continue
        const n = nightsIn(r, a, b)
        const li = lmap[String(r.listing_id)]
        const bld = li ? li.building : 'Unassigned'
        if (n > 0) {
          const totalNights = stayNights(r)
          const fare = num(r.fare) || num(r.fareBase) || num(r.money_total)
          const share = (fare / totalNights) * n
          nights += n; room += share
          const ch = str(r.source) || 'Direct'
          if (!byChannel[ch]) byChannel[ch] = { nights: 0, revenue: 0 }
          byChannel[ch].nights += n; byChannel[ch].revenue += share
          if (!byBuilding[bld]) byBuilding[bld] = { nights: 0, revenue: 0, cleaning: 0, units: {} }
          byBuilding[bld].nights += n; byBuilding[bld].revenue += share
          if (li) byBuilding[bld].units[li.id] = true
        }
        // Cleaning fee belongs to the checkout it paid for. Reservation first (what the guest was
        // actually charged), then the property's configured fee, then nothing.
        if (inWin(dOf(r.check_out), a, b)) {
          const charged = num(r.cleaning)
          let c = charged
          // Botanica's fee is ADR by contract — count it as room revenue and move on. No
          // cleaning turn, no cleaning revenue, no fallback pricing.
          if (li && botLi[li.id]) {
            if (c > 0) { room += c; if (!byBuilding[bld]) byBuilding[bld] = { nights: 0, revenue: 0, cleaning: 0, units: {} }; byBuilding[bld].revenue += c }
            if (inWin(dOf(r.check_in), a, b)) arrivals += 1
            continue
          }
          // Expedia-bundled fees were already rebuilt OUT of the fare above, so this fallback now
          // only prices a non-Expedia checkout that genuinely carries no fee.
          if (!c && li && li.listingFee > 0) { c = li.listingFee; turnsFromListingFee += 1 }
          else if (!c) turnsUnpriced += 1
          cleaning += c; turns += 1
          if ((r as any).__backfilled) turnsBackfilled += 1
          // NET of the channel's cut — the exact formula lib/labor-econ uses, so this board and
          // the Labor board net the same way: fee − hostServiceFee × (fee / (fare + fee)).
          const chFee = Math.max(0, num(r.channelFee))
          const base = num(r.fare) + c
          const netC = base > 0 && chFee > 0 ? Math.max(0, c - chFee * (c / base)) : c
          cleaningNet += netC
          if (li && vendorLi[li.id]) turnsVen += 1
          else { turnsIn += 1; cleaningGrossIn += c; cleaningNetIn += netC }
          if (!byBuilding[bld]) byBuilding[bld] = { nights: 0, revenue: 0, cleaning: 0, units: {} }
          byBuilding[bld].cleaning += c
        }
        if (inWin(dOf(r.check_in), a, b)) arrivals += 1
      }
      const available = unitCount * days
      return {
        days, nights, available, arrivals, turns, turnsFromListingFee, turnsUnpriced,
        turnsInHouse: turnsIn, turnsVendor: turnsVen, turnsBackfilled,
        cleaningNet: Math.round(cleaningNet),
        cleaningNetInHouse: Math.round(cleaningNetIn),
        cleaningGrossInHouse: Math.round(cleaningGrossIn),
        occupancy: available ? round((nights / available) * 100, 1) : 0,
        roomRevenue: Math.round(room),
        cleaningRevenue: Math.round(cleaning),
        totalRevenue: Math.round(room + cleaning),
        // ONE ADR (2026-09-03). `adr` is accommodation ÷ nights — the industry definition, the
        // lib/basis default, what Revenue Center and PriceLabs report. It used to include cleaning
        // here and nowhere else, so the briefs and Eve quoted an ADR the Revenue page could not
        // reproduce. The cleaning-inclusive figure is still available as `adrGross`.
        adr: nights ? Math.round(room / nights) : 0,
        adrGross: nights ? Math.round((room + cleaning) / nights) : 0,
        adrRoomOnly: nights ? Math.round(room / nights) : 0,
        // RevPAR IS OCCUPANCY × ADR (lib/pacing-check, 2026-09-28 audit P0-2): room revenue ÷
        // available unit-nights — the same numerator as `adr`. It carried cleaning while ADR did not,
        // so RevPAR ÷ occupancy gave an ADR the board did not show. Cleaning-inclusive: `revparGross`.
        revpar: available ? round(room / available, 2) : 0,
        revparGross: available ? round((room + cleaning) / available, 2) : 0,
        byChannel, byBuilding,
      }
    }

    const workBlock = (a: string, b: string) => {
      const rows = scopedTasks.filter(t => inWin(dOf(t.scheduled_date), a, b))
      const done = rows.filter(isDone)
      const byDept: Record<string, { scheduled: number; done: number; minutes: number; cost: number }> = {}
      const byMarket: Record<string, { done: number; cost: number; minutes: number }> = {}
      const byBuilding: Record<string, { done: number; cleans: number; maintenance: number; inspections: number; cost: number }> = {}
      const byDay: Record<string, number> = {}
      for (const t of rows) {
        const d = deptOf(t.type_department)
        if (!byDept[d]) byDept[d] = { scheduled: 0, done: 0, minutes: 0, cost: 0 }
        byDept[d].scheduled += 1
      }
      let minutes = 0, cost = 0, turns = 0, turnMinutes = 0, turnCost = 0, onTime = 0, onTimeBase = 0
      for (const t of done) {
        const d = deptOf(t.type_department)
        const li = lmap[String(t.reference_property_id)]
        const mkt = li ? li.market : 'Other'
        const bld = li ? li.building : 'Unassigned'
        const mins = Number(t.total_minutes) || 0
        const pay = num(t.rate_paid)
        minutes += mins; cost += pay
        if (!byDept[d]) byDept[d] = { scheduled: 0, done: 0, minutes: 0, cost: 0 }
        byDept[d].done += 1; byDept[d].minutes += mins; byDept[d].cost += pay
        if (!byMarket[mkt]) byMarket[mkt] = { done: 0, cost: 0, minutes: 0 }
        byMarket[mkt].done += 1; byMarket[mkt].cost += pay; byMarket[mkt].minutes += mins
        if (!byBuilding[bld]) byBuilding[bld] = { done: 0, cleans: 0, maintenance: 0, inspections: 0, cost: 0 }
        byBuilding[bld].done += 1; byBuilding[bld].cost += pay
        if (d === 'housekeeping') byBuilding[bld].cleans += 1
        if (d === 'maintenance') byBuilding[bld].maintenance += 1
        if (d === 'inspection') byBuilding[bld].inspections += 1
        const day = dOf(t.scheduled_date)
        byDay[day] = (byDay[day] || 0) + 1
        if (d === 'housekeeping' && isTurn(t.name)) { turns += 1; turnMinutes += mins; turnCost += pay }
        // On time = finished on the day it was scheduled for. That is the promise we make.
        if (t.finished_at) {
          onTimeBase += 1
          if (etDayOf(t.finished_at) <= day) onTime += 1
        }
      }
      const dept = (k: string) => byDept[k] || { scheduled: 0, done: 0, minutes: 0, cost: 0 }
      // No percentage without a sample (lib/money pctOrCount): under 5 the rate is null, not "100%".
      return {
        scheduled: rows.length, completed: done.length,
        completionRate: pctOrCount(done.length, rows.length).pct,
        minutes, hours: round(minutes / 60, 1), cost: Math.round(cost),
        cleans: dept('housekeeping').done, maintenance: dept('maintenance').done, inspections: dept('inspection').done,
        cleaningCost: Math.round(dept('housekeeping').cost),
        maintenanceCost: Math.round(dept('maintenance').cost),
        turns, turnMinutes, turnCost: Math.round(turnCost),
        minutesPerTurn: turns ? Math.round(turnMinutes / turns) : null,
        // COST PER CLEAN IS NOT COMPUTED HERE ANY MORE (2026-09-09). This divided Breezeway's
        // `rate_paid` — a field that is empty on every task in this account — by housekeeping-
        // DEPARTMENT cleans, so it excluded any turn filed under maintenance and was funded by a
        // column of zeros, while the tile that showed it was unlocked by a Homebase check. One
        // number, one place: lib/labor-econ owns it and /api/labor/headline serves it.
        costPerTurn: null,
        onTimeRate: pctOrCount(onTime, onTimeBase).pct,
        byDept, byMarket, byBuilding, byDay,
      }
    }

    // ---- welcome calls. The rate is the call log's (read above, lib/call-desk welcomeRate). Calls on
    // the clock right now are the desk's own `dueNow` — live arrivals from today through the 72-hour
    // runway with no completed call, whether the tick is in Guesty or on the desk — in this scope.
    // `null` = that read failed, which the board shows as a dash rather than a confident zero.
    const welcomeDueNow: number | null = welcomeDue ? welcomeDue.filter(d => inScope(d.listingId)).length : null

    // TIMESTAMPS BUCKET BY THE EASTERN DAY (2026-09-28 audit, P2-4): slicing the UTC string put a
    // message or a glitch from after 8pm ET on the next day — and across a window's edge.
    const sentimentBlock = (a: string, b: string) => {
      const rows = sentiment.filter(s => inWin(etDayOf(s.last_message_at), a, b) && (!s.listing_id || inScope(s.listing_id)))
      const bad = rows.filter(s => !!s.dissatisfied).length
      const issues: Record<string, number> = {}
      for (const s of rows) {
        if (!s.dissatisfied) continue
        const k = str(s.top_issue) || 'other'
        issues[k] = (issues[k] || 0) + 1
      }
      return {
        scanned: rows.length, unhappy: bad,
        unhappyPct: pctOrCount(bad, rows.length).pct,
        happyPct: pctOrCount(rows.length - bad, rows.length).pct,
        topIssues: Object.keys(issues).map(k => ({ issue: k, n: issues[k] })).sort((x, y) => y.n - x.n).slice(0, 6),
      }
    }
    const openUnhappy = sentiment.filter(s => s.dissatisfied && str(s.status || 'open') === 'open').length
    const awaitingReply = sentiment.filter(s => s.awaiting_reply && str(s.status || 'open') === 'open').length

    // A glitch is in this board's scope by its LISTING when it has one; one with no listing can only
    // be placed by market, so a building filter leaves it out (2026-09-28 audit, P2-8 — the block
    // filtered by market alone, so a building view showed the whole market's glitches).
    const glitchInScope = (g: any): boolean => g.listing_id
      ? inScope(g.listing_id)
      : buildingFilter === 'all' && (marketFilter === 'all' || str(g.market) === marketFilter)
    const GLITCH_DONE = ['done', 'resolved', 'closed']
    const glitchBlock = (a: string, b: string) => {
      const rows = (glitchRows.rows || []).filter((g: any) => inWin(etDayOf(g.created_at), a, b) && glitchInScope(g))
      // Refunds only. Cost recovery was retired 2026-08-27 — Jon: "cost recovery is not
      // something we track, the refund amount is."
      const cost = rows.reduce((s: number, g: any) => s + num(g.refund_approved), 0)
      const cats: Record<string, number> = {}
      for (const g of rows) { const k = str(g.category) || 'Other'; cats[k] = (cats[k] || 0) + 1 }
      return {
        opened: rows.length,
        // Closed = any finished state — the same three "open" excludes. Only `closed` was counted,
        // so a glitch marked done or resolved was neither open nor closed.
        closed: rows.filter((g: any) => GLITCH_DONE.indexOf(str(g.status).toLowerCase()) >= 0).length,
        cost: Math.round(cost),
        categories: Object.keys(cats).map(k => ({ category: k, n: cats[k] })).sort((x, y) => y.n - x.n).slice(0, 6),
      }
    }
    // Open glitches NOW, in this board's scope (P2-8: it was a portfolio-wide head count on every view).
    const openGlitchesNow = ((openGlitchRes.rows || []) as any[]).filter(glitchInScope).length

    // PUNCHES, NOT THE CSV LEDGER (Jon, 2026-09-01: one source). This block read the uploaded
    // labor_timesheets table — a parallel ledger with its own math that could and did disagree
    // with /labor. It now reads the same audited Homebase punches everything else uses; when a
    // week failed to fetch, hasData goes false and the board falls back rather than understating.
    let punchCards: { date: string | null; name: string; hours: number | null; laborCost: number | null }[] = []
    let punchesComplete = false
    try {
      const { getTimecardsAudited } = await import('./homebase-labor')
      const a = await getTimecardsAudited(prevFrom, to)
      punchCards = a.cards as any[]
      punchesComplete = a.complete
    } catch { /* board falls back to Breezeway-cost basis below */ }
    const laborBlock = (a: string, b: string) => {
      const rows = punchCards.filter(r => r.date && r.date >= a && r.date <= b)
      const hours = rows.reduce((s: number, r: any) => s + (Number(r.hours) || 0), 0)
      const cost = rows.reduce((s: number, r: any) => s + (Number(r.laborCost) || 0), 0)
      const people: Record<string, true> = {}
      for (const r of rows) people[str(r.name)] = true
      return { hasData: punchesComplete && rows.length > 0, hours: round(hours, 1), cost: Math.round(cost), people: Object.keys(people).length }
    }

    const stays = stayBlock(from, to)
    const staysPrev = stayBlock(prevFrom, prevTo)
    const work = workBlock(from, to)
    const workPrev = workBlock(prevFrom, prevTo)
    const senti = sentimentBlock(from, to)
    const sentiPrev = sentimentBlock(prevFrom, prevTo)
    const glitch = glitchBlock(from, to)
    const glitchPrev = glitchBlock(prevFrom, prevTo)
    const homebase = laborBlock(from, to)
    const homebasePrev = laborBlock(prevFrom, prevTo)

    // Cleaning P&L: what the guest paid for cleaning, against what we paid to clean.
    // HONESTY GATE. Breezeway only carries `rate_paid` if the billing module is switched on, and
    // today it is empty on every task. Subtracting zero would have printed a 100% cleaning margin
    // and a $0 labour cost — both worse than useless. When no pay is recorded anywhere, the money
    // side of housekeeping is reported as UNKNOWN, not as free.
    const cleaningCostKnown = work.cleaningCost > 0
    // Margin runs on NET IN-HOUSE revenue — what we actually keep on units our own crew turns —
    // never on gross-including-vendor, which flattered the margin twice over.
    const cleaningMargin = stays.cleaningNetInHouse - work.cleaningCost
    const cleaningMarginPrev = staysPrev.cleaningNetInHouse - workPrev.cleaningCost
    const labourCost = homebase.hasData ? homebase.cost : work.cost
    const labourCostPrev = homebasePrev.hasData ? homebasePrev.cost : workPrev.cost
    const labourSource = homebase.hasData ? 'homebase' : (work.cost > 0 ? 'breezeway' : 'none')
    const labourKnown = labourCost > 0

    // Open work now (not window-bound) — what is sitting on someone's plate right now.
    const openRows = (openWork.rows || []) as any[]
    const nowIso = new Date().toISOString()
    const overdueWork = openRows.filter(w => w.due_at && str(w.due_at) < nowIso).length
    // Guesty-only buildings (Botanica) left Breezeway with old tasks still sitting in the mirror.
    // Nobody will ever close those, so they are not open work. (Re-applied 2026-07-31 after a
    // parallel-session commit reverted it - keep this block if you touch this file.)
    const noBz = noBreezewayRegex((await getOpsPresets()).vendorBuildings)
    const openTasks = ((openTaskRes.rows || []) as any[]).filter(t => {
      const li = lmap[String(t.reference_property_id)]
      // In this board's scope, like the glitches beside them on the Open work tile.
      return (!li || !noBz.test(li.building + ' ' + li.name)) && inScope(t.reference_property_id)
    }).length
    const openWorkTotal = openRows.length + openGlitchesNow + openTasks

    const buildingRows = Object.keys(work.byBuilding).map(b => {
      const w = work.byBuilding[b]
      const s = stays.byBuilding[b] || { nights: 0, revenue: 0, cleaning: 0, units: {} }
      // Every unit in the building's stock, booked or not (2026-09-28 audit, P1-1). It counted only
      // the units that HAD nights, so a building half empty read as full to Eve and the GM brief.
      const units = all.filter(l => l.active && !l.full && l.building === b && inScope(l.id)).length
      return {
        building: b, done: w.done, cleans: w.cleans, maintenance: w.maintenance, inspections: w.inspections,
        cost: Math.round(w.cost), nights: s.nights, revenue: Math.round(s.revenue + s.cleaning),
        occupancy: units ? round((s.nights / (units * span)) * 100, 1) : null,
      }
    }).sort((a, b) => b.done - a.done)

    const marketRows = ['Miami', 'Broward', 'North'].map(m => {
      const w = work.byMarket[m] || { done: 0, cost: 0, minutes: 0 }
      // The same stock as the headline, per market — so a Miami-filtered board has no Broward row
      // at 0%, and the nights come from the units being counted.
      const units = all.filter(l => l.active && !l.full && l.market === m && inScope(l.id)).length
      let nights = 0, revenue = 0
      for (const r of live) {
        const li = lmap[String(r.listing_id)]
        if (!li || li.market !== m || !inStock(r.listing_id)) continue
        const n = nightsIn(r, from, to)
        if (n > 0) {
          const totalNights = stayNights(r)
          nights += n
          revenue += ((num(r.fare) || num(r.fareBase) || num(r.money_total)) / totalNights) * n
        }
        if (inWin(dOf(r.check_out), from, to)) revenue += num(r.cleaning)
      }
      return {
        market: m, units, done: w.done, cost: Math.round(w.cost), hours: round(w.minutes / 60, 1),
        nights, revenue: Math.round(revenue),
        occupancy: units ? round((nights / (units * span)) * 100, 1) : null,
      }
    }).filter(r => r.units > 0 || r.done > 0)

    // NOTHING VANISHES. Some completed tasks sit on Breezeway properties with no Guesty listing
    // behind them (common areas, buildings we do not manage on the PMS side). Without this row the
    // market table quietly sums to less than the headline, which is exactly how a board loses trust.
    {
      const placed = marketRows.reduce((a, r) => a + r.done, 0)
      const missing = work.completed - placed
      if (missing > 0) marketRows.push({
        market: 'Not matched to a unit', units: 0, done: missing,
        cost: Math.round((work.byMarket['Other'] || { cost: 0 }).cost || 0),
        hours: round(((work.byMarket['Other'] || { minutes: 0 }).minutes || 0) / 60, 1),
        nights: 0, revenue: 0, occupancy: null,
      })
    }

    const dayRows: { date: string; done: number }[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) dayRows.push({ date: d, done: work.byDay[d] || 0 })

    const negatives = ((lowReviews.data || []) as any[])
      // The read starts at UTC midnight (hours early); the window is the Eastern day.
      .filter(r => isLowReview(r.rating, r.channel) && inScope(r.listing_id) && etDayOf(r.created_at) >= from)
      .slice(0, 12)
      .map(r => {
        const li = lmap[String(r.listing_id)]
        return {
          id: r.id, listingId: r.listing_id, unit: li ? li.name : 'Unit', building: li ? li.building : null,
          rating: Number(r.rating) || null, guest: r.guest_name || 'Guest', channel: r.channel || null,
          at: r.created_at, replied: !!r.has_reply,
          quote: str(r.content).replace(/\s+/g, ' ').trim().slice(0, 220),
        }
      })

    const lastSync = ((syncRows.data || []) as any[]).map(s => s.last_sync_at).filter(Boolean).sort().pop() || null

    const money = <T,>(v: T): T | null => (showMoney ? v : null)

    const payload = {
      ok: true,
      window: { from, to, days: span, prevFrom, prevTo, prevDays: daysBetween(prevFrom, prevTo), prior: monthly ? 'month' : 'days', today },
      filters: {
        market: marketFilter, building: buildingFilter,
        markets: ['Miami', 'Broward', 'North'],
        buildings: Array.from(new Set(all.filter(l => l.active).map(l => l.building))).sort(),
      },
      // The flag KpiHome renders against. Must stay the boolean — writing `canSeeMoney` shorthand
      // here now picks up the imported FUNCTION, which JSON.stringify drops, and the board then
      // hides money from everyone including the owner.
      canSeeMoney: showMoney,
      lastSync,
      // What did not load in full, one short line each — KpiHome prints them; empty = everything read.
      partial,

      today: {
        arrivals: arrivalsToday.length,
        departures: departuresToday.length,
        inHouse: inHouseNow.length,
        units: scopedUnits.length,
        occupancy: round((inHouseStock / unitCount) * 100, 1),
        sameDayTurns,
        cleansScheduled: cleansToday.length,
        cleansDone: cleansTodayDone,
        cleansDonePct: pctOrCount(cleansTodayDone, cleansToday.length).pct,
        arrivals7: arrivals7.length,
        booked7: money(Math.round(booked7)),
        welcomeDueNow,
        openWork: openWorkTotal,
        openRequests: openRows.length,
        openTasks,
        overdueWork,
        openGlitches: openGlitchesNow,
        openUnhappy,
        awaitingReply,
      },

      revenue: {
        occupancy: stays.occupancy, occupancyPrev: staysPrev.occupancy,
        occupancyChange: round(stays.occupancy - staysPrev.occupancy, 1),
        nights: stays.nights, available: stays.available,
        adr: money(stays.adr), adrPrev: money(staysPrev.adr), adrChange: money(pctChange(stays.adr, staysPrev.adr)),
        adrGross: money(stays.adrGross), adrRoomOnly: money(stays.adrRoomOnly),
        revpar: money(stays.revpar), revparPrev: money(staysPrev.revpar), revparChange: money(pctChange(stays.revpar, staysPrev.revpar)),
        revparGross: money(stays.revparGross),
        total: money(stays.totalRevenue), totalPrev: money(staysPrev.totalRevenue), totalChange: money(pctChange(stays.totalRevenue, staysPrev.totalRevenue)),
        channels: Object.keys(stays.byChannel).map(c => ({
          channel: c, nights: stays.byChannel[c].nights, revenue: money(Math.round(stays.byChannel[c].revenue)),
          share: stays.nights ? round((stays.byChannel[c].nights / stays.nights) * 100, 1) : 0,
        })).sort((a, b) => b.nights - a.nights).slice(0, 8),
      },

      cleaning: {
        // NET, IN-HOUSE, ENGINE CONVENTION (Jon, 2026-08-21: "make sure that on all interfaces
        // everything is pulling the same level of data"). Revenue here is what we keep of the
        // cleaning fee after the OTA's cut, on units our own crew turns. Vendor checkouts and
        // the channel cut are broken out below instead of blended in; gross stays visible.
        revenue: money(stays.cleaningNetInHouse), revenuePrev: money(staysPrev.cleaningNetInHouse),
        revenueChange: money(pctChange(stays.cleaningNetInHouse, staysPrev.cleaningNetInHouse)),
        revenueGross: money(stays.cleaningRevenue),          // every checkout, before the cut
        revenueGrossPrev: money(staysPrev.cleaningRevenue),
        channelCut: money(Math.max(0, stays.cleaningGrossInHouse - stays.cleaningNetInHouse)),
        turns: stays.turns, turnsPrev: staysPrev.turns,
        turnsInHouse: stays.turnsInHouse, turnsInHousePrev: staysPrev.turnsInHouse,
        turnsVendor: stays.turnsVendor, turnsBackfilled: stays.turnsBackfilled,
        turnsFromListingFee: stays.turnsFromListingFee, turnsUnpriced: stays.turnsUnpriced,
        feePerTurn: money(stays.turnsInHouse ? Math.round(stays.cleaningNetInHouse / stays.turnsInHouse) : 0),
        costKnown: cleaningCostKnown,
        cost: cleaningCostKnown ? money(work.cleaningCost) : null,
        costPrev: cleaningCostKnown ? money(workPrev.cleaningCost) : null,
        costPerTurn: cleaningCostKnown ? money(work.costPerTurn) : null,
        margin: cleaningCostKnown ? money(cleaningMargin) : null,
        marginPrev: cleaningCostKnown ? money(cleaningMarginPrev) : null,
        marginChange: cleaningCostKnown ? money(pctChange(cleaningMargin, cleaningMarginPrev)) : null,
        // A margin % off a handful of turns is noise — the sample here is turns, not dollars.
        marginPct: cleaningCostKnown && stays.cleaningNetInHouse && stays.turnsInHouse >= 5 ? money(round((cleaningMargin / stays.cleaningNetInHouse) * 100, 1)) : null,
        minutesPerTurn: work.minutesPerTurn,
        costNote: cleaningCostKnown
          ? 'cost = what Breezeway records as paid on completed housekeeping tasks'
          : 'Breezeway records no pay on these tasks, so the margin cannot be worked out yet — upload a Homebase timesheet on the Labor page',
      },

      labor: {
        source: labourSource, known: labourKnown,
        cost: labourKnown ? money(labourCost) : null,
        costPrev: labourKnown ? money(labourCostPrev) : null,
        costChange: labourKnown ? money(pctChange(labourCost, labourCostPrev)) : null,
        hours: homebase.hasData ? homebase.hours : work.hours,
        hoursPrev: homebasePrev.hasData ? homebasePrev.hours : workPrev.hours,
        people: homebase.hasData ? homebase.people : null,
        homebaseConnected: homebase.hasData,
        costPerTurn: labourKnown ? money(work.costPerTurn) : null,
        costRatio: labourKnown && stays.totalRevenue ? money(round((labourCost / stays.totalRevenue) * 100, 1)) : null,
        breezewayCost: work.cost > 0 ? money(work.cost) : null,
        minutesPerTurn: work.minutesPerTurn,
      },

      work: {
        scheduled: work.scheduled, completed: work.completed, completedPrev: workPrev.completed,
        completedChange: pctChange(work.completed, workPrev.completed),
        completionRate: work.completionRate, completionRatePrev: workPrev.completionRate,
        onTimeRate: work.onTimeRate, onTimeRatePrev: workPrev.onTimeRate,
        cleans: work.cleans, cleansPrev: workPrev.cleans,
        maintenance: work.maintenance, maintenancePrev: workPrev.maintenance,
        inspections: work.inspections, inspectionsPrev: workPrev.inspections,
        hours: work.hours, minutesPerTurn: work.minutesPerTurn,
        byMarket: marketRows,
        byBuilding: buildingRows.slice(0, 14),
        byDay: dayRows,
      },

      welcome: {
        // completed ÷ (completed + incomplete) from the call log; null under 5 closed calls.
        // `arrivals` keeps its name for the GM brief ("X of Y") — it is the calls with a verdict.
        pct: welcome.rate, pctPrev: welcomePrev.rate,
        done: welcome.completed, arrivals: welcome.completed + welcome.incomplete,
        missed: welcome.incomplete, open: welcome.open, n: welcome.n, text: welcome.text,
        since: welcome.since,
        dueNow: welcomeDueNow,
      },

      sentiment: {
        scanned: senti.scanned, unhappy: senti.unhappy, unhappyPct: senti.unhappyPct, happyPct: senti.happyPct,
        happyPctPrev: sentiPrev.happyPct, topIssues: senti.topIssues,
        openUnhappy, awaitingReply,
      },

      glitches: {
        opened: glitch.opened, openedPrev: glitchPrev.opened,
        closed: glitch.closed, open: openGlitchesNow,
        cost: money(glitch.cost), costPrev: money(glitchPrev.cost),
        costChange: money(pctChange(glitch.cost, glitchPrev.cost)),
        categories: glitch.categories,
      },

      negatives,
    }

    // A SHORT READ BLANKS WHAT IT WOULD HAVE UNDERSTATED (see `partial` above). A comparison against
    // half a prior window is not a smaller comparison, it is a wrong one — so it goes, and the note
    // says why. The current window's work, sentiment and glitch figures go the same way when their
    // own read failed; the stays that feed revenue and occupancy already threw.
    const blank = (block: any, keys: string[]) => { if (block) for (const k of keys) block[k] = null }
    if (!resPrevOk) {
      blank(payload.revenue, ['occupancyPrev', 'occupancyChange', 'adrPrev', 'adrChange', 'revparPrev', 'revparChange', 'totalPrev', 'totalChange'])
      blank(payload.cleaning, ['revenuePrev', 'revenueChange', 'revenueGrossPrev', 'turnsPrev', 'turnsInHousePrev', 'marginPrev', 'marginChange'])
    }
    if (!tasksPrevOk) {
      blank(payload.work, ['completedPrev', 'completedChange', 'completionRatePrev', 'onTimeRatePrev', 'cleansPrev', 'maintenancePrev', 'inspectionsPrev'])
      blank(payload.cleaning, ['costPrev', 'marginPrev', 'marginChange'])
      if (!homebasePrev.hasData) blank(payload.labor, ['costPrev', 'costChange', 'hoursPrev'])
    }
    if (!tasksCurOk) {
      blank(payload.work, ['scheduled', 'completed', 'completedChange', 'completionRate', 'onTimeRate', 'cleans', 'maintenance', 'inspections', 'hours', 'minutesPerTurn'])
      ;(payload.work as any).byBuilding = []
      ;(payload.work as any).byDay = []
      for (const m of payload.work.byMarket as any[]) { m.done = null; m.cost = null; m.hours = null }
      ;(payload.work as any).partial = true
      blank(payload.today, ['cleansScheduled', 'cleansDone', 'cleansDonePct'])
      blank(payload.cleaning, ['minutesPerTurn', 'cost', 'costPerTurn', 'margin', 'marginPct'])
      blank(payload.labor, ['minutesPerTurn', 'breezewayCost'])
      if (!homebase.hasData) blank(payload.labor, ['hours', 'cost', 'costChange', 'costRatio'])
    }
    if (!sentCurOk) {
      blank(payload.sentiment, ['scanned', 'unhappy', 'unhappyPct', 'happyPct', 'happyPctPrev', 'openUnhappy', 'awaitingReply'])
      ;(payload.sentiment as any).topIssues = []
      blank(payload.today, ['openUnhappy', 'awaitingReply'])
    } else if (!sentPrevOk) blank(payload.sentiment, ['happyPctPrev'])
    if (!glCurOk) {
      blank(payload.glitches, ['opened', 'openedPrev', 'closed', 'cost', 'costPrev', 'costChange'])
      ;(payload.glitches as any).categories = []
    } else if (!glPrevOk) blank(payload.glitches, ['openedPrev', 'costPrev', 'costChange'])

    // BELT AND BRACES. money() above only covers the fields somebody remembered to wrap, and two
    // did not get wrapped: marketRows and buildingRows shipped raw `cost` and `revenue` to every
    // ops user, quietly, for as long as that gate has existed. redactMoney() strips by field NAME,
    // so it catches those and anything added later without a wrapper. money() still earns its keep
    // for fields whose names don't read like money at all (adr, revpar, booked7).
    // MONEY SOURCE (Jon, 2026-08-24). When the Revenue App owns a money domain, HIS number is the
    // number — here, once, so the KPI board, the daily briefs, Eve and the weekly all change
    // together instead of drifting apart. Ops volumes, Breezeway work and Homebase labour are
    // untouched; only revenue, cleaning revenue, expenses, budget and projections move. A scoped
    // board passes its unit ids so a filtered view can never be answered with a portfolio total,
    // and anything he cannot cover falls back to OUR math with `moneySource.note` saying why.
    //
    // Runs BEFORE redactMoney so a non-money user is still stripped: whose number it is and who is
    // allowed to see it are two separate questions.
    const scopeIds = (marketFilter === 'all' && buildingFilter === 'all') ? null : scopedUnits.map(l => l.id)
    let out: any = payload
    try {
      const { applyMoneyOverride } = await import('./money-source')
      out = await applyMoneyOverride(payload, from, to, prevFrom, prevTo, scopeIds)
    } catch { /* the mirror is never allowed to take the KPI board down — ours stands */ }
    return showMoney ? { ...out, moneyHidden: false } : { ...redactMoney(out), moneyHidden: true }
  }
}
