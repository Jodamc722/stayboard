// Platform-aware AI listing optimizer. Tailors title + description to the REAL
// rules of the target OTA (Airbnb / Vrbo / Expedia / Booking.com), grounded ONLY
// in a single guesty_listings row's verified data. Requires ANTHROPIC_API_KEY.
// Logged-in users only. No auto-write to Guesty — generate-only.
//
// Per-OTA rules below are from 2025-2026 platform docs (see research brief):
// - Airbnb:  title <=50 chars; structured description (summary <=500 + The space,
//            Guest access, Neighborhood, Other notes). No emoji/CAPS/contact info.
// - Vrbo:    headline 20-80 chars; single description blob 400-10,000 chars.
// - Expedia: for a Guesty-connected PM, content is governed by VRBO's rules
//            (Vrbo listing syndicates to Expedia via the EDN) — same limits as Vrbo.
// - Booking: you CANNOT write a free-text description (auto-generated from structured
//            fields) and the property NAME is constrained + moderated. So we return a
//            clean name + a content/amenity completeness checklist instead of prose.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Platform = 'airbnb' | 'vrbo' | 'expedia' | 'booking'

const PLATFORMS: Record<Platform, {
  label: string
  mode: 'copy' | 'structured'      // structured = Booking.com (no prose description)
  titleField: string
  titleMin: number
  titleMax: number
  descField: string
  descMin: number
  descMax: number
  rules: string                    // injected into the system prompt
}> = {
  airbnb: {
    label: 'Airbnb',
    mode: 'copy',
    titleField: 'Title',
    titleMin: 0,
    titleMax: 50,
    descField: 'Description',
    descMin: 0,
    descMax: 500,        // the summary/intro field that shows before "read more"
    rules: `TARGET: AIRBNB.
- TITLE: hard limit 50 characters INCLUDING spaces (Airbnb truncates ~32 chars on mobile search cards, so front-load the strongest, most differentiating words first). Title Case. Do NOT repeat the city, bed count, or "New" — Airbnb already shows those. NO emoji, NO repeated symbols (!!! ***), NO ALL CAPS (proper nouns/abbreviations OK), NO phone/email/URLs (two words joined by a dot read as a URL and will fail to publish).
- DESCRIPTION ("summary"): the main blurb shown before "read more" — hard cap 500 characters. Lead with a hook (the experience + a quantified location perk like "5-min walk to the sand"), state layout (beds/baths/sleeps) early, weave in real search keywords naturally, end warm.
- SECTIONS: also produce 3 short supplementary sections that map to Airbnb's fields — "The space" (room-by-room layout + standout features), "Guest access" (what guests can use, parking, entry), and "Neighborhood" (walkability, beach/downtown proximity, vibe). Keep each scannable (a few sentences or bullets).
- Airbnb ranks complete, high-quality, high-converting listings (Quality/Popularity/Price/Location). Completeness and a strong cover-driving hook matter most.`,
  },
  vrbo: {
    label: 'Vrbo',
    mode: 'copy',
    titleField: 'Headline',
    titleMin: 20,
    titleMax: 80,
    descField: 'Description',
    descMin: 400,
    descMax: 10000,
    rules: `TARGET: VRBO.
- HEADLINE: 20-80 characters (the real Vrbo limit — not 65). Front-load the #1 differentiator + property type + location/landmark in the first ~40 chars (search cards truncate). Title Case. NO URLs, HTML, phone numbers, email addresses, or street addresses anywhere — Vrbo rejects them. No ALL CAPS / emoji / promo ("BEST DEAL!!!").
- DESCRIPTION: a single combined block, 400-10,000 characters. Open with a strong hook, then scannable blocks: layout (bed/bath/sleeps), key amenities guests filter for, neighborhood/proximity (quantified), who it suits, and logistics (parking, check-in). Be thorough and specific — Vrbo rewards completeness in search relevance.
- Vrbo combines all description fields into one, so write it as one cohesive description (no separate sub-sections needed).`,
  },
  expedia: {
    label: 'Expedia',
    mode: 'copy',
    titleField: 'Headline',
    titleMin: 20,
    titleMax: 80,
    descField: 'Description',
    descMin: 400,
    descMax: 10000,
    rules: `TARGET: EXPEDIA (via Vrbo).
- For a Guesty-connected property manager, the Expedia.com vacation-rental listing is the VRBO listing syndicated through Expedia's Expanded Distribution Network. So follow VRBO's content rules exactly.
- HEADLINE: 20-80 characters; front-load differentiator + type + location in the first ~40 chars. NO URLs, HTML, phone, email, addresses, ALL CAPS, emoji, or promo language.
- DESCRIPTION: single block, 400-10,000 characters. Hook first, then scannable layout / amenities / quantified location / who-it-suits / logistics. Lead with location and best features — Expedia notes ~90% of guests want surrounding-area info. Be complete: content completeness gates filtered-search visibility.`,
  },
  booking: {
    label: 'Booking.com',
    mode: 'structured',
    titleField: 'Property name',
    titleMin: 3,
    titleMax: 255,
    descField: 'Description',
    descMin: 0,
    descMax: 0,
    rules: `TARGET: BOOKING.COM — IMPORTANT, THIS PLATFORM IS DIFFERENT.
- Booking.com does NOT let you write a free-text guest-facing description. The description is 100% AUTO-GENERATED from structured fields (facilities, room details, location) and auto-translated. Do NOT write a prose description — it cannot be used.
- The only editable text is the PROPERTY NAME: 3-255 characters, clean and Google-friendly (think how a guest would search for it). NO symbols, emoji, repeated capitals, promotional text, phone/email/URLs. Name changes are moderated and reverted if they violate guidelines. Avoid Booking's restricted words (e.g. "wifi", "transfer", "chef", "comfortable", "free").
- Because copy is not the lever on Booking.com, the real optimization is STRUCTURED DATA COMPLETENESS: facilities/amenities configured per unit, room/bed/bath sizes, accurate policies, and photos — these feed the Property Page Score (target 100%) and the Quality Rating, which drive ranking and up to ~18% more bookings.
- So your job for Booking.com: (1) suggest a clean, compliant property name, and (2) produce a prioritized CONTENT-COMPLETENESS CHECKLIST of the specific structured fields/amenities this listing should make sure are filled in (based on the data provided and common gaps), so the auto-generated description and content score improve.`,
  },
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  const platform: Platform = (['airbnb', 'vrbo', 'expedia', 'booking'].includes(body?.platform) ? body.platform : 'airbnb') as Platform
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const cfg = PLATFORMS[platform]

  // Load the listing (service role - verified columns only)
  const { data: listing, error } = await supabaseAdmin()
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, amenities, status')
    .eq('id', listingId)
    .single()

  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  // Compact, honest fact sheet - the model may ONLY use these fields.
  const facts = {
    currentTitle: listing.title || listing.nickname || null,
    nickname: listing.nickname || null,
    building: listing.building || null,
    unit: listing.unit || null,
    roomType: listing.room_type || null,
    city: listing.address_city || null,
    state: listing.address_state || null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    sleeps: listing.max_occupancy ?? null,
    amenities: Array.isArray(listing.amenities) ? listing.amenities.slice(0, 60) : (listing.amenities ?? null),
    tags: Array.isArray(listing.tags) ? listing.tags.slice(0, 30) : (listing.tags ?? null),
  }

  const outputShape = cfg.mode === 'structured'
    ? `{"title":"...","checklist":["...","..."],"rationale":"..."}
- "title": a clean, compliant Booking.com property name (3-255 chars, no symbols/promo/contact info, avoid restricted words).
- "checklist": 5-9 prioritized, specific content-completeness actions (structured fields / amenities / photos to fill in) that will lift this listing's Property Page Score. Base them on the listing data and the common gaps.
- "rationale": 1-2 sentences on why this lifts Booking.com ranking.`
    : `{"title":"...","description":"...","sections":[{"label":"...","text":"..."}],"bullets":["..."],"rationale":"..."}
- "title": the optimized ${cfg.titleField.toLowerCase()} (${cfg.titleMin > 0 ? cfg.titleMin + '-' : '<= '}${cfg.titleMax} chars).
- "description": the optimized ${cfg.descField.toLowerCase()} (${cfg.descMin > 0 ? cfg.descMin + '-' + cfg.descMax : '<= ' + cfg.descMax} chars).
- "sections": ${platform === 'airbnb'
        ? 'exactly 3 supplementary sections with labels "The space", "Guest access", and "Neighborhood".'
        : 'an empty array [] (this platform uses one combined description).'}
- "bullets": 4-7 short highlight bullets (amenity/feature one-liners) drawn only from the data.
- "rationale": 1-2 sentences on why this is stronger for ${cfg.label} ranking & conversion.`

  const SYSTEM = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager (Miami Beach / Broward). You optimize OTA listing copy to the SPECIFIC target platform's real, current best practices.

${cfg.rules}

SOUTH FLORIDA KEYWORD GUIDANCE
- High-value, real searchable terms when (and only when) the data supports them: "ocean view", "walk to the beach", "pool", "hot tub", "free parking", "king bed", specific neighborhoods (e.g. "Miami Beach", "South Pointe", "Lincoln Road"), and specific property types ("penthouse", "villa", "condo"). Quantify location ("5-min walk to the sand") rather than vague ("close to beach").

HONESTY (CRITICAL)
- You may ONLY use facts in the listing JSON below. NEVER invent amenities, room counts, views, distances, or features not in the data. If a fact is missing, omit it — do not guess. This copy can go onto a live listing.

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else — no markdown, no commentary, no code fences. Exactly this shape:
${outputShape}`

  const USER = `Optimize this listing for ${cfg.label}. Real listing data (use ONLY these facts):
${JSON.stringify(facts)}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1400,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })

    const raw = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    const parsed = parseSuggestion(raw)
    if (!parsed) return NextResponse.json({ error: 'Model returned an unparseable response.', raw: raw.slice(0, 400) }, { status: 502 })

    // Server-side validation + warnings (don't trust the model on hard limits).
    const warnings: string[] = []
    const title = parsed.title || ''
    if (title.length > cfg.titleMax) warnings.push(`${cfg.titleField} is ${title.length} chars — over the ${cfg.titleMax}-char ${cfg.label} limit. Trim it before publishing.`)
    if (cfg.titleMin > 0 && title.length > 0 && title.length < cfg.titleMin) warnings.push(`${cfg.titleField} is ${title.length} chars — under ${cfg.label}'s ${cfg.titleMin}-char minimum.`)
    for (const f of forbiddenIn(title)) warnings.push(`${cfg.titleField} contains ${f} — ${cfg.label} may reject it.`)

    if (cfg.mode === 'copy') {
      const desc = parsed.description || ''
      if (cfg.descMax && desc.length > cfg.descMax) warnings.push(`${cfg.descField} is ${desc.length} chars — over ${cfg.label}'s ${cfg.descMax}-char limit.`)
      if (cfg.descMin && desc.length > 0 && desc.length < cfg.descMin) warnings.push(`${cfg.descField} is ${desc.length} chars — under ${cfg.label}'s ${cfg.descMin}-char minimum.`)
    }

    const suggestion = {
      platform,
      platformLabel: cfg.label,
      mode: cfg.mode,
      titleField: cfg.titleField,
      titleMax: cfg.titleMax,
      descField: cfg.descField,
      descMax: cfg.descMax,
      title,
      description: parsed.description || '',
      sections: Array.isArray(parsed.sections) ? parsed.sections.filter((s: any) => s && s.text) : [],
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
      rationale: parsed.rationale || '',
      warnings,
    }

    return NextResponse.json({ suggestion })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// Detect content OTAs reject in titles/names.
function forbiddenIn(s: string): string[] {
  const out: string[] = []
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) out.push('an email address')
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) out.push('a URL')
  if (/(?:\+?\d[\s().-]?){7,}/.test(s)) out.push('a phone number')
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) out.push('an emoji')
  if (/[!*#]{2,}/.test(s)) out.push('repeated symbols (!!! / ***)')
  if (/\b[A-Z]{4,}\b/.test(s)) out.push('an ALL-CAPS word')
  return out
}

// Degrade gracefully: parse strict JSON, otherwise extract the first {...} block.
function parseSuggestion(raw: string): {
  title: string; description?: string; sections?: any[]; bullets?: string[]; checklist?: string[]; rationale?: string
} | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }

  let obj: any = tryParse(raw)
  if (!obj) {
    const fenced = raw.replace(/```(?:json)?/gi, '').trim()
    obj = tryParse(fenced)
  }
  if (!obj) {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) obj = tryParse(raw.slice(start, end + 1))
  }

  if (obj && typeof obj === 'object') {
    return {
      title: String(obj.title ?? '').trim(),
      description: typeof obj.description === 'string' ? obj.description.trim() : '',
      sections: Array.isArray(obj.sections)
        ? obj.sections.map((s: any) => ({ label: String(s?.label ?? '').trim(), text: String(s?.text ?? '').trim() })).filter((s: any) => s.text)
        : [],
      bullets: Array.isArray(obj.bullets) ? obj.bullets.map((b: any) => String(b).trim()).filter(Boolean) : [],
      checklist: Array.isArray(obj.checklist) ? obj.checklist.map((b: any) => String(b).trim()).filter(Boolean) : [],
      rationale: String(obj.rationale ?? '').trim(),
    }
  }
  return { title: '', description: raw.trim(), bullets: [], checklist: [], sections: [], rationale: '' }
}
