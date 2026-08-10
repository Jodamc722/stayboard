// PORTFOLIO SEGMENTATION — the single source of truth for "which building is this?" and
// "which market is it in?". Every board, brief, KPI and export routes through here, so a unit
// cannot read Miami on one screen and Broward on another.
//
// WHY THIS IS A REGISTRY AND NOT A HEURISTIC (Jon, 2026-08-10: "make sure we have the markets
// organized properly, don't see Arya in Miami, Nomad, etc"):
// The old version derived market from the unit's CITY with only a handful of building overrides,
// and derived the building name by grabbing the first word of the listing name that was longer
// than two characters. Both broke in ways that were invisible until you went looking:
//   • Lake Worth Beach and Riviera Beach are Palm Beach County — in no list at all — so four
//     Lucerne units and Amrit fell through to the Miami default while their neighbours read North.
//   • "Nomad 409" became its own building, separate from any other Nomad unit.
//   • "Capri 115/116" became a second Capri.
//   • First-word grabbing invented buildings out of thin air: "Full", "Miami", "2023", "713".
// So both questions are answered from ONE explicit table below. A building sits in exactly one
// market; that is a fact about the world, not something to infer from a text field that a human
// typed into Guesty. City is now only the fallback for a unit that matches no known building.
//
// TO ADD A BUILDING: add one row to BUILDINGS. That is the whole job — every screen picks it up.

export type Market = 'Miami' | 'Broward' | 'North'

type BuildingDef = {
  label: string      // the canonical name shown everywhere
  market: Market
  re: RegExp         // matched against "<guesty building> <listing name>", lowercased
  lux?: boolean      // Jon's lux tier
  vendor?: boolean   // cleaned by an outside company, not our crew
}

// ORDER MATTERS. Named buildings are matched before numeric ones, so "Elser 906 - Studio" is an
// Elser unit and not the 906 building. Within that, most specific first.
const BUILDINGS: BuildingDef[] = [
  // ── Miami-Dade + Miami Beach ──────────────────────────────────────────────
  { label: '17WEST', market: 'Miami', lux: true, re: /\b17\s*-?\s*west\b|\b17west\b/ },
  { label: 'Arya', market: 'Miami', lux: true, re: /\barya\b/ },
  { label: 'Elser', market: 'Miami', lux: true, re: /\belser\b/ },
  { label: 'Nomad', market: 'Miami', lux: true, re: /\bnomad\b/ },
  { label: 'District 225', market: 'Miami', lux: true, re: /\bdistrict\s*-?\s*225\b|\bdist\s*-?\s*225\b|\bdistrict225\b/ },
  { label: 'Park Towers', market: 'Miami', vendor: true, re: /\bpark\s*towers?\b|\bpt\b/ },
  { label: 'Miami House', market: 'Miami', re: /\bmiami\s*house\b/ },
  // ── Broward ───────────────────────────────────────────────────────────────
  // Botanica sits in Broward geographically but an outside vendor cleans it (and does not close
  // Breezeway tasks — see DEFAULT_VENDOR_BUILDINGS in lib/ops-presets.ts, where it has always been
  // listed). Without this flag the two vendor lists disagreed and Botanica read as one of ours.
  { label: 'Botanica', market: 'Broward', vendor: true, re: /\bbotanica\b/ },
  { label: 'Eden', market: 'Broward', re: /\beden\b/ },
  { label: 'Rustic', market: 'Broward', re: /\brustic\b/ },
  { label: 'Hendricks', market: 'Broward', re: /\bhendricks?\b/ },
  // Oasis units are named after plants, not numbers — folded in so they don't scatter.
  { label: 'Oasis', market: 'Broward', re: /\boasis\b|\bmahogany\b|\broyal\s*palm\b|\bbougainvillea\b|\bbamboo\b|\bsapodilla\b|\bjasmine\b/ },
  { label: 'Waves', market: 'Broward', re: /\bwaves\b/ },
  { label: 'Pelican', market: 'Broward', re: /\bpelican\b/ },
  { label: 'Salato', market: 'Broward', re: /\bsalato\b/ },
  { label: '336 Arthur', market: 'Broward', re: /\barthur\b/ },
  { label: '7071 SW', market: 'Broward', re: /\b7071\b/ },
  { label: '906', market: 'Broward', re: /\b906\b/ },
  { label: '3316', market: 'Broward', re: /\b3316\b/ },
  { label: '1587', market: 'Broward', re: /\b1587\b/ },
  // ── North (the Palm Beach County cluster, vendor-managed) ──────────────────
  { label: 'Capri', market: 'North', vendor: true, re: /\bcapri\b/ },
  { label: 'Lucerne', market: 'North', vendor: true, re: /\bluc[ee]rne\b|\blucenre\b/ },
  { label: 'Amrit', market: 'North', vendor: true, lux: true, re: /\bamrit\b/ },
]

// City fallback, used ONLY when a unit matches no building above. Kept generous on purpose —
// a new building in a known city lands in the right market before anyone edits this file.
const BROWARD_CITIES = [
  'fort lauderdale', 'ft lauderdale', 'ft. lauderdale', 'lauderdale', 'hollywood', 'pompano',
  'pembroke pines', 'hallandale', 'dania', 'davie', 'plantation', 'sunrise', 'oakland park',
  'wilton manors', 'deerfield', 'coral springs', 'miramar', 'weston', 'tamarac', 'lauderhill',
  'margate', 'coconut creek', 'parkland', 'cooper city', 'lighthouse point', 'sea ranch lakes',
]
// PALM BEACH COUNTY = North. This list did not exist before, which is exactly why Lucerne and
// Amrit units with no building text were being called Miami.
const NORTH_CITIES = [
  'lake worth', 'riviera beach', 'west palm', 'palm beach', 'boynton', 'delray', 'lantana',
  'jupiter', 'wellington', 'greenacres', 'royal palm beach', 'juno beach', 'north palm',
]

// Exact aliases for raw Guesty building text that carries no recognisable name of its own.
const EXACT_ALIASES: Record<string, string> = { '101': 'Lucerne' }

function norm(s: any): string { return String(s ?? '').toLowerCase().trim() }
function hay(building?: string | null, name?: string | null): string {
  return (' ' + norm(building) + ' ' + norm(name) + ' ').replace(/[_/,]+/g, ' ')
}
function defFor(building?: string | null, name?: string | null): BuildingDef | null {
  const alias = EXACT_ALIASES[norm(building)]
  if (alias) { const hit = BUILDINGS.find(d => d.label === alias); if (hit) return hit }
  const h = hay(building, name)
  for (const d of BUILDINGS) if (d.re.test(h)) return d
  return null
}

/**
 * The canonical building name — "Nomad", not "Nomad 409"; "Capri", not "Capri 115/116".
 * Falls back to a cleaned first-word guess so a brand-new building still groups with itself,
 * and returns null when there is genuinely nothing to go on.
 */
export function buildingOf(building?: string | null, name?: string | null): string | null {
  const d = defFor(building, name)
  if (d) return d.label
  // Unknown building: strip unit numbers/sizes and take the first real word, so a new property
  // groups with its own units instead of scattering. Never invents a market.
  for (const src of [building, name]) {
    const s = String(src || '').replace(/^[^A-Za-z0-9]+/, '').trim()
    if (!s) continue
    for (const w of s.split(/[\s\-/]+/).filter(Boolean)) {
      const clean = w.replace(/[^A-Za-z0-9]/g, '')
      if (clean.length < 3) continue
      if (/^\d+$/.test(clean)) continue
      if (/^\d+(br|bd|bed|beds|ba|bath|baths)$/i.test(clean)) continue
      if (/^(bed|br|stu|studio|suite|king|queen|apt|unit|the|and|for|with|near|from)$/i.test(clean)) continue
      return clean
    }
  }
  return null
}

export function isLux(building?: string | null, name?: string | null): boolean {
  return !!defFor(building, name)?.lux
}
export function isVendorManaged(building?: string | null, name?: string | null): boolean {
  return !!defFor(building, name)?.vendor
}

/** Building first (a building sits in one market), then city, then Miami-Dade as the default. */
export function marketOf(building?: string | null, city?: string | null, name?: string | null): Market {
  const d = defFor(building, name)
  if (d) return d.market
  const c = norm(city)
  if (c) {
    if (NORTH_CITIES.some(n => c.includes(n))) return 'North'
    if (BROWARD_CITIES.some(n => c.includes(n))) return 'Broward'
  }
  return 'Miami'
}

export function tierOf(lux: boolean): 'Lux' | 'Other' { return lux ? 'Lux' : 'Other' }
export const MARKETS: Market[] = ['Miami', 'Broward', 'North']
/** Every building we know about, for filter menus and coverage checks. */
export const KNOWN_BUILDINGS: { label: string; market: Market; lux: boolean; vendor: boolean }[] =
  BUILDINGS.map(b => ({ label: b.label, market: b.market, lux: !!b.lux, vendor: !!b.vendor }))
