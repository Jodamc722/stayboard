// WHERE OUR LISTINGS ARE (Jon, 2026-11-04: "location matters — the Fort Lauderdale boat show should highlight our
// Fort Lauderdale units, Miami → Miami units … look at our properties"). Built from the live book (listing city):
//   Miami Beach      17WEST (26)
//   Miami            Elser (21) · Arya (16) · Park Towers (8) · District 225 · NoMad
//   Fort Lauderdale  Botanica (53) · Eden (25) · Rustic (24) · Oasis (7) · Hendricks (6)
//   Pompano Beach    Pelican (10) · 906 (8) · Salato (5) · 3316 (3) · 1587
//   Palm Beach       Capri (13) · Boynton (9) · Lucerne (5) · Amrit
// Building names are the library's (photo-library `building`). Client-safe — no imports.
export type AreaKey = 'miami-beach' | 'miami' | 'fort-lauderdale' | 'pompano' | 'palm-beach'
export const AREAS: { key: AreaKey; label: string; buildings: string[]; words: RegExp }[] = [
  { key: 'miami-beach', label: 'Miami Beach', buildings: ['17WEST'], words: /\b(miami beach|south beach|sobe|collins|lincoln road|ocean drive)\b/i },
  { key: 'miami', label: 'Miami', buildings: ['Elser', 'Arya', 'Park Towers', 'District 225', 'Nomad'], words: /\b(downtown miami|brickell|edgewater|wynwood|bayfront|biscayne|kaseya|midtown|design district|little havana|coconut grove|hard rock stadium|miami(?! beach))\b/i },
  { key: 'fort-lauderdale', label: 'Fort Lauderdale', buildings: ['Botanica', 'Eden', 'Rustic', 'Oasis', 'Hendricks'], words: /\b(fort lauderdale|ft\.? ?lauderdale|las olas|flibs|bahia mar|lauderdale)\b/i },
  { key: 'pompano', label: 'Pompano Beach', buildings: ['Pelican', '906', 'Salato', '3316', '1587'], words: /\b(pompano|lighthouse point|deerfield)\b/i },
  { key: 'palm-beach', label: 'Palm Beach', buildings: ['Capri', 'Boynton', 'Lucerne', 'Amrit'], words: /\b(palm beach|lake worth|boynton|delray|riviera beach|jupiter)\b/i },
]
export const AREA_LABEL: Record<AreaKey, string> = Object.fromEntries(AREAS.map(a => [a.key, a.label])) as Record<AreaKey, string>
/** The areas a brief talks about, in the order they appear in it (empty = anywhere we are). */
export function areasIn(text: string): AreaKey[] {
  const t = String(text || '')
  return AREAS.map(a => ({ k: a.key, at: t.search(a.words) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at).map(x => x.k)
}
/** The buildings for a set of areas. */
export function buildingsIn(areas: AreaKey[]): string[] {
  return AREAS.filter(a => areas.indexOf(a.key) >= 0).flatMap(a => a.buildings)
}
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
/** Is this library building in the preferred set? */
export function inBuildings(building: string, set: string[]): boolean {
  const b = norm(building)
  return !!b && set.some(x => norm(x) === b)
}
/** Rank photo hits so the right place comes first: preferred buildings, then the rest (stable). */
export function byPlace<T extends { building?: string }>(hits: T[], set: string[]): T[] {
  if (!set.length) return hits
  return hits.map((h, i) => ({ h, i, w: inBuildings(String(h.building || ''), set) ? 0 : 1 })).sort((a, b) => a.w - b.w || a.i - b.i).map(x => x.h)
}
