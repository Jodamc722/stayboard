// Single source of truth for the Listing Optimize Score (0-100).
// Deterministic, research-backed, computed entirely from structured Guesty data
// (no AI call) so it can run on the property detail page, the Properties/building
// grids, and roll up per building. Grounded in how OTA search ranking + conversion
// actually work: completeness, instant book, flexible cancellation, high-value
// amenities, photo count, and the guest-review signal.
//
// Components (structural, sum to 100 before the review blend):
//   Title 20 · Description 25 · Booking settings 30 · Amenity coverage 25
// When review data is available, overall = round(structural * 0.86 + reviewSignal * 0.14).

export type Band = 'good' | 'watch' | 'risk'
export type Factor = { label: string; got: number; max: number; note: string; ok: 'good' | 'warn' | 'bad' }
export type AmenitySuggestion = { name: string; tier: 1 | 2 | 3; reason: string }

export type ScoreResult = {
  overall: number
  band: Band
  title: { score: number; factors: Factor[] }
  description: { score: number; factors: Factor[]; sections: { label: string; text: string }[] }
  settings: { score: number; factors: Factor[]; meta: any }
  amenities: {
    score: number
    have: string[]
    suggestions: AmenitySuggestion[]
    mustFix: string[]
  }
  reviewSignal: { score: number; avgRating: number | null; reviewCount: number } | null
}

/* ----------------------------- building rollup ----------------------------- */
// Roll unit-level building names up to their parent property.
// e.g. "Botanica 6108" -> "Botanica", "Oasis Mahogany" -> "Oasis", "Arya 1704" -> "Arya".
const PARENTS = ['Botanica', 'Oasis', 'Arya']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
export function rollupBuilding(raw?: string | null): string {
  const b = (raw || '').trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) {
    if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  }
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

// URL slug for a building name (used by the drill-in route /buildings/[slug]).
export function buildingSlug(name: string): string {
  return encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, '-'))
}
export function slugToBuilding(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, ' ').trim().toLowerCase()
}

/* --------------------------------- helpers --------------------------------- */
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export function band(score: number): Band {
  return score >= 75 ? 'good' : score >= 60 ? 'watch' : 'risk'
}

export function bandUi(b: Band): { ring: string; label: string } {
  if (b === 'good') return { ring: 'ring-emerald-200 bg-emerald-50 text-emerald-700', label: 'Well optimized' }
  if (b === 'watch') return { ring: 'ring-amber-200 bg-amber-50 text-amber-700', label: 'Room to improve' }
  return { ring: 'ring-rose-200 bg-rose-50 text-rose-700', label: 'Needs work' }
}

function hasForbidden(s: string): string | null {
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) return 'an email address'
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) return 'a URL'
  if (/(?:\+?\d[\s().-]?){7,}/.test(s)) return 'a phone number'
  if (/[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(s)) return 'an emoji'
  if (/\b[A-Z]{4,}\b/.test(s)) return 'an ALL-CAPS word'
  return null
}

export function cancellationInfo(raw: any): { label: string; tier: 'flex' | 'mod' | 'strict' | 'unknown' } {
  const candidates = [
    raw?.terms?.cancellation, raw?.prices?.guestyCancellationPolicy, raw?.cancellationPolicy,
    raw?.airbnb?.cancellationPolicy, raw?.bookingcom?.cancellationPolicy,
  ].map(str).filter(Boolean)
  const c = (candidates[0] || '').toLowerCase()
  if (!c) return { label: 'Not set', tier: 'unknown' }
  if (/flex|relax|free/.test(c)) return { label: candidates[0], tier: 'flex' }
  if (/moderate|firm/.test(c)) return { label: candidates[0], tier: 'mod' }
  if (/strict|super|non.?refund|long/.test(c)) return { label: candidates[0], tier: 'strict' }
  return { label: candidates[0], tier: 'mod' }
}

/* ------------------------------ amenity model ------------------------------ */
// High-value amenities ranked by booking/visibility impact for South Florida condos.
// Each variant is matched case-insensitively as a substring against the normalized
// amenity list. weight = tier (3 = core, 2 = strong, 1 = nice-to-have).
type AmenityDef = { name: string; tier: 1 | 2 | 3; variants: string[]; conditional?: string }
const HIGH_VALUE: AmenityDef[] = [
  { name: 'Wifi', tier: 3, variants: ['wifi', 'wireless internet', 'internet'] },
  { name: 'Air conditioning', tier: 3, variants: ['air conditioning', 'central air', 'ac unit', 'window ac'] },
  { name: 'Pool', tier: 3, variants: ['pool'] },
  { name: 'Kitchen', tier: 3, variants: ['kitchen', 'kitchenette', 'cooking basics'] },
  { name: 'Free parking', tier: 3, variants: ['free parking', 'free street parking', 'parking on premises'], conditional: 'parking' },
  { name: 'Self check-in', tier: 3, variants: ['self check-in', 'self check in', 'smart lock', 'keypad', 'lockbox'] },
  { name: 'Hot tub', tier: 2, variants: ['hot tub', 'jacuzzi', 'jetted tub', 'spa'] },
  { name: 'Washer', tier: 2, variants: ['washer', 'washing machine'] },
  { name: 'Dryer', tier: 2, variants: ['dryer'] },
  { name: 'Dedicated workspace', tier: 2, variants: ['dedicated workspace', 'laptop-friendly', 'desk'] },
  { name: 'Beach access', tier: 2, variants: ['beach access', 'beachfront', 'beach essentials', 'ocean view', 'waterfront'], conditional: 'beach' },
  { name: 'Gym', tier: 2, variants: ['gym', 'exercise equipment', 'fitness'] },
  { name: 'TV', tier: 2, variants: ['tv', 'hdtv', 'cable', 'netflix'] },
  { name: 'Balcony / Patio', tier: 1, variants: ['balcony', 'patio', 'terrace'] },
  { name: 'Elevator', tier: 1, variants: ['elevator', 'lift'] },
  { name: 'Dishwasher', tier: 1, variants: ['dishwasher'] },
  { name: 'Coffee maker', tier: 1, variants: ['coffee maker', 'coffee', 'nespresso', 'keurig'] },
  { name: 'Hair dryer', tier: 1, variants: ['hair dryer', 'hairdryer'] },
  { name: 'EV charger', tier: 1, variants: ['ev charger', 'electric vehicle charger'], conditional: 'parking' },
  { name: 'Pets allowed', tier: 1, variants: ['pets allowed', 'pet friendly', 'pet-friendly'] },
]
const SAFETY: AmenityDef[] = [
  { name: 'Smoke alarm', tier: 1, variants: ['smoke alarm', 'smoke detector'] },
  { name: 'Carbon monoxide alarm', tier: 1, variants: ['carbon monoxide alarm', 'carbon monoxide detector', 'co alarm', 'co detector'] },
]

function normAmenities(list: string[]): string[] {
  return list.map(a => str(a).toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/-?\s*in (unit|building|the building)\b/g, '')
    .replace(/^free\s+/g, '')
    .trim())
}
function present(norm: string[], def: AmenityDef): boolean {
  return def.variants.some(v => norm.some(a => a.includes(v)))
}

/* --------------------------------- scoring --------------------------------- */
const TITLE_KW = ['pool', 'ocean', 'beach', 'view', 'hot tub', 'parking', 'king', 'balcony', 'gym', 'waterfront', 'rooftop', 'penthouse']
function scoreTitle(title: string): { score: number; factors: Factor[] } {
  const t = title.trim()
  const len = t.length
  const factors: Factor[] = []
  let lenGot = 0, lenNote = ''
  if (len === 0) { lenGot = 0; lenNote = 'Empty title' }
  else if (len > 65) { lenGot = 8; lenNote = `${len} chars - too long, truncated on every OTA` }
  else if (len > 50) { lenGot = 22; lenNote = `${len} chars - over Airbnb's 50-char cap` }
  else if (len >= 25) { lenGot = 35; lenNote = `${len} chars - ideal length` }
  else { lenGot = 20; lenNote = `${len} chars - short, room for a selling point` }
  factors.push({ label: 'Length', got: lenGot, max: 35, note: lenNote, ok: lenGot >= 30 ? 'good' : lenGot >= 18 ? 'warn' : 'bad' })
  const forb = t ? hasForbidden(t) : 'empty'
  factors.push({ label: 'Clean & compliant', got: forb ? 5 : 25, max: 25, note: forb && forb !== 'empty' ? `Contains ${forb} - OTAs may reject it` : (forb === 'empty' ? 'No title to check' : 'No caps/emoji/contact issues'), ok: forb ? 'bad' : 'good' })
  const lower = t.toLowerCase()
  const kw = TITLE_KW.filter(k => lower.includes(k))
  factors.push({ label: 'Standout amenity', got: kw.length ? 20 : 6, max: 20, note: kw.length ? `Leads with: ${kw.slice(0, 3).join(', ')}` : 'No headline amenity (pool, ocean view...) - add one', ok: kw.length ? 'good' : 'warn' })
  const hasLoc = /\b(beach|miami|brickell|south|downtown|lincoln|bay|isle|district|pointe|collins|ocean)\b/i.test(t) || (t.split(/\s+/).filter(w => /^[A-Z]/.test(w)).length >= 2)
  factors.push({ label: 'Specific location', got: hasLoc ? 20 : 8, max: 20, note: hasLoc ? 'Names a neighborhood / landmark' : 'Add a neighborhood or landmark guests search for', ok: hasLoc ? 'good' : 'warn' })
  return { score: Math.round(factors.reduce((s, f) => s + f.got, 0)), factors }
}

function scoreDescription(pub: any): { score: number; factors: Factor[]; sections: { label: string; text: string }[] } {
  const get = (k: string) => str(pub?.[k]).trim()
  const summary = get('summary')
  const sectionDefs: [string, string][] = [
    ['summary', 'Summary'], ['space', 'The space'], ['access', 'Guest access'],
    ['neighborhood', 'Neighborhood'], ['transit', 'Getting around'], ['notes', 'Other notes'],
  ]
  const sections = sectionDefs.map(([k, label]) => ({ label, text: get(k) })).filter(s => s.text)
  const full = sectionDefs.map(([k]) => get(k)).join(' ')
  const lower = full.toLowerCase()
  const factors: Factor[] = []
  let sGot = 0, sNote = ''
  if (!summary) { sGot = 0; sNote = 'No summary - this is what shows before "read more"' }
  else if (summary.length < 80) { sGot = 12; sNote = `Summary only ${summary.length} chars - thin` }
  else if (summary.length <= 500) { sGot = 30; sNote = `Summary ${summary.length} chars - good` }
  else { sGot = 22; sNote = `Summary ${summary.length} chars - over Airbnb's 500 cap` }
  factors.push({ label: 'Summary', got: sGot, max: 30, note: sNote, ok: sGot >= 24 ? 'good' : sGot >= 12 ? 'warn' : 'bad' })
  const filled = sections.length
  factors.push({ label: 'Sections filled', got: Math.round((Math.min(filled, 6) / 6) * 30), max: 30, note: `${filled} of 6 description sections filled`, ok: filled >= 5 ? 'good' : filled >= 3 ? 'warn' : 'bad' })
  const layout = /\b(bed|bath|sleeps?|king|queen|sofa|bunk)\b/.test(lower)
  factors.push({ label: 'States layout', got: layout ? 15 : 4, max: 15, note: layout ? 'Mentions beds/baths/sleeps' : 'Add bed/bath/sleeps early', ok: layout ? 'good' : 'warn' })
  const loc = /\b(walk|min|minutes|steps|near|close|beach|downtown|blocks?)\b/.test(lower)
  factors.push({ label: 'Quantified location', got: loc ? 15 : 4, max: 15, note: loc ? 'Describes proximity to attractions' : 'Add "5-min walk to..." style distances', ok: loc ? 'good' : 'warn' })
  const forb = full ? hasForbidden(full) : 'empty'
  factors.push({ label: 'No contact info', got: forb && forb !== 'empty' ? 2 : 10, max: 10, note: forb && forb !== 'empty' ? `Contains ${forb}` : 'Clean', ok: forb && forb !== 'empty' ? 'bad' : 'good' })
  return { score: Math.round(factors.reduce((s, f) => s + f.got, 0)), factors, sections }
}

function scoreSettings(raw: any, photoCount: number): { score: number; factors: Factor[]; meta: any } {
  const terms = raw?.terms || {}
  const minN = terms.minNights ?? raw?.defaultListingMinNights ?? null
  const maxN = terms.maxNights ?? null
  const instantRaw = raw?.instantBookable ?? raw?.instantBook ?? null
  const instant = instantRaw === true || instantRaw === 'true'
  const checkIn = str(raw?.defaultCheckInTime || raw?.checkInTime)
  const checkOut = str(raw?.defaultCheckOutTime || raw?.checkOutTime)
  const cancel = cancellationInfo(raw)
  const factors: Factor[] = []
  const cGot = cancel.tier === 'flex' ? 30 : cancel.tier === 'mod' ? 22 : cancel.tier === 'strict' ? 8 : 14
  factors.push({ label: 'Cancellation policy', got: cGot, max: 30, note: cancel.tier === 'unknown' ? 'Not set in Guesty' : `${cancel.label} - ${cancel.tier === 'flex' ? 'flexible policies rank & convert best' : cancel.tier === 'strict' ? 'strict policies suppress conversion' : 'moderate'}`, ok: cGot >= 22 ? 'good' : cGot >= 14 ? 'warn' : 'bad' })
  let mGot = 14, mNote = 'Not set'
  if (minN != null) {
    const n = Number(minN)
    if (n <= 3) { mGot = 22; mNote = `${n}-night minimum - very bookable` }
    else if (n <= 7) { mGot = 12; mNote = `${n}-night minimum - moderate` }
    else { mGot = 4; mNote = `${n}-night minimum - limits demand (may be an HOA rule)` }
  }
  factors.push({ label: 'Minimum stay', got: mGot, max: 22, note: mNote, ok: mGot >= 18 ? 'good' : mGot >= 10 ? 'warn' : 'bad' })
  factors.push({ label: 'Instant Book', got: instant ? 22 : 6, max: 22, note: instant ? 'On - boosts ranking on Airbnb & Vrbo' : (instantRaw == null ? 'Unknown / not set' : 'Off - turning it on lifts ranking'), ok: instant ? 'good' : 'warn' })
  let pGot = 0, pNote = ''
  if (photoCount >= 20) { pGot = 16; pNote = `${photoCount} photos - strong` }
  else if (photoCount >= 15) { pGot = 12; pNote = `${photoCount} photos - good, target 20+` }
  else if (photoCount >= 10) { pGot = 8; pNote = `${photoCount} photos - add more (target 20+)` }
  else if (photoCount >= 6) { pGot = 4; pNote = `${photoCount} photos - minimum met, well short of ideal` }
  else if (photoCount > 0) { pGot = 1; pNote = `${photoCount} photos - below Vrbo's 6 minimum` }
  else { pGot = 0; pNote = 'No photos detected' }
  factors.push({ label: 'Photos', got: pGot, max: 16, note: pNote, ok: pGot >= 12 ? 'good' : pGot >= 6 ? 'warn' : 'bad' })
  const ciGot = checkIn && checkOut ? 10 : checkIn || checkOut ? 5 : 0
  factors.push({ label: 'Check-in/out times', got: ciGot, max: 10, note: checkIn && checkOut ? `${checkIn} / ${checkOut}` : 'Not fully set', ok: ciGot >= 10 ? 'good' : 'warn' })
  return { score: Math.round(factors.reduce((s, f) => s + f.got, 0)), factors, meta: { minN, maxN, instant, instantRaw, checkIn, checkOut, cancel } }
}

// Amenity coverage 0-100 + suggestions. siblingAmenities = amenities present on other
// units in the same building (a missing one that a sibling has is the highest-ROI fix).
function scoreAmenities(amenities: string[], opts?: { isBeach?: boolean; siblingNorm?: string[] }): {
  score: number; have: string[]; suggestions: AmenitySuggestion[]; mustFix: string[]
} {
  const norm = normAmenities(amenities)
  const sib = opts?.siblingNorm || []
  let weightHave = 0, weightTotal = 0
  const suggestions: AmenitySuggestion[] = []
  for (const def of HIGH_VALUE) {
    if (def.conditional === 'beach' && opts?.isBeach === false) continue
    weightTotal += def.tier
    if (present(norm, def)) { weightHave += def.tier; continue }
    const siblingHas = def.variants.some(v => sib.some(a => a.includes(v)))
    const reason = siblingHas
      ? 'Other units in this building list it - likely available here, just add it'
      : def.tier === 3 ? 'Core amenity guests filter for - big visibility win'
        : def.tier === 2 ? 'Strong booking driver' : 'Nice-to-have that helps you appear in more searches'
    suggestions.push({ name: def.name, tier: def.tier, reason })
  }
  // Safety items: must-fix if missing (Airbnb filters on them) but not part of coverage %.
  const mustFix: string[] = []
  for (const def of SAFETY) if (!present(norm, def)) mustFix.push(def.name)
  const target = Math.round(weightTotal * 0.82) // hitting ~82% of weighted amenities = full marks
  const score = weightTotal === 0 ? 0 : Math.min(100, Math.round((weightHave / target) * 100))
  suggestions.sort((a, b) => b.tier - a.tier)
  return { score, have: amenities, suggestions, mustFix }
}

function scoreReviews(avgRating: number | null, reviewCount: number): number {
  let r = 0
  if (avgRating == null || reviewCount === 0) r = 50 // neutral - don't punish brand-new listings
  else if (avgRating >= 4.9) r = 100
  else if (avgRating >= 4.8) r = 88
  else if (avgRating >= 4.7) r = 70
  else if (avgRating >= 4.5) r = 50
  else r = 25
  let v = 0
  if (reviewCount >= 50) v = 100
  else if (reviewCount >= 20) v = 75
  else if (reviewCount >= 5) v = 50
  else if (reviewCount >= 1) v = 30
  else v = 50 // neutral
  return Math.round(r * 0.6 + v * 0.4)
}

/* --------------------------------- entry ----------------------------------- */
export function computeScore(listing: any, opts?: {
  avgRating?: number | null
  reviewCount?: number
  isBeach?: boolean
  siblingAmenities?: string[]
}): ScoreResult {
  const raw = listing?.raw || {}
  const pub = raw.publicDescription || raw.publicDescriptions || {}
  const name = listing?.title || raw.title || listing?.nickname || ''
  const amenities: string[] = Array.isArray(listing?.amenities) && listing.amenities.length
    ? listing.amenities : (Array.isArray(raw.amenities) ? raw.amenities : [])
  const photoCount = Array.isArray(listing?.pictures) ? listing.pictures.length
    : (Array.isArray(raw.pictures) ? raw.pictures.length : 0)

  const title = scoreTitle(name)
  const description = scoreDescription(pub)
  const settings = scoreSettings(raw, photoCount)
  const amen = scoreAmenities(amenities, {
    isBeach: opts?.isBeach,
    siblingNorm: opts?.siblingAmenities ? normAmenities(opts.siblingAmenities) : undefined,
  })

  // Structural blend (sums to 1.0): Title .20 · Description .25 · Settings .30 · Amenities .25
  const structural = title.score * 0.20 + description.score * 0.25 + settings.score * 0.30 + amen.score * 0.25

  let overall = structural
  let reviewSignal: ScoreResult['reviewSignal'] = null
  if (opts && (opts.avgRating !== undefined || opts.reviewCount !== undefined)) {
    const avg = opts.avgRating ?? null
    const cnt = opts.reviewCount ?? 0
    const rs = scoreReviews(avg, cnt)
    overall = structural * 0.86 + rs * 0.14
    reviewSignal = { score: rs, avgRating: avg, reviewCount: cnt }
  }
  const o = Math.round(overall)
  return {
    overall: o,
    band: band(o),
    title,
    description,
    settings,
    amenities: { score: amen.score, have: amen.have, suggestions: amen.suggestions, mustFix: amen.mustFix },
    reviewSignal,
  }
}
