import { buildingOf as canonicalBuilding } from '@/lib/segments'
import { auditAmenities, type Audit } from '@/lib/amenity-audit'
// Single source of truth for the Listing Optimize Score (0-100).
// Deterministic, research-backed, computed entirely from structured Guesty data
// (no AI call) so it can run on the property detail page, the Properties/building
// grids, and roll up per building. Grounded in how OTA search ranking + conversion
// actually work: completeness, instant book, flexible cancellation, high-value
// amenities, photo count, and the guest-review signal.
//
// Components (structural, sum to 1.0 before the review blend):
//   Title .18 · Description .22 · Photos .18 · Amenity coverage .22 · Booking settings .20
// When review data is available, overall = round(structural * 0.86 + reviewSignal * 0.14).
//
// PHOTOS BECAME THEIR OWN PILLAR ON 2026-08-21. They used to be one 16-point factor INSIDE
// Booking settings, which carried 0.30 — so photo count and AI-judged photo quality together were
// 16 x 0.30 x 0.86 = 4.1% of a unit's score, and a six-photo listing read on screen as a *booking
// settings* problem. For a business that converts on the photo grid that was backwards. Settings
// keeps its four remaining factors (84 raw points, rescaled to 100).

// Normalize a stored OTA rating to a 0-5 star scale. Ratings arrive mixed: Airbnb/Vrbo 0-5,
// Booking/Expedia 0-10, occasionally 0-100. scoreReviews() below expects STARS - averaging raw
// values let a Booking 9.0 count as "9 stars" and score a listing falsely perfect. Callers that
// average review rows must run each row through this first.
export function ratingToStars(r: number | null | undefined): number | null {
  if (r == null || isNaN(Number(r))) return null
  const n = Number(r)
  if (n > 10) return Math.max(0, Math.min(5, n / 20))   // 0-100
  if (n > 5) return Math.max(0, Math.min(5, n / 2))     // 0-10 (Booking/Expedia)
  return Math.max(0, Math.min(5, n))                    // 0-5 (Airbnb/Vrbo)
}

// How the GUEST actually saw their own score — use this any time a single review is quoted to a
// human (team, owner, vendor), as opposed to averaged.
//
// Why this exists (Jon 2026-08-08): Booking.com scores out of 10, and the sync already halves it
// on the way in, so every channel averages cleanly on one 0-5 scale. The maths is right. The
// WORDS were wrong: a guest who gave Park Towers 1 out of 10 was quoted back to the vendor as
// "0.5★" — a number that matches nothing anyone can look up on Booking. Averages stay on stars
// (you cannot mix scales); individual scores get spoken in the channel's own language.
export function ratingAsGuestSaw(stars: number | null | undefined, channel?: string | null): string | null {
  if (stars == null || !Number.isFinite(Number(stars))) return null
  const n = Number(stars)
  // Booking + Expedia are 1-10 channels; ratingToStars documents the same pair.
  if (/booking|expedia/i.test(String(channel || ''))) {
    const outOf10 = Math.round(n * 2 * 10) / 10
    return `${outOf10}/10 on ${String(channel).trim()}`
  }
  return `${n.toFixed(1)}★`
}

export type Band = 'good' | 'watch' | 'risk'
export type Factor = { label: string; got: number; max: number; note: string; ok: 'good' | 'warn' | 'bad' }
export type AmenitySuggestion = { name: string; tier: 1 | 2 | 3; reason: string }

export type ScoreResult = {
  overall: number
  band: Band
  title: { score: number; factors: Factor[] }
  description: { score: number; factors: Factor[]; sections: { label: string; text: string }[] }
  photos: { score: number; factors: Factor[]; count: number; aiQuality: number | null; coverageNote: string; notes: string[] }
  settings: { score: number; factors: Factor[]; meta: any }
  amenities: {
    score: number
    have: string[]
    suggestions: AmenitySuggestion[]
    mustFix: string[]
    /** What the photos prove vs what is listed (lib/amenity-audit). */
    audit: Audit
  }
  reviewSignal: { score: number; avgRating: number | null; reviewCount: number } | null
}

/* ----------------------------- building rollup ----------------------------- */
// Roll unit-level building names up to their parent property.
// e.g. "Botanica 6108" -> "Botanica", "Oasis Mahogany" -> "Oasis", "Arya 1704" -> "Arya".
// DELEGATES to lib/segments (Jon, 2026-08-10). This used to be its own table of parents and
// aliases, which meant the app had three different answers to "what building is this?" — this
// one, the first-word guess in geo-areas, and the city rules in segments. One registry now.
export function rollupBuilding(raw?: string | null, name?: string | null): string {
  const b = (raw || '').trim()
  if (!b && !String(name || '').trim()) return 'Unassigned'
  return canonicalBuilding(b, name || null) || b || 'Unassigned'
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

function contactInfo(s: string): string | null {
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) return 'an email address'
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) return 'a URL'
  if (/(?:\+?\d[\s().-]?){10,}/.test(s)) return 'a phone number'
  return null
}
function hasForbidden(s: string): string | null {
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) return 'an email address'
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) return 'a URL'
  if (/(?:\+?\d[\s().-]?){7,}/.test(s)) return 'a phone number'
  if (/[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(s)) return 'an emoji'
  if (/\b[A-Z]{4,}\b/.test(s)) return 'an ALL-CAPS word'
  return null
}

// Guesty stores channel settings under raw.integrations[].{airbnb2|whimstay|hopper|...}.
// Pull a field, preferring Airbnb (the strictest/highest-converting channel).
export function integrationField(raw: any, key: string): any {
  const ints = Array.isArray(raw?.integrations) ? raw.integrations : []
  for (const name of ['airbnb2', 'airbnb']) for (const it of ints) { const c = it?.[name]; if (c && c[key] != null) return c[key] }
  for (const it of ints) for (const ck of Object.keys(it || {})) { const c = (it as any)[ck]; if (c && typeof c === 'object' && c[key] != null) return c[key] }
  return null
}

export function cancellationInfo(raw: any): { label: string; tier: 'flex' | 'mod' | 'strict' | 'unknown' } {
  const candidates = [
    integrationField(raw, 'cancellationPolicy'),
    raw?.terms?.cancellation, raw?.prices?.guestyCancellationPolicy, raw?.cancellationPolicy,
    raw?.airbnb?.cancellationPolicy, raw?.bookingcom?.cancellationPolicy,
  ].map(str).filter(Boolean)
  const raw0 = candidates[0] || ''
  const c = raw0.toLowerCase()
  if (!c) return { label: 'Not set', tier: 'unknown' }
  const label = raw0.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) // "strict_60" -> "Strict 60"
  if (/flex|relax|free/.test(c)) return { label, tier: 'flex' }
  if (/strict|super|non.?refund|long/.test(c)) return { label, tier: 'strict' }
  if (/moderate|firm/.test(c)) return { label, tier: 'mod' }
  return { label, tier: 'mod' }
}

/* ------------------------------ amenity model ------------------------------ */
// High-value amenities ranked by booking/visibility impact for South Florida condos.
// Each variant is matched case-insensitively as a substring against the normalized
// amenity list. weight = tier (3 = core, 2 = strong, 1 = nice-to-have).
// AUDIT 2026-10-26: variants now match as WHOLE WORDS, with `not` for the look-alikes that used to
// score as the real thing ("dishwasher" as Washer, "hair dryer" as Dryer, "workspace" as Hot tub via
// 'spa', "pool towels" as Pool). `partial` = listed, but the weaker version (street parking) — half credit.
type AmenityDef = { name: string; tier: 1 | 2 | 3; variants: string[]; not?: string[]; partial?: string[]; conditional?: string }
const HIGH_VALUE: AmenityDef[] = [
  { name: 'Wifi', tier: 3, variants: ['wifi', 'wireless internet', 'internet'] },
  { name: 'Air conditioning', tier: 3, variants: ['air conditioning', 'central air', 'ac unit', 'window ac'] },
  { name: 'Pool', tier: 3, variants: ['pool', 'swimming pool'], not: ['pool towels', 'pool towel', 'pool table', 'pool toys'] },
  { name: 'Kitchen', tier: 3, variants: ['kitchen', 'kitchenette', 'cooking basics'] },
  { name: 'Parking', tier: 3, variants: ['parking', 'garage', 'carport', 'valet'], partial: ['street parking', 'off premises', 'off-premises', 'paid parking off'], conditional: 'parking' },
  { name: 'Self check-in', tier: 3, variants: ['self check-in', 'self check in', 'smart lock', 'keypad', 'lockbox'] },
  { name: 'Hot tub', tier: 2, variants: ['hot tub', 'jacuzzi', 'jetted tub', 'whirlpool'] },
  { name: 'Washer', tier: 2, variants: ['washer', 'washing machine', 'laundry'], not: ['dishwasher'] },
  { name: 'Dryer', tier: 2, variants: ['dryer', 'clothes dryer'], not: ['hair dryer', 'hairdryer'] },
  { name: 'Dedicated workspace', tier: 2, variants: ['dedicated workspace', 'laptop-friendly', 'laptop friendly', 'workspace', 'work space', 'desk', 'office'], not: ['front desk', 'office hours', 'leasing office'] },
  { name: 'Beach access', tier: 2, variants: ['beach access', 'beachfront', 'beach essentials', 'ocean view', 'waterfront'], conditional: 'beach' },
  { name: 'Gym', tier: 2, variants: ['gym', 'exercise equipment', 'fitness'] },
  { name: 'TV', tier: 2, variants: ['tv', 'hdtv', 'smart tv', 'cable tv', 'netflix'] },
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
const flatA = (x: string) => x.replace(/[-\s]+/g, ' ').trim()
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** Does amenity text `a` contain `v` as whole words (hyphen/space-insensitive)? */
function hasWords(a: string, v: string): boolean {
  return new RegExp('(^|[^a-z0-9])' + esc(flatA(v)) + '($|[^a-z0-9])').test(flatA(a))
}
/** 'full' = listed; 'partial' = only the weaker version is listed (half credit); null = not listed. */
function presence(norm: string[], def: AmenityDef): 'full' | 'partial' | null {
  let partial = false
  for (const a of norm) {
    if (def.not && def.not.some(n => hasWords(a, n))) continue
    if (!def.variants.some(v => hasWords(a, v))) continue
    if (def.partial && def.partial.some(pv => hasWords(a, pv))) { partial = true; continue }
    return 'full'
  }
  return partial ? 'partial' : null
}
function present(norm: string[], def: AmenityDef): boolean { return presence(norm, def) === 'full' }

/* --------------------------------- scoring --------------------------------- */
const LOCATION_RE = /\b(beach|miami|brickell|south beach|downtown|lincoln|bay ?front|isles?|district|pointe|collins|ocean|fort lauderdale|ft\.? lauderdale|lauderdale|las olas|hollywood|pompano|hallandale|aventura|sunny isles|wynwood|edgewater|midtown|coconut grove|coral gables|key biscayne|little havana|design district|wilton manors|deerfield|boca|galt|intracoastal|marina|harbor|riverwalk|flagler|victoria park|port everglades|airport|fll|mia|convention center|hard rock|cruise port)\b/i
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
  // Whole words: 'king' must not match "parking" or "walking" (audit 2026-10-26).
  const kw = TITLE_KW.filter(k => hasWords(lower, k))
  factors.push({ label: 'Standout amenity', got: kw.length ? 20 : 6, max: 20, note: kw.length ? `Leads with: ${kw.slice(0, 3).join(', ')}` : 'No headline amenity (pool, ocean view...) - add one', ok: kw.length ? 'good' : 'warn' })
  // A real place name, not "any two capitalised words" (which every Title Case title has).
  const hasLoc = LOCATION_RE.test(t)
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
  // A section counts when it says something: 60+ characters (one boilerplate line does not).
  const substantive = sections.filter(s => s.text.length >= 60)
  const full = sectionDefs.map(([k]) => get(k)).join(' ')
  const lower = full.toLowerCase()
  const factors: Factor[] = []
  let sGot = 0, sNote = ''
  if (!summary) { sGot = 0; sNote = 'No summary - this is what shows before "read more"' }
  // 450-500 is the target (Jon, 2026-10-30: "this section should try and be 500 characters"): the
  // summary is the pitch every channel shows first, and unused characters are unused selling.
  else if (summary.length < 80) { sGot = 6; sNote = `Summary only ${summary.length} chars - thin` }
  else if (summary.length < 300) { sGot = 14; sNote = `Summary ${summary.length} chars - use the full ~500` }
  else if (summary.length < 450) { sGot = 21; sNote = `Summary ${summary.length} chars - close; aim for 450-500` }
  else if (summary.length <= 500) { sGot = 26; sNote = `Summary ${summary.length} chars - uses the full space` }
  else { sGot = 18; sNote = `Summary ${summary.length} chars - over Airbnb's 500 cap` }
  factors.push({ label: 'Summary', got: sGot, max: 26, note: sNote, ok: sGot >= 21 ? 'good' : sGot >= 12 ? 'warn' : 'bad' })
  const filled = substantive.length
  const space = get('space')
  factors.push({ label: 'Sections filled', got: Math.round((Math.min(filled, 6) / 6) * 20), max: 20, note: `${filled} of 6 description sections say something (60+ characters)`, ok: filled >= 5 ? 'good' : filled >= 3 ? 'warn' : 'bad' })
  // THE SPACE IS THE SALES PITCH (2026-10-30): a few paragraphs that sell the stay plus a short
  // highlights list. 500-1600 is the band; a wall past ~2000 is an inventory nobody finishes.
  const spaceGot = !space ? 0 : space.length < 150 ? 3 : space.length < 500 ? 6 : space.length <= 2000 ? 10 : 7
  factors.push({ label: 'The space', got: spaceGot, max: 10, note: !space ? 'Empty — this is the sales pitch guests read before booking' : space.length < 500 ? `${space.length} chars — thin; sell the stay: the feel, who it suits, the best features` : space.length <= 2000 ? `${space.length} chars — a full selling section` : `${space.length} chars — too long; guests skim, keep the pitch tight`, ok: spaceGot >= 10 ? 'good' : spaceGot >= 6 ? 'warn' : 'bad' })
  // Layout stated with numbers ("2 bedrooms", "sleeps 6", "king bed"), not just the word "bed".
  const layout = /\b(\d+|one|two|three|four|five|six)[- ](bed(room)?s?|bath(room)?s?|queen|king|twin)\b|\bsleeps? \d+|\b(king|queen)[- ](size )?bed\b/.test(lower)
  factors.push({ label: 'States layout', got: layout ? 12 : 3, max: 12, note: layout ? 'Mentions beds/baths/sleeps' : 'Add bed/bath/sleeps early', ok: layout ? 'good' : 'warn' })
  // Quantified: "5-minute walk", "2 miles", "3 blocks", "steps to the beach".
  const loc = /\b\d+[- ]?(min(ute)?s?|mi(les?)?|blocks?|km)\b|\bsteps (to|from)\b|\bwalking distance\b|\bacross the street\b/.test(lower)
  factors.push({ label: 'Quantified location', got: loc ? 12 : 3, max: 12, note: loc ? 'Describes proximity to attractions' : 'Add "5-min walk to..." style distances', ok: loc ? 'good' : 'warn' })
  // LOCAL PICKS (2026-10-30: "the location/neighborhood should give actual recommendations"): a
  // neighbourhood section that names real places — one per line, or several with their minutes.
  const hood = get('neighborhood')
  const pickLines = hood.split(/\n/).filter(l => /^\s*[-•]\s*\S/.test(l)).length
  const timed = (hood.match(/\b\d+[- ]?(min(ute)?s?|mi(les?)?)\b/gi) || []).length
  const picksGot = !hood ? 0 : (pickLines >= 4 || timed >= 4) ? 10 : (pickLines >= 2 || timed >= 2) ? 6 : 2
  factors.push({ label: 'Local picks', got: picksGot, max: 10, note: !hood ? 'No neighborhood section' : picksGot >= 10 ? `Recommends real places (${Math.max(pickLines, timed)})` : 'Name the real places to go — the beach, where to eat, what to do — with times', ok: picksGot >= 10 ? 'good' : picksGot >= 6 ? 'warn' : 'bad' })
  // Contact info only — an ALL-CAPS word is a style issue, not a policy breach.
  const forb = full ? contactInfo(full) : 'empty'
  factors.push({ label: 'No contact info', got: forb && forb !== 'empty' ? 2 : 10, max: 10, note: forb && forb !== 'empty' ? `Contains ${forb}` : 'Clean', ok: forb && forb !== 'empty' ? 'bad' : 'good' })
  return { score: Math.round(factors.reduce((s, f) => s + f.got, 0)), factors, sections }
}

function scoreSettings(raw: any): { score: number; factors: Factor[]; meta: any } {
  const terms = raw?.terms || {}
  const minN = terms.minNights ?? raw?.defaultListingMinNights ?? null
  const maxN = terms.maxNights ?? null
  const ibCategory = integrationField(raw, 'instantBookingAllowedCategory')
  const instantRaw = raw?.instantBookable ?? raw?.instantBook ?? (ibCategory != null ? ibCategory : null)
  const instant = instantRaw === true || instantRaw === 'true' ||
    (typeof ibCategory === 'string' && ibCategory.length > 0 && ibCategory.toLowerCase() !== 'off')
  const checkIn = str(raw?.defaultCheckInTime || raw?.checkInTime)
  const checkOut = str(raw?.defaultCheckOutTime || raw?.checkOutTime)
  const cancel = cancellationInfo(raw)
  const factors: Factor[] = []
  // Not set scores BELOW the strictest real policy (audit 2026-10-26: it used to beat Strict).
  const cGot = cancel.tier === 'flex' ? 30 : cancel.tier === 'mod' ? 22 : cancel.tier === 'strict' ? 8 : 4
  factors.push({ label: 'Cancellation policy', got: cGot, max: 30, note: cancel.tier === 'unknown' ? 'Not set in Guesty' : `${cancel.label} - ${cancel.tier === 'flex' ? 'flexible policies rank & convert best' : cancel.tier === 'strict' ? 'strict policies suppress conversion' : 'moderate'}`, ok: cGot >= 22 ? 'good' : cGot >= 14 ? 'warn' : 'bad' })
  let mGot = 6, mNote = 'Not set in Guesty — set it so the channels show the right stays'
  if (minN != null) {
    const n = Number(minN)
    if (n <= 3) { mGot = 22; mNote = `${n}-night minimum - very bookable` }
    else if (n <= 7) { mGot = 12; mNote = `${n}-night minimum - moderate` }
    else { mGot = 4; mNote = `${n}-night minimum - limits demand (may be an HOA rule)` }
  }
  factors.push({ label: 'Minimum stay', got: mGot, max: 22, note: mNote, ok: mGot >= 18 ? 'good' : mGot >= 10 ? 'warn' : 'bad' })
  factors.push({ label: 'Instant Book', got: instant ? 22 : 6, max: 22, note: instant ? 'On - boosts ranking on Airbnb & Vrbo' : (instantRaw == null ? 'Unknown / not set' : 'Off - turning it on lifts ranking'), ok: instant ? 'good' : 'warn' })
  const ciGot = checkIn && checkOut ? 10 : checkIn || checkOut ? 5 : 0
  factors.push({ label: 'Check-in/out times', got: ciGot, max: 10, note: checkIn && checkOut ? `${checkIn} / ${checkOut}` : 'Not fully set', ok: ciGot >= 10 ? 'good' : 'warn' })
  // Photos moved out to their own pillar on 2026-08-21, so this pillar's raw ceiling is 84
  // (cancellation 30 + min stay 22 + instant book 22 + check-in/out 10). Rescale to 0-100 so the
  // weights in computeScore stay readable.
  const rawMax = factors.reduce((s, f) => s + f.max, 0) || 1
  const rawGot = factors.reduce((s, f) => s + f.got, 0)
  return { score: Math.round((rawGot / rawMax) * 100), factors, meta: { minN, maxN, instant, instantRaw, checkIn, checkOut, cancel } }
}

/* ------------------------------ photos ------------------------------------- */
// Photo count (0-55) + AI-judged photo quality (0-45). When the photo AI has never run we give a
// provisional 30/45 rather than a zero — the same "don't punish what we haven't measured" rule
// scoreReviews() uses for a brand-new listing — so a 25-photo unit lands at 85 until it is scored
// for real. The factor note says so out loud.
function scorePhotos(raw: any, photoScoreCol: any, photoCount: number): ScoreResult['photos'] {
  const ai0: any = (photoScoreCol && typeof photoScoreCol === 'object') ? photoScoreCol
    : ((raw && typeof raw._photoScore === 'object') ? raw._photoScore : null)
  // A photo score is about ONE photo set. When the set has changed since (count off by more than 3)
  // or it is over 180 days old, it no longer describes these photos (audit 2026-10-26).
  const aiCount = ai0 && Number.isFinite(Number(ai0.count)) ? Number(ai0.count) : null
  const aiAt = ai0 && typeof ai0.at === 'string' ? Date.parse(ai0.at) : NaN
  const stale = !!ai0 && ((aiCount != null && Math.abs(aiCount - photoCount) > 3) || (Number.isFinite(aiAt) && Date.now() - aiAt > 180 * 86400000))
  const ai: any = stale ? null : ai0
  const aiQ = ai && Number.isFinite(Number(ai.score)) ? Math.max(0, Math.min(100, Number(ai.score))) : null
  const coverageNote = ai && typeof ai.coverageNote === 'string' ? ai.coverageNote : ''
  const notes: string[] = ai && Array.isArray(ai.notes) ? ai.notes.filter((n: any) => typeof n === 'string').slice(0, 4) : []

  // COUNT (max 45): 20-35 is the sweet spot the photo engine itself targets; past ~45 guests stop
  // scrolling and repeats creep in, so more is no longer better (audit 2026-10-26).
  let cGot = 0, cNote = ''
  if (photoCount > 45) { cGot = 32; cNote = `${photoCount} photos - too many; cut repeats and weak shots to 25-35` }
  else if (photoCount >= 20) { cGot = 40; cNote = `${photoCount} photos - a full set` }
  else if (photoCount >= 15) { cGot = 30; cNote = `${photoCount} photos - good, target 20+` }
  else if (photoCount >= 10) { cGot = 20; cNote = `${photoCount} photos - add more (target 20+)` }
  else if (photoCount >= 6) { cGot = 10; cNote = `${photoCount} photos - Vrbo's minimum met, well short of ideal` }
  else if (photoCount > 0) { cGot = 4; cNote = `${photoCount} photos - below Vrbo's 6-photo minimum` }
  else { cGot = 0; cNote = 'No photos detected' }

  // CAPTIONS (max 15): Airbnb's photo tour and every AI search read them; a blank or a filename is
  // a photo that says nothing.
  const pics: any[] = Array.isArray(raw?.pictures) ? raw.pictures : []
  const caps = pics.map((p: any) => { const o = typeof p === 'string' ? (() => { try { return JSON.parse(p) } catch { return {} } })() : (p || {}); return str(o.caption).trim() })
  const goodCaps = caps.filter(c => c.split(/\s+/).length >= 3 && !/^[0-9a-f-]{16,}$/i.test(c) && !/\.(jpe?g|png|webp|heic)$/i.test(c)).length
  const capShare = caps.length ? goodCaps / caps.length : 0
  const capGot = Math.round(capShare * 15)

  const factors: Factor[] = [
    { label: 'Photo count', got: cGot, max: 40, note: cNote, ok: cGot >= 36 ? 'good' : cGot >= 20 ? 'warn' : 'bad' },
    { label: 'Photo captions', got: capGot, max: 15, note: caps.length ? `${goodCaps} of ${caps.length} photos have a real caption` : 'No photos', ok: capShare >= 0.9 ? 'good' : capShare >= 0.5 ? 'warn' : 'bad' },
  ]
  let qGot: number
  if (aiQ != null) {
    qGot = Math.round((aiQ / 100) * 35)
    factors.push({
      label: 'AI photo quality', got: qGot, max: 35,
      note: `Scored ${aiQ}/100 on lighting, sharpness, composition and staging${coverageNote ? ` - ${coverageNote}` : ''}`,
      ok: aiQ >= 80 ? 'good' : aiQ >= 60 ? 'warn' : 'bad',
    })
  } else {
    // Unmeasured is not good: a token 12/40 (it was 30/45, which let a never-analysed unit read 85).
    qGot = 10
    factors.push({
      label: 'AI photo quality', got: qGot, max: 35,
      note: stale ? 'The photo score is out of date (the photos changed or it is 6+ months old) - run Organize photos again.' : 'Not scored yet - run Organize photos on this unit to score it for real.',
      ok: 'warn',
    })
  }
  // THE FIRST FIVE (2026-10-30): the photos a guest swipes on the search card. Five angles of one
  // room sell one room; the strongest sets show the living space, a bedroom, the kitchen or bath
  // and the outdoor/amenity draw. Read from the photo analysis — unmeasured gets a token 4.
  const idx: Record<string, any> = raw && typeof raw._photoIndex === 'object' && raw._photoIndex ? raw._photoIndex : {}
  const firstIds = pics.slice(0, 5).map((p: any) => { const o = typeof p === 'string' ? (() => { try { return JSON.parse(p) } catch { return {} } })() : (p || {}); return str(o._id || o.id) })
  const known = firstIds.filter(id => id && idx[id])
  let fGot = 4, fNote = 'Not analysed yet - run Organize photos to check the first five'
  if (known.length >= 3) {
    const bucket = (e: any) => { const c = str(e?.category).toLowerCase(); return c === 'living' || c === 'dining' ? 'living' : c === 'bedroom' ? 'bedroom' : c === 'kitchen' ? 'kitchen' : c === 'bathroom' ? 'bathroom' : c === 'outdoor' || c === 'view' || c === 'amenity' || c === 'exterior' ? 'outside' : 'other' }
    const kinds = new Set(known.map(id => bucket(idx[id])).filter(b => b !== 'other'))
    const stock = known.some(id => idx[id]?.kind === 'stock')
    fGot = Math.max(0, (kinds.size >= 4 ? 10 : kinds.size === 3 ? 7 : kinds.size === 2 ? 4 : 1) - (stock ? 3 : 0))
    fNote = `${kinds.size} different spaces in the first five${stock ? ', and a stock photo' : ''}${kinds.size >= 4 ? ' - a strong spread' : ' - show the living area, a bedroom, the kitchen or bath and the outdoor draw'}`
  }
  factors.push({ label: 'First five photos', got: fGot, max: 10, note: fNote, ok: fGot >= 9 ? 'good' : fGot >= 6 ? 'warn' : 'bad' })
  return { score: Math.max(0, Math.min(100, cGot + capGot + qGot + fGot)), factors, count: photoCount, aiQuality: aiQ, coverageNote, notes }
}

// Amenity coverage 0-100 + suggestions. siblingAmenities = amenities present on other
// units in the same building (a missing one that a sibling has is the highest-ROI fix).
function scoreAmenities(amenities: string[], opts?: { isBeach?: boolean; siblingNorm?: string[]; seenMissing?: string[] }): {
  score: number; have: string[]; suggestions: AmenitySuggestion[]; mustFix: string[]
} {
  const norm = normAmenities(amenities)
  const sib = opts?.siblingNorm || []
  let weightHave = 0, weightTotal = 0
  const suggestions: AmenitySuggestion[] = []
  for (const def of HIGH_VALUE) {
    if (def.conditional === 'beach' && opts?.isBeach === false) continue
    weightTotal += def.tier
    const got = presence(norm, def)
    if (got === 'full') { weightHave += def.tier; continue }
    if (got === 'partial') { weightHave += def.tier / 2; suggestions.push({ name: def.name, tier: def.tier, reason: 'Only street / off-site parking listed — on-site parking is the version guests filter for' }); continue }
    const siblingHas = presence(sib, def) === 'full'
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
  // SEEN BUT NOT LISTED (2026-10-30): an amenity a photo proves and the listing omits is a filter the
  // unit fails for no reason — 3 points each (up to 15), and it goes to the top of the suggestions.
  const seen = (opts?.seenMissing || []).filter(n => !suggestions.some(x => x.name.toLowerCase() === n.toLowerCase()))
  const missed = opts?.seenMissing?.length || 0
  const score = weightTotal === 0 ? 0 : Math.max(0, Math.min(100, Math.round((weightHave / target) * 100)) - Math.min(15, missed * 3))
  for (const n of seen) suggestions.push({ name: n, tier: 3, reason: 'Seen in your photos but not listed — mark it so guests who filter for it find you' })
  suggestions.sort((a, b) => b.tier - a.tier)
  return { score, have: amenities, suggestions, mustFix }
}

function scoreReviews(avgRating: number | null, reviewCount: number): number {
  let r = 0
  // Confidence-weighted (audit 2026-10-26): two 5★ reviews are not a 5.0 listing. Shrink toward a
  // 4.6 prior by five phantom reviews, so a long record outweighs a lucky start.
  const adj = avgRating == null || reviewCount === 0 ? null : (avgRating * reviewCount + 4.6 * 5) / (reviewCount + 5)
  if (adj == null) r = 50 // neutral - don't punish brand-new listings
  else if (adj >= 4.9) r = 100
  else if (adj >= 4.8) r = 88
  else if (adj >= 4.7) r = 72
  else if (adj >= 4.6) r = 58
  else if (adj >= 4.5) r = 45
  else if (adj >= 4.3) r = 30
  else r = 15
  let v = 0
  if (reviewCount >= 50) v = 100
  else if (reviewCount >= 20) v = 75
  else if (reviewCount >= 5) v = 50
  else if (reviewCount >= 1) v = 30
  else v = 50 // neutral
  return Math.round(r * 0.6 + v * 0.4)
}

/** Is this a beach listing? The city alone missed Fort Lauderdale, Hollywood and Sunny Isles beachfront. */
export function isBeachListing(l: any): boolean {
  const t = [l?.address_city, l?.building, l?.title, l?.nickname, l?.raw?.address?.full, l?.raw?.address?.street].map(str).join(' ')
  return /beach|oceanfront|ocean front|beachfront|sunny isles|galt ocean|a1a|collins ave/i.test(t)
}

/* --------------------------------- entry ----------------------------------- */
export function computeScore(listing: any, opts?: {
  avgRating?: number | null
  reviewCount?: number
  isBeach?: boolean
  siblingAmenities?: string[]
  /** The verified building parking line, so a contradicted Garage shows in the audit. */
  parkingFact?: string | null
}): ScoreResult {
  const raw = listing?.raw || {}
  const pub = raw.publicDescription || raw.publicDescriptions || {}
  // The PUBLIC title only — the internal nickname is a name no guest ever sees (audit 2026-10-26).
  const name = listing?.title || raw.title || ''
  const amenities: string[] = Array.isArray(listing?.amenities) && listing.amenities.length
    ? listing.amenities : (Array.isArray(raw.amenities) ? raw.amenities : [])
  const photoCount = Array.isArray(listing?.pictures) ? listing.pictures.length
    : (Array.isArray(raw.pictures) ? raw.pictures.length : 0)

  const title = scoreTitle(name)
  const description = scoreDescription(pub)
  const photoScoreCol = (listing?.photo_score && typeof listing.photo_score === 'object') ? listing.photo_score : null
  const photos = scorePhotos(raw, photoScoreCol, photoCount)
  const settings = scoreSettings(raw)
  const picIds = (Array.isArray(raw.pictures) ? raw.pictures : []).map((p: any) => { const o = typeof p === 'string' ? (() => { try { return JSON.parse(p) } catch { return {} } })() : (p || {}); return str(o._id || o.id) }).filter(Boolean)
  const audit = auditAmenities(amenities.map(a => String(a)), raw._photoIndex, picIds, opts?.parkingFact || null)
  const amen = scoreAmenities(amenities, {
    seenMissing: audit.seenMissing.map(x => x.name),
    isBeach: opts?.isBeach,
    siblingNorm: opts?.siblingAmenities ? normAmenities(opts.siblingAmenities) : undefined,
  })

  // Structural blend (sums to 1.0):
  //   Title .18 · Description .22 · Photos .18 · Amenities .22 · Settings .20
  const structural = title.score * 0.18 + description.score * 0.22 + photos.score * 0.18 + amen.score * 0.22 + settings.score * 0.20

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
    photos,
    settings,
    amenities: { score: amen.score, have: amen.have, suggestions: amen.suggestions, mustFix: amen.mustFix, audit },
    reviewSignal,
  }
}

/* --------------------------- one truth for "optimized" ---------------------- */
// Until 2026-08-21 the unit page decided "is this optimized?" three different ways in one file —
// the last_optimized column, then raw._lastOptimized, then an INFERENCE from "has a title and 5+ of
// 6 sections". A unit could read "Optimized" having never been touched by the optimizer, and the
// building list (which only checked the first two) disagreed about the same unit. One helper now,
// and "the content looks complete" is a separate, honestly-worded statement.
export function lastOptimizedOf(listing: any): { at: string | null; date: Date | null } {
  const raw = listing?.raw || {}
  const iso = listing?.last_optimized || (typeof raw?._lastOptimized === 'string' ? raw._lastOptimized : null) || null
  if (!iso) return { at: null, date: null }
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? { at: null, date: null } : { at: iso, date: d }
}

/* ------------------------------- fix-next ---------------------------------- */
// The Optimize Score already knows everything that is wrong with a unit — every factor carries a
// `got` and a `max`. A worklist is just those gaps, converted into the points they actually cost
// the overall score, and sorted. No new model, no second opinion to keep in sync.
export type Gap = {
  pillar: 'title' | 'description' | 'photos' | 'amenities' | 'settings'
  label: string
  note: string
  points: number          // how much the overall score would rise if this were fully fixed
  severity: 'good' | 'warn' | 'bad'
}

export const PILLAR_WEIGHTS: Record<Gap['pillar'], number> = {
  title: 0.18, description: 0.22, photos: 0.18, amenities: 0.22, settings: 0.20,
}
// Structural score is blended with the review signal at 0.86 when reviews are present, so a
// structural point is worth 0.86 of an overall point. Fixing copy cannot move the review signal.
const REVIEW_BLEND = 0.86

function gapsFromFactors(pillar: Gap['pillar'], factors: Factor[], blend = REVIEW_BLEND): Gap[] {
  const rawMax = factors.reduce((s, f) => s + f.max, 0) || 1
  return factors
    .filter(f => f.got < f.max)
    .map(f => ({
      pillar, label: f.label, note: f.note, severity: f.ok,
      points: Math.round(((f.max - f.got) / rawMax) * 100 * PILLAR_WEIGHTS[pillar] * blend * 10) / 10,
    }))
}

export function scoreGaps(res: ScoreResult): Gap[] {
  // Structural points are worth 0.86 overall only when the review blend is in play.
  const blend = res.reviewSignal ? REVIEW_BLEND : 1
  const out: Gap[] = [
    ...gapsFromFactors('title', res.title.factors, blend),
    ...gapsFromFactors('description', res.description.factors, blend),
    ...gapsFromFactors('photos', res.photos.factors, blend),
    ...gapsFromFactors('settings', res.settings.factors, blend),
  ]
  // Amenities score without per-factor detail, so express the gap as the two things a human can act
  // on: a missing safety amenity (always first) and the high-value suggestions.
  const amenGapPts = Math.round((100 - res.amenities.score) * PILLAR_WEIGHTS.amenities * blend * 10) / 10
  if (res.amenities.mustFix.length) {
    out.push({
      pillar: 'amenities', label: 'Missing safety amenity', severity: 'bad',
      note: `${res.amenities.mustFix.join(', ')} - every OTA filters on these`,
      points: Math.max(amenGapPts, 1),
    })
  } else if (res.amenities.suggestions.length && amenGapPts >= 0.5) {
    out.push({
      pillar: 'amenities', label: 'High-value amenities missing', severity: 'warn',
      note: res.amenities.suggestions.slice(0, 3).map(x => x.name).join(', '),
      points: amenGapPts,
    })
  }
  return out.sort((a, b) => b.points - a.points)
}
