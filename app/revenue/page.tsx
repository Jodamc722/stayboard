// REVENUE CENTER — the revenue-manager's cockpit. Per-listing performance (occupancy, ADR,
// RevPAR, struggling flags, vacant units) with a full revenue breakdown: gross accommodation,
// net accommodation (after channel fees), cleaning, parking and other fees — switchable lenses.
// Revenue is PRORATED PER NIGHT into the selected range (owner-report convention, reconciles to
// the cent), so a 10-night stay straddling the range only counts its in-range nights. Includes
// prior-period deltas and forward on-the-books pacing (next 30/60/90 days). Confirmed
// reservations only. Data: guesty_reservations (raw->money incl. invoiceItems) + guesty_listings.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { unstable_cache } from 'next/cache'
import { Shell } from '@/components/Shell'
import { RevenueCenter } from '@/components/RevenueCenter'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
// YTD pulls ~3 ranges of reservations incl. raw money JSON - needs more than the default fn timeout.
export const maxDuration = 60

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/
// Standard invoice lines that are NOT guest add-on fees (accommodation/cleaning/taxes/commissions).
const STD_ITEM_RE = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay|verify|resolution|deposit|damage waiver|vat/i

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z')
  return Math.round((db - da) / 86_400_000)
}
function overlapNights(checkIn: string, checkOut: string, from: string, toExcl: string): number {
  if (!checkIn || !checkOut) return 0
  const s = checkIn > from ? checkIn : from
  const e = checkOut < toExcl ? checkOut : toExcl
  const n = daysBetween(s, e)
  return n > 0 ? n : 0
}
function addDays(iso: string, d: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10)
}

type RawResv = {
  listing_id: string; check_in: string; check_out: string; nights: number
  source: string; money_total: number; fare: number; grossFare: number; cleaningFee: number; hostFee: number; commission: number; items: any[]
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// Pull confirmed reservations overlapping [from, toExcl). ROBUST: checks the Supabase error on
// every page, retries transient failures, and THROWS if a page keeps failing - so a bad pull
// can never be silently cached as "$0 revenue". Selects flat money fields + invoiceItems only
// (much lighter than the whole raw->money object).
async function pullRange(sb: any, from: string, toExcl: string): Promise<RawResv[]> {
  let all: any[] = []
  for (let i = 0; i < 30; i++) {
    let data: any[] | null = null
    let lastErr: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await sb
        .from('guesty_reservations')
        .select('listing_id, check_in, check_out, nights, status, source, money_total, fare:raw->money->>fareAccommodation, grossFare:raw->money->>fareAccommodationAdjusted, cleaningFee:raw->money->>fareCleaning, hostFee:raw->money->>hostServiceFeeIncTax, commission:raw->money->>commission, items:raw->money->invoiceItems')
        .in('status', CONFIRMED)
        .gt('check_out', from)
        .lt('check_in', toExcl)
        .range(i * 1000, i * 1000 + 999)
      if (!res.error) { data = res.data || []; break }
      lastErr = res.error
      await sleep(500 * (attempt + 1))
    }
    if (data === null) throw new Error('revenue pull failed (' + from + '..' + toExcl + ' page ' + i + '): ' + String(lastErr && (lastErr.message || lastErr.code) || 'unknown'))
    if (data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  return all
    .filter((r: any) => r.check_in && r.check_out && r.listing_id)
    .map((r: any) => ({
      listing_id: String(r.listing_id),
      check_in: String(r.check_in).slice(0, 10),
      check_out: String(r.check_out).slice(0, 10),
      nights: Math.max(1, num(r.nights) || daysBetween(String(r.check_in).slice(0, 10), String(r.check_out).slice(0, 10))),
      source: String(r.source || 'other'),
      money_total: num(r.money_total),
      fare: num(r.fare), grossFare: num(r.grossFare), cleaningFee: num(r.cleaningFee),
      hostFee: num(r.hostFee), commission: num(r.commission),
      items: Array.isArray(r.items) ? r.items : [],
    }))
}

// Per-reservation revenue components. grossAccom = fareAccommodationAdjusted (guest-paid room
// rate, before OTA fees - matches PriceLabs). netAccom = grossAccom - hostServiceFeeIncTax: the
// OWNER-STATEMENT "Rental Income" basis, validated to the penny against Guesty owner statements
// (Jun 2026: Vrbo 770.23-45.53=724.70, Airbnb 221.15-54.34=166.81, direct 170-0=170). Do NOT use
// raw netIncome/ownerRevenue - they double-count the Airbnb fee and carry stale formula snapshots.
// commission = Guesty's per-reservation PMC commission (the owner's actual business-model %).
type Comp = { grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; commission: number }
function componentsOf(r: RawResv): Comp {
  const grossAccom = r.grossFare || r.fare
  const netAccom = grossAccom - r.hostFee
  const commission = r.commission
  const cleaning = r.cleaningFee
  let parking = 0, other = 0
  for (const it of r.items) {
    const t = String((it && (it.title || it.name)) || '').trim()
    if (!t || STD_ITEM_RE.test(t)) continue
    const amt = num(it && it.amount)
    if (amt === 0) continue
    if (/park/i.test(t)) parking += amt
    else other += amt
  }
  return { grossAccom, netAccom, cleaning, parking, other, commission }
}

// Expedia-family channels bundle cleaning into accommodation (arrives cleaning=0). Rebuild each
// unit's modal cleaning fee from non-Expedia bookings and split it out so Net/Gross line up.
function expediaCleaningFix(list: { r: RawResv; c: Comp }[]) {
  const pool: Record<string, Record<string, number>> = {}
  for (const x of list) {
    if (!EXPEDIA_RE.test(x.r.source.toLowerCase()) && x.c.cleaning > 0) {
      const key = String(Math.round(x.c.cleaning))
      const p = pool[x.r.listing_id] = pool[x.r.listing_id] || {}
      p[key] = (p[key] || 0) + 1
    }
  }
  const modal: Record<string, number> = {}
  for (const id of Object.keys(pool)) {
    let best = 0, bestN = 0
    for (const k of Object.keys(pool[id])) { if (pool[id][k] > bestN) { bestN = pool[id][k]; best = Number(k) } }
    modal[id] = best
  }
  for (const x of list) {
    if (EXPEDIA_RE.test(x.r.source.toLowerCase()) && x.c.cleaning === 0) {
      const cl = modal[x.r.listing_id] || 0
      if (cl > 0 && x.c.grossAccom > cl) {
        x.c.cleaning = cl
        x.c.grossAccom -= cl
        if (x.c.netAccom > cl) x.c.netAccom -= cl
      }
    }
  }
}

export type UnitRow = {
  id: string; name: string; building: string; market: string; owner: string; bedrooms: number | null
  nightsSold: number; occ: number; bookings: number
  grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; commission: number; total: number
  prevOcc: number; prevTotal: number
  otb30: number // forward on-the-books occupancy next 30 days (0..1)
  flags: string[] // struggling reasons
}

// A daily check for the rev team: what to look at, why, and the concrete action.
export type Rec = {
  severity: 'red' | 'amber' | 'info'
  title: string
  action: string
  // Estimated $/month left on the table (0 for informational checks). Ranked desc in the UI.
  impact: number
  units: { id: string; name: string; impact: number }[]
}

export type RevenueData = {
  from: string; to: string; days: number; currency: string
  activeUnits: number; inactiveUnits: number
  totals: Comp & { total: number; moneyTotal: number }
  nightsSold: number; occupiedNights: number; availableNights: number; bookings: number
  prev: { from: string; to: string; total: number; nightsSold: number; occupiedNights: number; availableNights: number; grossAccom: number }
  otb: { d30: number; d60: number; d90: number; nights30: number; nights60: number; nights90: number; rev30: number }
  channels: { name: string; revenue: number; count: number }[]
  buildingAvg: Record<string, { occ: number; adr: number }>
  units: UnitRow[]
  recs: Rec[]
  // Portfolio trend series: total collected revenue + nights sold per day in the range.
  daily: { d: string; rev: number; nights: number }[]
  // Forward on-the-books nights per day for the next 90 days (portfolio).
  fwdDaily: { d: string; nights: number }[]
}

function prettyChannel(s: string): string {
  const c = s.toLowerCase()
  if (/airbnb/.test(c)) return 'Airbnb'
  if (/booking/.test(c)) return 'Booking.com'
  if (/vrbo|homeaway/.test(c)) return 'Vrbo'
  if (/expedia|hotels\.com/.test(c)) return 'Expedia'
  if (/direct|website|manual|owner/.test(c)) return 'Direct / Owner'
  if (/be-api|api/.test(c)) return 'Booking Engine'
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other'
}

export default async function RevenuePage({ searchParams }: { searchParams?: { from?: string; to?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const validDate = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const to = validDate(searchParams?.to) || todayStr
  // Default view = MONTH TO DATE (first of the current month through today).
  const defFrom = to.slice(0, 8) + '01'
  let from = validDate(searchParams?.from) || defFrom
  if (from > to) from = to
  const toExcl = addDays(to, 1)
  const days = daysBetween(from, to) + 1
  const prevFrom = addDays(from, -days)

  const getData = unstable_cache(async (_f: string, _t: string, _today: string): Promise<RevenueData> => {
    const sb = supabaseAdmin()

    const { data: listingRows } = await sb
      .from('guesty_listings')
      .select('id, title, nickname, building, unit, bedrooms, status, address_city')
      .limit(5000)
    const listings = (listingRows || []) as any[]

    // Listing -> owner name, from the synced Guesty owners store (app_settings 'guesty_owners').
    const ownerOf: Record<string, string> = {}
    try {
      const { data: ownRow } = await sb.from('app_settings').select('value').eq('key', 'guesty_owners').limit(1)
      const j = ownRow && ownRow[0] && ownRow[0].value ? JSON.parse(ownRow[0].value) : null
      const owners = j && Array.isArray(j.owners) ? j.owners : []
      for (const o of owners) {
        const nm = String(o.name || '').trim()
        for (const lid of (Array.isArray(o.listingIds) ? o.listingIds : [])) {
          if (nm) ownerOf[String(lid)] = nm
        }
      }
    } catch {}
    const active = listings.filter(l => !DEAD.includes(String(l.status || '').toLowerCase()))
      .filter(l => !/\bfull\b/i.test(String(l.nickname || l.title || '')))
    const inactiveUnits = listings.length - active.length

    const [cur, prevR, fwd] = await Promise.all([
      pullRange(sb, from, toExcl),
      pullRange(sb, prevFrom, from),
      pullRange(sb, todayStr, addDays(todayStr, 90)),
    ])

    const curX = cur.map(r => ({ r, c: componentsOf(r) }))
    const prevX = prevR.map(r => ({ r, c: componentsOf(r) }))
    expediaCleaningFix(curX)
    expediaCleaningFix(prevX)

    const activeIds = new Set(active.map(l => String(l.id)))
    const currency = 'USD'

    // ---- per-listing accumulation (prorated per night into the range) ----
    type Acc = { nightsSold: number; bookings: number; grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; commission: number; moneyTotal: number }
    const blank = (): Acc => ({ nightsSold: 0, bookings: 0, grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, commission: 0, moneyTotal: 0 })
    const per: Record<string, Acc> = {}
    const byChannel: Record<string, { count: number; revenue: number }> = {}
    const dayRev: Record<string, number> = {}
    const dayNights: Record<string, number> = {}
    for (const x of curX) {
      if (!activeIds.has(x.r.listing_id)) continue
      const n = overlapNights(x.r.check_in, x.r.check_out, from, toExcl)
      if (n <= 0) continue
      const share = n / x.r.nights
      // Per-day trend: spread the reservation's total evenly across its in-range nights.
      const nightly = (x.c.grossAccom + x.c.cleaning + x.c.parking + x.c.other) / x.r.nights
      let nd = x.r.check_in > from ? x.r.check_in : from
      const nEnd = x.r.check_out < toExcl ? x.r.check_out : toExcl
      while (nd < nEnd) {
        dayRev[nd] = (dayRev[nd] || 0) + nightly
        dayNights[nd] = (dayNights[nd] || 0) + 1
        nd = addDays(nd, 1)
      }
      const a = per[x.r.listing_id] = per[x.r.listing_id] || blank()
      a.nightsSold += n
      a.bookings += 1
      a.grossAccom += x.c.grossAccom * share
      a.netAccom += x.c.netAccom * share
      a.cleaning += x.c.cleaning * share
      a.parking += x.c.parking * share
      a.other += x.c.other * share
      a.commission += x.c.commission * share
      a.moneyTotal += x.r.money_total * share
      const ch = prettyChannel(x.r.source)
      if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0 }
      byChannel[ch].count += 1
      byChannel[ch].revenue += (x.c.grossAccom + x.c.cleaning + x.c.parking + x.c.other) * share
    }

    // Prior period per listing (occupancy + total revenue only)
    const prevPer: Record<string, { nights: number; total: number }> = {}
    let prevTotalAll = 0, prevNights = 0, prevGross = 0
    for (const x of prevX) {
      if (!activeIds.has(x.r.listing_id)) continue
      const n = overlapNights(x.r.check_in, x.r.check_out, prevFrom, from)
      if (n <= 0) continue
      const share = n / x.r.nights
      const tot = (x.c.grossAccom + x.c.cleaning + x.c.parking + x.c.other) * share
      const p = prevPer[x.r.listing_id] = prevPer[x.r.listing_id] || { nights: 0, total: 0 }
      p.nights += n; p.total += tot
      prevTotalAll += tot; prevNights += n; prevGross += x.c.grossAccom * share
    }

    // Forward on-the-books nights per listing (30/60/90) + per-day booked curve
    const fwd30: Record<string, number> = {}
    const fwdDayN: Record<string, number> = {}
    let n30 = 0, n60 = 0, n90 = 0, rev30 = 0
    const t30 = addDays(todayStr, 30), t60 = addDays(todayStr, 60), t90 = addDays(todayStr, 90)
    for (const r of fwd) {
      if (!activeIds.has(r.listing_id)) continue
      const a = overlapNights(r.check_in, r.check_out, todayStr, t30)
      const b = overlapNights(r.check_in, r.check_out, todayStr, t60)
      const c = overlapNights(r.check_in, r.check_out, todayStr, t90)
      n30 += a; n60 += b; n90 += c
      if (c > 0) {
        let fd = r.check_in > todayStr ? r.check_in : todayStr
        const fEnd = r.check_out < t90 ? r.check_out : t90
        while (fd < fEnd) { fwdDayN[fd] = (fwdDayN[fd] || 0) + 1; fd = addDays(fd, 1) }
      }
      if (a > 0) {
        fwd30[r.listing_id] = (fwd30[r.listing_id] || 0) + a
        const comp = componentsOf(r)
        rev30 += (comp.grossAccom + comp.cleaning + comp.parking + comp.other) * (a / r.nights)
      }
    }

    // ---- unit rows ----
    const units: UnitRow[] = active.map(l => {
      const id = String(l.id)
      const a = per[id] || blank()
      const p = prevPer[id] || { nights: 0, total: 0 }
      const name = String(l.nickname || l.title || id)
      return {
        id, name,
        building: rollupBuilding(String(l.building || '').trim()),
        market: marketOf(l.building, l.address_city, name),
        owner: ownerOf[id] || 'Unassigned',
        bedrooms: l.bedrooms ?? null,
        nightsSold: a.nightsSold,
        occ: days > 0 ? a.nightsSold / days : 0,
        bookings: a.bookings,
        grossAccom: a.grossAccom, netAccom: a.netAccom, cleaning: a.cleaning, parking: a.parking, other: a.other, commission: a.commission,
        total: a.grossAccom + a.cleaning + a.parking + a.other,
        prevOcc: days > 0 ? p.nights / days : 0,
        prevTotal: p.total,
        otb30: (fwd30[id] || 0) / 30,
        flags: [],
      }
    })

    // ---- building averages (peer benchmark) ----
    const bAgg: Record<string, { nights: number; rev: number; avail: number }> = {}
    for (const u of units) {
      const b = bAgg[u.building] = bAgg[u.building] || { nights: 0, rev: 0, avail: 0 }
      b.nights += u.nightsSold; b.rev += u.grossAccom; b.avail += days
    }
    const buildingAvg: Record<string, { occ: number; adr: number }> = {}
    for (const k of Object.keys(bAgg)) {
      buildingAvg[k] = {
        occ: bAgg[k].avail > 0 ? bAgg[k].nights / bAgg[k].avail : 0,
        adr: bAgg[k].nights > 0 ? bAgg[k].rev / bAgg[k].nights : 0,
      }
    }

    // ---- struggling flags ----
    const revparSorted = units.map(u => u.total / days).sort((a, b) => a - b)
    const decileCut = revparSorted[Math.floor(revparSorted.length * 0.1)] ?? 0
    for (const u of units) {
      const bl = buildingAvg[u.building]
      const adr = u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0
      if (u.nightsSold === 0) u.flags.push('Vacant — no nights sold in range')
      if (bl && bl.occ > 0.05 && u.occ < bl.occ - 0.10) u.flags.push(`Occupancy ${Math.round(u.occ * 100)}% vs building ${Math.round(bl.occ * 100)}%`)
      if (bl && bl.adr > 0 && adr > 0 && adr < bl.adr * 0.85) u.flags.push(`ADR $${Math.round(adr)} vs building $${Math.round(bl.adr)}`)
      if (u.total / days <= decileCut && units.length >= 20) u.flags.push('Bottom 10% RevPAR in portfolio')
      if (u.prevOcc - u.occ >= 0.10) u.flags.push(`Occupancy down ${Math.round((u.prevOcc - u.occ) * 100)}pts vs prior period`)
      if (u.occ < 0.5 && u.nightsSold > 0) u.flags.push('Occupancy under 50%')
      if (u.otb30 === 0) u.flags.push('Zero on-the-books next 30 days')
    }

    // ---- portfolio totals ----
    const totals = { grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, commission: 0, total: 0, moneyTotal: 0 }
    let nightsSold = 0, bookings = 0
    for (const id of Object.keys(per)) {
      const a = per[id]
      totals.grossAccom += a.grossAccom; totals.netAccom += a.netAccom; totals.cleaning += a.cleaning
      totals.parking += a.parking; totals.other += a.other; totals.commission += a.commission; totals.moneyTotal += a.moneyTotal
      nightsSold += a.nightsSold; bookings += a.bookings
    }
    totals.total = totals.grossAccom + totals.cleaning + totals.parking + totals.other
    const availableNights = active.length * days

    const channels = Object.keys(byChannel)
      .map(k => ({ name: k, revenue: byChannel[k].revenue, count: byChannel[k].count }))
      .sort((a, b) => b.revenue - a.revenue)

    // ---- daily checks / recommendations, each with an estimated $/month impact ----
    // Impact estimates are deliberately simple and conservative: peer-pace gaps priced at the
    // building's ADR, normalized to a 30-day month. They rank the work; they are not forecasts.
    const recs: Rec[] = []
    const adrOf = (u: UnitRow) => (u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0)
    const monthize = (v: number) => (days > 0 ? (v * 30) / days : 0)
    const rnd = (v: number) => Math.round(v)
    const chips = (list: { u: UnitRow; imp: number }[]) =>
      list.sort((a, b) => b.imp - a.imp).map(x => ({ id: x.u.id, name: x.u.name, impact: rnd(x.imp) }))
    const sum = (list: { imp: number }[]) => rnd(list.reduce((s, x) => s + x.imp, 0))

    const dead = units.filter(u => u.nightsSold === 0 && u.otb30 === 0)
      .map(u => { const bl = buildingAvg[u.building]; return { u, imp: bl && bl.occ > 0 ? bl.occ * 30 * bl.adr : 0 } })
    if (dead.length > 0) recs.push({
      severity: 'red',
      title: dead.length + ' unit' + (dead.length > 1 ? 's' : '') + ' earned $0 in this range and have nothing on the books',
      action: 'Confirm each is live and bookable (calendar blocks, listing status, min-stay). If deliberately offline, ignore. Otherwise restart momentum: intro rate about -15% and a relaxed min-stay for the next 14 days. Impact = a month at the building’s pace.',
      impact: sum(dead), units: chips(dead),
    })
    const noOtb = units.filter(u => u.nightsSold > 0 && u.otb30 === 0)
      .map(u => { const bl = buildingAvg[u.building]; const base = bl && bl.occ > 0 ? bl.occ * 30 * bl.adr : monthize(u.total); return { u, imp: base } })
    if (noOtb.length > 0) recs.push({
      severity: 'red',
      title: noOtb.length + ' selling unit' + (noOtb.length > 1 ? 's have' : ' has') + ' ZERO nights booked for the next 30 days',
      action: 'These sold recently but the forward calendar is empty. Check for new blocks and stale pricing; refresh near-term rates today before they go dark. Impact = next month’s revenue at peer pace, all at risk.',
      impact: sum(noOtb), units: chips(noOtb),
    })
    const tooHigh = units.filter(u => { const bl = buildingAvg[u.building]; const a = adrOf(u); return !!bl && bl.occ > 0.05 && u.occ < bl.occ - 0.10 && a > bl.adr * 1.05 })
      .map(u => { const bl = buildingAvg[u.building]; return { u, imp: (bl.occ - u.occ) * 30 * bl.adr } })
    if (tooHigh.length > 0) recs.push({
      severity: 'amber',
      title: tooHigh.length + ' unit' + (tooHigh.length > 1 ? 's are' : ' is') + ' priced above building peers but filling less',
      action: 'Same building is outselling them at lower rates. Trim about 10% or add value (parking credit, flexible check-in) and re-check next week. Impact = closing the occupancy gap at the building’s ADR.',
      impact: sum(tooHigh), units: chips(tooHigh),
    })
    const raise = units.filter(u => { const bl = buildingAvg[u.building]; const a = adrOf(u); return !!bl && u.occ >= 0.90 && a > 0 && a < bl.adr * 0.95 })
      .map(u => { const bl = buildingAvg[u.building]; return { u, imp: (bl.adr - adrOf(u)) * u.occ * 30 } })
    if (raise.length > 0) recs.push({
      severity: 'amber',
      title: raise.length + ' unit' + (raise.length > 1 ? 's' : '') + ' at 90%+ occupancy priced below building peers',
      action: 'Money on the table: raise base rates 5-10% and confirm pacing holds. Impact = closing the ADR gap at current occupancy.',
      impact: sum(raise), units: chips(raise),
    })
    const dropped = units.filter(u => u.prevOcc - u.occ >= 0.15 && u.prevOcc > 0.30)
      .map(u => ({ u, imp: (u.prevOcc - u.occ) * 30 * (adrOf(u) || (buildingAvg[u.building]?.adr || 0)) }))
    if (dropped.length > 0) recs.push({
      severity: 'amber',
      title: dropped.length + ' unit' + (dropped.length > 1 ? 's' : '') + ' dropped 15+ occupancy points vs the prior period',
      action: 'Before touching price: check each for a fresh bad review, a channel delisting or sync issue, or new calendar blocks. Impact = the lost occupancy priced at the unit’s ADR.',
      impact: sum(dropped), units: chips(dropped),
    })
    // Parking upsell: value the gap at the building's average parking take per selling unit.
    const parkAgg: Record<string, { rev: number; sellers: number }> = {}
    for (const u of units) if (u.parking > 0) { const p = parkAgg[u.building] = parkAgg[u.building] || { rev: 0, sellers: 0 }; p.rev += u.parking; p.sellers += 1 }
    const upsell = units.filter(u => parkAgg[u.building] && u.parking === 0 && u.nightsSold > 5)
      .map(u => { const p = parkAgg[u.building]; return { u, imp: monthize(p.rev / p.sellers) } })
    if (upsell.length > 0) recs.push({
      severity: 'info',
      title: upsell.length + ' unit' + (upsell.length > 1 ? 's' : '') + ' collected $0 parking in buildings where parking sells',
      action: 'Upsell miss: add parking to the welcome-call script and listing description for these units. Impact = the building’s average parking take per selling unit.',
      impact: sum(upsell), units: chips(upsell),
    })
    const otb30Pct = active.length > 0 ? n30 / (active.length * 30) : 0
    if (active.length > 0 && otb30Pct < 0.40) recs.push({
      severity: 'info',
      title: 'Portfolio is only ' + Math.round(otb30Pct * 100) + '% booked for the next 30 days',
      action: 'Broad pacing is soft. Review base rates for near-term dates and open up min-stays to catch short-window demand.',
      impact: 0, units: [],
    })
    const topCh = channels[0]
    if (topCh && totals.total > 0 && topCh.revenue / totals.total > 0.80) recs.push({
      severity: 'info',
      title: topCh.name + ' is ' + Math.round((topCh.revenue / totals.total) * 100) + '% of revenue',
      action: 'Heavy single-channel dependence. Keep pushing direct: booking-engine links in guidebooks and repeat-guest offers.',
      impact: 0, units: [],
    })
    recs.sort((a, b) => b.impact - a.impact)

    // ---- trend series ----
    const daily: { d: string; rev: number; nights: number }[] = []
    for (let dd = from; dd <= to; dd = addDays(dd, 1)) daily.push({ d: dd, rev: Math.round(dayRev[dd] || 0), nights: dayNights[dd] || 0 })
    const fwdDaily: { d: string; nights: number }[] = []
    for (let dd = todayStr; dd < t90; dd = addDays(dd, 1)) fwdDaily.push({ d: dd, nights: fwdDayN[dd] || 0 })

    return {
      from, to, days, currency,
      activeUnits: active.length, inactiveUnits,
      totals, nightsSold, occupiedNights: nightsSold, availableNights, bookings,
      prev: { from: prevFrom, to: addDays(from, -1), total: prevTotalAll, nightsSold: prevNights, occupiedNights: prevNights, availableNights, grossAccom: prevGross },
      otb: {
        d30: active.length ? n30 / (active.length * 30) : 0,
        d60: active.length ? n60 / (active.length * 60) : 0,
        d90: active.length ? n90 / (active.length * 90) : 0,
        nights30: n30, nights60: n60, nights90: n90, rev30,
      },
      channels, buildingAvg, units, recs, daily, fwdDaily,
    }
  }, ['revenue-center-v7'], { tags: ['revenue'], revalidate: 300 })

  const data = await getData(from, to, todayStr)

  return (
    <Shell>
      <RevenueCenter data={data} />
    </Shell>
  )
}
