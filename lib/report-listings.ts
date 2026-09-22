// PERFORMANCE, UNIT BY UNIT — the table the owner review never had.
//
// Jon, 2026-09-22: "want to add listing by listing performance, Gross values or net values, occ
// etc in the page, make it as a add on slide."
//
// `ReportContent.byListing` has existed as a TYPE since the report engine was written and nothing
// has ever populated it — the generate route never writes it, which is why every live review comes
// back with byListing undefined. So this is not a renderer reading a field it forgot about; the
// data has to be built.
//
// DERIVED AT RENDER, like the gallery and the verdict. The alternative is writing it at generate
// time, which would mean the five reviews that already exist stay blank until each is regenerated —
// and regenerating a report an owner has already been sent is not a thing anyone wants to do for a
// new table. One indexed query per page load buys the slide on every report, past and future.
//
// IT MUST RECONCILE WITH THE SNAPSHOT ABOVE IT. The window and the arithmetic are deliberately the
// same ones the generator used for the headline numbers — periodStart to periodEnd inclusive, via
// the same pullReservations and metricsFor — so the total row lands on the report's own revenue and
// occupancy. A per-unit table that sums to a different number than the card above it is worse than
// no table at all, so `totals` is returned for the slide to show and for anyone to check.
import 'server-only'
import { pullReservations, metricsFor, resolveScope } from '@/lib/owner-report'
import type { BasisRaw } from '@/lib/basis'

/**
 * Rows carry the RAW basis components, not finished revenue figures.
 *
 * The first cut returned metricsFor's `accomRevenue` as "net" and put $101K on the slide under a
 * snapshot card reading $109K. Both numbers were correct and they were answering different
 * questions: the report's default basis is `netota` — accommodation BEFORE channel fees — and
 * accomRevenue is the legacy base fare. A per-unit table that does not add up to the card above it
 * is the single thing this slide cannot do, so the rows now hand back exactly what lib/basis needs
 * and the slide runs basisTriple over them, the same function every other section uses.
 */
export type ListingRow = BasisRaw & {
  id: string
  name: string
  unit: string
  bedrooms: number | null
  building: string
  occPct: number
  reservations: number
}

export type ListingTable = {
  rows: ListingRow[]
  totals: BasisRaw & { occPct: number; reservations: number; units: number }
  from: string
  to: string
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Build the per-unit table for an owner_reports row. Empty when the report names no listings. */
export async function reportByListing(report: any): Promise<ListingTable | null> {
  const ids: string[] = (Array.isArray(report?.listing_ids) ? report.listing_ids : [])
    .map((x: any) => String(x || '')).filter(Boolean)
  const from = String(report?.period_start || '').slice(0, 10)
  const endIncl = String(report?.period_end || '').slice(0, 10)
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(endIncl)) return null
  const toExcl = addDaysIso(endIncl, 1)

  const [{ listings }, resv] = await Promise.all([
    resolveScope(ids, []).catch(() => ({ listings: [] as any[], scopeLabel: '' })),
    pullReservations(ids, from, toExcl).catch(() => [] as any[]),
  ])
  if (!listings.length) return null

  const byId: Record<string, any[]> = {}
  for (const r of resv) (byId[String(r.listing_id)] = byId[String(r.listing_id)] || []).push(r)

  const rows: ListingRow[] = listings.map((l: any) => {
    const m = metricsFor(byId[String(l.id)] || [], 1, from, toExcl)
    return {
      id: String(l.id),
      name: String(l.name || ''),
      unit: String(l.unit || ''),
      bedrooms: l.bedrooms ?? null,
      building: String(l.building || ''),
      accomNum: m.accomRevenue,
      accomGrossNum: m.accomGrossRevenue,
      cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees,
      occNights: m.occupiedNights,
      availNights: m.availableNights,
      occPct: m.occupancyPct,
      reservations: m.reservations,
    }
  })
  // Biggest earner first — the order an owner reads a portfolio in.
  rows.sort((a, b) => (b.accomGrossNum + b.cleaningNum) - (a.accomGrossNum + a.cleaningNum))

  // The totals are recomputed over the WHOLE set rather than summed from the rows, because ADR and
  // RevPAR are ratios: averaging twelve units' ADRs is not the portfolio's ADR, and an owner who
  // adds the column up by hand should find the same number we printed.
  const all = metricsFor(resv, listings.length, from, toExcl)
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
