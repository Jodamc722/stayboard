// THE PROJECTIONS CALCULATOR'S ADJUSTMENTS (Jon, 2026-11-12: "it should ask kitchen, square feet, balcony,
// view, address… select amenities… a robust tool with real data that we can train or adjust in the sales tab").
//
// VERSION 2, REALISTIC (Jon, 2026-11-12: "the % based on amenities needs to be realistic, can't just add a
// percentage on all things. They can't all stack. Maybe not ADR goes up but slight occupancy gains. Be smart
// about it and do real data research"). What changed, and why:
//   · Every factor has TWO effects: on the nightly rate (ADR, %) and on occupancy (points). Revenue moves by
//     (1 + ADR%) × (occupancy + points) / occupancy, so an amenity that fills nights is worth more in a slow
//     building than in a full one, and occupancy never passes a ceiling (90%).
//   · They do not stack. Positive factors are ranked by size and each next one counts less (×0.6, ×0.36…),
//     then the rate and the occupancy each have their own cap. Drawbacks (no kitchen, far from the beach)
//     count in full.
//   · Building amenities are not counted twice. Pool, gym, rooftop, beach service and a hot tub are usually the
//     building's: when the base is the building's OWN projections they add nothing (those numbers already
//     have them), against the area's comparables they count half, against all of South Florida in full.
// The starting values come from published hedonic studies of US listings (AirDNA's 2025 amenity analysis:
// pool +5.9% ADR in coastal markets, hot tub +14.3% nationally but much less in coastal cities, ocean view
// +8.5% in large cities, waterfront about +9% to +13%, EV charging +5.8% coastal, washer/dryer under 5%,
// parking, wifi and air conditioning with no measurable rate premium, pets about $17 a night) and are set
// conservatively for South Florida condos, where most comparables already have a pool and a gym. They are
// still the sales team's to change on Sales → Projections library → Calculator.
// Isomorphic: the page, the API and the settings panel share this file. Stored in app_settings 'projection_calc'.

export const PROJ_CALC_KEY = 'projection_calc'
export const PROJ_CALC_VERSION = 2

export type ViewKey = 'none' | 'city' | 'water' | 'ocean' | 'beachfront'
export type KitchenKey = 'full' | 'kitchenette' | 'none'
/** pct = effect on the nightly rate (%), occ = effect on occupancy (points); shared = usually the building's. */
export type Amenity = { key: string; label: string; pct: number; occ: number; shared: boolean }
export type BeachBand = { maxMi: number; pct: number; occ: number }
export type ProjCalcSettings = {
  v: number
  view: Record<ViewKey, number>
  viewLabel: Record<ViewKey, string>
  kitchen: Record<KitchenKey, number>
  kitchenOcc: Record<KitchenKey, number>
  balcony: number
  amenities: Amenity[]
  beach: BeachBand[]           // the first band the home's distance to the nearest beach falls in
  sqftPer10: number            // rate % per 10% larger (or smaller) than the comparable set's typical size
  sqftCap: number              // the size adjustment never goes beyond ± this
  diminish: number             // each next positive factor counts this much of the one before (0.6)
  adrCap: number               // the rate never moves more than ± this %
  occCap: number               // occupancy never moves more than ± this many points
  occMax: number               // occupancy never above this %
  cap: number                  // revenue never moves more than ± this % in all
  note: string                 // the estimate line on every result
  updatedAt?: string; updatedBy?: string
}

export const DEFAULT_PROJ_CALC: ProjCalcSettings = {
  v: PROJ_CALC_VERSION,
  view: { none: 0, city: 2, water: 5, ocean: 8, beachfront: 11 },
  viewLabel: { none: 'No particular view', city: 'City view', water: 'Bay or water view', ocean: 'Ocean view', beachfront: 'Beachfront' },
  kitchen: { full: 0, kitchenette: -4, none: -8 },
  kitchenOcc: { full: 0, kitchenette: -2, none: -5 },
  balcony: 2,
  amenities: [
    { key: 'pool', label: 'Pool', pct: 3, occ: 0, shared: true },
    { key: 'beach-access', label: 'Beach access or beach service', pct: 3, occ: 1, shared: true },
    { key: 'rooftop', label: 'Rooftop or sky deck', pct: 1, occ: 0, shared: true },
    { key: 'gym', label: 'Gym', pct: 0, occ: 0.5, shared: true },
    { key: 'hot-tub', label: 'Hot tub', pct: 3, occ: 0, shared: true },
    { key: 'parking', label: 'Parking included', pct: 0, occ: 1.5, shared: false },
    { key: 'washer', label: 'Washer and dryer in the unit', pct: 1, occ: 1, shared: false },
    { key: 'pets', label: 'Pet friendly', pct: 2, occ: 2, shared: false },
    { key: 'workspace', label: 'Dedicated workspace', pct: 0, occ: 1, shared: false },
    { key: 'ev', label: 'EV charging', pct: 1, occ: 0, shared: false },
  ],
  beach: [{ maxMi: 0.25, pct: 6, occ: 2 }, { maxMi: 1, pct: 3, occ: 1 }, { maxMi: 3, pct: 1, occ: 0 }],
  sqftPer10: 2,
  sqftCap: 8,
  diminish: 0.6,
  adrCap: 15,
  occCap: 5,
  occMax: 90,
  cap: 25,
  note: 'This is an estimate, based on comparable homes and the details you entered. For a detailed projection of your specific unit, covering its layout, finishes and booking calendar, contact Nick Carline.',
}

const num = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d }
const txt = (v: any, n: number, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d)

export function normProjCalc(raw: any): ProjCalcSettings {
  const D = DEFAULT_PROJ_CALC
  // Settings saved under version 1 were flat percentages that stacked; they are replaced by version 2's
  // researched defaults (the team's own estimate line is kept).
  const r0 = raw && typeof raw === 'object' ? raw : {}
  const r = Number(r0.v) === PROJ_CALC_VERSION ? r0 : { note: r0.note }
  const view = {} as Record<ViewKey, number>, viewLabel = {} as Record<ViewKey, string>
  for (const k of Object.keys(D.view) as ViewKey[]) { view[k] = num(r.view?.[k], -30, 40, D.view[k]); viewLabel[k] = txt(r.viewLabel?.[k], 40, D.viewLabel[k]) }
  const kitchen = {} as Record<KitchenKey, number>, kitchenOcc = {} as Record<KitchenKey, number>
  for (const k of Object.keys(D.kitchen) as KitchenKey[]) { kitchen[k] = num(r.kitchen?.[k], -40, 20, D.kitchen[k]); kitchenOcc[k] = num(r.kitchenOcc?.[k], -20, 10, D.kitchenOcc[k]) }
  const amenities: Amenity[] = (Array.isArray(r.amenities) ? r.amenities : D.amenities).map((a: any) => ({
    key: txt(a?.key, 40, '').toLowerCase().replace(/[^a-z0-9-]/g, '-') || txt(a?.label, 40, 'amenity').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: txt(a?.label, 50, 'Amenity'), pct: num(a?.pct, -20, 25, 0), occ: num(a?.occ, -10, 10, 0), shared: !!a?.shared,
  })).filter((a: Amenity, i: number, all: Amenity[]) => a.key && all.findIndex(b => b.key === a.key) === i).slice(0, 30)
  const beach: BeachBand[] = (Array.isArray(r.beach) ? r.beach : D.beach).map((b: any) => ({ maxMi: num(b?.maxMi, 0.05, 50, 1), pct: num(b?.pct, -20, 25, 0), occ: num(b?.occ, -10, 10, 0) }))
    .sort((a: BeachBand, b: BeachBand) => a.maxMi - b.maxMi).slice(0, 8)
  return {
    v: PROJ_CALC_VERSION, view, viewLabel, kitchen, kitchenOcc, balcony: num(r.balcony, -10, 20, D.balcony), amenities, beach,
    sqftPer10: num(r.sqftPer10, 0, 10, D.sqftPer10), sqftCap: num(r.sqftCap, 0, 30, D.sqftCap),
    diminish: num(r.diminish, 0, 1, D.diminish), adrCap: num(r.adrCap, 0, 50, D.adrCap), occCap: num(r.occCap, 0, 20, D.occCap), occMax: num(r.occMax, 50, 99, D.occMax), cap: num(r.cap, 0, 60, D.cap),
    // the first wording (2026-11-12) was reworded the same day; a saved copy of it takes the new one
    note: /more granular estimate/i.test(String(r.note || '')) ? D.note : txt(r.note, 300, D.note),
    updatedAt: r.updatedAt ? String(r.updatedAt) : undefined, updatedBy: r.updatedBy ? String(r.updatedBy) : undefined,
  }
}

/** basis: where the base numbers came from — the building's own projections, the area's, or South Florida's. */
export type CalcAnswers = { view: ViewKey; kitchen: KitchenKey; balcony: boolean; amenities: string[]; sqft: number; beachMi: number | null; typicalSqft: number | null; baseOcc: number; basis: 'own' | 'local' | 'all' }
/** One factor: its effect on the rate (%) and on occupancy (points), after the no-stacking weights. */
export type Adjustment = { label: string; pct: number; occ: number; note?: string }
export type AdjResult = { list: Adjustment[]; adr: number; occ: number; total: number; factor: number; adrFactor: number; occAfter: number }

const r1 = (x: number) => Math.round(x * 10) / 10
/** The adjustments for these answers: each factor with its weighted effect, and the combined result. */
export function adjustmentsFor(s: ProjCalcSettings, a: CalcAnswers): AdjResult {
  const baseOcc = Math.max(20, Math.min(95, a.baseOcc || 70))
  type F = { label: string; pct: number; occ: number; note?: string }
  const pos: F[] = [], neg: F[] = []
  const put = (f: F) => { if (!f.pct && !f.occ) return; (f.pct < 0 || f.occ < 0 ? neg : pos).push(f) }
  put({ label: s.viewLabel[a.view], pct: s.view[a.view], occ: 0 })
  if (a.kitchen !== 'full') put({ label: a.kitchen === 'kitchenette' ? 'Kitchenette rather than a full kitchen' : 'No kitchen', pct: s.kitchen[a.kitchen], occ: s.kitchenOcc[a.kitchen] })
  if (a.balcony) put({ label: 'Balcony or terrace', pct: s.balcony, occ: 0 })
  // building amenities the base already carries do not count again
  const sharedK = a.basis === 'own' ? 0 : a.basis === 'local' ? 0.5 : 1
  for (const k of a.amenities) {
    const am = s.amenities.find(x => x.key === k); if (!am) continue
    const kk = am.shared ? sharedK : 1
    if (!kk) continue
    put({ label: am.label, pct: am.pct * kk, occ: am.occ * kk, note: am.shared && kk < 1 ? 'half: most comparable homes nearby have it' : undefined })
  }
  if (a.beachMi != null) {
    const band = s.beach.find(b => a.beachMi! <= b.maxMi)
    // an ocean view or a beachfront home is already near the beach: the distance counts half on top of it
    const k = a.view === 'ocean' || a.view === 'beachfront' ? 0.5 : 1
    if (band) put({ label: `About ${a.beachMi < 0.95 ? a.beachMi.toFixed(1) : Math.round(a.beachMi)} mi to the beach`, pct: band.pct * k, occ: band.occ * k })
  }
  if (a.sqft > 0 && a.typicalSqft && a.typicalSqft > 0 && s.sqftPer10) {
    const diff = (a.sqft - a.typicalSqft) / a.typicalSqft
    const pct = Math.max(-s.sqftCap, Math.min(s.sqftCap, (diff * 100 / 10) * s.sqftPer10))
    if (Math.abs(pct) >= 0.5) put({ label: `${Math.round(a.sqft).toLocaleString()} SF against a typical ${Math.round(a.typicalSqft).toLocaleString()} SF`, pct, occ: 0 })
  }
  // NO STACKING: the biggest gain counts in full, each next one less
  const worth = (f: F) => f.pct + (f.occ / baseOcc) * 100
  pos.sort((x, y) => worth(y) - worth(x))
  const list: Adjustment[] = []
  pos.forEach((f, i) => { const w = Math.pow(s.diminish, i); list.push({ label: f.label, pct: r1(f.pct * w), occ: r1(f.occ * w), ...(f.note ? { note: f.note } : {}) }) })
  neg.forEach(f => list.push({ label: f.label, pct: r1(f.pct), occ: r1(f.occ) }))
  const adr = Math.max(-s.adrCap, Math.min(s.adrCap, list.reduce((t, x) => t + x.pct, 0)))
  const occ = Math.max(-s.occCap, Math.min(s.occCap, list.reduce((t, x) => t + x.occ, 0)))
  const occAfter = Math.min(s.occMax, Math.max(10, baseOcc + occ))
  let factor = (1 + adr / 100) * (occAfter / baseOcc)
  factor = Math.max(1 - s.cap / 100, Math.min(1 + s.cap / 100, factor))
  return { list, adr: r1(adr), occ: r1(occAfter - baseOcc), total: r1((factor - 1) * 100), factor, adrFactor: 1 + adr / 100, occAfter: r1(occAfter) }
}

/** "391 to 599 SF" → 495; "894 SF" → 894. */
export function sqftOf(text: string): number | null {
  const m = String(text || '').replace(/,/g, '').match(/(\d{3,5})(?:\s*(?:to|-|–)\s*(\d{3,5}))?/)
  if (!m) return null
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
  return Number.isFinite(a) ? (a + b) / 2 : null
}
