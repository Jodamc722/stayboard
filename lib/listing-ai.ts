// The editable Listing & Photo AI configuration — prompts, length targets and enhance presets.
//
// WHY THIS FILE EXISTS: until 2026-08-21 the writing rules for the listing title and all six Guesty
// publicDescription sections were a hardcoded SECTION_DEFS array inside app/api/optimize-listing.
// Changing how the Neighborhood section is written meant shipping code. Everything editable now lives
// in app_settings key 'listing_ai', edited at /users -> App settings -> "Listing & photo AI".
//
// THE DEFAULTS BELOW ARE THE EXACT TEXT THAT WAS HARDCODED, so an unset key behaves identically to
// the old build. This file is PURE (no DB, no server-only imports) because the admin UI imports it
// too — the database read lives in lib/listing-ai-server.ts.
//
// What is NOT editable, on purpose: the honesty block (never invent a fact, never print the address
// or door codes, never claim a garage, tell real photos from stock). It is assembled in the route
// and sits outside this config so a prompt experiment can never put a wrong fact on a live listing.

export type SectionKey = 'title' | 'summary' | 'space' | 'access' | 'neighborhood' | 'transit' | 'notes'

export const SECTION_KEYS: SectionKey[] = ['title', 'summary', 'space', 'access', 'neighborhood', 'transit', 'notes']

export type SectionConfig = {
  label: string
  guide: string          // the editable prompt for this field
  targetMin: number      // soft target, characters
  targetMax: number
  hardCap: number | null // hard character limit; a warning fires above it
  mustInclude: string    // free text, appended as "ALWAYS work these in"
  neverSay: string       // free text, appended as "NEVER say"
  enabled: boolean       // off = the field is left alone by a full run
}

export type EnhancePreset = {
  key: string
  name: string
  when: string           // shown in the UI and given to the model as the choosing rule
  brightness: number
  saturation: number
  contrast: number       // sharp linear() multiplier; the offset is derived as -(contrast-1)*100
  sharpen: number        // sharp sharpen sigma
  warmth: number         // 0-8, a mild red-up / blue-down white-balance shift
}

export type ListingAi = {
  voice: string
  exemplarMatch: string          // building name matched with ilike to pull the house-style exemplar
  exemplarListingId: string | null // pin one listing instead of matching by building
  sections: Record<SectionKey, SectionConfig>
  photos: {
    orderPrompt: string
    captionPrompt: string
    captionMaxWords: number
    captionMaxChars: number
    maxPhotos: number
    photosToCopywriter: number   // how many labelled photos the copywriter is shown
  }
  enhance: {
    autoPick: boolean            // true = the model picks a preset per photo
    fallbackPreset: string       // used when autoPick is off, or the model returns nothing
    presets: EnhancePreset[]
  }
}

/* ------------------------------------------------------------------ *
 * Hard caps. Presets are editable; these are not. Whatever anyone
 * types into the settings page, an enhanced photo can never be pushed
 * past this — the line between "corrected" and "not the same room".
 * ------------------------------------------------------------------ */
export const ENHANCE_CAPS = { brightness: 1.15, saturation: 1.20, contrast: 1.15, sharpen: 1.5, warmth: 8 }

export function clampPreset(p: Partial<EnhancePreset> & { key: string; name: string }): EnhancePreset {
  const n = (v: any, d: number, lo: number, hi: number) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d
  }
  return {
    key: String(p.key).slice(0, 24),
    name: String(p.name).slice(0, 40),
    when: String(p.when || '').slice(0, 200),
    brightness: n(p.brightness, 1, 0.85, ENHANCE_CAPS.brightness),
    saturation: n(p.saturation, 1, 0.85, ENHANCE_CAPS.saturation),
    contrast: n(p.contrast, 1, 0.90, ENHANCE_CAPS.contrast),
    sharpen: n(p.sharpen, 0, 0, ENHANCE_CAPS.sharpen),
    warmth: n(p.warmth, 0, 0, ENHANCE_CAPS.warmth),
  }
}

/* ------------------------------------------------------------------ *
 * DEFAULTS — verbatim from the pre-2026-08-21 hardcoded prompts.
 * ------------------------------------------------------------------ */

export const TITLE_MAX = 50

const DEFAULT_SECTIONS: Record<SectionKey, SectionConfig> = {
  title: {
    label: 'Title',
    guide: 'AIM for a FULL, rich title - about 42-50 characters (USE the space; do not stop short at ~30). Front-load the single strongest hook in the first ~32 chars (mobile cards truncate there), THEN keep going to fill toward 50 with the specific unit/property details guests scan for: bed count/type (e.g. "2BR", "King"), a standout amenity (Pool, Ocean View, Rooftop, Steps to Beach), or the real area. Example shape: "Oceanview 2BR | Pool & Steps to South Beach". Title Case. No emoji, no repeated symbols, no ALL-CAPS words (proper nouns OK), no phone/email/URLs.',
    targetMin: 42, targetMax: 50, hardCap: TITLE_MAX, mustInclude: '', neverSay: '', enabled: true,
  },
  summary: {
    label: 'Summary',
    guide: 'The headline blurb shown first (maps to the main Airbnb/Vrbo description). HARD CAP 500 characters. Open with a hook that pairs the experience with one quantified, REAL perk only if the data supports it; state layout (beds/baths/sleeps) early; weave in real search keywords naturally; close warm. ALWAYS END the summary with a short standalone closing line that nudges guests to read the important notes, phrased like: "Please see Other things to note before booking." (keep it within the 500-char cap). Most important field.',
    targetMin: 350, targetMax: 500, hardCap: 500, mustInclude: '', neverSay: '', enabled: true,
  },
  space: {
    label: 'The space',
    guide: 'The SELLING section — make the reader want to book. Walk them through the home the way the PHOTOS show it: open with the single most compelling, true visual highlight (the view, the natural light, the kitchen, the pool), then room-by-room in short labeled lines or tight paragraphs (17 West house style): bedrooms + bed types, bathrooms, kitchen, living/dining, outdoor space, views, standout finishes, building amenities (pool, gym, parking). Keep it INVITING and broad - describe what the home offers in warm, confident strokes and list its real features. Use the photos to stay accurate and CONFIRM claims, but do NOT over-specify fine detail (exact materials, brands, precise finishes) unless you are 100% sure from a photo or the data; when unsure stay general (e.g. a bright open living area, a full kitchen, ample outdoor space) rather than risk a wrong specific. Lead with benefits (how it FEELS to stay), not a dry inventory. ALWAYS surface the practical amenities guests actively search for and that drive bookings, as a hyphenated list - e.g. pool / hot tub, in-unit OR on-site LAUNDRY (say if it is coin- or pay-app operated), free or paid parking, full kitchen, fast WiFi + workspace, elevator, gym, A/C, private balcony/outdoor space, beach or pool access. Include the building amenities and the high-level feel of the area (walkable, beachy, lively) - the important draws guests want, not fine specifics. Concrete, vivid, scannable.',
    targetMin: 800, targetMax: 1400, hardCap: null, mustInclude: '', neverSay: '', enabled: true,
  },
  access: {
    label: 'Guest access',
    guide: 'What the guest can use and how they get in: which areas/amenities are theirs, parking, building/elevator access, self check-in if the data indicates it. NEVER include the street address, unit number, real codes, phone, or URLs.',
    targetMin: 300, targetMax: 700, hardCap: null, mustInclude: '', neverSay: '', enabled: true,
  },
  neighborhood: {
    label: 'Neighborhood',
    guide: 'The area and concrete THINGS TO DO nearby, using the real city/area from the address. Name only WELL-KNOWN, real nearby beaches, dining/nightlife districts and attractions for that exact city. Highlight genuinely desirable, KEY draws - do NOT pad with trivial conveniences (a laundromat, convenience store, ATM, gas station, pharmacy). Do NOT fabricate distances or specific business names you are not sure of — keep proximity general unless the data states it.',
    targetMin: 500, targetMax: 1000, hardCap: null, mustInclude: '', neverSay: '', enabled: true,
  },
  transit: {
    label: 'Getting around',
    guide: 'Transport and orientation for the real area: parking, whether a car is useful, walkability, airport proximity in general terms. Do not invent precise drive times or distances.',
    targetMin: 250, targetMax: 600, hardCap: null, mustInclude: '', neverSay: '', enabled: true,
  },
  notes: {
    label: 'Other notes',
    guide: 'Standardized "Listing Notes" - write as short, scannable lines, ONE PER ITEM each starting with "- " (hyphen + space), factual and welcoming. NEVER mention the cancellation policy or refunds anywhere in this section. Include these lines, lightly adapted to this listing: (1) ONLY IF facts.minAge21 is true: "The primary guest must be 21 years or older to check in"; (2) "No smoking or parties permitted"; (3) "Guests must sign the rental agreement and check-in form before arrival - these are mandatory to confirm your reservation and receive access instructions"; (4) "Please review all house rules prior to arrival for a seamless experience"; (5) "Only initial consumables (toiletries, coffee, paper products) are provided; additional supplies can be requested for a small fee"; (6) "Mid-stay cleaning services are available upon request for an additional fee"; (7) "Additional accessibility details and building policies available upon request before booking".',
    targetMin: 400, targetMax: 800, hardCap: null, mustInclude: '', neverSay: 'the cancellation policy, refunds', enabled: true,
  },
}

const DEFAULT_VOICE = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager (Miami Beach / Fort Lauderdale / Broward). You write the MASTER listing content stored in Guesty, which syncs to Airbnb, Vrbo, Expedia and Booking.com. Write to Airbnb's stricter, highest-converting standard so it is excellent everywhere.

GOALS
1) MAXIMIZE VISIBILITY: OTAs rank complete, specific, keyword-rich, high-converting listings. Fill every section fully with REAL detail; lead with the strongest true differentiators.
2) SET GREAT, HONEST EXPECTATIONS: lean into what guests genuinely praise (review signal); never over-promise. Accurate, complete copy earns better reviews and ranking over time.
3) BE WORLD-CLASS, NEVER LAZY: this is a top property manager's flagship copy. Every section must be ROBUST, specific and benefit-led, written to DRIVE BOOKINGS - sell the experience, maximize SEO with the real keywords guests search, and speak directly to what guests want (space, cleanliness, location, and the amenities). Thin, generic or templated copy loses rankings AND bookings - go deep with real, concrete detail.

HOUSE STYLE
- Structured and scannable: short labeled lines or tight, skimmable paragraphs per topic; lead each section with its strongest true point. Vivid but never padded or flowery.
- FORMAT LISTS WITH HYPHENS: any time you present a list of items - room-by-room in The space, the building/unit amenities, the lines in Other notes - put each item on its own line starting with "- " (hyphen + space). Never use bullet dots, asterisks, or numbered lists.
- SOUTH FLORIDA KEYWORDS — only when the data supports them: "ocean view", "walk to the beach", "pool", "hot tub", "free parking", "king bed", real neighborhoods, real property types. Quantify location only if the data provides the figure.`

const DEFAULT_ORDER_PROMPT = `Ordering principles (in priority):
1. FIRST 5 = SHOWCASE SPREAD: the opening 5 photos (the host's COVER is already #1) should give a full taste of the place, not five of the same room. Lead with the single most beautiful, scroll-stopping photo, then make the next four a VARIETY that previews everything: the best AMENITY shot (pool / rooftop / gym / standout view), the best BEDROOM, the KITCHEN, and the best LIVING area. So the first 5 = best photo + amenity + bedroom + kitchen + living, strongest-looking first. If one of those categories has no good photo, fill with the next strongest available shot.
2. NEXT = ROOMS, GROUPED BY ROOM: after the showcase 5, walk the rest of the unit room by room, keeping every photo of the SAME room together (all living-room shots, then each bedroom's shots together, then bathrooms, then kitchen/dining, then the unit's own balcony/outdoor). Never split a room's photos across the set - one clean grouped tour.
3. LAST = EXTERIORS + REMAINING AMENITIES: building exterior shots and any shared amenities (gym, pool, lobby, common areas, parking) NOT already used in the showcase go at the VERY END, after all the unit's own rooms.
4. PROPERTY vs STOCK: classify every photo. "property" = an actual photo OF THIS home or its building (rooms, the unit's view/balcony, the real building exterior/lobby/pool/gym). "stock" = generic location/marketing imagery that is NOT this specific home: a city skyline, a generic beach, a map, a sunset, an attraction, a restaurant, lifestyle/decor stock, or a watermarked promo graphic. Stock photos must NOT be woven into the room-by-room tour - order all property photos first, then any stock photos last.
5. RECOMMEND DELETIONS: set remove=true for photos that hurt conversion: stock/location photos that misrepresent the home, EXACT or near-duplicates (keep the single best, flag the rest), dark/blurry/badly-lit/crooked shots, cluttered or unstaged messes, tiny detail/closeups that add nothing, and screenshots/graphics. Give a short removeReason. Be willing to recommend several - a tight set of strong real photos beats a padded set.
6. Never invent what a photo shows - judge only from the image. Every "reason" must be grounded in what you actually see.`

// Was "<=8 word guest-facing caption" in two separately-worded prompts (optimize-photos and
// photo-caption) that could drift. One spec now, read by both. Jon 2026-08-21: one richer caption
// that still pushes to Guesty — not a second internal field.
const DEFAULT_CAPTION_PROMPT = `A specific, guest-facing description of what the photo shows: name the space, what is in it, and the one true thing that sells it. Write it like a listing caption a guest reads under the photo — concrete, warm, never marketing fluff, never a sentence about how it "feels". Ground every word in the image. NEVER include a unit, room or listing number, a brand name you are not certain of, or a claim the photo does not show.`

const DEFAULT_PRESETS: EnhancePreset[] = [
  // "Classic" is the exact recipe every enhanced photo got before 2026-08-21 — kept so the
  // default behaviour of the button is unchanged for anyone who does not touch the settings.
  { key: 'classic', name: 'Classic', when: 'The Stay default. Safe on almost any interior.', brightness: 1.04, saturation: 1.08, contrast: 1.06, sharpen: 0.9, warmth: 0 },
  { key: 'natural', name: 'Natural', when: 'Already well shot. Clean-up and resize only.', brightness: 1.00, saturation: 1.02, contrast: 1.00, sharpen: 0.6, warmth: 0 },
  { key: 'bright', name: 'Bright', when: 'Underexposed interiors, dim bathrooms, shot against a window.', brightness: 1.12, saturation: 1.06, contrast: 1.08, sharpen: 0.9, warmth: 0 },
  { key: 'warm', name: 'Warm', when: 'A cool, grey or blue cast — overcast window light.', brightness: 1.05, saturation: 1.12, contrast: 1.02, sharpen: 0.8, warmth: 4 },
  { key: 'crisp', name: 'Crisp', when: 'Flat, low-contrast, slightly soft.', brightness: 1.03, saturation: 1.06, contrast: 1.14, sharpen: 1.3, warmth: 0 },
]

export const NONE_PRESET: EnhancePreset = { key: 'none', name: 'None', when: 'Leave this photo exactly as shot.', brightness: 1, saturation: 1, contrast: 1, sharpen: 0, warmth: 0 }

export const DEFAULT_LISTING_AI: ListingAi = {
  voice: DEFAULT_VOICE,
  exemplarMatch: '17 west',
  exemplarListingId: null,
  sections: DEFAULT_SECTIONS,
  photos: {
    orderPrompt: DEFAULT_ORDER_PROMPT,
    captionPrompt: DEFAULT_CAPTION_PROMPT,
    captionMaxWords: 20,
    captionMaxChars: 120,
    maxPhotos: 40,
    photosToCopywriter: 10,
  },
  enhance: { autoPick: true, fallbackPreset: 'classic', presets: DEFAULT_PRESETS },
}

/* ------------------------------------------------------------------ *
 * Merge a stored (possibly partial, possibly stale) value over the
 * defaults. Anything missing or malformed falls back, so a half-saved
 * key can never blank out a prompt on a live listing.
 * ------------------------------------------------------------------ */
export function mergeListingAi(stored: any): ListingAi {
  const s = (stored && typeof stored === 'object') ? stored : {}
  const str = (v: any, d: string, max = 8000) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : d)
  const num = (v: any, d: number, lo: number, hi: number) => {
    const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d
  }
  const sections = {} as Record<SectionKey, SectionConfig>
  for (const k of SECTION_KEYS) {
    const d = DEFAULT_SECTIONS[k]
    const v = (s.sections && typeof s.sections === 'object') ? s.sections[k] : null
    const o = (v && typeof v === 'object') ? v : {}
    // hardCap: an explicit null means "no limit"; anything unparseable falls back to the default.
    // The title is additionally clamped to TITLE_MAX because Guesty rejects a longer one outright.
    let hardCap: number | null
    if (o.hardCap === null) hardCap = null
    else if (Number.isFinite(Number(o.hardCap)) && Number(o.hardCap) > 0) hardCap = Math.min(8000, Math.round(Number(o.hardCap)))
    else hardCap = d.hardCap
    if (k === 'title') hardCap = Math.min(hardCap ?? TITLE_MAX, TITLE_MAX)
    sections[k] = {
      label: d.label,
      guide: str(o.guide, d.guide),
      targetMin: num(o.targetMin, d.targetMin, 0, 8000),
      targetMax: num(o.targetMax, d.targetMax, 0, 8000),
      hardCap,
      // An empty string is a real, saved choice here — only a non-string falls back to the default.
      mustInclude: typeof o.mustInclude === 'string' ? o.mustInclude.slice(0, 1200) : d.mustInclude,
      neverSay: typeof o.neverSay === 'string' ? o.neverSay.slice(0, 1200) : d.neverSay,
      enabled: o.enabled === false ? false : true,
    }
  }
  const ph = (s.photos && typeof s.photos === 'object') ? s.photos : {}
  const en = (s.enhance && typeof s.enhance === 'object') ? s.enhance : {}
  const rawPresets = Array.isArray(en.presets) && en.presets.length ? en.presets : DEFAULT_PRESETS
  const presets = rawPresets
    .filter((p: any) => p && typeof p.key === 'string' && p.key && typeof p.name === 'string' && p.name)
    .slice(0, 10)
    .map((p: any) => clampPreset(p))
  return {
    voice: str(s.voice, DEFAULT_VOICE),
    exemplarMatch: str(s.exemplarMatch, DEFAULT_LISTING_AI.exemplarMatch, 120),
    exemplarListingId: typeof s.exemplarListingId === 'string' && s.exemplarListingId ? s.exemplarListingId.slice(0, 64) : null,
    sections,
    photos: {
      orderPrompt: str(ph.orderPrompt, DEFAULT_ORDER_PROMPT),
      captionPrompt: str(ph.captionPrompt, DEFAULT_CAPTION_PROMPT, 2000),
      captionMaxWords: num(ph.captionMaxWords, 20, 4, 40),
      captionMaxChars: num(ph.captionMaxChars, 120, 20, 240),
      maxPhotos: num(ph.maxPhotos, 40, 5, 60),
      photosToCopywriter: num(ph.photosToCopywriter, 10, 3, 16),
    },
    enhance: {
      autoPick: en.autoPick === false ? false : true,
      fallbackPreset: str(en.fallbackPreset, 'classic', 24),
      presets: presets.length ? presets : DEFAULT_PRESETS,
    },
  }
}

// Look a preset up by key. Unknown key -> the configured fallback -> Classic. "none" is always valid.
export function presetByKey(cfg: ListingAi, key: string | null | undefined): EnhancePreset {
  const k = String(key || '').trim().toLowerCase()
  if (k === 'none') return NONE_PRESET
  const hit = cfg.enhance.presets.find(p => p.key.toLowerCase() === k)
  if (hit) return hit
  const fb = cfg.enhance.presets.find(p => p.key.toLowerCase() === cfg.enhance.fallbackPreset.toLowerCase())
  return fb || cfg.enhance.presets[0] || DEFAULT_PRESETS[0]
}

// True when a section has been changed from the Stay default — drives the "edited" badge.
export function sectionEdited(cfg: ListingAi, k: SectionKey): boolean {
  const d = DEFAULT_SECTIONS[k], c = cfg.sections[k]
  return c.guide !== d.guide || c.targetMin !== d.targetMin || c.targetMax !== d.targetMax ||
    c.mustInclude !== d.mustInclude || c.neverSay !== d.neverSay || c.enabled !== d.enabled
}

export { DEFAULT_SECTIONS }

// The length/inclusion rules appended under a section's editable guide. Kept here so the full run
// and the single-section rewrite phrase them identically.
export function sectionRules(c: SectionConfig): string {
  const bits: string[] = []
  if (c.targetMin && c.targetMax) bits.push(`Target length: about ${c.targetMin}-${c.targetMax} characters.`)
  if (c.hardCap) bits.push(`HARD LIMIT ${c.hardCap} characters.`)
  if (c.mustInclude.trim()) bits.push(`ALWAYS work these in, when the data supports them: ${c.mustInclude.trim()}`)
  if (c.neverSay.trim()) bits.push(`NEVER mention: ${c.neverSay.trim()}`)
  return bits.join(' ')
}
