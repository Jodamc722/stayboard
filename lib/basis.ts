// Revenue-basis model shared by the owner-report engine (server) and ReportView (client).
// Three bases, all derived from three raw per-section numbers so any section can show any basis:
//   net    = accommodation AFTER channel/OTA fees, excludes cleaning   ("true net")
//   netota = accommodation BEFORE channel/OTA fees, excludes cleaning   (matches PriceLabs) — default
//   gross  = accommodation BEFORE channel/OTA fees + cleaning           (full top line)
// Cleaning is prorated per night upstream, so it flows into Gross ADR and Gross RevPAR.
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
  accomNum: number       // accommodation after channel fees (net)
  accomGrossNum: number  // accommodation before channel fees (netota)
  cleaningNum: number    // prorated cleaning
  occNights: number
  availNights: number
}

export function basisRevenueNum(r: BasisRaw, b: Basis): number {
  if (b === 'net') return r.accomNum
  if (b === 'gross') return r.accomGrossNum + r.cleaningNum
  return r.accomGrossNum // netota
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
