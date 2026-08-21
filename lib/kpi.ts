// BUSINESS KPIs — the numbers the home page runs on.
//
// One endpoint, one window, everything compared against the SAME LENGTH period immediately before
// it, so "vs prior" always means something. Sources:
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
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { noBreezewayRegex, vendorRegex } from '@/lib/ops-presets'
import { rollupBuilding } from '@/lib/optimize-score'
import { canSeeMoney, type Access } from '@/lib/access'
import { redactMoney } from '@/lib/money'


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
function isDone(t: any): boolean { return /complete|finish|close|approv|done/i.test(str(t && t.status)) || !!(t && t.finished_at) }
function isDead(t: any): boolean { return /delete|cancel/i.test(str(t && t.status)) }
function isTurn(name: any): boolean { return /departure clean|turnover clean|^clean/i.test(str(name)) }

/** Percentage change, guarding a zero base (which would otherwise read as an infinite gain). */
function pctChange(now: number, prev: number): number | null {
  if (!prev) return null
  return round(((now - prev) / Math.abs(prev)) * 100, 1)
}

/** Read a whole table in 1000-row pages. PostgREST will not give you more in one request. */
async function pageAll(build: (from: number, to: number) => any, maxPages = 14): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push.apply(out, rows)
    if (rows.length < 1000) break
  }
  return out
}

type Li = { id: string; name: string; building: string; market: string; active: boolean; listingFee: number }

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
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(span - 1))
    const marketFilter = str(sp.get('market') || 'all')
    const buildingFilter = str(sp.get('building') || 'all')

    // ---------------------------------------------------------------- listings
    const listingRows = await pageAll((a, b) =>
      db.from('guesty_listings').select('id,nickname,title,building,address_city,status,listingFee:raw->prices->>cleaningFee').order('id').range(a, b), 3)
    const lmap: Record<string, Li> = {}
    for (const l of listingRows) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = {
        id: String(l.id),
        name,
        building: rollupBuilding(l.building, name) || 'Unassigned',
        market: marketOf(l.building, l.address_city, name),
        active: !DEAD_LISTING.includes(str(l.status).toLowerCase()),
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
    const scopedUnits = all.filter(l => l.active && inScope(l.id))
    const unitCount = scopedUnits.length || 1

    // ---------------------------------------------------------------- reads
    const resFrom = prevFrom
    const resTo = addDays(to, 14)          // far enough forward for arrivals-next-7 and welcome calls
    const [reservations, tasks, sentiment, lowReviews, glitchRows, openWork, timesheets, syncRows, openGlitchRes, openTaskRes] = await Promise.all([
      pageAll((a, b) => db.from('guesty_reservations')
        .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,status,source,money_total,custom_fields,cleaning:raw->money->>fareCleaning,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,channelFee:raw->money->>hostServiceFee')
        .gte('check_out', resFrom).lte('check_in', resTo).order('check_out').range(a, b)),
      pageAll((a, b) => db.from('breezeway_tasks_sync')
        .select('id,reference_property_id,name,status,type_department,scheduled_date,started_at,finished_at,total_minutes,rate_paid,assignees')
        .gte('scheduled_date', prevFrom).lte('scheduled_date', to).order('scheduled_date').range(a, b)),
      pageAll((a, b) => db.from('guesty_conversation_sentiment')
        .select('conversation_id,listing_id,band,dissatisfied,awaiting_reply,status,top_issue,last_message_at')
        .gte('last_message_at', prevFrom + 'T00:00:00Z').order('last_message_at').range(a, b), 4),
      db.from('guesty_reviews')
        .select('id,listing_id,rating,content,guest_name,channel,created_at,has_reply')
        .gte('created_at', from + 'T00:00:00Z').lte('rating', 3)
        .order('created_at', { ascending: false }).limit(60),
      db.from('glitches').select('id,status,category,market,unit,listing_id,created_at,recovery_cost,refund_approved')
        .gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false }).limit(1000),
      db.from('field_requests').select('id,status,due_at,priority,building').in('status', ['open', 'in_progress']).limit(1000),
      db.from('labor_timesheets').select('employee,work_date,hours,cost').neq('source', '__synthetic_test.csv')
        .gte('work_date', prevFrom).lte('work_date', to).limit(5000),
      db.from('guesty_sync_status').select('entity,last_sync_at').order('entity'),
      // OPEN WORK, the honest version. Requests alone under-report badly — the same rule the day
      // sheet uses counts open glitches plus Breezeway tasks from the last 45 days that nobody
      // has finished. Kept as head-counts so it costs nothing.
      db.from('glitches').select('id', { count: 'exact', head: true })
        .not('status', 'in', '("done","resolved","closed")'),
      db.from('breezeway_tasks_sync').select('reference_property_id')
        .gte('scheduled_date', addDays(today, -45)).lte('scheduled_date', today)
        .is('finished_at', null)
        .not('status', 'ilike', '%complet%').not('status', 'ilike', '%finish%')
        .not('status', 'ilike', '%close%').not('status', 'ilike', '%approv%')
        .not('status', 'ilike', '%delete%').not('status', 'ilike', '%cancel%')
        .limit(5000),
    ])

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
    const sameDayTurns = departuresToday.filter(d => arrivalsToday.some(a => String(a.listing_id) === String(d.listing_id))).length
    const in7 = addDays(today, 7)
    const arrivals7 = live.filter(r => dOf(r.check_in) >= today && dOf(r.check_in) <= in7)
    const booked7 = arrivals7.reduce((s, r) => s + num(r.money_total), 0)

    const scopedTasks = tasks.filter(t => !isDead(t) && inScope(t.reference_property_id))
    const cleansToday = scopedTasks.filter(t => dOf(t.scheduled_date) === today && deptOf(t.type_department) === 'housekeeping')
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

    const stayBlock = (a: string, b: string) => {
      const days = daysBetween(a, b)
      let nights = 0, room = 0, cleaning = 0, turns = 0, arrivals = 0, turnsFromListingFee = 0, turnsUnpriced = 0
      let cleaningNet = 0, cleaningGrossIn = 0, cleaningNetIn = 0, turnsIn = 0, turnsVen = 0, turnsBackfilled = 0
      const byChannel: Record<string, { nights: number; revenue: number }> = {}
      const byBuilding: Record<string, { nights: number; revenue: number; cleaning: number; units: Record<string, true> }> = {}
      for (const r of live) {
        const n = nightsIn(r, a, b)
        const li = lmap[String(r.listing_id)]
        const bld = li ? li.building : 'Unassigned'
        if (n > 0) {
          const totalNights = Math.max(1, Number(r.nights) || Math.round((new Date(dOf(r.check_out) + 'T12:00:00Z').getTime() - new Date(dOf(r.check_in) + 'T12:00:00Z').getTime()) / 86400000) || 1)
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
        adr: nights ? Math.round((room + cleaning) / nights) : 0,
        adrRoomOnly: nights ? Math.round(room / nights) : 0,
        revpar: available ? round((room + cleaning) / available, 2) : 0,
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
          const fin = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t.finished_at))
          if (fin <= day) onTime += 1
        }
      }
      const dept = (k: string) => byDept[k] || { scheduled: 0, done: 0, minutes: 0, cost: 0 }
      return {
        scheduled: rows.length, completed: done.length,
        completionRate: rows.length ? round((done.length / rows.length) * 100, 1) : null,
        minutes, hours: round(minutes / 60, 1), cost: Math.round(cost),
        cleans: dept('housekeeping').done, maintenance: dept('maintenance').done, inspections: dept('inspection').done,
        cleaningCost: Math.round(dept('housekeeping').cost),
        maintenanceCost: Math.round(dept('maintenance').cost),
        turns, turnMinutes, turnCost: Math.round(turnCost),
        minutesPerTurn: turns ? Math.round(turnMinutes / turns) : null,
        costPerTurn: turns && turnCost ? round(turnCost / turns, 2) : null,
        onTimeRate: onTimeBase ? round((onTime / onTimeBase) * 100, 1) : null,
        byDept, byMarket, byBuilding, byDay,
      }
    }

    // ---- welcome calls. Any writing in the Welcome Call custom field counts as done (same rule
    // the welcome-calls board uses), so the two screens can never disagree.
    const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'
    const cfId = (c: any) => String((c && c.fieldId && c.fieldId._id) || (c && typeof c.fieldId === 'string' ? c.fieldId : '') || '')
    const welcomeOf = (cf: any) => {
      if (!Array.isArray(cf)) return undefined
      return cf.find((c: any) => cfId(c) === WELCOME_FIELD_ID || /welcome/i.test(str(c && (c.fieldName || c.name || (c.fieldId && c.fieldId.name)))))
    }
    const welcomeBlock = (a: string, b: string) => {
      const rows = live.filter(r => inWin(dOf(r.check_in), a, b) && str(r.status).toLowerCase() === 'confirmed')
      let done = 0
      for (const r of rows) {
        const w: any = welcomeOf(r.custom_fields)
        if (w && ((typeof w.value === 'string' && w.value.trim().length > 0) || w._by)) done += 1
      }
      return { arrivals: rows.length, done, pct: rows.length ? round((done / rows.length) * 100, 1) : null }
    }
    // Calls that are actually on the clock right now: arriving in the next 48 hours, no note yet.
    const dueWindow = addDays(today, 2)
    const welcomeDueNow = live.filter(r => {
      if (str(r.status).toLowerCase() !== 'confirmed') return false
      const ci = dOf(r.check_in)
      if (!(ci >= today && ci <= dueWindow)) return false
      const w: any = welcomeOf(r.custom_fields)
      return !(w && ((typeof w.value === 'string' && w.value.trim().length > 0) || w._by))
    }).length

    const sentimentBlock = (a: string, b: string) => {
      const rows = sentiment.filter(s => inWin(dOf(s.last_message_at), a, b) && (!s.listing_id || inScope(s.listing_id)))
      const bad = rows.filter(s => !!s.dissatisfied).length
      const issues: Record<string, number> = {}
      for (const s of rows) {
        if (!s.dissatisfied) continue
        const k = str(s.top_issue) || 'other'
        issues[k] = (issues[k] || 0) + 1
      }
      return {
        scanned: rows.length, unhappy: bad,
        unhappyPct: rows.length ? round((bad / rows.length) * 100, 1) : null,
        happyPct: rows.length ? round(((rows.length - bad) / rows.length) * 100, 1) : null,
        topIssues: Object.keys(issues).map(k => ({ issue: k, n: issues[k] })).sort((x, y) => y.n - x.n).slice(0, 6),
      }
    }
    const openUnhappy = sentiment.filter(s => s.dissatisfied && str(s.status || 'open') === 'open').length
    const awaitingReply = sentiment.filter(s => s.awaiting_reply && str(s.status || 'open') === 'open').length

    const glitchBlock = (a: string, b: string) => {
      const rows = (glitchRows.data || []).filter((g: any) => inWin(dOf(g.created_at), a, b)
        && (marketFilter === 'all' || str(g.market) === marketFilter))
      const cost = rows.reduce((s: number, g: any) => s + num(g.recovery_cost) + num(g.refund_approved), 0)
      const cats: Record<string, number> = {}
      for (const g of rows) { const k = str(g.category) || 'Other'; cats[k] = (cats[k] || 0) + 1 }
      return {
        opened: rows.length,
        closed: rows.filter((g: any) => str(g.status) === 'closed').length,
        cost: Math.round(cost),
        categories: Object.keys(cats).map(k => ({ category: k, n: cats[k] })).sort((x, y) => y.n - x.n).slice(0, 6),
      }
    }
    const openGlitchesNow = Number(openGlitchRes.count) || 0

    const laborBlock = (a: string, b: string) => {
      const rows = (timesheets.data || []).filter((r: any) => inWin(dOf(r.work_date), a, b))
      const hours = rows.reduce((s: number, r: any) => s + (Number(r.hours) || 0), 0)
      const cost = rows.reduce((s: number, r: any) => s + (Number(r.cost) || 0), 0)
      const people: Record<string, true> = {}
      for (const r of rows) people[str(r.employee)] = true
      return { hasData: rows.length > 0, hours: round(hours, 1), cost: Math.round(cost), people: Object.keys(people).length }
    }

    const stays = stayBlock(from, to)
    const staysPrev = stayBlock(prevFrom, prevTo)
    const work = workBlock(from, to)
    const workPrev = workBlock(prevFrom, prevTo)
    const welcome = welcomeBlock(from, to)
    const welcomePrev = welcomeBlock(prevFrom, prevTo)
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
    const openRows = (openWork.data || []) as any[]
    const nowIso = new Date().toISOString()
    const overdueWork = openRows.filter(w => w.due_at && str(w.due_at) < nowIso).length
    // Guesty-only buildings (Botanica) left Breezeway with old tasks still sitting in the mirror.
    // Nobody will ever close those, so they are not open work. (Re-applied 2026-07-31 after a
    // parallel-session commit reverted it - keep this block if you touch this file.)
    const noBz = noBreezewayRegex((await getOpsPresets()).vendorBuildings)
    const openTasks = ((openTaskRes.data || []) as any[]).filter(t => {
      const li = lmap[String(t.reference_property_id)]
      return !li || !noBz.test(li.building + ' ' + li.name)
    }).length
    const openWorkTotal = openRows.length + openGlitchesNow + openTasks

    const buildingRows = Object.keys(work.byBuilding).map(b => {
      const w = work.byBuilding[b]
      const s = stays.byBuilding[b] || { nights: 0, revenue: 0, cleaning: 0, units: {} }
      const units = Object.keys(s.units || {}).length
      return {
        building: b, done: w.done, cleans: w.cleans, maintenance: w.maintenance, inspections: w.inspections,
        cost: Math.round(w.cost), nights: s.nights, revenue: Math.round(s.revenue + s.cleaning),
        occupancy: units ? round((s.nights / (units * span)) * 100, 1) : null,
      }
    }).sort((a, b) => b.done - a.done)

    const marketRows = ['Miami', 'Broward', 'North'].map(m => {
      const w = work.byMarket[m] || { done: 0, cost: 0, minutes: 0 }
      const units = all.filter(l => l.active && l.market === m && (buildingFilter === 'all' || l.building === buildingFilter)).length
      let nights = 0, revenue = 0
      for (const r of live) {
        const li = lmap[String(r.listing_id)]
        if (!li || li.market !== m) continue
        const n = nightsIn(r, from, to)
        if (n > 0) {
          const totalNights = Math.max(1, Number(r.nights) || 1)
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
      .filter(r => inScope(r.listing_id))
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
      window: { from, to, days: span, prevFrom, prevTo, today },
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

      today: {
        arrivals: arrivalsToday.length,
        departures: departuresToday.length,
        inHouse: inHouseNow.length,
        units: scopedUnits.length,
        occupancy: round((inHouseNow.length / unitCount) * 100, 1),
        sameDayTurns,
        cleansScheduled: cleansToday.length,
        cleansDone: cleansTodayDone,
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
        adrRoomOnly: money(stays.adrRoomOnly),
        revpar: money(stays.revpar), revparPrev: money(staysPrev.revpar), revparChange: money(pctChange(stays.revpar, staysPrev.revpar)),
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
        marginPct: cleaningCostKnown && stays.cleaningNetInHouse ? money(round((cleaningMargin / stays.cleaningNetInHouse) * 100, 1)) : null,
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
        pct: welcome.pct, pctPrev: welcomePrev.pct,
        done: welcome.done, arrivals: welcome.arrivals,
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
    // BELT AND BRACES. money() above only covers the fields somebody remembered to wrap, and two
    // did not get wrapped: marketRows and buildingRows shipped raw `cost` and `revenue` to every
    // ops user, quietly, for as long as that gate has existed. redactMoney() strips by field NAME,
    // so it catches those and anything added later without a wrapper. money() still earns its keep
    // for fields whose names don't read like money at all (adr, revpar, booked7).
    return showMoney ? { ...payload, moneyHidden: false } : { ...redactMoney(payload), moneyHidden: true }
  }
}
