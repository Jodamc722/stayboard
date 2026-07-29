// MINI-MARKET AREAS — group units by where they actually ARE, not by which city string Guesty
// happens to carry. Buildings a few blocks apart belong on the same run even when the city name
// differs (Lauderdale-by-the-Sea vs Fort Lauderdale), and one city can hold several areas that
// are 20 minutes apart. A runner should be able to read one area block and know their route.
//
// Single-link clustering: a unit joins an area if it is within `radiusKm` of ANY unit already in
// it, so a chain of neighbouring buildings stays together. Portfolio-wide coordinates are complete
// (232/232 active listings), so this is reliable.

export type GeoUnit = { listingId: string; unit: string; city?: string | null; lat?: number | null; lng?: number | null }
export type Area<T> = { key: string; label: string; city: string | null; units: T[]; lat: number | null; lng: number | null }

const R = 6371 // km
function toRad(d: number) { return (d * Math.PI) / 180 }
export function distanceKm(a: { lat?: number | null; lng?: number | null }, b: { lat?: number | null; lng?: number | null }): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// "Botanica 1109 - King w/ Kitchenette" -> Botanica ; "17WEST - 410 - 2BR" -> 17WEST
// "101/3 Lucerne - STU" -> Lucerne ; "906/5- 1BR" -> (none, falls back to the city)
export function buildingOf(name: string): string | null {
  const s = String(name || '').replace(/^[^A-Za-z0-9]+/, '').trim()
  if (!s) return null
  const words = s.split(/[\s\-/]+/).filter(Boolean)
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z0-9]/g, '')
    if (clean.length < 3) continue
    if (/^\d+$/.test(clean)) continue           // pure unit number
    if (/^(bed|br|stu|studio|suite|king|queen|apt|unit)$/i.test(clean)) continue
    return clean
  }
  return null
}

/** Group units into geographic areas. Units without coordinates fall back to city/building. */
export function clusterAreas<T extends GeoUnit>(units: T[], radiusKm = 1.2): Area<T>[] {
  const geo = units.filter(u => u.lat != null && u.lng != null)
  const flat = units.filter(u => u.lat == null || u.lng == null)
  const parent: number[] = geo.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra }
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      if (distanceKm(geo[i], geo[j]) <= radiusKm) union(i, j)
    }
  }
  const groups: Record<string, T[]> = {}
  for (let i = 0; i < geo.length; i++) { const r = String(find(i)); (groups[r] ||= []).push(geo[i]) }

  const areas: Area<T>[] = Object.keys(groups).map(k => {
    const list = groups[k]
    // name the area after the buildings inside it (up to two), else the city
    const counts: Record<string, number> = {}
    for (const u of list) { const b = buildingOf(u.unit); if (b) counts[b] = (counts[b] || 0) + 1 }
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
    const city = list.map(u => u.city).filter(Boolean)[0] || null
    const label = names.length === 0 ? (city || 'Area')
      : names.length === 1 ? names[0]
      : names.length === 2 ? names[0] + ' + ' + names[1]
      : names[0] + ' + ' + names[1] + ' +' + (names.length - 2)
    const lat = list.reduce((s, u) => s + (u.lat || 0), 0) / list.length
    const lng = list.reduce((s, u) => s + (u.lng || 0), 0) / list.length
    // walk the units nearest-to-nearest so the block reads like a driving route
    const ordered: T[] = list.length ? [list[0]] : []
    const rest = list.slice(1)
    while (rest.length) {
      const last = ordered[ordered.length - 1]
      let bi = 0, bd = Infinity
      for (let i = 0; i < rest.length; i++) { const d = distanceKm(last, rest[i]); if (d < bd) { bd = d; bi = i } }
      ordered.push(rest.splice(bi, 1)[0])
    }
    return { key: 'geo-' + k, label, city, units: ordered, lat, lng }
  })

  // units with no coordinates: keep them visible, grouped by city
  const byCity: Record<string, T[]> = {}
  for (const u of flat) { const c = String(u.city || 'No location'); (byCity[c] ||= []).push(u) }
  for (const c of Object.keys(byCity)) areas.push({ key: 'city-' + c, label: c, city: c, units: byCity[c], lat: null, lng: null })

  // biggest runs first — that is where the day is won
  areas.sort((a, b) => b.units.length - a.units.length || a.label.localeCompare(b.label))
  return areas
}
