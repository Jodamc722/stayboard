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
  source: string; money_total: number; money: any
}

async function pullRange(sb: any, from: string, toExcl: string): Promise<RawResv[]> {
  let all: any[] = []
  for (let i = 0; i < 30; i++) {
    const { data } = await sb
      .from('guesty_reservations')
      .select('listing_id, check_in, check_out, nights, status, source, money_total, money:raw->money')
      .in('status', CONFIRMED)
      .gt('check_out', from)
      .lt('check_in', toExcl)
      .range(i * 1000, i * 1000 + 999)
    if (!data || data.length === 0) break
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
      money: (r.money && typeof r.money === 'object') ? r.money : {},
    }))
}

// Per-reservation revenue components. netAccom = fareAccommodation (after channel/OTA host fee),
// grossAccom = fareAccommodationAdjusted (before the fee — matches PriceLabs / guest-paid room rate).
type Comp = { grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number }
function componentsOf(r: RawResv): Comp {
  const m = r.money || {}
  const netAccom = num(m.fareAccommodation)
  const grossAccom = num(m.fareAccommodationAdjusted) || netAccom
  const cleaning = num(m.fareCleaning)
  let parking = 0, other = 0
  const items = Array.isArray(m.invoiceItems) ? m.invoiceItems : []
  for (const it of items) {
    const t = String((it && (it.title || it.name)) || '').trim()
    if (!t || STD_ITEM_RE.test(t)) continue
    const amt = num(it && it.amount)
    if (amt === 0) continue
    if (/park/i.test(t)) parking += amt
    else other += amt
  }
  return { grossAccom, netAccom, cleaning, parking, other }
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
  id: string; name: string; building: string; market: string; bedrooms: number | null
  nightsSold: number; occ: number; bookings: number
  grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; total: number
  prevOcc: number; prevTotal: number
  otb30: number // forward on-the-books occupancy next 30 days (0..1)
  flags: string[] // struggling reasons
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
  const def30 = addDays(to, -29)
  let from = validDate(searchParams?.from) || def30
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
    type Acc = { nightsSold: number; bookings: number; grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; moneyTotal: number }
    const blank = (): Acc => ({ nightsSold: 0, bookings: 0, grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, moneyTotal: 0 })
    const per: Record<string, Acc> = {}
    const byChannel: Record<string, { count: number; revenue: number }> = {}
    for (const x of curX) {
      if (!activeIds.has(x.r.listing_id)) continue
      const n = overlapNights(x.r.check_in, x.r.check_out, from, toExcl)
      if (n <= 0) continue
      const share = n / x.r.nights
      const a = per[x.r.listing_id] = per[x.r.listing_id] || blank()
      a.nightsSold += n
      a.bookings += 1
      a.grossAccom += x.c.grossAccom * share
      a.netAccom += x.c.netAccom * share
      a.cleaning += x.c.cleaning * share
      a.parking += x.c.parking * share
      a.other += x.c.other * share
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

    // Forward on-the-books nights per listing (30/60/90)
    const fwd30: Record<string, number> = {}
    let n30 = 0, n60 = 0, n90 = 0, rev30 = 0
    const t30 = addDays(todayStr, 30), t60 = addDays(todayStr, 60), t90 = addDays(todayStr, 90)
    for (const r of fwd) {
      if (!activeIds.has(r.listing_id)) continue
      const a = overlapNights(r.check_in, r.check_out, todayStr, t30)
      const b = overlapNights(r.check_in, r.check_out, todayStr, t60)
      const c = overlapNights(r.check_in, r.check_out, todayStr, t90)
      n30 += a; n60 += b; n90 += c
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
        bedrooms: l.bedrooms ?? null,
        nightsSold: a.nightsSold,
        occ: days > 0 ? a.nightsSold / days : 0,
        bookings: a.bookings,
        grossAccom: a.grossAccom, netAccom: a.netAccom, cleaning: a.cleaning, parking: a.parking, other: a.other,
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
    const totals = { grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, total: 0, moneyTotal: 0 }
    let nightsSold = 0, bookings = 0
    for (const id of Object.keys(per)) {
      const a = per[id]
      totals.grossAccom += a.grossAccom; totals.netAccom += a.netAccom; totals.cleaning += a.cleaning
      totals.parking += a.parking; totals.other += a.other; totals.moneyTotal += a.moneyTotal
      nightsSold += a.nightsSold; bookings += a.bookings
    }
    totals.total = totals.grossAccom + totals.cleaning + totals.parking + totals.other
    const availableNights = active.length * days

    const channels = Object.keys(byChannel)
      .map(k => ({ name: k, revenue: byChannel[k].revenue, count: byChannel[k].count }))
      .sort((a, b) => b.revenue - a.revenue)

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
      channels, buildingAvg, units,
    }
  }, ['revenue-center-v2'], { tags: ['revenue'], revalidate: 300 })

  const data = await getData(from, to, todayStr)

  return (
    <Shell>
      <RevenueCenter data={data} />
    </Shell>
  )
}
