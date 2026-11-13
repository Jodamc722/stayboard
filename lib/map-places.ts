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
const LONG: Record<string, string> = { st: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', rd: 'road', dr: 'drive', hwy: 'highway', ln: 'lane', ct: 'court', pl: 'place', ter: 'terrace', cir: 'circle', trl: 'trail', pkwy: 'parkway', cswy: 'causeway',
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' }
/** One spelling per street, so "101 Lucerne Ave" and "101 Lucerne Avenue" (or "911 N Federal Hwy") are the same address:
 *  short forms written out, then title case. */
export function canonStreet(street: string): string {
  return String(street || '').replace(/\./g, '').split(/\s+/).filter(Boolean).map((w, i) => { const l = w.toLowerCase(); const x = i > 0 && LONG[l] ? LONG[l] : l; return /^\d/.test(x) ? x : x.charAt(0).toUpperCase() + x.slice(1) }).join(' ')
}
/** "Botanica 6107" → "Botanica"; "Arya 2004 FULL" → "Arya"; "17W 504" → "17W". */
export function baseName(name: string): string {
  let s = String(name || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i++) { const t = s.replace(/\s+(?:full|unit|apt|suite|ph|#)?\s*#?[\d-]+[a-z]?$/i, '').replace(/\s+(?:full|entire|combo|combined)$/i, '').trim(); if (t === s || !t) break; s = t }
  return s
}
/** Buildings whose Guesty name is only a street number: the name people actually use, by street address. */
const ALIAS: Record<string, string> = { '101 lucerne avenue': 'Lucerne' }
const NEAR_KM = 1.5
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => { const R = 6371, r = Math.PI / 180, dy = (b.lat - a.lat) * r, dx = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r); return R * Math.sqrt(dx * dx + dy * dy) }
/** "3621 North Ocean Boulevard" + "3623 …" + "3821 …" → "3621, 3623 and 3821 North Ocean Boulevard"; different streets are listed. */
function joinStreets(streets: string[]): string {
  const parts = streets.map(s => { const m = s.match(/^(\d+[\w-]*)\s+(.*)$/); return m ? { no: m[1], rest: m[2] } : { no: '', rest: s } })
  const and = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1])
  if (parts.every(p => p.no && p.rest.toLowerCase() === parts[0].rest.toLowerCase())) return and(parts.map(p => p.no).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) + ' ' + parts[0].rest
  return and(streets)
}
export type MapPlace<U extends MapUnit> = { id: string; name: string; address: string; city: string; lat: number; lng: number; units: U[] }

export function placesByAddress<U extends MapUnit>(units: U[]): MapPlace<U>[] {
  const m = new Map<string, MapPlace<U>>()
  for (const u of units) {
    const street = canonStreet(streetOf(u.address))
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
  for (const p of out) p.name = ALIAS[p.address.split(',')[0].toLowerCase()] || p.name
  // ONE PROPERTY, SEVERAL ADDRESSES (Jon, 2026-11-13: "Botanica, group them together, same property different
  // addresses… Capri same thing"). Addresses that carry the same name and sit within a short walk of each other are one
  // property. The distance check keeps two unrelated buildings that merely share a name apart.
  const merged: MapPlace<U>[] = []
  for (const p of out) {
    const host = merged.find(m => m.name.toLowerCase() === p.name.toLowerCase() && km(m, p) <= NEAR_KM)
    if (!host) { merged.push({ ...p, units: [...p.units], streets: [p.address.split(',')[0]] } as MapPlace<U> & { streets: string[] }); continue }
    const n = host.units.length + p.units.length
    host.lat = (host.lat * host.units.length + p.lat * p.units.length) / n; host.lng = (host.lng * host.units.length + p.lng * p.units.length) / n
    host.units.push(...p.units); (host as any).streets.push(p.address.split(',')[0])
  }
  for (const m of merged) {
    const streets: string[] = (m as any).streets; delete (m as any).streets
    if (streets.length > 1) { m.address = joinStreets(streets) + (m.city ? ', ' + m.city : ''); m.id = 'n:' + m.name.toLowerCase() + '|' + m.id; m.units.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }
  }
  out.length = 0; out.push(...merged)
  // still the same name in two places that are far apart: say which
  const names = new Map<string, number>(); out.forEach(p => names.set(p.name, (names.get(p.name) || 0) + 1))
  for (const p of out) if ((names.get(p.name) || 0) > 1) { const no = p.address.match(/^\d+[\w-]*/)?.[0]; if (no) p.name = p.name + ' · ' + no }
  out.sort((a, b) => b.units.length - a.units.length || a.name.localeCompare(b.name))
  return out
}
