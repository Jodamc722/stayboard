// REVENUE CENTER'S OWN RULES, lifted so the brain can apply them the same way (2026-11-10).
//
// app/revenue/page.tsx keeps these as private helpers (componentsOf, expediaCleaningFix, the active
// listing filter). The brain may not edit that page, so the rules are restated here, line for line,
// and BOTH the nightly builder (lib/brain/unit-day) and the reconcile check (lib/brain/reconcile)
// call them. If Revenue Center's rules change, change them here too — or, better, move the page's
// helpers into a lib file and import that from both.
//
//   SCOPE      Revenue Center counts listings that are not dead (inactive / disabled / archived /
//              deleted — an exact status match) and whose name (nickname, else title) does not
//              contain the word "Full". Stays on any other listing are left out of its totals.
//   ACCOM      grossAccom = fareAccommodationAdjusted, else fareAccommodation (when the adjusted
//              figure is missing or zero); netAccom = grossAccom − channel fee (lib/basis).
//   EXPEDIA    Expedia-family channels arrive with cleaning folded into accommodation. For a stay on
//              one of them with cleaning = 0, the listing's MODAL cleaning fee among the other stays
//              read in the same window is moved out of accommodation (and out of net, when net is
//              larger than it). The modal is per window, so the brain builds in calendar-month
//              chunks: a month in the brain then uses the same modal as that month on Revenue Center.
export const RC_EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/
export const RC_DEAD = ['inactive', 'disabled', 'archived', 'deleted']

/** Revenue Center's listing filter: alive, and not a "Full" whole-unit listing. */
export function rcInScope(l: { status?: any; nickname?: any; title?: any }): boolean {
  if (RC_DEAD.indexOf(String(l.status || '').toLowerCase()) >= 0) return false
  return !/\bfull\b/i.test(String(l.nickname || l.title || ''))
}

/** Why a listing is outside Revenue Center's scope, or null when it is inside. */
export function rcOutOfScopeReason(l: { status?: any; nickname?: any; title?: any }): 'inactive' | 'full' | null {
  if (RC_DEAD.indexOf(String(l.status || '').toLowerCase()) >= 0) return 'inactive'
  return /\bfull\b/i.test(String(l.nickname || l.title || '')) ? 'full' : null
}

const n0 = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** grossAccom the way componentsOf reads it: the adjusted fare, else the base fare. */
export function rcGrossAccom(fareAdjusted: any, fareBase: any): number {
  return n0(fareAdjusted) || n0(fareBase)
}

export type RcStay = { listingId: string; source: string; grossAccom: number; netAccom: number; cleaning: number; split?: number }

/**
 * expediaCleaningFix, as Revenue Center runs it. Mutates the stays: an Expedia-family stay with no
 * cleaning gets its listing's modal cleaning fee moved out of accommodation. `split` records how
 * much moved, so a reconcile can name the stays it touched.
 */
export function rcExpediaSplit<T extends RcStay>(list: T[]): void {
  const pool: Record<string, Record<string, number>> = {}
  for (const x of list) {
    if (!RC_EXPEDIA_RE.test(x.source.toLowerCase()) && x.cleaning > 0) {
      const key = String(Math.round(x.cleaning))
      const p = pool[x.listingId] = pool[x.listingId] || {}
      p[key] = (p[key] || 0) + 1
    }
  }
  // Integer-like keys iterate in ascending order, and only a strictly larger count replaces the
  // leader — so a tie goes to the lowest fee, exactly as on the page.
  const modal: Record<string, number> = {}
  for (const id of Object.keys(pool)) {
    let best = 0, bestN = 0
    for (const k of Object.keys(pool[id])) { if (pool[id][k] > bestN) { bestN = pool[id][k]; best = Number(k) } }
    modal[id] = best
  }
  for (const x of list) {
    if (RC_EXPEDIA_RE.test(x.source.toLowerCase()) && x.cleaning === 0) {
      const cl = modal[x.listingId] || 0
      if (cl > 0 && x.grossAccom > cl) {
        x.cleaning = cl
        x.grossAccom -= cl
        if (x.netAccom > cl) x.netAccom -= cl
        x.split = cl
      }
    }
  }
}
