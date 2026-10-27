// WHY OWNERS SWITCH — OUR HOMES AGAINST THE MARKET (Jon, 2026-10-27: "think like the top sales
// director in the country in short-term rentals"; Nick Carline's brief: "our returns 20% above
// average... that claim and backing it up").
//
// THE ONE SLIDE A PROSPECT CANNOT GET FROM ANYONE ELSE: what homes we run earned, set against what
// the same size of home earns across the market, on the same window. Two halves, and each one
// says where it came from.
//
// THE MARKET HALF is AirROI's published benchmark for entire homes LISTED ALL TWELVE MONTHS, by
// bedroom count. That population matters: AirROI's headline medians also count homes that were
// live for a few weeks, which would flatter us against anyone. The all-year table is the honest
// comparison, and it is the one copied below — read 2026-10-27, twelve months to September 2026.
// It is Airbnb booking revenue; ours is every channel. That difference is stated on the slide.
//
// THE OUR HALF counts a home only if it was live for the whole window — a stay checking in within
// the first sixty days of it — because a unit we took on in June has not had a year, and leaving
// it in would understate us exactly as including AirROI's part-year homes would overstate us.
// Studios are measured but carry no benchmark, because AirROI publishes none for all-year studios.
//
// AND THE SLIDE NEVER CLAIMS WHAT IS NOT TRUE. A bedroom count where our median does not beat the
// market median is returned with `ahead: false`, and the slide leaves it out; a market where no
// row is ahead carries no slide. Broward is the live example: our stock there is hotel-style and
// priced for it, and against Fort Lauderdale's all-year homes it does not win.
import { supabaseAdmin } from './supabase-admin'
import { pullReservations, metricsFor } from './owner-report'
import { basisTriple } from './basis'
import { rollupBuilding } from './optimize-score'
import { marketOf } from './segments'

type Bench = { median: number; top: number; homes: number }
type MarketBench = {
  label: string
  url: string
  /** Company-run vs owner-run homes of the same size: revenue and nightly-rate premium, %. */
  pro: { revenue: number; rate: number }
  byBedroom: Record<string, Bench>
}

export const EDGE_SOURCE = {
  name: 'AirROI',
  window: '12 months to September 2026',
  read: '2026-10-27',
  basis: 'Entire homes listed all 12 months, Airbnb booking revenue',
}

// Copied from the published pages, not modelled. Change the window and read date above when these
// are refreshed, or the footnote will vouch for numbers it no longer describes.
export const EDGE_BENCH: Record<string, MarketBench> = {
  miami: {
    label: 'Miami',
    url: 'airroi.com/airbnb-data/united-states/florida/miami/management-companies',
    pro: { revenue: 32, rate: 51 },
    byBedroom: {
      '1BR': { median: 30400, top: 51500, homes: 2290 },
      '2BR': { median: 47400, top: 77600, homes: 1410 },
      '3BR': { median: 68800, top: 109000, homes: 635 },
      '4BR': { median: 88700, top: 133000, homes: 329 },
    },
  },
  broward: {
    label: 'Fort Lauderdale',
    url: 'airroi.com/airbnb-data/united-states/florida/fort-lauderdale/management-companies',
    pro: { revenue: 34, rate: 25 },
    byBedroom: {
      '1BR': { median: 26800, top: 43800, homes: 887 },
      '2BR': { median: 44800, top: 75100, homes: 625 },
      '3BR': { median: 73200, top: 113000, homes: 414 },
      '4BR': { median: 121000, top: 172000, homes: 244 },
    },
  },
}

export type EdgeRow = {
  bedrooms: string
  homes: number
  gross: number
  occ: number
  adr: number
  median: number | null
  top: number | null
  /** Our median over theirs, e.g. 2.1. Null where there is no benchmark. */
  multiple: number | null
  ahead: boolean
  aboveTop: boolean
}
export type Edge = {
  market: string
  benchLabel: string
  window: string
  rows: EdgeRow[]
  pro: { revenue: number; rate: number } | null
  source: string
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const brLabel = (n: number) => (n === 0 ? 'Studio' : n + 'BR')

/** The bench key for a market label as the app writes it ('Miami', 'Broward', 'Fort Lauderdale'…). */
export function benchKey(market: string): string | null {
  const m = str(market).toLowerCase()
  if (!m) return null
  if (/miami/.test(m)) return 'miami'
  if (/broward|lauderdale|hollywood|pompano/.test(m)) return 'broward'
  return null
}

export async function measureEdge(opts: { market: string; to: string }): Promise<Edge | null> {
  const key = benchKey(opts.market)
  if (!key) return null
  const bench = EDGE_BENCH[key]
  const to = opts.to
  const fromD = new Date(to + 'T12:00:00Z'); fromD.setUTCMonth(fromD.getUTCMonth() - 12)
  const from = fromD.toISOString().slice(0, 10)

  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings')
    .select('id, title, nickname, building, bedrooms, status').limit(1000)
  const listings = ((data || []) as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    if (/\bfull\b/i.test(str(l.nickname || l.title || l.id))) return false // one apartment sold twice
    const b = rollupBuilding(str(l.building))
    return !!b && benchKey(String(marketOf(b))) === key && l.bedrooms != null
  })
  if (!listings.length) return null

  const resv = await pullReservations(listings.map(l => String(l.id)), from, to)
  const byListing: Record<string, any[]> = {}
  for (const r of resv) (byListing[r.listing_id] = byListing[r.listing_id] || []).push(r)

  const liveBy = addDays(from, 60)
  const groups: Record<string, { gross: number; occ: number; adr: number }[]> = {}
  for (const l of listings) {
    const mine = byListing[String(l.id)] || []
    if (!mine.some(r => str(r.check_in) <= liveBy)) continue // not live for the whole window
    const m = metricsFor(mine, 1, from, to)
    const g = basisTriple({
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
    }, 'gross')
    if (!(g.revenue > 0)) continue
    const br = brLabel(Math.min(4, Number(l.bedrooms)))
    ;(groups[br] = groups[br] || []).push({ gross: g.revenue, occ: m.occupancyPct, adr: g.adr })
  }

  const order = ['Studio', '1BR', '2BR', '3BR', '4BR']
  const rows: EdgeRow[] = order.filter(br => (groups[br] || []).length >= 3).map(br => {
    const g = groups[br]
    const gross = Math.round(median(g.map(x => x.gross)) / 100) * 100
    const b = bench.byBedroom[br] || null
    const multiple = b ? Math.round((gross / b.median) * 10) / 10 : null
    return {
      bedrooms: br,
      homes: g.length,
      gross,
      occ: Math.round(median(g.map(x => x.occ))),
      adr: Math.round(median(g.map(x => x.adr))),
      median: b ? b.median : null,
      top: b ? b.top : null,
      multiple,
      ahead: !!b && gross > b.median,
      aboveTop: !!b && gross > b.top,
    }
  })

  return {
    market: key,
    benchLabel: bench.label,
    window: from + ' → ' + to,
    rows,
    pro: bench.pro,
    source: EDGE_SOURCE.name + ', ' + bench.label + ' · ' + EDGE_SOURCE.basis + ' · ' + EDGE_SOURCE.window,
  }
}
