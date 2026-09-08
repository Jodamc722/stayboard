// THE PHOTO ORDER ENGINE — deterministic, explainable, and owned by code, not by the model.
//
// Jon, 2026-09-08: "full deep audit and improvement — photo order matters big time."
//
// What the audit found on a real 55-photo studio (Arya 1704/1):
//   · the model was asked to ORDER and the server then re-sorted its answer by category, so the
//     two disagreed and neither was explainable; a room's wide shots and its detail shots ended up
//     20 positions apart because category outranked room in the sort;
//   · the cover photo was never analysed at all (it was excluded from the vision call), and the
//     40-photo cap left 14 photos unseen, unordered and uncaptioned at the end;
//   · the showcase spread put two bedroom shots and a desk detail in the first five of a STUDIO,
//     because the rule ("amenity, bedroom, kitchen, living") is blind to what kind of unit it is;
//   · seven near-duplicate bedroom shots stayed in the tour even though the model flagged them;
//   · existing captions like "DSC03072" beat the AI caption because the junk detector only knew
//     UUIDs and ".jpg".
//
// The split now: the VISION pass returns FACTS per photo (room, subject, shot type, quality,
// faults, selling points, caption) — see app/api/optimize-photos. THIS file turns facts into an
// order, and every decision it makes is written back onto the photo as `placement.why`, so the
// screen can say "showcase — best kitchen shot" or "last — near-duplicate of #4" instead of
// presenting a black box.
//
// The order, in words (this string is also shown in the UI):
//   1  COVER — the host's pick (the engine ranks candidates but never overrides a human).
//   2–5 SHOWCASE — one photo per key space, wide shots only, chosen by unit type: a studio leads
//       with its view/outdoor, bathroom, kitchenette and best amenity; a 1BR+ with living, bedroom,
//       kitchen and the best amenity/view. Never two of the same room, never a detail, never stock.
//   then THE TOUR — room by room in the order a guest walks it: entry → living → dining → kitchen →
//       bedroom 1..n → bathrooms → balcony/outdoor → view. Inside a room: wide, then medium, then
//       detail, best quality first. Every photo of one room stays together — no exceptions.
//   then BUILDING — pool, gym, rooftop, lobby, other shared amenities, then the exterior.
//   last DEMOTED — near-duplicates, faulty shots (blurry, dark, signage, clutter) and stock imagery,
//       each with a reason and pre-flagged for removal.
// Everything is a pure function of the facts, so the same facts always give the same order.

// ── THE PLAYBOOK — what the order is FOR (Jon, 2026-09-08: "based on best practices in marketing,
// OTA visibility, what guests want and clicking habits… gets people to click into our listing —
// and book"). Two jobs, two parts of the set:
//
//   THE CLICK (search results). Airbnb/Vrbo/Booking show the COVER in the search card, and Airbnb
//   lets guests swipe the first ~5 photos WITHOUT opening the listing. So the cover decides the
//   click and the first five decide whether the swipe becomes a tap. Cover rules from what
//   converts: landscape, bright natural light, wide, the ONE thing this home has that neighbours
//   don't (a view, a pool, a striking room) or the best living/sleeping space; never a bathroom,
//   never a plain exterior, never a collage / text overlay / watermark (Airbnb suppresses them and
//   they read as ads), never a vertical (it gets cropped in every grid), never people.
//   The first five answer the guest's five questions in one swipe: what's special · where I sleep ·
//   where I sit · where I cook · where I bathe — one photo each, wide, best quality.
//
//   THE BOOKING (inside the listing). Guests scroll to VERIFY: every bed exists, the bathroom is
//   clean, the kitchen is real, the outdoor space is as promised. So the tour walks the home in
//   the order a guest would (entry → living → dining → kitchen → each bedroom → baths → balcony →
//   view), wide shot first so they know where they are, then detail. Airbnb's own photo tour
//   groups by room — correct room ids feed it. Building amenities and exterior come after the
//   home. Duplicates and weak shots are cut, not buried: a padded set reads as hiding something,
//   and 20–35 strong photos beat 55 mixed ones (attention drops off a cliff after ~30).
//   Close-ups are seasoning, not the meal — capped at ~15% of the tour.
//   Missing rooms cost bookings: a bedroom with no photo is a bed the guest will not trust.
//
// Every rule below cites which of these it serves.
export const PLAYBOOK = {
  targetCount: { min: 20, ideal: 30, max: 35 },
  detailShare: 0.15,          // max share of the tour that may be close-ups
  showcaseMinQuality: 60,     // a first-five photo must be at least this good
  coverMinQuality: 65,
}

export type ShotType = 'wide' | 'medium' | 'detail'
export type PhotoFacts = {
  _id: string
  url: string
  /** Stable room id from the model: "living", "bedroom-1", "bath-primary", "balcony", "pool"… */
  room: string
  category: string          // living|kitchen|dining|bedroom|bathroom|outdoor|view|amenity|exterior|detail|other
  subject: string           // "king bed with bay view" — ≤ 8 words
  shotType: ShotType
  quality: number           // 0–100, conversion quality of THIS photo
  kind: 'property' | 'stock'
  faults: string[]          // 'dark' | 'blurry' | 'clutter' | 'people' | 'watermark' | 'signage' | 'vertical' | 'tight'
  sellingPoints: string[]   // 'pool', 'ocean-view', 'balcony', 'king-bed', 'workspace', 'gym'…
  duplicateOf: string | null // _id of a stronger near-identical photo, or null
  heroWorthy: boolean
  caption: string
  captionSource: 'ai' | 'human' | 'placeholder'
  enhance?: string
  enhanceWhy?: string
}

export type Slot = 'cover' | 'showcase' | 'tour' | 'building' | 'demoted'
export type Placement = { slot: Slot; group: string; why: string; flag?: 'duplicate' | 'fault' | 'stock' | null }
export type Placed = PhotoFacts & { placement: Placement; position: number }
export type HeroCandidate = { _id: string; score: number; why: string }
export type UnitProfile = { bedrooms: number | null; bathrooms?: number | null; isStudio: boolean }

/**
 * ROOM IDS THAT AGREE WITH EACH OTHER (Jon, 2026-09-08: "need to organize rooms too, make sure it
 * organized properly"). The vision pass sees 18 photos at a time, so batch 1 may say "bedroom-1",
 * batch 2 "master-bedroom" and batch 3 "bedroom" for the same bed. This folds every spelling into
 * one vocabulary and clamps numbers to what the unit actually has: a 1-bedroom cannot have a
 * "bedroom-2", a studio's sleeping space is always "bedroom-1", one bathroom is always
 * "bath-primary". Same room → same id → the tour keeps it together.
 */
export function normalizeRoom(room: string, category: string, profile: UnitProfile): string {
  let r = rk(room).replace(/\s+/g, '-').replace(/_/g, '-').replace(/[^a-z0-9-]/g, '')
  const beds = profile.isStudio ? 1 : Math.max(1, profile.bedrooms ?? 1)
  const baths = Math.max(1, Math.ceil(profile.bathrooms ?? 1))
  if (!r) r = category || 'other'
  // Living / dining / kitchen family
  if (/^(living|livingroom|living-room|lounge-area|family|great-room|sitting)/.test(r)) return 'living'
  if (/^(dining|dinette|breakfast)/.test(r)) return 'dining'
  if (/^(kitchen|kitchenette|galley)/.test(r)) return 'kitchen'
  if (/^(entry|entrance|foyer|hallway|hall|vestibule)/.test(r)) return 'entry'
  if (/^(office|den|study|workspace|desk)/.test(r)) return 'workspace'
  if (/^(laundry|closet|storage|utility|washer)/.test(r)) return 'utility'
  // Bedrooms: any spelling → bedroom-N, clamped
  if (/^(bed|bedroom|master|primary-bed|primary|suite|sleeping|studio|guest-bed|kids|bunk)/.test(r) || category === 'bedroom') {
    let n = Number(r.match(/(\d+)/)?.[1] || 0)
    if (!n) n = /guest|second|2nd|kids|bunk/.test(r) ? 2 : /third|3rd/.test(r) ? 3 : 1
    return 'bedroom-' + Math.min(beds, Math.max(1, n))
  }
  // Bathrooms: primary first, then guest, half…; clamp to the count
  if (/^(bath|bathroom|ensuite|en-suite|powder|wc|shower|toilet|restroom)/.test(r) || category === 'bathroom') {
    const n = Number(r.match(/(\d+)/)?.[1] || 0)
    const isGuest = /guest|second|2nd|half|powder|hall/.test(r) || n >= 2
    return baths <= 1 ? 'bath-primary' : (isGuest ? 'bath-guest' : 'bath-primary')
  }
  // Unit outdoor vs building outdoor
  if (/^(balcony|terrace|patio|lanai|porch|deck-private|private-deck|yard|garden)/.test(r)) return 'balcony'
  if (/^view/.test(r) || (category === 'view' && !/pool|roof/.test(r))) return 'view'
  if (/pool|infinity|marina|beach/.test(r)) return 'pool'
  if (/roof|rooftop|sky-?deck|sundeck|deck/.test(r)) return 'rooftop'
  if (/gym|fitness|spa|sauna|wellness|yoga/.test(r)) return 'gym'
  if (/lobby|reception|entrance-hall|elevator|corridor|mailroom/.test(r)) return 'lobby'
  if (/lounge|club|coworking|cinema|theater|theatre|game|billiard/.test(r)) return 'lounge'
  if (/park|garage|bike|ev-/.test(r)) return 'parking'
  if (/exterior|building|facade|street|aerial|drone|neighborhood|neighbourhood/.test(r) || category === 'exterior') return 'exterior'
  if (category === 'outdoor') return 'balcony'
  if (category === 'amenity') return r || 'amenity'
  return r
}
export function normalizeRooms<T extends { room: string; category: string }>(facts: T[], profile: UnitProfile): T[] {
  return facts.map(f => ({ ...f, room: normalizeRoom(f.room, f.category, profile) }))
}

export const ORDER_RULE = "1 cover wins the click · 2–5 answer the guest's five questions in one swipe (what's special · where I sleep · sit · cook · bathe), one wide shot each · then the tour room by room as a guest walks it, wide → detail · then pool, gym, lobby, exterior · duplicates, close-up overload, verticals, text/collages and stock last, flagged to cut — aim for 20–35 strong photos"

// Where a room sits in the walk. Unknown rooms slot in by category.
const WALK: { re: RegExp; rank: number; label: string }[] = [
  { re: /^(entry|entrance|foyer|hall|hallway|vestibule)/, rank: 10, label: 'Entry' },
  { re: /^living/, rank: 20, label: 'Living' },
  { re: /^dining/, rank: 30, label: 'Dining' },
  { re: /^kitchen/, rank: 40, label: 'Kitchen' },
  { re: /^(bedroom|bed|master|primary-bed|suite)/, rank: 50, label: 'Bedroom' },
  { re: /^(bath|bathroom|ensuite|en-suite|powder|wc)/, rank: 60, label: 'Bathroom' },
  { re: /^(office|den|study|workspace)/, rank: 55, label: 'Workspace' },
  { re: /^(laundry|closet|storage|utility)/, rank: 65, label: 'Utility' },
  { re: /^(balcony|terrace|patio|deck|yard|garden|outdoor|porch)/, rank: 70, label: 'Balcony / outdoor' },
  { re: /^view/, rank: 75, label: 'View' },
]
const CATEGORY_RANK: Record<string, number> = { living: 20, dining: 30, kitchen: 40, bedroom: 50, bathroom: 60, outdoor: 70, view: 75, detail: 78, other: 79, amenity: 90, exterior: 95 }
const AMENITY_RANK: { re: RegExp; rank: number; label: string }[] = [
  { re: /pool|infinity|beach|marina/, rank: 90, label: 'Pool' },
  { re: /rooftop|roof|deck|sky/, rank: 91, label: 'Rooftop' },
  { re: /gym|fitness|spa|sauna|wellness/, rank: 92, label: 'Gym & spa' },
  { re: /lounge|club|coworking|game|cinema|theater|theatre/, rank: 93, label: 'Lounges' },
  { re: /lobby|entrance|reception|elevator|hallway|corridor/, rank: 94, label: 'Lobby' },
  { re: /park|garage|bike/, rank: 95, label: 'Parking' },
  { re: /exterior|building|facade|façade|street|aerial/, rank: 96, label: 'Exterior' },
]
const SHOT_RANK: Record<ShotType, number> = { wide: 0, medium: 1, detail: 2 }
const BAD_FAULTS = new Set(['blurry', 'dark', 'signage', 'people', 'watermark', 'clutter', 'text', 'collage'])
// Never on a cover, never in the first five — the grid crops or suppresses them (THE CLICK).
const COVER_KILLERS = new Set(['vertical', 'collage', 'text', 'watermark', 'people', 'blurry', 'dark', 'mirror-selfie'])

const rk = (s: string) => String(s || '').trim().toLowerCase()
function walkOf(p: PhotoFacts, profile?: UnitProfile): { rank: number; label: string } {
  const room = rk(p.room)
  // A shared space is a building amenity whatever the model called its category — a "pool-deck"
  // tagged outdoor belongs with the pool, not in the unit's tour (audit: 10 rooftop shots landed
  // mid-tour under "Outdoor" because their category was outdoor and their room was "pool-deck").
  const shared = /pool|rooftop|roof-?deck|gym|fitness|spa|sauna|lobby|lounge|coworking|cinema|garage|parking|exterior|facade|marina/
  if (shared.test(room)) {
    for (const a of AMENITY_RANK) if (a.re.test(room) || a.re.test(rk(p.subject))) return a
    return { rank: 93, label: 'Building amenities' }
  }
  // A unit room is a unit room even when the model's category says "amenity" (a desk tagged as an
  // amenity is still the workspace IN the unit) — the room id wins over the category.
  for (const w of WALK) if (w.re.test(room)) {
    // In a studio the sleeping space IS the living room — it opens the tour.
    if (profile?.isStudio && w.rank === 50) return { rank: 20, label: 'The room' }
    // bedroom-2 after bedroom-1, bath-guest after bath-primary
    const n = room.match(/(\d+)/)?.[1]
    const bump = n ? Math.min(9, Number(n)) * 0.1 : (/primary|master|main/.test(room) ? 0 : /guest|second|2nd|half|powder/.test(room) ? 0.5 : 0.2)
    return { rank: w.rank + bump, label: w.label + (n ? ' ' + n : (/primary|master|main/.test(room) && w.rank === 60 ? ' (primary)' : /guest|half|powder/.test(room) && w.rank === 60 ? ' (guest)' : '')) }
  }
  if (p.category === 'amenity' || p.category === 'exterior') {
    for (const a of AMENITY_RANK) if (a.re.test(room) || a.re.test(rk(p.subject))) return a
    return { rank: p.category === 'exterior' ? 96 : 93, label: p.category === 'exterior' ? 'Exterior' : 'Building amenities' }
  }
  const c = CATEGORY_RANK[p.category] ?? 79
  return { rank: c, label: p.category ? p.category[0].toUpperCase() + p.category.slice(1) : 'Other' }
}

/** Is this photo good enough to be seen early? Wide, decent quality, no disqualifying fault. */
function showable(p: PhotoFacts): boolean {
  return p.kind === 'property' && !p.duplicateOf && p.shotType !== 'detail' && p.quality >= PLAYBOOK.showcaseMinQuality && !p.faults.some(f => BAD_FAULTS.has(f) || f === 'vertical')
}

/** Score a photo as a COVER. Wide, bright, a space or a view a guest books for. */
export function heroScore(p: PhotoFacts): number {
  if (p.kind !== 'property' || p.duplicateOf) return 0
  // Quality carries ~70% of the score so candidates spread out instead of all hitting 100.
  let s = p.quality * 0.7
  if (p.shotType === 'wide') s += 12; else if (p.shotType === 'detail') s -= 30
  if (p.heroWorthy) s += 8
  const sp = p.sellingPoints.join(' ')
  if (/ocean|bay|water|view|skyline|sunset/.test(sp)) s += 7
  if (/pool|rooftop/.test(sp) && p.category === 'amenity') s += 3
  if (p.category === 'living' || p.category === 'bedroom') s += 4
  if (p.category === 'bathroom' || p.category === 'detail' || p.category === 'exterior') s -= 12
  if (p.category === 'kitchen') s -= 6
  // Differentiators win clicks: a view, a pool, a rooftop, a striking feature the neighbours lack.
  if (/infinity|rooftop|ocean|bay|skyline|sunset|private-pool|hot-tub|fireplace|floor-to-ceiling/.test(sp)) s += 6
  // Cover killers: the grid crops verticals, Airbnb suppresses collages/text, people read as ads.
  for (const f of p.faults) { if (COVER_KILLERS.has(f)) s -= 35; else if (BAD_FAULTS.has(f)) s -= 15 }
  if (p.quality < PLAYBOOK.coverMinQuality) s -= 10
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function rankHeroes(photos: PhotoFacts[], limit = 4): HeroCandidate[] {
  return photos
    .map(p => ({ _id: p._id, score: heroScore(p), why: `${p.subject || p.category}${p.shotType === 'wide' ? ' · wide' : ''} · quality ${p.quality}` }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// The showcase recipe by unit type: which spaces get a seat in positions 2–5, in priority order.
// Each entry is a predicate; the first showable photo that matches (highest quality first) takes
// the seat. A space with no showable photo gives its seat to the next strongest wide shot.
function showcaseRecipe(profile: UnitProfile): { label: string; test: (p: PhotoFacts) => boolean }[] {
  const isView = (p: PhotoFacts) => p.category === 'view' || (p.category === 'outdoor' && /view|ocean|bay|water|skyline/.test(p.sellingPoints.join(' ')))
  const isAmenity = (p: PhotoFacts) => p.category === 'amenity' && /pool|rooftop|infinity/.test(rk(p.room) + ' ' + rk(p.subject) + ' ' + p.sellingPoints.join(' '))
  const isKitchen = (p: PhotoFacts) => p.category === 'kitchen'
  const isLiving = (p: PhotoFacts) => p.category === 'living'
  const isBedroom = (p: PhotoFacts) => p.category === 'bedroom'
  const isBath = (p: PhotoFacts) => p.category === 'bathroom'
  const isOutdoor = (p: PhotoFacts) => p.category === 'outdoor'
  // The five questions a guest swipes to answer, in the order that earns the tap:
  // what's special → where I sleep → where I sit → where I cook → where I bathe.
  const special = { label: "what's special (view, pool, rooftop)", test: (p: PhotoFacts) => isView(p) || isAmenity(p) || isOutdoor(p) }
  if (profile.isStudio) {
    // A studio's bedroom IS its living room — one wide shot of it is the cover or seat 2, not both.
    return [
      { label: 'shot of the room (where I sleep & sit)', test: (p) => isBedroom(p) || isLiving(p) },
      special,
      { label: 'kitchenette (where I cook)', test: isKitchen },
      { label: 'bathroom (where I bathe)', test: isBath },
      { label: 'balcony or view', test: (p) => isOutdoor(p) || isView(p) },
    ]
  }
  return [
    special,
    { label: 'main bedroom (where I sleep)', test: isBedroom },
    { label: 'living area (where I sit)', test: isLiving },
    { label: 'kitchen (where I cook)', test: isKitchen },
    { label: 'bathroom (where I bathe)', test: isBath },
    { label: 'balcony or view', test: (p) => isOutdoor(p) || isView(p) },
  ]
}

/**
 * Build the order. `heroId` is the human's cover (or null to let the engine pick the top candidate).
 * Returns the placed photos in order plus the cover candidates and the sections for the UI.
 */
export function buildOrder(facts: PhotoFacts[], heroId: string | null, profile: UnitProfile): { placed: Placed[]; heroCandidates: HeroCandidate[]; sections: { slot: Slot; label: string; ids: string[] }[] } {
  const byId = new Map(facts.map(p => [p._id, p]))
  const heroCandidates = rankHeroes(facts)
  const hero = (heroId && byId.get(heroId)) || (heroCandidates[0] && byId.get(heroCandidates[0]._id)) || facts[0]
  const used = new Set<string>([hero._id])
  const placed: Placed[] = []
  const push = (p: PhotoFacts, placement: Placement) => { placed.push({ ...p, placement, position: placed.length + 1 }) }

  // Mark near-duplicates from the model's flag, but only when the "original" is a real, stronger photo.
  const dupOf = (p: PhotoFacts): PhotoFacts | null => {
    if (!p.duplicateOf) return null
    const o = byId.get(p.duplicateOf)
    if (!o || o._id === p._id) return null
    return o.quality >= p.quality - 5 ? o : null
  }

  push(hero, { slot: 'cover', group: 'Cover', why: heroId ? 'your cover photo' : `engine pick — ${heroCandidates[0]?.why || 'strongest wide shot'}` })

  // ── SHOWCASE: one seat per space, wide shots only, best quality first. The hero's own room is
  // skipped so the first five are five different spaces.
  const heroRoom = rk(hero.room)
  const seatsWanted = 4
  const recipe = showcaseRecipe(profile)
  const pool = facts.filter(p => !used.has(p._id) && showable(p) && !dupOf(p)).sort((a, b) => b.quality - a.quality)
  const takenRooms = new Set<string>([heroRoom])
  const sameSpace = (p: PhotoFacts) => takenRooms.has(rk(p.room)) || (profile.isStudio && (p.category === 'bedroom' || p.category === 'living') && (hero.category === 'bedroom' || hero.category === 'living'))
  for (const seat of recipe) {
    if (placed.length - 1 >= seatsWanted) break
    const pick = pool.find(p => !used.has(p._id) && seat.test(p) && !sameSpace(p))
    if (!pick) continue
    used.add(pick._id); takenRooms.add(rk(pick.room))
    push(pick, { slot: 'showcase', group: 'Showcase', why: `showcase — best ${seat.label}${pick.shotType === 'wide' ? ', wide' : ''} · quality ${pick.quality}` })
  }
  // Seats still empty → next strongest wide shots of rooms not yet shown.
  for (const p of pool) {
    if (placed.length - 1 >= seatsWanted) break
    if (used.has(p._id) || sameSpace(p)) continue
    used.add(p._id); takenRooms.add(rk(p.room))
    push(p, { slot: 'showcase', group: 'Showcase', why: `showcase — strongest remaining wide shot (${p.subject || p.category}) · quality ${p.quality}` })
  }

  // ── THE TOUR + BUILDING: every remaining photo grouped by room in walk order; wide → detail;
  // duplicates, faults and stock fall to the end with a reason.
  const rest = facts.filter(p => !used.has(p._id))
  // How many usable photos each room has — the ONLY photo of a room is never demoted, however
  // weak: a dark kitchenette beats no kitchenette (the guest needs to know it exists).
  const roomCount: Record<string, number> = {}
  for (const p of facts) if (p.kind === 'property' && !dupOf(p)) roomCount[rk(p.room)] = (roomCount[rk(p.room)] || 0) + 1
  const demoted: { p: PhotoFacts; why: string; flag: Placement['flag'] }[] = []
  const tour: { p: PhotoFacts; walk: { rank: number; label: string } }[] = []
  for (const p of rest) {
    const d = dupOf(p)
    if (p.kind === 'stock') { demoted.push({ p, why: 'stock / location imagery — not this home', flag: 'stock' }); continue }
    if (d) { demoted.push({ p, why: `near-duplicate of a stronger shot (${d.subject || d.room})`, flag: 'duplicate' }); continue }
    const bad = p.faults.filter(f => BAD_FAULTS.has(f))
    if (bad.length && p.quality < 50 && (roomCount[rk(p.room)] || 0) > 1) { demoted.push({ p, why: `weak shot — ${bad.join(', ')} · quality ${p.quality}`, flag: 'fault' }); continue }
    tour.push({ p, walk: walkOf(p, profile) })
  }
  // Within a room: wide → medium → detail, then quality. Rooms in walk order, then by the room's
  // best photo so a strong bedroom-2 does not outrank bedroom-1 (numbers already order them).
  tour.sort((a, b) => (a.walk.rank - b.walk.rank) || (rk(a.p.room).localeCompare(rk(b.p.room))) || (SHOT_RANK[a.p.shotType] - SHOT_RANK[b.p.shotType]) || (b.p.quality - a.p.quality))
  // Close-ups are seasoning: past ~15% of the tour they stop adding information and start diluting
  // it (THE BOOKING). The strongest details stay in their rooms; the rest are cut with a reason.
  const tourOnly = tour.filter(t => t.walk.rank < 90)
  const detailCap = Math.max(2, Math.round(tourOnly.length * PLAYBOOK.detailShare))
  const detailsRanked = tourOnly.filter(t => t.p.shotType === 'detail').sort((a, b) => b.p.quality - a.p.quality)
  const detailCut = new Set(detailsRanked.slice(detailCap).map(t => t.p._id))
  // Verticals get cropped in every grid — they close their room group rather than open it.
  tour.sort((a, b) => (a.walk.rank - b.walk.rank) || (rk(a.p.room).localeCompare(rk(b.p.room))) || ((a.p.faults.includes('vertical') ? 1 : 0) - (b.p.faults.includes('vertical') ? 1 : 0)) || (SHOT_RANK[a.p.shotType] - SHOT_RANK[b.p.shotType]) || (b.p.quality - a.p.quality))
  for (const t of tour) {
    if (detailCut.has(t.p._id)) { demoted.push({ p: t.p, why: `one close-up too many — ${detailsRanked.length} details in a ${tourOnly.length}-photo tour; keep the best ${detailCap}`, flag: 'fault' }); continue }
    const isBuilding = t.walk.rank >= 90
    const bad = t.p.faults.filter(f => BAD_FAULTS.has(f) || f === 'vertical')
    push(t.p, {
      slot: isBuilding ? 'building' : 'tour', group: t.walk.label,
      why: `${isBuilding ? 'building' : 'tour'} — ${t.walk.label.toLowerCase()}, ${t.p.shotType}${bad.length ? ' (' + bad.join(', ') + ')' : ''} · quality ${t.p.quality}`,
      flag: bad.length ? 'fault' : null,
    })
  }
  for (const d of demoted.sort((a, b) => (a.flag === 'stock' ? 1 : 0) - (b.flag === 'stock' ? 1 : 0) || b.p.quality - a.p.quality)) {
    push(d.p, { slot: 'demoted', group: 'Consider removing', why: d.why, flag: d.flag })
  }

  const sections: { slot: Slot; label: string; ids: string[] }[] = []
  for (const p of placed) {
    const label = p.placement.slot === 'cover' ? 'Cover' : p.placement.slot === 'showcase' ? 'Showcase' : p.placement.slot === 'demoted' ? 'Consider removing' : p.placement.group
    const last = sections[sections.length - 1]
    if (last && last.slot === p.placement.slot && last.label === label) last.ids.push(p._id)
    else sections.push({ slot: p.placement.slot, label, ids: [p._id] })
  }
  return { placed, heroCandidates, sections }
}

export type Check = { key: string; ok: boolean | null; label: string; detail: string }
/**
 * THE MARKETING CHECK — does this set do the two jobs? Pass/fail per rule, in guest-facing words,
 * so the operator sees WHY the score is what it is and what to shoot or cut next.
 */
export function marketingChecks(placed: Placed[], profile: UnitProfile): Check[] {
  const out: Check[] = []
  const cover = placed[0]
  const property = placed.filter(p => p.kind === 'property')
  const kept = placed.filter(p => p.placement.slot !== 'demoted')
  const showcase = placed.filter(p => p.placement.slot === 'showcase')
  // 1. The cover earns the click
  if (cover) {
    const killers = cover.faults.filter(f => COVER_KILLERS.has(f))
    const weak = cover.category === 'bathroom' || cover.category === 'exterior' || cover.shotType === 'detail' || cover.kind === 'stock'
    const ok = !killers.length && !weak && cover.quality >= PLAYBOOK.coverMinQuality
    out.push({ key: 'cover', ok, label: 'Cover earns the click', detail: ok ? `${cover.subject || cover.category} · quality ${cover.quality} — wide, bright, a space guests book for.` : killers.length ? `Your cover is ${killers.join(' + ')} — grids crop verticals and Airbnb suppresses collages/text; guests scroll past it.` : weak ? `A ${cover.category}${cover.shotType === 'detail' ? ' close-up' : ''} does not sell the home from a search card.` : `Cover quality ${cover.quality} is below ${PLAYBOOK.coverMinQuality} — a brighter, wider shot lifts click-through.` })
  }
  // 2. First five answer the five questions
  const rooms5 = new Set(showcase.map(p => rk(p.room)))
  out.push({ key: 'five', ok: showcase.length >= 4 && rooms5.size === showcase.length, label: 'First five show five different spaces', detail: showcase.length < 4 ? `Only ${showcase.length + 1} strong wide shots for the opening swipe — shoot the missing spaces wide and bright.` : `${showcase.map(p => p.placement.why.replace(/^showcase — best /, '').replace(/ · quality \d+$/, '')).join(' · ')}` })
  // 3. Every bed is shown
  const beds = profile.isStudio ? 1 : (profile.bedrooms ?? 1)
  const bedRooms = new Set(property.filter(p => /^bedroom/.test(rk(p.room)) && p.placement.slot !== 'demoted').map(p => rk(p.room)))
  const bedsOk = bedRooms.size >= Math.max(1, beds)
  out.push({ key: 'beds', ok: bedsOk, label: beds > 1 ? `All ${beds} bedrooms photographed` : 'Sleeping space photographed', detail: bedsOk ? `${bedRooms.size} of ${beds} shown, wide shot first.` : `${bedRooms.size} of ${beds} bedrooms have a photo — a bed guests cannot see is a bed they will not book.` })
  // 4. Kitchen + bathroom shown (the trust shots)
  const hasK = kept.some(p => p.category === 'kitchen'); const hasB = kept.some(p => p.category === 'bathroom')
  out.push({ key: 'trust', ok: hasK && hasB, label: 'Kitchen and bathroom shown', detail: hasK && hasB ? 'Both present — guests verify these before booking.' : `Missing ${[!hasK && 'kitchen', !hasB && 'bathroom'].filter(Boolean).join(' and ')} — the two rooms guests check for cleanliness and reality.` })
  // 5. No duplicates / padding
  const dups = placed.filter(p => p.placement.flag === 'duplicate').length
  out.push({ key: 'dupes', ok: dups === 0, label: 'No near-duplicates', detail: dups ? `${dups} flagged — repeats read as padding; remove them.` : 'Every photo adds something new.' })
  // 6. Count in the sweet spot
  const n = kept.length
  const okN = n >= PLAYBOOK.targetCount.min && n <= PLAYBOOK.targetCount.max
  out.push({ key: 'count', ok: okN, label: `${PLAYBOOK.targetCount.min}–${PLAYBOOK.targetCount.max} photos after cuts`, detail: `${n} would remain after the flagged removals (${placed.length} now)${n > PLAYBOOK.targetCount.max ? ' — attention drops off after ~30; cut weaker angles' : n < PLAYBOOK.targetCount.min ? ' — shoot more wide shots of each room' : ''}.` })
  // 7. Orientation / overlays
  const vert = kept.filter(p => p.faults.includes('vertical')).length
  const overlays = kept.filter(p => p.faults.some(f => f === 'collage' || f === 'text' || f === 'watermark')).length
  out.push({ key: 'format', ok: vert === 0 && overlays === 0, label: 'Landscape, no text or collages', detail: (vert || overlays) ? `${vert ? vert + ' vertical' : ''}${vert && overlays ? ', ' : ''}${overlays ? overlays + ' with text/collage/watermark' : ''} — grids crop verticals; Airbnb may hide overlays.` : 'All landscape, clean frames.' })
  return out
}

/** The three or four strongest photographed features, for the title writer. */
export function titleHooks(facts: PhotoFacts[], limit = 4): { hook: string; strength: number }[] {
  const score: Record<string, number> = {}
  for (const p of facts) {
    if (p.kind !== 'property') continue
    for (const s of p.sellingPoints) { const k = rk(s); if (!k) continue; score[k] = (score[k] || 0) + Math.max(1, p.quality / 25) }
  }
  return Object.keys(score).map(k => ({ hook: k, strength: Math.round(score[k] * 10) / 10 })).sort((a, b) => b.strength - a.strength).slice(0, limit)
}

/** Existing Guesty captions that are not captions: filenames, ids, camera names, bare numbers. */
export function isJunkCaption(s: string): boolean {
  const t = String(s || '').trim()
  if (!t) return true
  if (/^[0-9a-f-]{16,}$/i.test(t)) return true
  if (/\.(jpe?g|png|webp|gif|heic)$/i.test(t)) return true
  if (/^(dsc|img|dcim|pxl|mvimg|photo|image|screenshot|whatsapp|snapchat|untitled)[\s_-]?\d*/i.test(t)) return true
  if (/^[\d_\-\s.]+$/.test(t)) return true
  if (!/\s/.test(t) && /\d{3,}/.test(t)) return true   // "IMG20240117", "P1040238"
  return false
}
