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
//   The first five answer the guest's questions in one swipe: what's special · where I sleep ·
//   where I sit · where I cook · the outdoor space — one photo each, wide, best quality. Since
//   2026-11-25 each of the five is held to the cover's standard (Airbnb may show any of them on the
//   search card), so an ordinary bathroom waits for the tour, and a unit's five are kept distinct
//   from its sister units' (see SISTER UNITS below).
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
  /** Amenities from the house vocabulary this photo plainly shows (toaster, crib, BBQ grill…). */
  amenitiesSeen?: string[]
  /** A 64-bit difference hash of the image (16 hex). The same photo on a sister unit has (nearly) the same hash. */
  hash?: string
  /** 0–100 from the analyst: how specific this photo is to THIS unit (its own room, its own view) rather than
   *  something every unit in the building also shows (the pool, the lobby, a generic skyline). */
  distinct?: number
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

export const ORDER_RULE = "1 cover wins the click · 2–5 are four more photos that could each be the cover (what's special · where I sleep · sit · cook · the outdoor space), one wide shot each, and not the same opening as a sister unit · then the tour room by room as a guest walks it, wide → detail · then pool, gym, lobby, exterior · duplicates, close-up overload, verticals, text/collages and stock last, flagged to cut — aim for 20–35 strong photos"

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
// Airbnb crops the search card to a centred square (its own photo guide: "keep key subjects centered").
// A photo whose subject sits at the edge loses it there. Not a reason to cut it from the tour.
const EDGE = 'edge-subject'

// ── SISTER UNITS: ONE BUILDING, DISTINCT OPENINGS ───────────────────────────────────────────────
// Jon, 2026-11-25: "audit the way we decide the first 5 photos … if same building please switch it up
// and make sure that is on the model. Need to be distinct."
//
// What the audit found (live data, 2026-11-25): the engine ranked every listing alone. A building's
// units share its pool, rooftop and lobby photos, and those carry the cover bonuses, so sister units
// converge on one opening. 9 of 28 Arya listings led with the pool and one photo file sat in the first
// five of 12 of them; 7 of 13 Capri listings led with the pool; 39 of 53 Botanica rooms led with the
// same kind of bedroom shot and 17 shared a cover file. In search that reads as one listing repeated:
// the guest cannot tell the units apart, and our own units compete for one click.
//
// The rule now. A sister unit's opening (its cover and first five, live or just proposed) is an input:
//   · the SAME PHOTO as a sister unit's cover is never this unit's cover while another strong shot exists;
//   · a SCENE (the pool, the rooftop, "the bedroom") may lead about a third of a building; past that
//     each further unit pays for choosing it, shared spaces more than the unit's own rooms;
//   · a photo that is specific to this unit (the analyst's `distinct`) is preferred for the cover over
//     one every unit could show;
//   · in seats 2–5 a photo sister units already use in their five gives way to an equally good one they
//     do not, and the second photo (the first swipe) is not the scene most sister units put second.
// The same photo is recognised by its hash (`hamming`), so it matches even when each unit uploaded its
// own copy. Units still LOOK like one building; they just do not open with the same frame.
export type SiblingShot = { hash?: string; scene: string }
/** One sister unit's opening. `five[0]` is its cover. */
export type SiblingOpening = { name: string; five: SiblingShot[] }
const SHARED_SCENE = /^(pool|rooftop|gym|lobby|lounge|parking|exterior|amenity)$/
/** Bits that differ between two hashes; 64 when either is missing. */
export function hamming(a?: string, b?: string): number {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64
  let n = 0
  for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); if (Number.isNaN(x)) return 64; while (x) { n += x & 1; x >>= 1 } }
  return n
}
/** Two hashes this close are the same photograph (a re-upload, a resize, a light edit). */
export const SAME_SHOT_BITS = 8
export const sameShot = (a?: string, b?: string) => hamming(a, b) <= SAME_SHOT_BITS
/** The scene a photo stands for when units are compared: the shared space, or the unit's room. */
export function sceneOf(p: { room: string; category: string }): string {
  const r = rk(p.room)
  if (/pool|marina|beach/.test(r)) return 'pool'
  if (/roof|sky-?deck|sundeck/.test(r)) return 'rooftop'
  if (/gym|fitness|spa|sauna/.test(r)) return 'gym'
  if (/lobby|reception|elevator|corridor/.test(r)) return 'lobby'
  if (/lounge|club|coworking|cinema|game/.test(r)) return 'lounge'
  if (/park|garage/.test(r)) return 'parking'
  if (/exterior|facade|building|street|aerial/.test(r) || p.category === 'exterior') return 'exterior'
  if (/^bedroom/.test(r)) return 'bedroom'
  if (/^bath/.test(r)) return 'bathroom'
  if (r) return r
  return p.category === 'amenity' ? 'amenity' : rk(p.category) || 'other'
}
const SCENE_WORDS: Record<string, string> = { pool: 'the pool', rooftop: 'the rooftop', gym: 'the gym', lobby: 'the lobby', lounge: 'a lounge', parking: 'the garage', exterior: 'the exterior', bedroom: 'a bedroom', bathroom: 'a bathroom', living: 'the living room', kitchen: 'the kitchen', dining: 'the dining area', balcony: 'the balcony', view: 'the view', workspace: 'the desk', entry: 'the entry', amenity: 'a building amenity' }
export const sceneWords = (scene: string) => SCENE_WORDS[scene] || 'the ' + scene.replace(/-/g, ' ')
/** A scene may lead this share of a building before another unit choosing it pays. */
export const SCENE_SHARE_FREE = 1 / 3
export type SiblingRead = { n: number; sameCover: string[]; sceneCover: number; inFives: number; scene: string }
/** How a photo sits against the sister units' openings. */
export function siblingRead(p: PhotoFacts, sibs: SiblingOpening[] | undefined): SiblingRead {
  const scene = sceneOf(p)
  const out: SiblingRead = { n: 0, sameCover: [], sceneCover: 0, inFives: 0, scene }
  for (const s of sibs || []) {
    if (!s.five.length) continue
    out.n++
    const c = s.five[0]
    if (sameShot(p.hash, c.hash)) out.sameCover.push(s.name)
    if (c.scene && c.scene === scene) out.sceneCover++
    if (s.five.some(x => sameShot(p.hash, x.hash))) out.inFives++
  }
  return out
}
/** What choosing this photo as the COVER costs, given the sister units. 0 with no sister units. */
export function coverCrowding(p: PhotoFacts, sibs: SiblingOpening[] | undefined): number {
  const r = siblingRead(p, sibs)
  if (!r.n) return 0
  let cost = 0
  if (r.sameCover.length) cost += 30
  const over = r.sceneCover / r.n - SCENE_SHARE_FREE
  if (over > 0) cost += Math.round(over * (SHARED_SCENE.test(r.scene) ? 60 : 24))
  if (typeof p.distinct === 'number') { if (p.distinct < 60) cost += Math.round((60 - p.distinct) / 6); else if (p.distinct >= 85) cost -= 4 }
  return cost
}
/** What choosing this photo for seats 2–5 costs, given the sister units. */
export function showcaseCrowding(p: PhotoFacts, sibs: SiblingOpening[] | undefined): number {
  const r = siblingRead(p, sibs)
  if (!r.n) return 0
  return (r.sameCover.length ? 8 : 0) + Math.min(12, r.inFives * 3)
}

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
export function heroScore(p: PhotoFacts, sibs?: SiblingOpening[]): number {
  if (p.kind !== 'property' || p.duplicateOf) return 0
  // Quality carries ~70% of the score so candidates spread out instead of all hitting 100.
  let s = p.quality * 0.7
  if (p.shotType === 'wide') s += 12; else if (p.shotType === 'detail') s -= 30
  if (p.heroWorthy) s += 8
  const sp = p.sellingPoints.join(' ')
  if (/ocean|bay|water|view|skyline|sunset/.test(sp)) s += 7
  // South Florida books on water and pools: a bright pool deck or a balcony view is a real cover
  // contender, not a building shot to bury (audit 2026-10-26).
  if (/pool|rooftop/.test(sp) && (p.category === 'amenity' || p.category === 'outdoor')) s += 6
  if (p.category === 'view' || p.category === 'outdoor') s += 5
  if (p.category === 'living' || p.category === 'bedroom') s += 4
  const scenicExterior = p.category === 'exterior' && /ocean|bay|water|pool|beach/.test(sp)
  if (p.category === 'bathroom' || p.category === 'detail' || (p.category === 'exterior' && !scenicExterior)) s -= 12
  if (p.category === 'kitchen') s -= 6
  // Differentiators win clicks: a view, a pool, a rooftop, a striking feature the neighbours lack.
  if (/infinity|rooftop|ocean|bay|skyline|sunset|private-pool|hot-tub|fireplace|floor-to-ceiling/.test(sp)) s += 6
  // Cover killers: the grid crops verticals, Airbnb suppresses collages/text, people read as ads.
  for (const f of p.faults) { if (COVER_KILLERS.has(f)) s -= 35; else if (BAD_FAULTS.has(f)) s -= 15; else if (f === EDGE) s -= 12 }
  if (p.quality < PLAYBOOK.coverMinQuality) s -= 10
  s -= coverCrowding(p, sibs)
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function rankHeroes(photos: PhotoFacts[], limit = 4, sibs?: SiblingOpening[]): HeroCandidate[] {
  return photos
    .map(p => ({ _id: p._id, score: heroScore(p, sibs), why: `${p.subject || p.category}${p.shotType === 'wide' ? ' · wide' : ''} · quality ${p.quality}` }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// THE FIRST FIVE, BY SCORE (Jon, 2026-10-26: "need smarter first 5, we need best photos").
// It used to be a fixed recipe — the best "special" shot, then the best bedroom, living room,
// kitchen, bathroom — filled in that order, so a 61-quality bathroom took seat 5 over a stunning
// second view. Now every showable photo competes on what it is worth in the opening swipe
// (quality, wide, what it proves), plus a bonus for showing a SPACE the five do not show yet and a
// penalty for repeating one. The result is the five best photos that still tour the home.
export type SpaceType = 'special' | 'amenity' | 'bedroom' | 'living' | 'kitchen' | 'outdoor' | 'bath' | 'other'
export function spaceType(p: PhotoFacts, studio = false): SpaceType {
  const sp = p.sellingPoints.join(' ') + ' ' + rk(p.room) + ' ' + rk(p.subject)
  // A view and a pool are two different reasons to book — both can earn a seat.
  if ((p.category === 'amenity' && /pool|rooftop|infinity|hot-tub|beach|gym/.test(sp)) || (p.category === 'outdoor' && /pool|hot-tub|spa\b/.test(sp))) return 'amenity'
  if (p.category === 'view' || (p.category === 'outdoor' && /view|ocean|bay|water|skyline/.test(sp))) return 'special'
  if (studio && (p.category === 'bedroom' || p.category === 'living')) return 'living'
  if (p.category === 'bedroom') return 'bedroom'
  if (p.category === 'living' || p.category === 'dining') return 'living'
  if (p.category === 'kitchen') return 'kitchen'
  if (p.category === 'outdoor') return 'outdoor'
  if (p.category === 'bathroom') return 'bath'
  return 'other'
}
export const SPACE_LABEL: Record<SpaceType, string> = { special: 'the view', amenity: 'pool / rooftop', bedroom: 'where I sleep', living: 'where I sit', kitchen: 'where I cook', outdoor: 'balcony / outdoor', bath: 'where I bathe', other: 'other' }
// ANY OF THE FIVE CAN BE THE COVER (audit 2026-11-25). Airbnb's help page calls the first five the
// photos "prominently displayed", and since its 2026 Summer Release hosts report search showing one of
// the first five instead of the chosen cover. So a seat in the five is held to the cover's standard:
// a bathroom earns one only when it is a feature in its own right (a soaking tub, a hero-grade shot);
// an ordinary clean bathroom belongs in the tour, where guests go to verify it.
const SPACE_BONUS: Record<SpaceType, number> = { special: 14, amenity: 11, bedroom: 12, living: 10, kitchen: 9, outdoor: 7, bath: -8, other: 0 }
const featureBath = (p: PhotoFacts) => p.quality >= 80 && (p.heroWorthy || /soaking-tub|freestanding|spa-bath/.test(p.sellingPoints.join(' ')))
/** What a photo is worth in positions 2–5 on its own — before diversity. */
export function showcaseScore(p: PhotoFacts): number {
  if (p.kind !== 'property' || p.duplicateOf) return 0
  let s = p.quality * 0.75
  s += p.shotType === 'wide' ? 12 : p.shotType === 'medium' ? 3 : -25
  if (p.heroWorthy) s += 5
  if (/infinity|rooftop|ocean|bay|skyline|sunset|pool|hot-tub|king-bed|floor-to-ceiling|balcony/.test(p.sellingPoints.join(' '))) s += 6
  for (const f of p.faults) { if (COVER_KILLERS.has(f)) s -= 30; else if (BAD_FAULTS.has(f)) s -= 12; else if (f === EDGE) s -= 8 }
  return Math.max(0, Math.round(s))
}
/** The engine's best four seats after `taken` (cover + any fixed seats), with a reason each. */
export function pickShowcase(pool: PhotoFacts[], taken: PhotoFacts[], seats: number, studio = false, sibs?: SiblingOpening[]): { p: PhotoFacts; why: string; score: number }[] {
  const rooms = new Set(taken.map(t => rk(t.room)))
  const types = new Map<SpaceType, number>()
  for (const t of taken) { const k = spaceType(t, studio); types.set(k, (types.get(k) || 0) + 1) }
  const out: { p: PhotoFacts; why: string; score: number }[] = []
  const used = new Set(taken.map(t => t._id))
  while (out.length < seats) {
    let best: { p: PhotoFacts; score: number; t: SpaceType } | null = null
    for (const p of pool) {
      if (used.has(p._id) || rooms.has(rk(p.room))) continue
      const t = spaceType(p, studio)
      const seen = types.get(t) || 0
      const sc = showcaseScore(p) + (seen ? -10 * seen : t === 'bath' && featureBath(p) ? 4 : SPACE_BONUS[t]) - showcaseCrowding(p, sibs)
      if (sc > 0 && (!best || sc > best.score)) best = { p, score: sc, t }
    }
    if (!best) break
    used.add(best.p._id); rooms.add(rk(best.p.room)); types.set(best.t, (types.get(best.t) || 0) + 1)
    out.push({ p: best.p, score: best.score, why: `best photo for ${SPACE_LABEL[best.t]} — ${best.p.subject || best.p.category}${best.p.shotType === 'wide' ? ', wide' : ''} · quality ${best.p.quality}` })
  }
  // THE FIRST SWIPE DIFFERS TOO. When most sister units put the same scene second, the best of this
  // unit's other picks takes the second seat, as long as it is about as strong (within 10 points).
  const live = (sibs || []).filter(s => s.five.length > 1)
  if (out.length > 1 && live.length >= 2) {
    const second = (scene: string) => live.filter(s => s.five[1].scene && s.five[1].scene === scene).length
    const lead = out[0], crowd = second(sceneOf(lead.p))
    if (crowd / live.length > 0.5) {
      const alt = out.slice(1).filter(x => lead.score - x.score <= 10 && second(sceneOf(x.p)) < crowd).sort((a, b) => second(sceneOf(a.p)) - second(sceneOf(b.p)) || b.score - a.score)[0]
      if (alt) { out.splice(out.indexOf(alt), 1); out.unshift({ ...alt, why: alt.why + ` · second here because ${crowd} of ${live.length} sister units show ${sceneWords(sceneOf(lead.p))} second` }) }
    }
  }
  return out
}

/**
 * Build the order. `heroId` is the human's cover (or null to let the engine pick the top candidate).
 * Returns the placed photos in order plus the cover candidates and the sections for the UI.
 */
export type BuildOpts = {
  /** Positions 2–5 chosen by the host, in order. The engine fills any seat left empty (Jon,
   *  2026-09-08: "allow me to organize the first five photos, which I would call your cover photos"). */
  showcase?: string[]
  /** The sister units' openings (same building). The engine keeps this unit's opening distinct from them. */
  siblings?: SiblingOpening[]
  /** The `heroId` passed in was chosen by the engine a step earlier (not by a person), so its reason says so. */
  enginePicked?: boolean
}
export function buildOrder(facts: PhotoFacts[], heroId: string | null, profile: UnitProfile, opts: BuildOpts = {}): { placed: Placed[]; heroCandidates: HeroCandidate[]; sections: { slot: Slot; label: string; ids: string[] }[] } {
  const byId = new Map(facts.map(p => [p._id, p]))
  const sibs = opts.siblings && opts.siblings.length ? opts.siblings : undefined
  const heroCandidates = rankHeroes(facts, 4, sibs)
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

  // When the sister units changed the pick, the reason says so.
  const byEngine = !heroId || !!opts.enginePicked
  let coverWhy = byEngine ? `engine pick — ${heroCandidates.find(c => c._id === hero._id)?.why || heroCandidates[0]?.why || 'strongest wide shot'}` : 'your cover photo'
  if (sibs && byEngine) {
    const alone = rankHeroes(facts, 1)[0], lone = alone && byId.get(alone._id)
    if (lone && lone._id !== hero._id) {
      const r = siblingRead(lone, sibs)
      const because = r.sameCover.length ? `${r.sameCover.slice(0, 2).join(' and ')}${r.sameCover.length > 2 ? ` and ${r.sameCover.length - 2} more` : ''} already ${r.sameCover.length === 1 ? 'uses' : 'use'} the top-scoring photo as ${r.sameCover.length === 1 ? 'its' : 'their'} cover`
        : r.sceneCover ? `${r.sceneCover} of ${r.n} sister units already open with ${sceneWords(r.scene)}` : 'the top-scoring photo is one every unit in the building shows'
      coverWhy += ` · distinct from the building: ${because}`
    }
  }
  push(hero, { slot: 'cover', group: 'Cover', why: coverWhy })

  // ── SHOWCASE: one seat per space, wide shots only, best quality first. The hero's own room is
  // skipped so the first five are five different spaces.
  const heroRoom = rk(hero.room)
  const seatsWanted = 4
  const pool = facts.filter(p => !used.has(p._id) && showable(p) && !dupOf(p)).sort((a, b) => b.quality - a.quality)
  const takenRooms = new Set<string>([heroRoom])
  const sameSpace = (p: PhotoFacts) => takenRooms.has(rk(p.room)) || (profile.isStudio && (p.category === 'bedroom' || p.category === 'living') && (hero.category === 'bedroom' || hero.category === 'living'))
  // The host's own picks for 2–5 come first, exactly as ordered; the recipe only fills what is left.
  for (const id of (opts.showcase || [])) {
    if (placed.length - 1 >= seatsWanted) break
    const p = byId.get(id)
    if (!p || used.has(id)) continue
    used.add(id); takenRooms.add(rk(p.room))
    push(p, { slot: 'showcase', group: 'Showcase', why: `your pick — ${p.subject || p.category}${p.shotType === 'wide' ? ', wide' : ''} · quality ${p.quality}` })
  }
  // The engine fills what the host left: the best remaining photos that still tour the home.
  const fixed = placed.map(x => byId.get(x._id) as PhotoFacts).filter(Boolean)
  for (const pick of pickShowcase(pool.filter(p => !sameSpace(p)), fixed, seatsWanted - (placed.length - 1), profile.isStudio, sibs)) {
    used.add(pick.p._id); takenRooms.add(rk(pick.p.room))
    push(pick.p, { slot: 'showcase', group: 'Showcase', why: 'showcase — ' + pick.why })
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
export function marketingChecks(placed: Placed[], profile: UnitProfile, siblings?: SiblingOpening[]): Check[] {
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
  out.push({ key: 'five', ok: showcase.length >= 4 && rooms5.size === showcase.length, label: 'First five show five different spaces', detail: showcase.length < 4 ? `Only ${showcase.length + 1} strong wide shots for the opening swipe — shoot the missing spaces wide and bright.` : `${showcase.map(p => p.placement.why.replace(/^showcase — (best photo for )?/, '').replace(/^your pick — /, '').replace(/ · quality \d+$/, '')).join(' · ')}` })
  // 2b. Distinct from the sister units (only when the building has other listings).
  const sibs = (siblings || []).filter(s => s.five.length)
  if (sibs.length && cover) {
    const r = siblingRead(cover, sibs)
    const five = placed.slice(0, 5)
    const twin = sibs.map(s => ({ name: s.name, n: five.filter(p => s.five.some(x => sameShot(p.hash, x.hash))).length })).sort((a, b) => b.n - a.n)[0]
    const crowded = sibs.length >= 3 && (r.sceneCover + 1) / (r.n + 1) > 0.5
    const ok = !r.sameCover.length && !crowded && !(twin && twin.n >= 3)
    out.push({ key: 'distinct', ok, label: 'Opens differently from its sister units', detail: r.sameCover.length ? `Same cover photo as ${r.sameCover.slice(0, 3).join(', ')}${r.sameCover.length > 3 ? ` and ${r.sameCover.length - 3} more` : ''} — in search the units read as one listing repeated.`
      : crowded ? `${r.sceneCover + 1} of the building's ${r.n + 1} listings open with ${sceneWords(r.scene)} — lead this one with its own room or view.`
      : twin && twin.n >= 3 ? `${twin.n} of the first five are the same photos as ${twin.name}'s first five.`
      : `Cover and first five differ from the ${sibs.length} sister unit${sibs.length === 1 ? '' : 's'}.` })
  }
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
  // Anchored at BOTH ends (audit 2026-10-26): "Photo of the bay view" is a caption, "IMG_2041" is not.
  if (/^(dsc|img|dcim|pxl|mvimg|photo|image|screenshot|whatsapp|snapchat|untitled)([\s_-]*\d+)?$/i.test(t)) return true
  if (/^[\d_\-\s.]+$/.test(t)) return true
  if (!/\s/.test(t) && /\d{3,}/.test(t)) return true   // "IMG20240117", "P1040238"
  return false
}
