// THE AMENITY AUDIT — what the photos prove against what the listing claims (Jon, 2026-10-30: "edit
// and audit the amenities and ensure they're up to date and all amenities are listed … on the
// amenities tab check photos and see if any are missing and recommend from that page").
//
// Three lists, all from facts already stored on the listing (raw._photoIndex, written by the photo
// analysis), so the audit costs nothing to run and the score and the Amenities tab always agree:
//
//   seenMissing   a photo plainly shows it, the listing does not list it → one tap to add
//   listedNoPhoto the listing claims a feature guests choose on looks (pool, balcony, workspace) and
//                 no photo shows it → a guest doubts it; add a photo
//   conflicts     a listed amenity the verified building facts contradict (a Garage at a building
//                 whose parking is a lot) → remove it before a guest complains
//
// "Proof" is the analyst's own words for each photo: the amenities it saw, its selling-point tags
// and the room it named. Stock photos never count.
//
// Pure: no imports beyond the catalogue, no I/O.
import { amenityListed } from './amenity-catalog'

export type AuditItem = { name: string; photos: string[] }
export type Audit = {
  analyzed: number
  seenMissing: AuditItem[]
  listedNoPhoto: { name: string; tip: string }[]
  conflicts: { name: string; why: string }[]
}

/** Selling-point tags and room ids the analyst uses, in the Guesty spelling of the amenity they prove. */
const TAG_TO_AMENITY: Record<string, string[]> = {
  'pool': ['Pool'], 'infinity-pool': ['Pool'], 'hot-tub': ['Hot tub'], 'jacuzzi': ['Hot tub'],
  'gym': ['Gym'], 'balcony': ['Patio or balcony'], 'patio': ['Patio or balcony'], 'terrace': ['Terrace'],
  'rooftop': ['Rooftop deck'], 'ocean-view': ['Ocean view'], 'city-view': ['City skyline view'],
  'workspace': ['Dedicated workspace'], 'washer-dryer': ['Washer', 'Dryer'], 'soaking-tub': ['Bathtub'],
  'bathtub': ['Bathtub'], 'smart-tv': ['TV'], 'full-kitchen': ['Kitchen'], 'bbq': ['BBQ grill'], 'grill': ['BBQ grill'],
}
const ROOM_TO_AMENITY: Record<string, string[]> = {
  pool: ['Pool'], gym: ['Gym'], balcony: ['Patio or balcony'], rooftop: ['Rooftop deck'], workspace: ['Dedicated workspace'],
}

/** Features a guest books on looks — claiming one without a photo invites doubt. */
const PHOTO_WORTHY: { name: string; tip: string }[] = [
  { name: 'Pool', tip: 'a wide pool shot in daylight' },
  { name: 'Hot tub', tip: 'the hot tub with its surroundings' },
  { name: 'Gym', tip: 'the gym showing the equipment' },
  { name: 'Patio or balcony', tip: 'the balcony or patio with its seating and view' },
  { name: 'Balcony', tip: 'the balcony with its seating and view' },
  { name: 'Terrace', tip: 'the terrace with its seating' },
  { name: 'Rooftop deck', tip: 'the rooftop deck' },
  { name: 'BBQ grill', tip: 'the grill area' },
  { name: 'Ocean view', tip: 'the ocean view from inside the unit' },
  { name: 'City skyline view', tip: 'the skyline view from the unit' },
  { name: 'Dedicated workspace', tip: 'the desk and chair' },
  { name: 'Washer', tip: 'the washer and dryer' },
  { name: 'Bathtub', tip: 'the bathtub' },
  { name: 'Outdoor dining area', tip: 'the outdoor dining table' },
  { name: 'Sauna', tip: 'the sauna' },
]

/**
 * THE PHOTO DIGEST — the few facts the score needs from the photo analysis, small enough for the
 * portfolio pages to read for every listing (the full _photoIndex carries captions and is ~4x the
 * size). Written next to _photoIndex by the photo analysis and by photo-meta edits.
 */
export type DigestEntry = { c?: string; r?: string; k?: 's'; s?: string[]; a?: string[] }
export function digestOf(index: Record<string, any> | null | undefined): Record<string, DigestEntry> {
  const out: Record<string, DigestEntry> = {}
  if (!index || typeof index !== 'object') return out
  for (const [id, e] of Object.entries(index)) {
    if (!e || typeof e !== 'object') continue
    const d: DigestEntry = {}
    if (e.category) d.c = String(e.category)
    if (e.room) d.r = String(e.room)
    if (e.kind === 'stock') d.k = 's'
    if (Array.isArray(e.sellingPoints) && e.sellingPoints.length) d.s = e.sellingPoints.map(String).slice(0, 4)
    if (Array.isArray(e.amenitiesSeen) && e.amenitiesSeen.length) d.a = e.amenitiesSeen.map(String).slice(0, 8)
    out[id] = d
  }
  return out
}
/** The photo facts from whichever the listing carries: the full index, else the digest. */
export function photoFacts(raw: any): Record<string, any> {
  if (raw && raw._photoIndex && typeof raw._photoIndex === 'object' && Object.keys(raw._photoIndex).length) return raw._photoIndex
  const d = raw && raw._photoDigest && typeof raw._photoDigest === 'object' ? raw._photoDigest : null
  if (!d) return {}
  const out: Record<string, any> = {}
  for (const [id, e] of Object.entries(d as Record<string, DigestEntry>)) out[id] = { category: e.c, room: e.r, kind: e.k === 's' ? 'stock' : 'property', sellingPoints: e.s || [], amenitiesSeen: e.a || [] }
  return out
}

const norm = (x: string) => String(x || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The audit for one listing.
 * `photoIndex` = raw._photoIndex; `order` = the photo ids in display order (to show the first proof);
 * `parkingFact` = the verified building parking line, when there is one.
 */
export function auditAmenities(listed: string[], photoIndex: Record<string, any> | null | undefined, order: string[] = [], parkingFact?: string | null): Audit {
  const idx = photoIndex && typeof photoIndex === 'object' ? photoIndex : {}
  const ids = (order.length ? order.filter(id => idx[id]) : Object.keys(idx))
  const proof: Record<string, string[]> = {}   // amenity (Guesty spelling) → photo ids
  let analyzed = 0
  for (const id of ids) {
    const e = idx[id]
    if (!e || typeof e !== 'object' || e.kind === 'stock') continue
    analyzed++
    const names = new Set<string>()
    for (const a of Array.isArray(e.amenitiesSeen) ? e.amenitiesSeen : []) if (typeof a === 'string' && a.trim()) names.add(a.trim())
    for (const t of Array.isArray(e.sellingPoints) ? e.sellingPoints : []) for (const a of TAG_TO_AMENITY[String(t).toLowerCase()] || []) names.add(a)
    for (const a of ROOM_TO_AMENITY[String(e.room || '').toLowerCase()] || []) names.add(a)
    names.forEach(n => { (proof[n] = proof[n] || []).push(id) })
  }
  const proven = (name: string) => Object.keys(proof).some(p => norm(p) === norm(name) || (name === 'Balcony' && p === 'Patio or balcony') || (name === 'Patio or balcony' && /balcony|patio|terrace/i.test(p)))

  const seenMissing = Object.entries(proof)
    .filter(([name]) => !amenityListed(name, listed) && !(name === 'Patio or balcony' && listed.some(l => /balcony|patio|terrace/i.test(l))))
    .map(([name, photos]) => ({ name, photos: photos.slice(0, 4) }))
    .sort((a, b) => b.photos.length - a.photos.length)

  // Only judge "no photo" once enough of the set has been analysed to mean something.
  const listedNoPhoto = analyzed >= 5
    ? PHOTO_WORTHY.filter(w => amenityListed(w.name, listed) && listed.some(l => norm(l) === norm(w.name)) && !proven(w.name)).map(w => ({ name: w.name, tip: 'Add a photo of ' + w.tip }))
    : []

  const conflicts: Audit['conflicts'] = []
  const p = String(parkingFact || '')
  if (p && listed.some(l => /^garage$/i.test(l.trim())) && !/garage/i.test(p.replace(/no garage/ig, ''))) {
    conflicts.push({ name: 'Garage', why: 'Listed, but the building’s parking is: ' + p.replace(/\.$/, '') })
  }
  return { analyzed, seenMissing, listedNoPhoto, conflicts }
}
