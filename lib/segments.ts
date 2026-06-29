// Portfolio segmentation — MARKET (Miami | Broward | North) and LUX tier, plus a
// vendor-managed flag. Per Jon (2026-06-29):
//   • North market   = the vendor-managed northern cluster: Capri, Lucerne, Amrit.
//   • Park Towers (PT) is in Miami but ALSO vendor-managed.
//   • Lux tier        = Elser, Amrit, Nomad, Arya, 17 West, District 225.
// Market is derived from the unit's CITY (geography) so it stays accurate as the portfolio
// grows; North and the vendor flag are building-name overrides. All matching is lowercase
// substring + tolerant of common misspellings. Edit the lists here to adjust.

export type Market = 'Miami' | 'Broward' | 'North'

// Building/name keywords.
const NORTH_BUILDINGS = ['capri', 'lucerne', 'lucenre', 'amrit']
const VENDOR_BUILDINGS = ['capri', 'lucerne', 'lucenre', 'amrit', 'park tower', 'park towers', 'pt-', 'pt ']
const LUX_BUILDINGS = ['elser', 'amrit', 'nomad', 'arya', '17 west', '17west', 'district 225', 'district225', 'dist 225']

// Broward-county cities. Anything else in the portfolio defaults to Miami (Miami-Dade).
const BROWARD_CITIES = [
  'fort lauderdale', 'ft lauderdale', 'ft. lauderdale', 'lauderdale', 'hollywood', 'pompano',
  'pembroke pines', 'hallandale', 'dania', 'davie', 'plantation', 'sunrise', 'oakland park',
  'wilton manors', 'deerfield', 'coral springs', 'miramar', 'weston', 'tamarac', 'lauderhill',
  'margate', 'coconut creek', 'parkland', 'cooper city', 'lighthouse point', 'sea ranch lakes',
]

function norm(s: any): string { return String(s ?? '').toLowerCase().trim() }
function matchAny(hay: string, needles: string[]): boolean { return needles.some(n => n && hay.includes(n)) }

export function isLux(building?: string | null, name?: string | null): boolean {
  return matchAny(norm(building) + ' ' + norm(name), LUX_BUILDINGS)
}
export function isVendorManaged(building?: string | null, name?: string | null): boolean {
  return matchAny(norm(building) + ' ' + norm(name), VENDOR_BUILDINGS)
}
export function marketOf(building?: string | null, city?: string | null, name?: string | null): Market {
  const b = norm(building) + ' ' + norm(name)
  if (matchAny(b, NORTH_BUILDINGS)) return 'North'
  if (matchAny(norm(city), BROWARD_CITIES)) return 'Broward'
  return 'Miami'
}
export function tierOf(lux: boolean): 'Lux' | 'Other' { return lux ? 'Lux' : 'Other' }
export const MARKETS: Market[] = ['Miami', 'Broward', 'North']
