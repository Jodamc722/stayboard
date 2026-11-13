// THE MAP GROUPS BY ADDRESS, NOT BY LISTING (Jon, 2026-11-13: "group properties by address, not listings").
// Guesty's "building" on a unit is often the listing's own name ("Botanica 6107", "Arya 1418"), so grouping by it
// made 83 "properties" out of what are 42 street addresses. A property here is one street address in one city;
// its name is the name most of its units share once the unit number is taken off. Isomorphic and pure, so it is tested.

export type MapUnit = { id: string; name: string; building: string; address: string; city: string; lat: number; lng: number }
const TYPE = '(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|highway|hwy|way|lane|ln|court|ct|place|pl|terrace|ter|circle|cir|trail|trl|parkway|pkwy|causeway|cswy|plaza|square|alley|run|path|row|walk|bay|isle|point)'
const STREET = new RegExp('^(.*\\b' + TYPE + ')\\b\\.?(?:\\s+(?:n|s|e|w|ne|nw|se|sw|north|south|east|west))?(?=\\s|$)', 'i')

/** "398 Northeast 5th Street Elser 2811, Miami, …" → "398 Northeast 5th Street". The unit, tower or apartment that
 *  people type after the street is dropped, so every unit in a building lands on the same address. */
export function streetOf(address: string): string {
  const first = String(address || '').split(',')[0].replace(/\s+/g, ' ').trim()
  if (!first) return ''
  const m = first.match(STREET)
  if (m && /^\d/.test(m[1])) return m[0].trim()
  // no street word found: take off a trailing "Apt 4B", "#12", "Unit 3", or a bare unit number
  return first.replace(/\s+(?:apt|apartment|unit|suite|ste|#)\s*[\w-]+$/i, '').replace(/\s+#?\d{1,5}[a-z]?$/i, '').trim() || first
}
/** "Botanica 6107" → "Botanica"; "Arya 2004 FULL" → "Arya"; "17W 504" → "17W". */
export function baseName(name: string): string {
  let s = String(name || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i++) { const t = s.replace(/\s+(?:full|unit|apt|suite|ph|#)?\s*#?[\d-]+[a-z]?$/i, '').replace(/\s+(?:full|entire|combo|combined)$/i, '').trim(); if (t === s || !t) break; s = t }
  return s
}
export type MapPlace<U extends MapUnit> = { id: string; name: string; address: string; city: string; lat: number; lng: number; units: U[] }

export function placesByAddress<U extends MapUnit>(units: U[]): MapPlace<U>[] {
  const m = new Map<string, MapPlace<U>>()
  for (const u of units) {
    const street = streetOf(u.address)
    const k = street ? 'a:' + street.toLowerCase() + '|' + String(u.city || '').toLowerCase() : 'p:' + u.lat.toFixed(4) + ',' + u.lng.toFixed(4)
    const p = m.get(k) || { id: k, name: '', address: [street, u.city].filter(Boolean).join(', '), city: u.city, lat: 0, lng: 0, units: [] as U[] }
    p.units.push(u); m.set(k, p)
  }
  const out = Array.from(m.values())
  for (const p of out) {
    p.lat = p.units.reduce((a, u) => a + u.lat, 0) / p.units.length; p.lng = p.units.reduce((a, u) => a + u.lng, 0) / p.units.length
    p.units.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const tally = new Map<string, number>()
    for (const u of p.units) { const b = baseName(u.building || u.name); if (b) tally.set(b, (tally.get(b) || 0) + 1) }
    p.name = Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || p.address || 'Property'
  }
  // the same name at more than one address (Botanica at 3621, 3623 and 3821): say which
  const names = new Map<string, number>(); out.forEach(p => names.set(p.name, (names.get(p.name) || 0) + 1))
  for (const p of out) if ((names.get(p.name) || 0) > 1) { const no = p.address.match(/^\d+[\w-]*/)?.[0]; if (no) p.name = p.name + ' · ' + no }
  out.sort((a, b) => b.units.length - a.units.length || a.name.localeCompare(b.name))
  return out
}
