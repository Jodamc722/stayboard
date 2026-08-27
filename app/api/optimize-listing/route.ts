// AI listing optimizer -> Guesty master content. Generates an optimized title + all six Guesty
// publicDescription sections, grounded ONLY in the listing's verified data, its real address/area,
// its current content, its guest-review signal, its booking settings, and — since 2026-08-21 — the
// LABELLED photo index the analyst in /api/optimize-photos already built. MASTER content syncs to
// every channel; written to Airbnb's stricter, highest-converting standard. Generate-only; push via
// /api/listing-content.
//
// TWO CHANGES ON 2026-08-21
// 1. PHOTOS. This route used to send `rawPics.slice(0, 8)` — the first eight photos in stored order,
//    as bare image URLs with no captions and no room labels — and then ask the model to work out
//    for itself which of them were stock. Meanwhile /api/optimize-photos had ALREADY decided, per
//    photo, what room it is, whether it is real or stock, and what it shows, and thrown all of it
//    away. It now reads raw._photoIndex and sends a labelled, property-only, one-per-room selection
//    plus the coverage note. That is where the extra colour in the copy comes from.
// 2. PROMPTS. The per-section writing rules were a hardcoded SECTION_DEFS array. They now come from
//    app_settings 'listing_ai' (lib/listing-ai), editable at /users -> App settings. The defaults
//    are the same text, so an unset key behaves exactly as before. The HONESTY BLOCK below is NOT
//    editable and is assembled here on every call.
import { NextRequest, NextResponse } from 'next/server'
import { buildingFactsFor, factsPrompt } from '@/lib/building-facts'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { loadListingAiWithPreview } from '@/lib/listing-ai-server'
import { SECTION_KEYS, TITLE_MAX, sectionRules, type SectionKey, type ListingAi, bannedRule, examplesRule } from '@/lib/listing-ai'

export const dynamic = 'force-dynamic'
// Was 45. Opus with ~10 vision images does comparable work to the photo analyst, which needs 120
// with a 110s abort (a verified run took 57.9s). At 45 a slow full run 504s with no message.
export const maxDuration = 120

function str(v: any): string { return typeof v === 'string' ? v : '' }

/* ------------------------------------------------------------------ *
 * NOT EDITABLE. The safety floor under every prompt in this route.
 * ------------------------------------------------------------------ */
const HONESTY = `ABSOLUTE HONESTY (THE MOST IMPORTANT RULE)
- Use ONLY facts present in the JSON below (data, location, current content, review signal, booking settings, photo index). If you are NOT certain of something — an exact distance, a specific restaurant/shop/attraction name, a drive time, an amenity, a view, a room count — DO NOT state it. Omit it or stay general. Never guess, never embellish, never invent.
- It is far better to say less, accurately, than to say more and be wrong. This copy goes on a live listing.

LOCATION (use it; never print it verbatim)
- A real address/area is provided. Use it ONLY to identify the actual city/neighborhood so you can name genuinely well-known, real nearby places for THAT exact city (e.g. for Miami Beach: South Beach, Lincoln Road, Ocean Drive; for Fort Lauderdale: Las Olas, Fort Lauderdale Beach). Reference only landmarks you are confident actually exist for that city.
- NEVER print the exact street address, unit number, lock/door codes, phone, email, or URLs anywhere in the copy. Keep proximity general ("a short walk to the beach") unless the data gives an exact distance.
- PARKING: describe only the parking the data confirms. If a VERIFIED BUILDING FACTS block states a garage, it is a garage and you should say so — that is a booking driver. If nothing confirms parking, do not mention it.

THE ONE EXCEPTION TO ALL OF THE ABOVE
- If a block headed VERIFIED BUILDING FACTS appears below, everything in it was written and checked by Stay staff. You MAY state those places, distances and walk times specifically and by name. That block is the ONLY licence to be that specific — it does not extend to anything you know from elsewhere.`

const PHOTO_RULES_LABELLED = `PHOTOS (you can SEE them, and they are LABELLED)
- Each attached photo is introduced by a line naming the room it shows and what is in it. That labelling was produced by a vision pass over the whole photo set — trust it for WHICH space you are looking at, and use the image itself for how it looks.
- Every photo attached here is a real photo OF THIS home or its building. Generic area/stock imagery has already been filtered out, so you do not need to second-guess it — but still never describe something a photo does not show.
- Ground the copy, especially "The space", in these photos: layout, light, finishes, views, outdoor areas, standout features. Walk the home in the order the rooms are labelled.
- A "coverage" note may tell you which key spaces are well shown and which have no photo at all. Lean on what is shown; do not write vividly about a room nobody photographed.`

const PHOTO_RULES_RAW = `PHOTOS (you can SEE them — use them)
- The listing's actual photos are attached. STUDY them. Ground the copy (especially "The space") in what the images genuinely show: layout, light, finishes, views, outdoor areas, standout features.
- Use the photos to VERIFY before you write. Only describe what is visible in a photo or stated in the data. If a claimed amenity/view isn't visible or in the data, leave it out. The photos are your fact-check.
- REAL vs STOCK: some photos are NOT of this home - they are generic area/stock shots (city skyline, beach, map, sunset, neighborhood landmarks, building exterior renderings, lifestyle/decor stock). You must tell these apart. ONLY ground home-feature claims (rooms, layout, finishes, views from the unit, the unit's outdoor space) in photos that genuinely show THIS unit or building. Generic area/stock photos may ONLY inform the Neighborhood section - never describe them as part of the home.
- Lead with the most visually compelling TRUE selling points. Make a reader picture themselves there.`

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

/* ------------------------------------------------------------------ *
 * Photo selection for the copywriter.
 *
 * With a photo index: property photos only, ONE PER ROOM first (so ten
 * photos cover ten different spaces instead of ten shots of the same
 * living room), then the best of the rest, each labelled with its room
 * and caption. Without one: the old unlabelled first-N behaviour, so a
 * listing whose photos have never been analysed still works.
 * ------------------------------------------------------------------ */
type CopyPhoto = { url: string; label: string | null }

function pickPhotosForCopy(raw: any, listing: any, cfg: ListingAi): { photos: CopyPhoto[]; labelled: boolean; rooms: string[] } {
  const rawPics: any[] = Array.isArray(raw.pictures) ? raw.pictures
    : (Array.isArray(listing?.pictures) ? listing.pictures : [])
  const pics = rawPics
    .map((pic: any, i: number) => {
      const p = typeof pic === 'string' ? (() => { try { return JSON.parse(pic) } catch { return null } })() : pic
      if (!p) return null
      const url = str(p?.original || p?.large || p?.regular || p?.url || p?.thumbnail)
      if (!/^https?:\/\//.test(url)) return null
      return { _id: str(p?._id) || `idx-${i}`, url }
    })
    .filter(Boolean) as { _id: string; url: string }[]

  const index = (raw._photoIndex && typeof raw._photoIndex === 'object') ? raw._photoIndex : null
  const limit = cfg.photos.photosToCopywriter

  if (index && Object.keys(index).length) {
    const rows = pics.map(p => ({ p, m: index[p._id] })).filter(x => x.m && typeof x.m === 'object')
    const property = rows.filter(x => x.m.kind !== 'stock')
    if (property.length) {
      const seen = new Set<string>()
      const firstPerRoom: typeof property = []
      const extras: typeof property = []
      for (const x of property) {
        const room = str(x.m.room) || str(x.m.category) || 'other'
        if (seen.has(room)) extras.push(x)
        else { seen.add(room); firstPerRoom.push(x) }
      }
      const chosen = [...firstPerRoom, ...extras].slice(0, limit)
      return {
        photos: chosen.map((x, i) => {
          const room = (str(x.m.room) || str(x.m.category) || 'space').replace(/-/g, ' ')
          const cap = str(x.m.caption)
          return { url: x.p.url, label: `Photo ${i + 1} — ${room}${cap ? ` — ${cap}` : ''}` }
        }),
        labelled: true,
        rooms: Array.from(seen).map(r => r.replace(/-/g, ' ')),
      }
    }
  }
  return { photos: pics.slice(0, 8).map(p => ({ url: p.url, label: null })), labelled: false, rooms: [] }
}

function photoBlocksFor(sel: { photos: CopyPhoto[] }): any[] {
  const out: any[] = []
  for (const p of sel.photos) {
    if (p.label) out.push({ type: 'text', text: `${p.label}:` })
    out.push({ type: 'image', source: { type: 'url', url: p.url } })
  }
  return out
}

export async function POST(req: NextRequest) {
  // Generates listing copy with the Anthropic API (real spend) and feeds the write-back flow —
  // gated to optimizer edit access, not just "signed in" (2026-08-10).
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  // promptPreview = the settings playground testing UNSAVED prompt text. Otherwise the saved
  // config, otherwise the Stay defaults (which are the old hardcoded text verbatim).
  const cfg = await loadListingAiWithPreview(body?.promptPreview)
  const SECTION_DEFS = SECTION_KEYS.filter(k => k !== 'title').map(k => ({ key: k, label: cfg.sections[k].label }))

  const sb = supabaseAdmin()
  const [{ data: listing, error }, { data: reviewRows }] = await Promise.all([
    sb.from('guesty_listings')
      .select('id, title, nickname, building, unit, room_type, tags, address_full, address_city, address_state, bedrooms, bathrooms, max_occupancy, amenities, status, pictures, raw')
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

  // Current-only mode: return the listing's EXISTING content (no AI) so the UI can show each section
  // as an editable field immediately, without running optimization.
  if (body?.currentOnly === true) {
    return NextResponse.json({
      listingId, titleMax: cfg.sections.title.hardCap || TITLE_MAX,
      sections: SECTION_DEFS,
      current, proposed: current, rationale: '', warnings: [],
    })
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

  // THE FACTS WE ALREADY HAD (see lib/building-facts). Without this the honesty rules leave the
  // model nothing specific to say about the neighbourhood, and it falls back to "moments from
  // world-class dining" on every unit in the portfolio.
  const bFacts = await buildingFactsFor({
    building: (listing as any).building, nickname: (listing as any).nickname, title: (listing as any).title,
  }).catch(() => null)
  const factsBlock = factsPrompt(bFacts)

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

  // ── Photos for VISION ────────────────────────────────────────────────────────────────────────
  const sel = pickPhotosForCopy(raw, listing, cfg)
  const photoBlocks = photoBlocksFor(sel)
  const photoRules = sel.labelled ? PHOTO_RULES_LABELLED : PHOTO_RULES_RAW
  const coverageNote = str(raw?._photoScore?.coverageNote)
  const photoBrief = sel.labelled
    ? `PHOTO INDEX: ${sel.photos.length} real photos of this home are attached, covering: ${sel.rooms.join(', ')}.${coverageNote ? ` Coverage note from the photo review: "${coverageNote}".` : ''}`
    : ''

  // The house-style exemplar for 'space'. Pinned to one listing if set, otherwise matched by
  // building name (default "17 west", the in-house gold standard).
  let spaceExemplar = ''
  try {
    if (cfg.exemplarListingId) {
      const { data: ex } = await sb.from('guesty_listings').select('raw').eq('id', cfg.exemplarListingId).maybeSingle()
      spaceExemplar = str((ex as any)?.raw?.publicDescription?.space).slice(0, 1400)
    }
    if (!spaceExemplar && cfg.exemplarMatch.trim()) {
      const m = cfg.exemplarMatch.trim().replace(/[%_]/g, '')
      const { data: ex } = await sb.from('guesty_listings').select('building, raw')
        .or(`building.ilike.%${m}%,building.ilike.%${m.replace(/\s+/g, '')}%`).limit(20)
      const cands = (ex ?? []).map((rr: any) => str(rr?.raw?.publicDescription?.space)).filter(Boolean).sort((a: string, b: string) => b.length - a.length)
      if (cands[0]) spaceExemplar = cands[0].slice(0, 1400)
    }
  } catch { /* exemplar is best-effort */ }

  const guideFor = (k: SectionKey) => {
    const c = cfg.sections[k]
    const rules = sectionRules(c)
    return `${c.guide}${rules ? ` ${rules}` : ''}`
  }

  // ── Single-section mode ──────────────────────────────────────────────────────
  // When the UI asks to regenerate ONE field (optionally with a custom instruction),
  // rewrite just that field and return { section, text, rationale, warnings }.
  const singleSection: string | null = typeof body?.section === 'string' && body.section ? body.section : null
  const instruction = str(body?.instruction).trim().slice(0, 600)
  const currentDraft = str(body?.currentText)
  if (singleSection) {
    if (!(SECTION_KEYS as string[]).includes(singleSection)) return NextResponse.json({ error: 'unknown section' }, { status: 400 })
    const sk = singleSection as SectionKey
    const isTitle = sk === 'title'
    const guide = isTitle ? `Title: ${guideFor('title')}` : `${cfg.sections[sk].label}: ${guideFor(sk)}`
    // ── THE HOUSE VOICE BELONGS ON BOTH PATHS ────────────────────────────────────────────────
    // This prompt used to open with a hardcoded paragraph and substitute a one-line "HOUSE STYLE:"
    // for cfg.voice, so everything the operator wrote in the voice box was silently dropped here.
    // That matters more than it sounds: this is the path behind every per-section Regenerate AND
    // behind the "Test on a unit" playground in settings — which always sends a section. So every
    // voice experiment anyone has ever run was judged on a prompt that ignored the voice they were
    // editing. Tuning the voice appeared to do nothing, because on the path being tested it did.
    const SYS = `${cfg.voice}

You are rewriting ONE field of the Guesty MASTER listing content, which syncs to Airbnb, Vrbo, Expedia and Booking.com.

${HONESTY}

${photoRules}
${bannedRule(cfg) ? '\n' + bannedRule(cfg) + '\n' : ''}
You are writing ONLY this field:
${guide}${examplesRule(cfg.sections[sk])}
${instruction ? `\nTHE USER WANTS THIS SPECIFIC CHANGE (apply it, within the honesty rules above): "${instruction}"` : ''}

OUTPUT: STRICT minified JSON only, nothing else, exactly: {"text":"...","rationale":"..."}
- "text" = the new field content as a single non-empty string (for the title, obey the character limit).
- "rationale" = one short sentence on why it is stronger.`
    const USR = `Field to rewrite: "${sk}".
${factsBlock ? '\n' + factsBlock + '\n' : ''}
${sk === 'space' && spaceExemplar ? `\nHOUSE STYLE EXEMPLAR (match its voice/format as a baseline, then ENHANCE; do NOT copy its facts):\n"""${spaceExemplar}"""\n` : ''}
${photoBrief}

${factsBlock ? factsBlock + '\n\n' : ''}VERIFIED FACTS (use ONLY these; never invent beyond them):
${JSON.stringify(facts)}

GUEST REVIEW SIGNAL - you MAY share what guests genuinely PRAISE, in your own words (e.g. "guests love the natural light and the walkable location"). NEVER state a star rating, a numeric score, or "X-star"; never quote a review verbatim:
${JSON.stringify(reviewSignal)}

CURRENT TEXT for this field (improve on it):
${JSON.stringify(currentDraft || (current as any)[sk] || '')}`
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1200, system: SYS, messages: [{ role: 'user', content: [{ type: 'text', text: USR }, ...photoBlocks] }] }),
      })
      const d: any = await r.json()
      if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
      const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
      const parsed = parseJson(text)
      if (!parsed || typeof parsed.text !== 'string') return NextResponse.json({ error: 'Model returned an unparseable response.' }, { status: 502 })
      const value = String(parsed.text).trim()
      const warnings = warnFor(sk, value, cfg, location.streetAddress)
      return NextResponse.json({ listingId, section: sk, text: value, titleMax: cfg.sections.title.hardCap || TITLE_MAX, rationale: String(parsed.rationale || '').trim(), warnings, photosUsed: sel.photos.length, photosLabelled: sel.labelled })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
    }
  }

  // ── Full run ─────────────────────────────────────────────────────────────────
  const activeSections = SECTION_KEYS.filter(k => k !== 'title' && cfg.sections[k].enabled)
  const sectionSpec = activeSections
    .map(k => `- "${k}" (${cfg.sections[k].label}): ${guideFor(k)}${examplesRule(cfg.sections[k])}`).join('\n')
  const outShape = ['title', ...activeSections].map(k => `"${k}":"..."`).join(',')

  const SYSTEM = `${cfg.voice}

${HONESTY}

${photoRules}

${bannedRule(cfg) ? bannedRule(cfg) + '\n' : ''}
TITLE RULES
- ${guideFor('title')}${examplesRule(cfg.sections.title)}

SECTION RULES (Guesty publicDescription fields)
${sectionSpec}

OUTPUT FORMAT
Return STRICT, minified JSON and nothing else (no markdown, no code fences, no commentary). Exactly this shape:
{${outShape},"rationale":"..."}
- Every section is a non-empty string. "rationale": 1-2 sentences on why this wins on visibility + honest expectation-setting.`

  const USER = `Rewrite the master content for this listing.
${instruction ? `\nMUST-INCLUDE FROM JON (work this in naturally, within the honesty rules - never invent facts to satisfy it): "${instruction}"\n` : ''}${spaceExemplar ? `\nHOUSE STYLE EXEMPLAR for the 'space' field - match this VOICE and FORMAT as your baseline, then ENHANCE it (even more compelling, photo-grounded). Do NOT copy its specific facts:\n"""${spaceExemplar}"""\n` : ''}
${photoBrief}

${factsBlock ? factsBlock + '\n\n' : ''}VERIFIED FACTS (use ONLY these; never invent beyond them):
${JSON.stringify(facts)}

GUEST REVIEW SIGNAL - you MAY share what guests genuinely PRAISE, in your own words (e.g. "guests love the natural light and the walkable location"). NEVER state a star rating, a numeric score, or "X-star"; never quote a review verbatim:
${JSON.stringify(reviewSignal)}

CURRENT GUESTY CONTENT (improve on this; it may be thin or empty):
${JSON.stringify(current)}`

  const ac = new AbortController()
  const acTimer = setTimeout(() => ac.abort(), 110_000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 3200, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: USER }, ...photoBlocks] }] }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })

    const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    const parsed = parseJson(text)
    if (!parsed) return NextResponse.json({ error: 'Model returned an unparseable response.', raw: text.slice(0, 400) }, { status: 502 })

    // A disabled section is left exactly as it is today rather than blanked.
    const proposed: Record<string, string> = { title: String(parsed.title || '').trim() }
    for (const k of SECTION_KEYS) {
      if (k === 'title') continue
      proposed[k] = cfg.sections[k].enabled ? String(parsed[k] || '').trim() : (current as any)[k]
    }

    const warnings: string[] = []
    for (const k of SECTION_KEYS) warnings.push(...warnFor(k, proposed[k] || '', cfg, location.streetAddress))

    return NextResponse.json({
      listingId,
      titleMax: cfg.sections.title.hardCap || TITLE_MAX,
      sections: SECTION_DEFS,
      current, proposed, reviewSignal,
      bookingSettings: settings,
      location: { city: location.city, state: location.state, neighborhood: location.neighborhood },
      rationale: String(parsed.rationale || '').trim(),
      warnings,
      // Shown in the UI so it is obvious WHY the copy improved — and obvious when it can't.
      photosUsed: sel.photos.length,
      photosLabelled: sel.labelled,
      photoCoverage: coverageNote || null,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') return NextResponse.json({ error: 'The optimizer timed out writing this listing. Try again — if it keeps happening, regenerate one section at a time.' }, { status: 504 })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  } finally { clearTimeout(acTimer) }
}

// Per-field guardrails, applied identically to a full run and a single rewrite.
// A RULE THE PROMPT ASKS FOR AND NOTHING CHECKS IS A RULE THE MODEL LEARNS IT CAN IGNORE.
// The banned list is stated in both system prompts; this is what makes it real. Matched on word
// boundaries so "Oasis" the building never trips the ban on "oasis" the cliché is not the goal —
// case matters there, so the check is deliberately case-SENSITIVE for single capitalised words and
// case-insensitive for multi-word phrases, which is the shape clichés actually take.
function bannedHits(value: string, list: string): string[] {
  const phrases = String(list || '').split(',').map(x => x.trim()).filter(Boolean)
  const hits: string[] = []
  for (const p of phrases) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const multi = /\s/.test(p)
    const re = new RegExp('\\b' + esc + '\\b', multi ? 'i' : '')
    if (re.test(value)) hits.push(p)
  }
  return hits
}

function warnFor(k: SectionKey, value: string, cfg: ListingAi, streetAddress: string | null): string[] {
  const out: string[] = []
  if (!value) return out
  const c = cfg.sections[k]
  const banned = bannedHits(value, cfg.bannedPhrases)
  if (banned.length) {
    out.push(`${k === 'title' ? 'Title' : 'The ' + c.label.toLowerCase() + ' section'} uses ${banned.map(b => `"${b}"`).join(', ')} - on the never-write list.`)
  }
  const label = k === 'title' ? 'Title' : `The ${c.label.toLowerCase()} section`
  if (k === 'title') {
    const cap = c.hardCap || TITLE_MAX
    if (value.length > cap) out.push(`Title is ${value.length} chars - over the ${cap}-char limit. Trim before pushing.`)
    for (const f of forbiddenIn(value)) out.push(`Title contains ${f} - channels may reject it.`)
    return out
  }
  if (c.hardCap && value.length > c.hardCap) out.push(`${label} is ${value.length} chars - over the ${c.hardCap}-char limit. Trim before pushing.`)
  const bad = forbiddenIn(value).filter(x => x === 'a phone number' || x === 'an email address' || x === 'a URL')
  if (bad.length) out.push(`${label} contains ${bad.join(' and ')} - remove it before pushing.`)
  const streetNum = streetAddress ? String(streetAddress).match(/\d{2,}/)?.[0] : null
  if (streetNum && value.includes(streetNum)) out.push(`${label} may contain the street address - remove it before pushing.`)
  return out
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
