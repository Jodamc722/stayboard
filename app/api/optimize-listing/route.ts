// AI listing optimizer. Suggests an OTA-optimized title + description for a
// single guesty_listings row, grounded ONLY in that listing's real data.
// Requires ANTHROPIC_API_KEY. Logged-in users only. No auto-write to Guesty.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
// NOTE: supabaseAdmin is a factory — call supabaseAdmin() to get the client.

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  // Load the listing (service role - read the verified columns only)
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

  const SYSTEM = `You are a senior short-term-rental listing copywriter for Stay Hospitality, a South Florida property manager. You rewrite OTA (Airbnb / Vrbo / Booking.com) listing titles and descriptions to maximize search visibility and conversion, following platform best practices.

TITLE BEST PRACTICES
- Keep it about 50 characters or fewer (hard ceiling ~60). Airbnb truncates long titles.
- Lead with the single strongest selling point, then location, then one standout amenity. Example shape: "Selling point | Neighborhood | Standout amenity".
- Title Case. NO ALL CAPS, NO emoji spam, no clickbait, no fake urgency, no "!!!".
- Be specific and scannable. Use real neighborhood/city names from the data.

DESCRIPTION BEST PRACTICES
- Scannable and benefit-led: short paragraphs and/or bullets, not a wall of text.
- Open with a hook that sells the experience, not a list of facts.
- Clearly state the layout early: bedrooms, bathrooms, and how many guests it sleeps.
- Cover location perks (walkability, beach/downtown proximity, neighborhood vibe) and the top amenities.
- Weave in SEO keywords real guests search (e.g. "Miami Beach condo", "walk to the beach", "king bed", "free parking", "pool") naturally.
- End with a clear, warm call to action (e.g. "Book your stay" / "Reserve your dates now").

HONESTY (CRITICAL)
- You may ONLY use facts provided in the listing JSON below. NEVER invent amenities, room counts, views, distances, or features that are not in the data.
- If a fact (e.g. bathrooms or amenities) is missing, simply omit it - do not guess.
- Stay truthful and professional; this copy is pasted into a live OTA listing.

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else - no markdown, no commentary, no code fences. Exactly this shape:
{"title":"...","description":"...","bullets":["...","...","..."],"rationale":"..."}
- "title": the optimized title (<= ~50 chars).
- "description": the full optimized description (plain text, line breaks allowed).
- "bullets": 4-7 short highlight bullets (amenity/feature one-liners) drawn only from the data.
- "rationale": 1-2 sentences on why this is stronger for OTA ranking & conversion.`

  const USER = `Optimize this listing. Real listing data (use ONLY these facts):
${JSON.stringify(facts)}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })

    const raw = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    const suggestion = parseSuggestion(raw)
    if (!suggestion) return NextResponse.json({ error: 'Model returned an unparseable response.', raw: raw.slice(0, 400) }, { status: 502 })

    return NextResponse.json({ suggestion })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// Degrade gracefully: parse strict JSON, otherwise extract the first {...} block.
function parseSuggestion(raw: string): { title: string; description: string; bullets: string[]; rationale: string } | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }

  let obj: any = tryParse(raw)
  if (!obj) {
    // strip code fences if present
    const fenced = raw.replace(/```(?:json)?/gi, '').trim()
    obj = tryParse(fenced)
  }
  if (!obj) {
    // extract the outermost {...}
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) obj = tryParse(raw.slice(start, end + 1))
  }

  if (obj && typeof obj === 'object') {
    return {
      title: String(obj.title ?? '').trim(),
      description: String(obj.description ?? '').trim(),
      bullets: Array.isArray(obj.bullets) ? obj.bullets.map((b: any) => String(b).trim()).filter(Boolean) : [],
      rationale: String(obj.rationale ?? '').trim(),
    }
  }

  // Last resort: hand back the raw text as the description so nothing is lost.
  return { title: '', description: raw.trim(), bullets: [], rationale: '' }
}
