// THE PROJECTIONS CALCULATOR'S ADJUSTMENTS (Jon, 2026-11-12: "it should ask kitchen, square feet,
// balcony, view, address… select amenities… a robust tool with real data that we can train or adjust in
// the sales tab… where if they add an amenity, beach view etc. it adjusts the projections by %").
//
// The base is always real: the building's own projections in the Projections library when the owner
// picks a building we have, else the plans and comparables for that bedroom count in the area, else
// across South Florida. These settings are only the percentages laid on top, and every one of them is
// the sales team's to change on Sales → Projections library → Calculator. The starting values below
// are placeholders to tune, not market findings. Isomorphic: the page, the API and the settings panel
// share this file. Stored in app_settings 'projection_calc'.

export const PROJ_CALC_KEY = 'projection_calc'

export type ViewKey = 'none' | 'city' | 'water' | 'ocean' | 'beachfront'
export type KitchenKey = 'full' | 'kitchenette' | 'none'
export type Amenity = { key: string; label: string; pct: number }
export type BeachBand = { maxMi: number; pct: number }
export type ProjCalcSettings = {
  view: Record<ViewKey, number>
  viewLabel: Record<ViewKey, string>
  kitchen: Record<KitchenKey, number>
  balcony: number
  amenities: Amenity[]
  beach: BeachBand[]           // the first band the home's distance to the nearest beach falls in
  sqftPer10: number            // % per 10% larger (or smaller) than the comparable set's typical size
  sqftCap: number              // the size adjustment never goes beyond ± this
  cap: number                  // all adjustments together never go beyond ± this
  note: string                 // the estimate line on every result
  updatedAt?: string; updatedBy?: string
}

export const DEFAULT_PROJ_CALC: ProjCalcSettings = {
  view: { none: 0, city: 3, water: 6, ocean: 10, beachfront: 15 },
  viewLabel: { none: 'No particular view', city: 'City view', water: 'Bay or water view', ocean: 'Ocean view', beachfront: 'Beachfront' },
  kitchen: { full: 0, kitchenette: -5, none: -12 },
  balcony: 3,
  amenities: [
    { key: 'pool', label: 'Pool', pct: 3 },
    { key: 'beach-access', label: 'Beach access or beach service', pct: 5 },
    { key: 'rooftop', label: 'Rooftop or sky deck', pct: 2 },
    { key: 'gym', label: 'Gym', pct: 1 },
    { key: 'parking', label: 'Parking included', pct: 2 },
    { key: 'hot-tub', label: 'Hot tub', pct: 2 },
    { key: 'washer', label: 'Washer and dryer in the unit', pct: 2 },
    { key: 'pets', label: 'Pet friendly', pct: 2 },
    { key: 'workspace', label: 'Dedicated workspace', pct: 1 },
    { key: 'ev', label: 'EV charging', pct: 1 },
  ],
  beach: [{ maxMi: 0.25, pct: 8 }, { maxMi: 1, pct: 4 }, { maxMi: 3, pct: 1 }],
  sqftPer10: 2,
  sqftCap: 10,
  cap: 35,
  note: 'This is an estimate, based on comparable homes and the details you entered. For a detailed projection of your specific unit, covering its layout, finishes and booking calendar, contact Nick Carline.',
}

const num = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d }
const txt = (v: any, n: number, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d)

export function normProjCalc(raw: any): ProjCalcSettings {
  const r = raw && typeof raw === 'object' ? raw : {}
  const D = DEFAULT_PROJ_CALC
  const view = {} as Record<ViewKey, number>, viewLabel = {} as Record<ViewKey, string>
  for (const k of Object.keys(D.view) as ViewKey[]) { view[k] = num(r.view?.[k], -50, 100, D.view[k]); viewLabel[k] = txt(r.viewLabel?.[k], 40, D.viewLabel[k]) }
  const kitchen = {} as Record<KitchenKey, number>
  for (const k of Object.keys(D.kitchen) as KitchenKey[]) kitchen[k] = num(r.kitchen?.[k], -50, 50, D.kitchen[k])
  const amenities: Amenity[] = (Array.isArray(r.amenities) ? r.amenities : D.amenities).map((a: any) => ({
    key: txt(a?.key, 40, '').toLowerCase().replace(/[^a-z0-9-]/g, '-') || txt(a?.label, 40, 'amenity').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: txt(a?.label, 50, 'Amenity'), pct: num(a?.pct, -30, 50, 0),
  })).filter((a: Amenity, i: number, all: Amenity[]) => a.key && all.findIndex(b => b.key === a.key) === i).slice(0, 30)
  const beach: BeachBand[] = (Array.isArray(r.beach) ? r.beach : D.beach).map((b: any) => ({ maxMi: num(b?.maxMi, 0.05, 50, 1), pct: num(b?.pct, -30, 50, 0) }))
    .sort((a: BeachBand, b: BeachBand) => a.maxMi - b.maxMi).slice(0, 8)
  return {
    view, viewLabel, kitchen, balcony: num(r.balcony, -30, 50, D.balcony), amenities, beach,
    sqftPer10: num(r.sqftPer10, 0, 20, D.sqftPer10), sqftCap: num(r.sqftCap, 0, 50, D.sqftCap), cap: num(r.cap, 0, 100, D.cap),
    // the first wording (2026-11-12) was reworded the same day; a saved copy of it takes the new one
    note: /more granular estimate/i.test(String(r.note || '')) ? D.note : txt(r.note, 300, D.note), updatedAt: r.updatedAt ? String(r.updatedAt) : undefined, updatedBy: r.updatedBy ? String(r.updatedBy) : undefined,
  }
}

export type CalcAnswers = { view: ViewKey; kitchen: KitchenKey; balcony: boolean; amenities: string[]; sqft: number; beachMi: number | null; typicalSqft: number | null }
export type Adjustment = { label: string; pct: number }

/** The adjustments for these answers, each with its reason, and the capped total. */
export function adjustmentsFor(s: ProjCalcSettings, a: CalcAnswers): { list: Adjustment[]; total: number } {
  const list: Adjustment[] = []
  const add = (label: string, pct: number) => { if (pct) list.push({ label, pct: Math.round(pct * 10) / 10 }) }
  add(s.viewLabel[a.view], s.view[a.view])
  if (a.kitchen !== 'full') add(a.kitchen === 'kitchenette' ? 'Kitchenette rather than a full kitchen' : 'No kitchen', s.kitchen[a.kitchen])
  if (a.balcony) add('Balcony or terrace', s.balcony)
  for (const k of a.amenities) { const am = s.amenities.find(x => x.key === k); if (am) add(am.label, am.pct) }
  if (a.beachMi != null) {
    const band = s.beach.find(b => a.beachMi! <= b.maxMi)
    if (band) add(`About ${a.beachMi < 0.95 ? a.beachMi.toFixed(1) : Math.round(a.beachMi)} mi to the beach`, band.pct)
  }
  if (a.sqft > 0 && a.typicalSqft && a.typicalSqft > 0 && s.sqftPer10) {
    const diff = (a.sqft - a.typicalSqft) / a.typicalSqft
    const pct = Math.max(-s.sqftCap, Math.min(s.sqftCap, (diff * 100 / 10) * s.sqftPer10))
    if (Math.abs(pct) >= 0.5) add(`${Math.round(a.sqft).toLocaleString()} SF against a typical ${Math.round(a.typicalSqft).toLocaleString()} SF`, pct)
  }
  const raw = list.reduce((t, x) => t + x.pct, 0)
  return { list, total: Math.max(-s.cap, Math.min(s.cap, raw)) }
}

/** "391 to 599 SF" → 495; "894 SF" → 894. */
export function sqftOf(text: string): number | null {
  const m = String(text || '').replace(/,/g, '').match(/(\d{3,5})(?:\s*(?:to|-|–)\s*(\d{3,5}))?/)
  if (!m) return null
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
  return Number.isFinite(a) ? (a + b) / 2 : null
}
