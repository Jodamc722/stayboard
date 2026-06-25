// AI listing optimizer -> Guesty master content. Generates an optimized title +
// all six Guesty publicDescription sections (summary, space, access, neighborhood,
// transit, notes), grounded ONLY in a single guesty_listings row's verified data and
// its current content. This is the MASTER content Guesty syncs to every channel, so it
// is written to Airbnb's stricter, highest-converting standard. Generate-only here;
// the human approves and pushes via /api/listing-content. Requires ANTHROPIC_API_KEY.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

// The six Guesty publicDescription sections, in display order.
const SECTION_DEFS: { key: string; label: string; guide: string }[] = [
  { key: 'summary', label: 'Summary', guide: 'The headline blurb shown first (this maps to the main Airbnb/Vrbo description). HARD CAP 500 characters. Open with a hook that pairs the experience with one quantified, real perk (e.g. "5-min walk to the sand"); state layout (beds/baths/sleeps) early; weave in real search keywords naturally; close warm. This is the single most important field.' },
  { key: 'space', label: 'The space', guide: 'Room-by-room layout and standout features: bedrooms + bed types, bathrooms, kitchen, living areas, outdoor space, square feel, views. Concrete and scannable. ~600-1200 characters.' },
  { key: 'access', label: 'Guest access', guide: 'What the guest can use and how they get in: which areas/amenities are theirs, parking, building access, self check-in if applicable. Do NOT include real codes, addresses, phone, or URLs. ~300-700 characters.' },
  { key: 'neighborhood', label: 'Neighborhood', guide: 'The area and what is nearby: walkability, beach/downtown proximity (quantified when in the data), dining/shops, vibe. Roughly 90% of guests want surrounding-area info. ~400-900 characters.' },
  { key: 'transit', label: 'Getting around', guide: 'Transport and orientation: parking, distance/time to the beach or key spots, airport proximity, whether a car is useful, rideshare/walkability. ~250-600 characters.' },
  { key: 'notes', label: 'Other notes', guide: 'Anything else that helps the guest decide or sets expectations honestly: who it suits, building amenities, quiet-enjoyment notes. Keep positive and factual. ~200-600 characters.' },
]

const TITLE_MAX = 50

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const { data: listing, error } = await supabaseAdmin()
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, amenities, status, raw')
    .eq('id', listingId)
    .single()

  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const raw: any = (listing as any).raw || {}
  const pub: any = raw.publicDescription || raw.publicDescriptions || {}
  const get = (k: string) => (typeof pub?.[k] === 'string' ? pub[k] : '')

  // Current content (what is on Guesty today) so the model improves on it, not blind.
  const current = {
    title: listing.title || raw.title || listing.nickname || '',
    summary: get('summary'), space: get('space'), access: get('access'),
    neighborhood: get('neighborhood'), transit: get('transit'), notes: get('notes'),
  }

  // Verified fact sheet - the model may ONLY use these facts.
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
  }

  const sectionSpec = SECTION_DEFS.map(s => `- "${s.key}" (${s.label}): ${s.guide}`).join('\n')

  const SYSTEM = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager (Miami Beach / Fort Lauderdale / Broward). You write the MASTER listing content stored in Guesty, which syncs out to Airbnb, Vrbo, Expedia and Booking.com. Write to Airbnb's stricter, highest-converting standard so it is excellent everywhere.

YOUR JOB
Rewrite this listing's TITLE and ALL SIX description sections so they are complete, vivid, accurate, keyword-smart, and conversion-focused. Every section must be filled — never leave one blank. Improve on the current content; do not simply copy it.

TITLE RULES
- Hard limit ${TITLE_MAX} characters including spaces. Mobile search cards truncate near 32 chars, so FRONT-LOAD the strongest differentiators first.
- Title Case. No emoji, no repeated symbols (!!! ***), no ALL-CAPS words (proper nouns/abbreviations OK), no phone/email/URLs (two words joined by a dot read as a URL and fail to publish).
- Do not waste characters on the city or bed count if the platform already shows them; lead with what makes THIS place special.

SECTION RULES (Guesty publicDescription fields)
${sectionSpec}

SOUTH FLORIDA KEYWORD GUIDANCE
- Use high-value, real searchable terms only when the data supports them: "ocean view", "walk to the beach", "pool", "hot tub", "free parking", "king bed", specific neighborhoods (e.g. "Miami Beach", "South Pointe", "Las Olas", "Fort Lauderdale Beach"), and specific property types ("penthouse", "villa", "condo"). Quantify location ("5-min walk to the sand") rather than vague ("close to beach").

HONESTY (CRITICAL)
- You may ONLY use facts present in the listing JSON below. NEVER invent amenities, room counts, views, distances, codes, or features. If a fact is missing, write around it honestly — do not guess. This copy goes onto a live listing.
- Never include phone numbers, emails, URLs, street addresses, or door/lock codes in any field.

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else (no markdown, no code fences, no commentary). Exactly this shape:
{"title":"...","summary":"...","space":"...","access":"...","neighborhood":"...","transit":"...","notes":"...","rationale":"..."}
- Every section is a non-empty string.
- "rationale": 1-2 sentences on why this version converts better.`

  const USER = `Rewrite the master content for this listing.

VERIFIED FACTS (use ONLY these):
${JSON.stringify(facts)}

CURRENT GUESTY CONTENT (improve on this; it may be thin or empty):
${JSON.stringify(current)}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2200,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
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
