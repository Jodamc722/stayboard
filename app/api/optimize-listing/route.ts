// AI listing optimizer -> Guesty master content. Generates an optimized title + all six
// Guesty publicDescription sections (summary, space, access, neighborhood, transit, notes),
// grounded ONLY in a single listing's verified data, its current content, its real guest-review
// signal, and its booking settings. This is the MASTER content Guesty syncs to every channel, so
// it is written to Airbnb's stricter, highest-converting standard for maximum visibility and to set
// great, honest expectations. Generate-only here; the human approves + pushes via /api/listing-content.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const SECTION_DEFS: { key: string; label: string; guide: string }[] = [
  { key: 'summary', label: 'Summary', guide: 'The headline blurb shown first (maps to the main Airbnb/Vrbo description). HARD CAP 500 characters. Open with a hook that pairs the experience with one quantified, real perk (e.g. "5-min walk to the sand"); state layout (beds/baths/sleeps) early; weave in real search keywords naturally; close warm. Most important field.' },
  { key: 'space', label: 'The space', guide: 'Room-by-room layout and standout features in short labeled lines or tight paragraphs (this is the 17 West house style): bedrooms + bed types, bathrooms, kitchen, living areas, outdoor space, views, building amenities (pool, gym, parking). Concrete and scannable. ~700-1300 characters.' },
  { key: 'access', label: 'Guest access', guide: 'What the guest can use and how they get in: which areas/amenities are theirs, parking, building/elevator access, self check-in if applicable. NEVER include real codes, full addresses, phone, or URLs. ~300-700 characters.' },
  { key: 'neighborhood', label: 'Neighborhood', guide: 'The area and concrete THINGS TO DO nearby, using the listing city/area: name real, well-known nearby beaches, dining/nightlife districts, attractions and walkable spots with quantified proximity where the data supports it. Roughly 90% of guests want surrounding-area info, and it is a strong visibility/expectation signal. ~500-1000 characters.' },
  { key: 'transit', label: 'Getting around', guide: 'Transport and orientation: parking, distance/time to the beach or key spots, airport proximity, whether a car is useful, rideshare/walkability. ~250-600 characters.' },
  { key: 'notes', label: 'Other notes', guide: 'Anything else that sets honest expectations and prevents bad surprises: who it suits best, building/HOA notes, quiet-enjoyment, the booking/cancellation flexibility if known. Keep positive and factual. ~250-700 characters.' },
]

const TITLE_MAX = 50

function str(v: any): string { return typeof v === 'string' ? v : '' }

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
      .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, amenities, status, raw')
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

  // Booking settings / "scoring" inputs - flexible policies and clear terms lift conversion + visibility.
  const terms = raw.terms || {}
  const settings = {
    minNights: terms.minNights ?? raw.defaultCheckInTime ?? null,
    maxNights: terms.maxNights ?? null,
    cancellationPolicy: str(raw.cancellationPolicy || raw?.prices?.cancellation || raw?.cancellation || '') || null,
    checkInTime: raw.defaultCheckInTime ?? null,
    checkOutTime: raw.defaultCheckOutTime ?? null,
    instantBookable: raw.instantBookable ?? null,
  }

  // Guest-review signal: what guests actually praise (lean in) + overall rating, to set great honest expectations.
  const reviews = Array.isArray(reviewRows) ? reviewRows : []
  const rated = reviews.map(r => Number(r.rating)).filter(n => Number.isFinite(n))
  const avgRating = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null
  const praise = reviews
    .filter(r => (Number(r.rating) >= 4 || r.rating == null) && str(r.content).trim().length > 12)
    .map(r => str(r.content).replace(/\s+/g, ' ').trim().slice(0, 220))
    .slice(0, 8)
  const reviewSignal = { count: reviews.length, avgRating, guestPraiseSamples: praise }

  const facts = {
    currentTitle: current.title || null,
    nickname: listing.nickname || null,
    building: listing.building || null,
    unit: listing.unit || null,
    roomType: listing.room_type || null,
    city: listing.address_city || null,
    state: listing.address_state || null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    sleeps: listing.max_occupancy ?? null,
    amenities: Array.isArray(listing.amenities) ? listing.amenities.slice(0, 80) : (listing.amenities ?? null),
    tags: Array.isArray(listing.tags) ? listing.tags.slice(0, 30) : (listing.tags ?? null),
    bookingSettings: settings,
  }

  const sectionSpec = SECTION_DEFS.map(s => `- "${s.key}" (${s.label}): ${s.guide}`).join('\n')

  const SYSTEM = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager (Miami Beach / Fort Lauderdale / Broward). You write the MASTER listing content stored in Guesty, which syncs out to Airbnb, Vrbo, Expedia and Booking.com. Write to Airbnb's stricter, highest-converting standard so it is excellent everywhere.

YOUR TWO GOALS
1) MAXIMIZE VISIBILITY: OTAs rank complete, specific, keyword-rich, high-converting listings. Fill every section fully; use real searchable terms; quantify; lead with the strongest differentiators.
2) SET GREAT, HONEST EXPECTATIONS: guests rate against expectations. Lean into what guests genuinely praise (see the review signal), and never over-promise. Accurate, vivid, complete copy earns better reviews and ranking over time.

HOUSE STYLE (model the strong "17 West" formatting)
- Structured and scannable: short labeled lines or tight, skimmable paragraphs per topic; lead each section with its strongest point. Vivid but never flowery or padded.
- Use the listing's CITY/AREA to name real, well-known nearby things to do (beaches, dining/nightlife districts, attractions, walkable spots) in the Neighborhood section. It is fine to reference the area and landmarks; never include the exact street address, codes, phone, email, or URLs.

TITLE RULES
- Hard limit ${TITLE_MAX} characters including spaces. Mobile cards truncate near 32 chars, so FRONT-LOAD the strongest differentiators. Title Case. No emoji, no repeated symbols, no ALL-CAPS words (proper nouns OK), no phone/email/URLs.

SECTION RULES (Guesty publicDescription fields)
${sectionSpec}

SOUTH FLORIDA KEYWORD GUIDANCE
- Use high-value, real searchable terms ONLY when the data supports them: "ocean view", "walk to the beach", "pool", "hot tub", "free parking", "king bed", neighborhoods ("Miami Beach", "South Pointe", "Las Olas", "Fort Lauderdale Beach"), property types ("penthouse", "villa", "condo"). Quantify location ("5-min walk to the sand") rather than vague ("close to beach").

HONESTY (CRITICAL)
- Use ONLY facts present in the listing JSON below (data, current content, review signal, booking settings). NEVER invent amenities, room counts, views, distances, codes, or features. If a fact is missing, write around it honestly. Never include phone numbers, emails, URLs, street addresses, or door/lock codes in any field.
- The guest-review samples are signal for what to emphasize and the tone guests respond to; do not quote them verbatim or invent specifics from them.

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else (no markdown, no code fences, no commentary). Exactly this shape:
{"title":"...","summary":"...","space":"...","access":"...","neighborhood":"...","transit":"...","notes":"...","rationale":"..."}
- Every section is a non-empty string. "rationale": 1-2 sentences on why this version wins on visibility and expectation-setting.`

  const USER = `Rewrite the master content for this listing.

VERIFIED FACTS (use ONLY these):
${JSON.stringify(facts)}

GUEST REVIEW SIGNAL (lean into what guests praise; set honest expectations; do not quote verbatim):
${JSON.stringify(reviewSignal)}

CURRENT GUESTY CONTENT (improve on this; it may be thin or empty):
${JSON.stringify(current)}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2400, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
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
    for (const [k, v] of Object.entries(proposed)) {
      if (k === 'title') continue
      const bad = forbiddenIn(v as string).filter(x => x === 'a phone number' || x === 'an email address' || x === 'a URL')
      if (bad.length) warnings.push(`The ${k} section contains ${bad.join(' and ')} - remove it before pushing.`)
    }

    return NextResponse.json({
      listingId,
      titleMax: TITLE_MAX,
      sections: SECTION_DEFS.map(s => ({ key: s.key, label: s.label })),
      current,
      proposed,
      reviewSignal,
      bookingSettings: settings,
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
