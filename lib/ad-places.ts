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

// THINGS TO DO NEAR OUR LISTINGS (2026-11-12, the event ad's second act — Jon: "Event, things to do, and then hit them
// with book your Stay now"). Real, public places only — neighbourhoods, streets, parks and beaches, never a business
// or a venue's brand — so a headline can name them as plain facts ("Rooftops in **Brickell**"). `visual` is the
// generic picture the AI image is asked for (no names, no signs, no logos); `stock` is the stock-photo search.
export type ThingToDo = { name: string; what: string; kind: 'food' | 'rooftop' | 'beach' | 'nightlife' | 'gallery' | 'water' | 'shopping' | 'culture' | 'park'; visual: string; stock: string }
export const THINGS_TO_DO: Record<AreaKey, ThingToDo[]> = {
  'miami-beach': [
    { name: 'South Pointe Park', what: 'Sunset by the water', kind: 'park', visual: 'a seaside park pier at sunset, palm trees, cruise-ship channel and turquoise water, people strolling far away', stock: 'miami beach sunset pier' },
    { name: 'Lincoln Road', what: 'Cafés and shopping, all on foot', kind: 'shopping', visual: 'a palm-lined pedestrian promenade with open-air café tables at golden hour, softly out-of-focus passers-by', stock: 'outdoor cafe palm trees street' },
    { name: 'Ocean Drive', what: 'Art Deco nights', kind: 'nightlife', visual: 'pastel Art Deco hotel facades glowing with neon-coloured light at night along a beachfront street, palm trees', stock: 'art deco miami beach night' },
    { name: 'The beach', what: 'Sunrise swims and slow mornings', kind: 'beach', visual: 'a wide white-sand beach at sunrise, a lifeguard hut in pastel colours, calm turquoise water', stock: 'miami beach sunrise lifeguard tower' },
    { name: 'Española Way', what: 'Dinner under the string lights', kind: 'food', visual: 'a narrow Mediterranean-style street with string lights and outdoor dinner tables at dusk, warm glow', stock: 'outdoor dining string lights street' },
  ],
  miami: [
    { name: 'Brickell', what: 'Rooftops over the skyline', kind: 'rooftop', visual: 'a stylish rooftop lounge at dusk overlooking a glittering city skyline and the bay, cocktails on a ledge, anonymous guests out of focus', stock: 'rooftop bar city skyline dusk' },
    { name: 'Wynwood', what: 'Street art and galleries', kind: 'gallery', visual: 'a sunny street lined with huge colourful abstract murals of original design, a few people walking far away', stock: 'colorful street art murals' },
    { name: 'Design District', what: 'Galleries and boutiques', kind: 'shopping', visual: 'a modern open-air design plaza with sculptural architecture, glass storefronts without signs and palm trees in bright sun', stock: 'modern architecture plaza palm trees' },
    { name: 'Little Havana', what: 'Cafecito and live music', kind: 'culture', visual: 'a colourful street-side café window with small cups of Cuban coffee on the counter, warm afternoon light', stock: 'cuban coffee cafe window' },
    { name: 'Biscayne Bay', what: 'A sunset cruise on the bay', kind: 'water', visual: 'a boat cruising across a calm bay at sunset with a city skyline glowing behind', stock: 'boat bay sunset skyline' },
    { name: 'Coconut Grove', what: 'Dinner on the waterfront', kind: 'food', visual: 'a waterfront restaurant terrace under banyan trees at dusk, sailboats moored beyond, candles on the tables', stock: 'waterfront restaurant dusk sailboats' },
  ],
  'fort-lauderdale': [
    { name: 'Las Olas Boulevard', what: 'Dinner and galleries on the boulevard', kind: 'food', visual: 'a palm-lined boulevard with outdoor dining tables and warm lights at dusk, softly out-of-focus diners', stock: 'outdoor dining palm boulevard evening' },
    { name: 'The beach promenade', what: 'A wave-wall walk by the ocean', kind: 'beach', visual: 'a seaside promenade with a curving white wave-shaped wall, palm trees and a bright blue ocean', stock: 'fort lauderdale beach promenade' },
    { name: 'The water taxi', what: 'See the canals from the water', kind: 'water', visual: 'a small open boat gliding along a palm-fringed canal past yachts and waterfront homes in bright sun', stock: 'canal boat yachts waterfront homes' },
    { name: 'Riverwalk', what: 'An evening by the river', kind: 'park', visual: 'a riverside walkway at dusk with lamps reflecting in the water, boats moored along the edge', stock: 'riverwalk evening lights' },
    { name: 'The Intracoastal', what: 'Dinner on the water', kind: 'food', visual: 'a dock-side dinner table at sunset on a wide waterway, yachts passing, string lights overhead', stock: 'dock dinner sunset yachts' },
  ],
  pompano: [
    { name: 'The pier', what: 'Sunrise on the pier', kind: 'beach', visual: 'a long fishing pier stretching into a calm turquoise ocean at sunrise, gentle waves', stock: 'fishing pier sunrise ocean' },
    { name: 'Hillsboro Inlet', what: 'Boats and the lighthouse', kind: 'water', visual: 'a tall historic lighthouse over a busy inlet with boats heading out to sea on a bright day', stock: 'lighthouse inlet boats' },
    { name: 'The beach', what: 'Quiet sand, all day', kind: 'beach', visual: 'a quiet wide beach with sea grape trees and two empty loungers facing turquoise water', stock: 'quiet beach loungers turquoise' },
    { name: 'The waterfront', what: 'Fresh seafood by the water', kind: 'food', visual: 'a plate of grilled fish and lime on a waterfront table, boats soft in the background, sunny afternoon', stock: 'seafood waterfront table' },
  ],
  'palm-beach': [
    { name: 'Worth Avenue', what: 'Courtyards and boutiques', kind: 'shopping', visual: 'an elegant Mediterranean-style shopping courtyard with bougainvillea, fountains and arched walkways, no signs', stock: 'mediterranean courtyard bougainvillea' },
    { name: 'Clematis Street', what: 'Nights downtown', kind: 'nightlife', visual: 'a lively downtown street at night with warm café lights and palm trees, a waterfront fountain', stock: 'downtown street night palm trees' },
    { name: 'Atlantic Avenue, Delray', what: 'Dinner and live music', kind: 'food', visual: 'a buzzing small-town avenue at dusk with outdoor dinner tables under palm trees and string lights', stock: 'outdoor dining avenue dusk' },
    { name: 'Peanut Island', what: 'A boat day on clear water', kind: 'water', visual: 'boats anchored over crystal-clear shallow turquoise water near a small tropical island, bright sun', stock: 'boats clear turquoise water island' },
    { name: 'Lake Worth Beach', what: 'Pier, sand and sunrise', kind: 'beach', visual: 'a beach pier at sunrise with pastel sky and gentle surf', stock: 'beach pier pastel sunrise' },
  ],
}
/** Things to do for the areas an ad is set in, a fair mix across the areas, up to `limit`. Empty areas = Miami. */
export function thingsToDo(areas: AreaKey[], limit = 8): ThingToDo[] {
  const keys: AreaKey[] = areas.length ? areas : ['miami']
  const lists = keys.map(k => THINGS_TO_DO[k] || [])
  const out: ThingToDo[] = []
  for (let i = 0; out.length < limit && lists.some(l => i < l.length); i++) for (const l of lists) if (l[i] && out.length < limit) out.push(l[i])
  return out
}
