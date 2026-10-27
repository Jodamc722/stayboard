// WHAT WE KNOW ABOUT THEIR MARKET, FROM OUR OWN BOOK.
//
// Jon, 2026-10-27: "the proposal entered into a particular slide should feed the area, the market
// data, the seasonality, etc. It should show our expertise and understanding of the market."
//
// The market slide used to be four empty prompts for someone to fill in before a meeting, which is
// a slide that goes out empty. This builds it instead from the only market data we can actually
// stand behind: the bookings our own units in that market took over the last twelve months. Not a
// bought index, not a scraped comp set — settled nights on properties we run, which is also the
// one source a prospect can hold us to.
//
// THE COMP SET IS BEDROOM-MATCHED WHERE WE CAN. A one-bedroom owner does not care what the
// three-bedrooms did, so when we run three or more units of their size in their market, that is
// the set; otherwise it widens to the whole market and the slide says which it used. Below three
// units there is no set worth quoting and the figures stay out — see the no-percentage-without-a-
// sample rule this business already works to.
//
// REVENUE ONLY, same as lib/sales-proof: gross and net of channel fees, never an expense line.
import { pullReservations, metricsFor, fmtK } from './owner-report'
import { basisTriple } from './basis'
import { rollupBuilding } from './optimize-score'
import { marketOf, marketLabel } from './segments'
import { supabaseAdmin } from './supabase-admin'

export type MarketMonth = { label: string; iso: string; occPct: number; adr: string; peak?: boolean }
export type MarketIntel = {
  market: string
  label: string
  units: number
  /** 'size' when the comp set is bedroom-matched, 'market' when it had to widen. */
  basis: 'size' | 'market'
  bedrooms: number | null
  window: string
  occ: string
  adr: string
  revpar: string
  grossPerUnit: string
  months: MarketMonth[]
  peakLabel: string
  lowLabel: string
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function monthStart(iso: string): string { return iso.slice(0, 7) + '-01' }
function nextMonth(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return (m >= 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01'
}
function shortMonth(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
}
function longMonth(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
}

/** Twelve months of our own book in one market, for a property of a given size. */
export async function marketIntel(opts: { market?: string; building?: string; bedrooms?: number | null; to: string }): Promise<MarketIntel | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status').limit(1000)
  const all = ((data || []) as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    // A combined "Full" listing is one apartment sold twice; it would double the market's nights.
    return !/\bfull\b/i.test(str(l.nickname || l.title || l.id))
  })
  const want = str(opts.market) || (opts.building ? String(marketOf(rollupBuilding(str(opts.building)))) : '')
  if (!want) return null
  const inMarket = all.filter(l => String(marketOf(rollupBuilding(str(l.building)))).toLowerCase() === want.toLowerCase())
  if (inMarket.length < 3) return null

  const br = opts.bedrooms == null || !Number.isFinite(Number(opts.bedrooms)) ? null : Number(opts.bedrooms)
  const sized = br == null ? [] : inMarket.filter(l => Number(l.bedrooms) === br)
  const set = sized.length >= 3 ? sized : inMarket
  const basis: 'size' | 'market' = sized.length >= 3 ? 'size' : 'market'

  // Twelve whole months back from the month before `to`, so a half-finished month never drags the
  // curve down on the slide.
  const endExcl = monthStart(opts.to)
  let from = endExcl
  for (let i = 0; i < 12; i++) from = monthStart(new Date(Date.parse(from + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10))
  const ids = set.map(l => String(l.id))
  const resv = await pullReservations(ids, from, endExcl)
  const units = set.length

  const whole = metricsFor(resv, units, from, endExcl)
  const raw = (m: ReturnType<typeof metricsFor>) => ({
    accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
    feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
  })
  const g = basisTriple(raw(whole), 'gross')
  if (!whole.occupiedNights) return null

  const months: MarketMonth[] = []
  let cur = from
  while (cur < endExcl) {
    const nx = nextMonth(cur)
    const mm = metricsFor(resv, units, cur, nx)
    const mg = basisTriple(raw(mm), 'gross')
    months.push({ label: shortMonth(cur), iso: cur, occPct: mm.occupancyPct, adr: '$' + mg.adr })
    cur = nx
  }
  const best = months.reduce((a, b) => (b.occPct > a.occPct ? b : a), months[0])
  const worst = months.reduce((a, b) => (b.occPct < a.occPct ? b : a), months[0])
  for (const m of months) if (m.occPct >= best.occPct) m.peak = true

  return {
    market: want,
    label: marketLabel(want),
    units,
    basis,
    bedrooms: basis === 'size' ? br : null,
    window: shortMonth(months[0].iso) + ' ' + months[0].iso.slice(0, 4) + ' – ' + shortMonth(months[months.length - 1].iso) + ' ' + months[months.length - 1].iso.slice(0, 4),
    occ: whole.occupancyPct + '%',
    adr: '$' + g.adr,
    revpar: '$' + g.revpar,
    grossPerUnit: fmtK(Math.round(g.revenue / Math.max(1, units))),
    months,
    peakLabel: longMonth(best.iso),
    lowLabel: longMonth(worst.iso),
  }
}
