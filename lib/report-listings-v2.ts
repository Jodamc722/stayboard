// THE PER-UNIT TABLE FOR ENGINE-2 REPORTS.
//
// lib/report-listings builds the table for every owner review with the original arithmetic, and
// reports generated before 2026-11-09 must keep rendering exactly that. A report generated under
// engine 2 (content.meta.engine — see lib/owner-report REPORT_ENGINE) has headline numbers that
// leave no-rate owner / friends-and-family nights out of occupied AND available nights and count
// each unit only from its first live date. A per-unit table that does not add up to the card above
// it is the one thing that slide cannot do, so engine-2 reports get their rows from here, through
// the same metricsFor with the same options the generator used. Same shape, same ordering.
import 'server-only'
import { pullReservations, metricsFor, resolveScope, engineOf, type CalcOpts, type ReportListing } from '@/lib/owner-report'
import { reportByListing, type ListingRow, type ListingTable } from '@/lib/report-listings'

function addDaysIso(iso: string, n: number): string {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The per-unit table under the report's own engine. Engine 1 is lib/report-listings, untouched. */
export async function reportByListingForEngine(report: any): Promise<ListingTable | null> {
  const eng = engineOf(report?.content)
  if (eng < 2) return reportByListing(report)

  // Same exclusion set the snapshot honours, so the total row lands on the card above it.
  const exclude: string[] = Array.isArray(report?.content?.excludeListings) ? report.content.excludeListings.map(String) : []
  const ids: string[] = (Array.isArray(report?.listing_ids) ? report.listing_ids : [])
    .map((x: any) => String(x || '')).filter(Boolean).filter((x: string) => exclude.indexOf(x) < 0)
  const from = String(report?.period_start || '').slice(0, 10)
  const endIncl = String(report?.period_end || '').slice(0, 10)
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(endIncl)) return null
  const toExcl = addDaysIso(endIncl, 1)

  const [scope, resv] = await Promise.all([
    resolveScope(ids, []).catch(() => ({ listings: [] as ReportListing[], scopeLabel: '' })),
    pullReservations(ids, from, toExcl).catch(() => [] as Awaited<ReturnType<typeof pullReservations>>),
  ])
  const listings = scope.listings
  if (!listings.length) return null

  const byId: Record<string, typeof resv> = {}
  for (const r of resv) (byId[r.listing_id] = byId[r.listing_id] || []).push(r)

  const rows: ListingRow[] = listings.map(l => {
    const one: CalcOpts = { engine: eng, listings: [l] }
    const m = metricsFor(byId[l.id] || [], 1, from, toExcl, one)
    return {
      id: l.id, name: l.name, unit: l.unit, bedrooms: l.bedrooms ?? null, building: l.building,
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue,
      cleaningNum: m.cleaningRevenue, feeNum: m.channelFees,
      occNights: m.occupiedNights, availNights: m.availableNights,
      occPct: m.occupancyPct, reservations: m.reservations,
    }
  })
  rows.sort((a, b) => (b.accomGrossNum + b.cleaningNum) - (a.accomGrossNum + a.cleaningNum))

  const all = metricsFor(resv, listings.length, from, toExcl, { engine: eng, listings })
  return {
    rows,
    totals: {
      accomNum: all.accomRevenue, accomGrossNum: all.accomGrossRevenue,
      cleaningNum: all.cleaningRevenue, feeNum: all.channelFees,
      occNights: all.occupiedNights, availNights: all.availableNights,
      occPct: all.occupancyPct, reservations: all.reservations, units: listings.length,
    },
    from, to: endIncl,
  }
}
