// AI listing optimizer -> Guesty master content. Generates an optimized title + all six Guesty
// publicDescription sections, grounded ONLY in the listing's verified data, its real address/area,
// its current content, its guest-review signal, and its booking settings (cancellation, instant
// book, min stay). MASTER content syncs to every channel; written to Airbnb's stricter, highest-
// converting standard. HARD honesty: never invent facts, distances, businesses, or amenities, and
// never print the street address/codes. Generate-only; push via /api/listing-content.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const SECTION_DEFS: { key: string; label: string; guide: string }[] = [
  { key: 'summary', label: 'Summary', guide: 'The headline blurb shown first (maps to the main Airbnb/Vrbo description). HARD CAP 500 characters. Open with a hook that pairs the experience with one quantified, REAL perk only if the data supports it; state layout (beds/baths/sleeps) early; weave in real search keywords naturally; close warm. Most important field.' },
  { key: 'space', label: 'The space', guide: 'The SELLING section — make the reader want to book. Walk them through the home the way the PHOTOS show it: open with the single most compelling, true visual highlight (the view, the natural light, the kitchen, the pool), then room-by-room in short labeled lines or tight paragraphs (17 West house style): bedrooms + bed types, bathrooms, kitchen, living/dining, outdoor space, views, standout finishes, building amenities (pool, gym, parking). Keep it INVITING and broad - describe what the home offers in warm, confident strokes and list its real features. Use the photos to stay accurate and CONFIRM claims, but do NOT over-specify fine detail (exact materials, brands, precise finishes) unless you are 100% sure from a photo or the data; when unsure stay general (e.g. a bright open living area, a full kitchen, ample outdoor space) rather than risk a wrong specific. Lead with benefits (how it FEELS to stay), not a dry inventory. Concrete, vivid, scannable. ~700-1300 characters.' },
  { key: 'access', label: 'Guest access', guide: 'What the guest can use and how they get in: which areas/amenities are theirs, parking, building/elevator access, self check-in if the data indicates it. NEVER include the street address, unit number, real codes, phone, or URLs. ~300-700 characters.' },
  { key: 'neighborhood', label: 'Neighborhood', guide: 'The area and concrete THINGS TO DO nearby, using the real city/area from the address. Name only WELL-KNOWN, real nearby beaches, dining/nightlife districts and attractions for that exact city. Highlight genuinely desirable, KEY draws - do NOT pad with trivial conveniences (a laundromat, convenience store, ATM, gas station, pharmacy). Do NOT fabricate distances or specific business names you are not sure of — keep proximity general unless the data states it. ~500-1000 characters.' },
  { key: 'transit', label: 'Getting around', guide: 'Transport and orientation for the real area: parking, whether a car is useful, walkability, airport proximity in general terms. Do not invent precise drive times or distances. ~250-600 characters.' },
  { key: 'notes', label: 'Other notes', guide: 'Standardized "Listing Notes" - write as short, scannable lines (one per item), factual and welcoming. NEVER mention the cancellation policy or refunds anywhere in this section. Include these lines, lightly adapted to this listing: (1) ONLY IF facts.minAge21 is true: "The primary guest must be 21 years or older to check in"; (2) "No smoking or parties permitted"; (3) "Guests must sign the rental agreement and check-in form before arrival - these are mandatory to confirm your reservation and receive access instructions"; (4) "Please review all house rules prior to arrival for a seamless experience"; (5) "Only initial consumables (toiletries, coffee, paper products) are provided; additional supplies can be requested for a small fee"; (6) "Mid-stay cleaning services are available upon request for an additional fee"; (7) "Additional accessibility details and building policies available upon request before booking". ~400-800 characters.' },
]

const TITLE_MAX = 50
function str(v: any): string { return typeof v === 'string' ? v : '' }

// Cancellation policy: read across the fields Guesty / channels use.
function integrationField(raw: any, key: string): any {
  const ints = Array.isArray(raw?.integrations) ? raw.integrations : []
  for (const name of ['airbnb2', 'airbnb']) for (const it of ints) { const c = it?.[name]; if (c && c[key] != null) return c[key] }
  for (const it of ints) for (const ck of Object.keys(it || {})) { const c = (it as any)[ck]; if (c && typeof c === 'object' && c[key] != null) return c[key] }
  return null
}

function cancellationPolicy(raw: any): string | null {
  const candidates = [
    integrationField(raw, 'cancellationPolicy'),
    raw?.terms?.cancellation, raw?.prices?.guestyCancellationPolicy, raw?.cancellationPolicy,
    raw?.airbnb?.cancellationPolicy, raw?.bookingcom?.cancellationPolicy, raw?.cancellation,
  ].map(str).filter(Boolean)
  const v = candidates[0]
  return v ? v.replace(/_/g, ' ') : null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const [{ data: listing, error }, { data: reviewRows }] = await Promise.all([
    sb.from('guesty_listings')
      .select('id, title, nickname, building, unit, room_type, tags, address_full, address_city, address_state, bedrooms, bathrooms, max_occupancy, amenities, status, raw')
      .eq('id', listingId).single(),
    sb.from('guesty_reviews').select('rating, content').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(40),
  ])
  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const raw: any = (listing as any).raw || {}
  const pub: any = raw.publicDescription || raw.publicDescriptions || {}
  const get = (k: string) => str(pub?.[k])

  const current = {
    title: listing.title || raw.title || listing.nickname || '',
    summary: get('summary'), space: get('space'), access: get('access'),
    neighborhood: get('neighborhood'), transit: get('transit'), notes: get('notes'),
  }

  // Real location (used to identify the area + name real nearby places — NOT to print verbatim).
  const addr = raw?.address || {}
  const location = {
    streetAddress: listing.address_full || str(addr.full) || null,
    city: listing.address_city || str(addr.city) || null,
    state: listing.address_state || str(addr.state) || null,
    neighborhood: str(addr.neighborhood) || null,
    lat: addr.lat ?? null, lng: addr.lng ?? null,
  }

  // Booking settings — also the inputs behind the property page's Optimize Score.
  const terms = raw.terms || {}
  const ibCategory = integrationField(raw, 'instantBookingAllowedCategory')
  const instantRaw = raw?.instantBookable ?? raw?.instantBook ?? (typeof ibCategory === 'string' && ibCategory && ibCategory.toLowerCase() !== 'off' ? true : (ibCategory != null ? ibCategory : null))
  const settings = {
    cancellationPolicy: cancellationPolicy(raw),
    instantBook: instantRaw === true || instantRaw === 'true' ? true : (instantRaw == null ? null : false),
    minNights: terms.minNights ?? raw?.defaultListingMinNights ?? null,
    maxNights: terms.maxNights ?? null,
    checkInTime: raw?.defaultCheckInTime ?? null,
    checkOutTime: raw?.defaultCheckOutTime ?? null,
  }

  // Guest-review signal: what guests genuinely praise (lean in) + average rating.
  const reviews = Array.isArray(reviewRows) ? reviewRows : []
  const rated = reviews.map(r => Number(r.rating)).filter(n => Number.isFinite(n))
  const avgRating = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null
  const praise = reviews
    .filter(r => (Number(r.rating) >= 4 || r.rating == null) && str(r.content).trim().length > 12)
    .map(r => str(r.content).replace(/\s+/g, ' ').trim().slice(0, 220)).slice(0, 8)
  const reviewSignal = { count: reviews.length, avgRating, guestPraiseSamples: praise }

  const facts = {
    currentTitle: current.title || null,
    nickname: listing.nickname || null,
    building: listing.building || null,
    unit: listing.unit || null,
    roomType: listing.room_type || null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    sleeps: listing.max_occupancy ?? null,
    amenities: Array.isArray(listing.amenities) ? listing.amenities.slice(0, 80) : (listing.amenities ?? null),
    tags: Array.isArray(listing.tags) ? listing.tags.slice(0, 30) : (listing.tags ?? null),
    location, bookingSettings: settings,
    minAge21: /arya|amrit|district\s*225/i.test(str(listing.building)),
  }

  // ── Photos for VISION: let the model SEE the actual space, verify features, and write copy that sells ──
  const rawPics: any[] = Array.isArray(raw.pictures) ? raw.pictures : (Array.isArray((listing as any).pictures) ? (listing as any).pictures : [])
  const photoUrls: string[] = rawPics
    .map((pic: any) => typeof pic === 'string' ? pic : str(pic?.original || pic?.large || pic?.regular || pic?.url || pic?.thumbnail || ''))
    .filter((u: string) => /^https?:\/\//.test(u))
    .slice(0, 8)
  const photoBlocks = photoUrls.map((u: string) => ({ type: 'image', source: { type: 'url', url: u } }))

  // 17 West is the in-house GOLD STANDARD for the 'space' voice/format. Pull a real example to anchor
  // the style - match its voice/format as a BASELINE, then ENHANCE beyond it.
  let spaceExemplar = ''
  try {
    const { data: ex } = await sb.from('guesty_listings').select('building, raw').or('building.ilike.%17 west%,building.ilike.%17west%').limit(20)
    const cands = (ex ?? []).map((rr: any) => str(rr?.raw?.publicDescription?.space)).filter(Boolean).sort((a: string, b: string) => b.length - a.length)
    if (cands[0]) spaceExemplar = cands[0].slice(0, 1400)
  } catch { /* exemplar is best-effort */ }

  // ── Single-section mode ──────────────────────────────────────────────────────
  // When the UI asks to regenerate ONE field (optionally with a custom instruction),
  // rewrite just that field and return { section, text, rationale, warnings }.
  const singleSection: string | null = typeof body?.section === 'string' && body.section ? body.section : null
  const instruction = str(body?.instruction).trim().slice(0, 600)
  const currentDraft = str(body?.currentText)
  if (singleSection) {
    const isTitle = singleSection === 'title'
    const def = SECTION_DEFS.find(s => s.key === singleSection)
    if (!isTitle && !def) return NextResponse.json({ error: 'unknown section' }, { status: 400 })
    const guide = isTitle
      ? `Title: hard limit ${TITLE_MAX} characters including spaces; front-load the strongest true differentiators (mobile cards truncate ~32 chars); Title Case; no emoji, repeated symbols, ALL-CAPS words, phone/email/URLs.`
      : `${def!.label}: ${def!.guide}`
    const SYS = `You are a senior short-term-rental listing copywriter for Stay Hospitality (South Florida). You are rewriting ONE field of the Guesty MASTER listing content, which syncs to Airbnb, Vrbo, Expedia and Booking.com. Write to Airbnb's stricter, highest-converting standard.

ABSOLUTE HONESTY (most important): Use ONLY facts in the JSON provided below. If you are not certain of a distance, a specific business/attraction name, an amenity, a view, or a room count, omit it or stay general. Never guess, embellish, or invent. Better to say less, accurately - this goes on a live listing.
LOCATION: a real area is provided; use it ONLY to name genuinely well-known, real nearby places for that exact city. NEVER print the street address, unit number, lock/door codes, phone, email, or URLs.
PHOTOS: the listing's actual photos are attached - study them and ground this field in what they genuinely show; use them to VERIFY (only state what's visible in a photo or in the data). DISTINGUISH real unit/building photos from generic area/stock photos (skyline, beach, map, landmarks, decor stock) - only ground home-feature claims in real unit photos; stock/area shots inform Neighborhood only. NEVER claim a garage (no unit has one).\nHOUSE STYLE: structured and scannable; lead with the strongest true point; vivid but never padded; write to SELL the stay.

You are writing ONLY this field:
${guide}
${instruction ? `\nTHE USER WANTS THIS SPECIFIC CHANGE (apply it, within the honesty rules above): "${instruction}"` : ''}

OUTPUT: STRICT minified JSON only, nothing else, exactly: {"text":"...","rationale":"..."}
- "text" = the new field content as a single non-empty string (for the title, obey the character limit).
- "rationale" = one short sentence on why it is stronger.`
    const USR = `Field to rewrite: "${singleSection}".
${singleSection === 'space' && spaceExemplar ? `\n17 WEST STYLE EXEMPLAR (match its voice/format as a baseline, then ENHANCE; do NOT copy its facts):\n"""${spaceExemplar}"""\n` : ''}

VERIFIED FACTS (use ONLY these; never invent beyond them):
${JSON.stringify(facts)}

GUEST REVIEW SIGNAL - you MAY share what guests genuinely PRAISE, in your own words (e.g. "guests love the natural light and the walkable location"). NEVER state a star rating, a numeric score, or "X-star"; never quote a review verbatim:
${JSON.stringify(reviewSignal)}

CURRENT TEXT for this field (improve on it):
${JSON.stringify(currentDraft || (current as any)[singleSection] || '')}`
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: SYS, messages: [{ role: 'user', content: [{ type: 'text', text: USR }, ...photoBlocks] }] }),
      })
      const d: any = await r.json()
      if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
      const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
      const parsed = parseJson(text)
      if (!parsed || typeof parsed.text !== 'string') return NextResponse.json({ error: 'Model returned an unparseable response.' }, { status: 502 })
      const value = String(parsed.text).trim()
      const warnings: string[] = []
      if (isTitle) {
        if (value.length > TITLE_MAX) warnings.push(`Title is ${value.length} chars - over the ${TITLE_MAX}-char limit. Trim before pushing.`)
        for (const f of forbiddenIn(value)) warnings.push(`Title contains ${f} - channels may reject it.`)
      } else {
        const bad = forbiddenIn(value).filter(x => x === 'a phone number' || x === 'an email address' || x === 'a URL')
        if (bad.length) warnings.push(`This section contains ${bad.join(' and ')} - remove it before pushing.`)
        const streetNum = location.streetAddress ? String(location.streetAddress).match(/\d{2,}/)?.[0] : null
        if (streetNum && value.includes(streetNum)) warnings.push('This section may contain the street address - remove it before pushing.')
        if (singleSection === 'summary' && value.length > 500) warnings.push(`Summary is ${value.length} chars - over the 500-char limit Airbnb shows before "read more".`)
      }
      return NextResponse.json({ listingId, section: singleSection, text: value, titleMax: TITLE_MAX, rationale: String(parsed.rationale || '').trim(), warnings })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
    }
  }

  const sectionSpec = SECTION_DEFS.map(s => `- "${s.key}" (${s.label}): ${s.guide}`).join('\n')

  const SYSTEM = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager (Miami Beach / Fort Lauderdale / Broward). You write the MASTER listing content stored in Guesty, which syncs to Airbnb, Vrbo, Expedia and Booking.com. Write to Airbnb's stricter, highest-converting standard so it is excellent everywhere.

GOALS
1) MAXIMIZE VISIBILITY: OTAs rank complete, specific, keyword-rich, high-converting listings. Fill every section fully with REAL detail; lead with the strongest true differentiators.
2) SET GREAT, HONEST EXPECTATIONS: lean into what guests genuinely praise (review signal); never over-promise. Accurate, complete copy earns better reviews and ranking over time.

ABSOLUTE HONESTY (THE MOST IMPORTANT RULE)
- Use ONLY facts present in the JSON below (data, location, current content, review signal, booking settings). If you are NOT certain of something — an exact distance, a specific restaurant/shop/attraction name, a drive time, an amenity, a view, a room count — DO NOT state it. Omit it or stay general. Never guess, never embellish, never invent.
- It is far better to say less, accurately, than to say more and be wrong. This copy goes on a live listing.

LOCATION (use it; never print it verbatim)
- A real address/area is provided. Use it ONLY to identify the actual city/neighborhood so you can name genuinely well-known, real nearby places for THAT exact city (e.g. for Miami Beach: South Beach, Lincoln Road, Ocean Drive; for Fort Lauderdale: Las Olas, Fort Lauderdale Beach). Reference only landmarks you are confident actually exist for that city.
- NEVER print the exact street address, unit number, lock/door codes, phone, email, or URLs anywhere in the copy. Keep proximity general ("a short walk to the beach") unless the data gives an exact distance.

PHOTOS (you can SEE them — use them)
- The listing's actual photos are attached. STUDY them. Ground the copy (especially "The space") in what the images genuinely show: layout, light, finishes, views, outdoor areas, standout features.
- Use the photos to VERIFY before you write. Only describe what is visible in a photo or stated in the data. If a claimed amenity/view isn't visible or in the data, leave it out. The photos are your fact-check.
- REAL vs STOCK: some photos are NOT of this home - they are generic area/stock shots (city skyline, beach, map, sunset, neighborhood landmarks, building exterior renderings, lifestyle/decor stock). You must tell these apart. ONLY ground home-feature claims (rooms, layout, finishes, views from the unit, the unit's outdoor space) in photos that genuinely show THIS unit or building. Generic area/stock photos may ONLY inform the Neighborhood section - never describe them as part of the home.
- NEVER claim a GARAGE or garage parking - none of these units have a garage. If parking exists per the data, describe it generically (e.g. parking available) and never call it a garage.
- Lead with the most visually compelling TRUE selling points. Make a reader picture themselves there.

HOUSE STYLE (model the strong "17 West" formatting)
- Structured and scannable: short labeled lines or tight, skimmable paragraphs per topic; lead each section with its strongest true point. Vivid but never padded or flowery.

TITLE RULES
- Hard limit ${TITLE_MAX} characters including spaces. Front-load the strongest true differentiators (mobile cards truncate ~32 chars). Title Case. No emoji, no repeated symbols, no ALL-CAPS words (proper nouns OK), no phone/email/URLs.

SECTION RULES (Guesty publicDescription fields)
${sectionSpec}

SOUTH FLORIDA KEYWORDS — only when the data supports them: "ocean view", "walk to the beach", "pool", "hot tub", "free parking", "king bed", real neighborhoods, real property types. Quantify location only if the data provides the figure.

NOTES SECTION: NEVER mention the cancellation policy or refunds anywhere (not in notes, not elsewhere). Write the "Other notes" field using the standardized Listing Notes format described above.

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else (no markdown, no code fences, no commentary). Exactly this shape:
{"title":"...","summary":"...","space":"...","access":"...","neighborhood":"...","transit":"...","notes":"...","rationale":"..."}
- Every section is a non-empty string. "rationale": 1-2 sentences on why this wins on visibility + honest expectation-setting.`

  const USER = `Rewrite the master content for this listing.
${instruction ? `\nMUST-INCLUDE FROM JON (work this in naturally, within the honesty rules - never invent facts to satisfy it): "${instruction}"\n` : ''}${spaceExemplar ? `\n17 WEST STYLE EXEMPLAR for the 'space' field - match this VOICE and FORMAT as your baseline, then ENHANCE it (even more compelling, photo-grounded). Do NOT copy its specific facts:\n"""${spaceExemplar}"""\n` : ''}

VERIFIED FACTS (use ONLY these; never invent beyond them):
${JSON.stringify(facts)}

GUEST REVIEW SIGNAL - you MAY share what guests genuinely PRAISE, in your own words (e.g. "guests love the natural light and the walkable location"). NEVER state a star rating, a numeric score, or "X-star"; never quote a review verbatim:
${JSON.stringify(reviewSignal)}

CURRENT GUESTY CONTENT (improve on this; it may be thin or empty):
${JSON.stringify(current)}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2400, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: USER }, ...photoBlocks] }] }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })

    const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    const parsed = parseJson(text)
    if (!parsed) return NextResponse.json({ error: 'Model returned an unparseable response.', raw: text.slice(0, 400) }, { status: 502 })

    const proposed = {
      title: String(parsed.title || '').trim(),
      summary: String(parsed.summary || '').trim(),
      space: String(parsed.space || '').trim(),
      access: String(parsed.access || '').trim(),
      neighborhood: String(parsed.neighborhood || '').trim(),
      transit: String(parsed.transit || '').trim(),
      notes: String(parsed.notes || '').trim(),
    }

    const warnings: string[] = []
    if (proposed.title.length > TITLE_MAX) warnings.push(`Title is ${proposed.title.length} chars - over the ${TITLE_MAX}-char Guesty/Airbnb limit. Trim before pushing.`)
    for (const f of forbiddenIn(proposed.title)) warnings.push(`Title contains ${f} - channels may reject it.`)
    if (proposed.summary.length > 500) warnings.push(`Summary is ${proposed.summary.length} chars - over the 500-char limit Airbnb shows before "read more".`)
    const streetNum = location.streetAddress ? String(location.streetAddress).match(/\d{2,}/)?.[0] : null
    for (const [k, v] of Object.entries(proposed)) {
      if (k === 'title') continue
      const bad = forbiddenIn(v as string).filter(x => x === 'a phone number' || x === 'an email address' || x === 'a URL')
      if (bad.length) warnings.push(`The ${k} section contains ${bad.join(' and ')} - remove it before pushing.`)
      if (streetNum && String(v).includes(streetNum)) warnings.push(`The ${k} section may contain the street address - remove it before pushing.`)
    }

    return NextResponse.json({
      listingId,
      titleMax: TITLE_MAX,
      sections: SECTION_DEFS.map(s => ({ key: s.key, label: s.label })),
      current, proposed, reviewSignal,
      bookingSettings: settings,
      location: { city: location.city, state: location.state, neighborhood: location.neighborhood },
      rationale: String(parsed.rationale || '').trim(),
      warnings,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

function forbiddenIn(s: string): string[] {
  const out: string[] = []
  if (!s) return out
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) out.push('an email address')
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) out.push('a URL')
  if (/(?:\+?\d[\s().-]?){7,}/.test(s)) out.push('a phone number')
  if (/[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(s)) out.push('an emoji')
  if (/[!*#]{2,}/.test(s)) out.push('repeated symbols (!!! / ***)')
  if (/\b[A-Z]{4,}\b/.test(s)) out.push('an ALL-CAPS word')
  return out
}

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let obj = tryParse(raw)
  if (!obj) obj = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!obj) {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
    if (a !== -1 && b > a) obj = tryParse(raw.slice(a, b + 1))
  }
  return obj && typeof obj === 'object' ? obj : null
}
