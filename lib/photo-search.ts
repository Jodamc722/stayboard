// SMART PHOTO SEARCH — the matching rules (Jon, 2026-10-27: "smart search like 17west pool or
// elser pool").
//
// A query is a few words. Every word has to land somewhere on the photo: the unit and property it
// belongs to (its location words), or what the photo shows (the caption as the team wrote it, and
// what the photo analysis saw — room, category, subject, selling points). "elser pool" is therefore
// Elser's pool shots across every Elser unit; "17west 511" is everything on that unit.
//
// Words have families: "pool" also finds swimming, plunge, jacuzzi, hot tub and spa; "view" finds
// skyline, ocean, bay, intracoastal, sunset. A family word matches a photo word exactly, or as the
// start of a longer one when it is four letters or more ("pool" → "poolside", "bath" → "bathroom")
// — never a short word inside a long one, so "spa" does not find "spacious". A property typed with a
// space ("17 west") is also tried joined, against the squashed names ("17west511").
//
// Pure: no imports, no I/O. lib/__tests__/photo-search.test.mjs runs the rules.

export const SYNONYMS: Record<string, string[]> = {
  pool: ['pool', 'swimming', 'plunge', 'jacuzzi', 'hottub', 'spa', 'whirlpool'],
  gym: ['gym', 'fitness', 'workout', 'exercise', 'peloton', 'treadmill', 'weights'],
  lobby: ['lobby', 'entrance', 'reception', 'entry', 'foyer', 'concierge', 'hallway', 'elevator'],
  view: ['view', 'skyline', 'ocean', 'bay', 'intracoastal', 'water', 'sunset', 'vista', 'waterfront', 'city'],
  balcony: ['balcony', 'terrace', 'patio', 'lanai'],
  kitchen: ['kitchen', 'kitchenette', 'stove', 'fridge', 'refrigerator', 'oven', 'cooktop', 'island', 'microwave'],
  bedroom: ['bedroom', 'bed', 'king', 'queen', 'bunk', 'sleep', 'nightstand', 'headboard'],
  bathroom: ['bathroom', 'bath', 'shower', 'vanity', 'toilet', 'tub', 'restroom', 'ensuite'],
  living: ['living', 'sofa', 'couch', 'sectional', 'fireplace'],
  dining: ['dining', 'dine', 'breakfast', 'bar', 'barstools'],
  rooftop: ['rooftop', 'roof', 'sundeck'],
  parking: ['parking', 'garage', 'valet', 'carport'],
  beach: ['beach', 'sand', 'shore', 'oceanfront', 'beachfront', 'boardwalk'],
  exterior: ['exterior', 'building', 'facade', 'outside', 'street', 'aerial', 'drone', 'curb'],
  laundry: ['laundry', 'washer', 'dryer'],
  office: ['office', 'desk', 'workspace', 'workstation'],
  tv: ['tv', 'television', 'theater', 'media'],
  grill: ['grill', 'bbq', 'barbecue'],
  playground: ['playground', 'kids', 'children', 'play'],
  pet: ['pet', 'pets', 'dog', 'dogs'],
  floorplan: ['floorplan', 'layout', 'plan'],
}
const FORM_OF: Record<string, string> = {}
for (const k of Object.keys(SYNONYMS)) for (const f of SYNONYMS[k]) if (!FORM_OF[f]) FORM_OF[f] = k

/** Lower-case letters and digits only: "17 West - 511" → "17west511". */
export const squash = (v: unknown): string => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '')
/** The words of a text, lower-cased, letters and digits only. */
export const wordsOf = (v: unknown): string[] => String(v == null ? '' : v).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** Up to six query words; the rest of a long query is ignored. */
export const queryWords = (q: unknown): string[] => wordsOf(q).slice(0, 6)

const known = (w: string) => !!SYNONYMS[w] || !!FORM_OF[w]
/** A query word in its family's spelling: "pools" → "pool", "balconies" → "balcony". Unknown words come back unchanged. */
export function normalizeWord(w: string): string {
  const l = w.toLowerCase()
  if (known(l)) return l
  if (l.length > 4 && l.endsWith('ies') && known(l.slice(0, -3) + 'y')) return l.slice(0, -3) + 'y'
  if (l.length > 3 && l.endsWith('es') && known(l.slice(0, -2))) return l.slice(0, -2)
  if (l.length > 3 && l.endsWith('s') && known(l.slice(0, -1))) return l.slice(0, -1)
  return l
}
/** The forms a query word may appear as on a photo: its family, or the word itself. */
export function expand(w: string): string[] {
  const n = normalizeWord(w)
  if (SYNONYMS[n]) return SYNONYMS[n]
  if (FORM_OF[n]) return SYNONYMS[FORM_OF[n]]
  return [n]
}

/** What a photo can be found by: its words, and the squashed unit/property names. */
export type Haystack = { tokens: string[]; squashed: string }
/** Build the haystack. `location` is the unit and property names; `content` is captions and what the analysis saw. */
export function haystack(location: string[], content: string[]): Haystack {
  const seen: Record<string, true> = {}
  const tokens: string[] = []
  for (const s of location.concat(content)) for (const w of wordsOf(s)) if (!seen[w]) { seen[w] = true; tokens.push(w) }
  return { tokens, squashed: ' ' + location.map(squash).filter(Boolean).join(' ') + ' ' }
}

/** Does one query word land on the photo? Returns the form it matched, or null. */
export function wordMatch(h: Haystack, w: string): string | null {
  const forms = expand(w)
  for (const f of forms) {
    const fw = f.replace(/\s+/g, '')
    if (fw.length >= 4) { for (const t of h.tokens) if (t === fw || t.indexOf(fw) === 0) return f }
    else { for (const t of h.tokens) if (t === fw) return f }
  }
  // a unit or property code, typed with or without its spaces and dashes: "17west", "511", "1203"
  const sq = squash(w)
  if (sq.length >= 2 && h.squashed.indexOf(sq) >= 0) return sq
  return null
}

/** Every word must land. Returns what each matched, or null. A property typed as two words ("17 west") is also tried joined. */
export function matchQuery(h: Haystack, words: string[]): string[] | null {
  if (!words.length) return null
  const attempt = (ws: string[]): string[] | null => {
    const why: string[] = []
    for (const w of ws) { const m = wordMatch(h, w); if (!m) return null; why.push(m) }
    return why
  }
  const direct = attempt(words)
  if (direct) return direct
  for (let i = 0; i + 1 < words.length; i++) {
    const joined = words.slice(0, i).concat([words[i] + words[i + 1]], words.slice(i + 2))
    const m = attempt(joined)
    if (m) return m
  }
  return null
}

/** The words of a photo's analysis entry (raw._photoIndex[picId]) that describe what it shows. */
export function analysisWords(e: any): string[] {
  if (!e || typeof e !== 'object') return []
  const out: string[] = []
  for (const k of ['room', 'category', 'subject', 'caption', 'shotType']) if (typeof e[k] === 'string' && e[k]) out.push(e[k])
  if (Array.isArray(e.sellingPoints)) for (const s of e.sellingPoints) if (typeof s === 'string') out.push(s)
  if (e.kind === 'stock') out.push('stock')
  return out
}
