// Revenue-basis model shared by the owner-report engine (server) and ReportView (client).
// Three bases, all derived from raw per-section numbers so any section can show any basis:
//   net    = accommodation AFTER channel/OTA fees, excludes cleaning   ("true net")
//   netota = accommodation BEFORE channel/OTA fees, excludes cleaning   (matches PriceLabs) — default
//   gross  = accommodation BEFORE channel/OTA fees + cleaning           (full top line)
// Cleaning is prorated per night upstream, so it flows into Gross ADR and Gross RevPAR.
//
// Net is computed as accomGrossNum - feeNum, where feeNum is the summed channel fee
// (channelFeeOf below). Sections saved before feeNum existed fall back to accomNum so old
// reports keep rendering their stored numbers.
//
// THE ONE NET (2026-11-09, owner-approved). "Net accommodation" everywhere on the revenue pages =
//   fareAccommodationAdjusted − hostServiceFeeIncTax   (falling back to hostServiceFee when the
//   tax-inclusive figure is absent or zero)
// That is Revenue Center's definition, the one validated to the cent against Guesty owner
// statements (app/revenue/page.tsx componentsOf). The KPI board's reads, lib/forecast/pacing,
// lib/unit-revenue and lib/sales-report all subtracted the tax-EXCLUSIVE hostServiceFee, so the same
// stay netted a little higher there than on Revenue Center. They now call channelFeeOf().
export function channelFeeOf(feeIncTax: unknown, fee: unknown): number {
  const inc = Number(feeIncTax), ex = Number(fee)
  if (Number.isFinite(inc) && inc > 0) return inc
  return Number.isFinite(ex) && ex > 0 ? ex : 0
}
/** One line for a page's basis note. */
export const NET_BASIS_NOTE = 'Net = accommodation after the channel fee (fareAccommodationAdjusted − hostServiceFeeIncTax, else hostServiceFee); no cleaning, no taxes'

// WHICH RESERVATIONS ARE REAL STAYS (2026-11-09, owner-approved). One list for every revenue read.
// `closed` is NOT in it: Guesty's closed is a request that never became a confirmed booking
// (lib/stay-status quotes Guesty and names the abandoned checkouts the Today audit found;
// lib/marketing files it under cancelled). The KPI board, pacing, unit revenue and projections each
// carried their own copy WITH `closed`, so they could sit above Revenue Center for the same window.
export const LIVE_STAY_STATUSES: string[] = ['confirmed', 'checked_in', 'checked_out']

export type Basis = 'net' | 'netota' | 'gross'
export const BASES: Basis[] = ['net', 'netota', 'gross']

export const BASIS_SHORT: Record<Basis, string> = {
  net: 'Net',
  netota: 'Net + fees',
  gross: 'Gross',
}
export const BASIS_LABEL: Record<Basis, string> = {
  net: 'Net (after channel fees)',
  netota: 'Net + channel fees',
  gross: 'Gross (incl. cleaning + channel fees)',
}
export const BASIS_NOTE: Record<Basis, string> = {
  net: 'Accommodation, after channel fees',
  netota: 'Accommodation, before channel fees',
  gross: 'Accommodation + cleaning',
}

// Raw numbers every section carries so the client can render any basis.
export type BasisRaw = {
  accomNum: number       // base accommodation fare (Guesty fareAccommodation) — legacy Net fallback
  accomGrossNum: number  // accommodation the guest paid, before channel fees (netota)
  cleaningNum: number    // prorated cleaning
  feeNum?: number        // channel/OTA host fee (channelFeeOf: hostServiceFeeIncTax, else hostServiceFee); absent on pre-fee sections
  occNights: number
  availNights: number
}

export function basisRevenueNum(r: BasisRaw, b: Basis): number {
  if (b === 'gross') return r.accomGrossNum + r.cleaningNum
  if (b === 'netota') return r.accomGrossNum
  // net = accommodation minus the channel's host fee. Sections saved before the fee was
  // pulled have no feeNum — keep showing their stored accommodation figure rather than
  // silently reporting a net with nothing deducted.
  return typeof r.feeNum === 'number' ? Math.max(0, r.accomGrossNum - r.feeNum) : r.accomNum
}

// Revenue / ADR / RevPAR (rounded integers) for a basis.
export function basisTriple(r: BasisRaw, b: Basis): { revenue: number; adr: number; revpar: number } {
  const rev = basisRevenueNum(r, b)
  return {
    revenue: Math.round(rev),
    adr: r.occNights > 0 ? Math.round(rev / r.occNights) : 0,
    revpar: r.availNights > 0 ? Math.round(rev / r.availNights) : 0,
  }
}

export function isBasis(v: unknown): v is Basis {
  return v === 'net' || v === 'netota' || v === 'gross'
}
