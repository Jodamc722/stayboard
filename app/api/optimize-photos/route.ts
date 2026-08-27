// AI photo analyst. Reads a listing's photos, shows them to Claude vision, and returns a recommended
// display order, a per-photo room + category + guest-facing caption, an enhance verdict, and a
// whole-set quality assessment. The HERO (position 1) is chosen by the human — this route never
// forces a hero; it may flag a photo that would make a stronger one, but #1 stays manual.
// Generate-only; the human approves and pushes via /api/photo-order.
//
// 2026-08-21 — three changes:
//  1. The result is now PERSISTED to guesty_listings.raw._photoIndex. It used to be returned to the
//     browser and thrown away unless you pushed, which is why the copywriter in /api/optimize-listing
//     had to re-derive "is this photo real or stock?" from eight unlabelled thumbnails.
//  2. The model returns a `room` id ("bedroom-1", "bath-primary"). The deterministic pass below used
//     to regroup by CATEGORY, so every bedroom in the unit interleaved even though the prompt asked
//     for room grouping — the model was never asked which room a photo was in. Same bug sent stock
//     photos into the middle of the tour, because `kind` was captured and then ignored by the sort.
//  3. Captions come from ONE spec in the settings (they used to be worded separately here and in
//     /api/photo-caption and were free to drift), and the model picks a named enhance preset.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadListingAiWithPreview } from '@/lib/listing-ai-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function str(v: any): string { return typeof v === 'string' ? v : '' }

// Guarantee every photo ends up with a caption: if the model skips one, fall back to a clean
// category-based label so no photo is ever left without a guest-facing description.
const CAT_CAPTION: Record<string, string> = { living: 'Living area', kitchen: 'Kitchen', dining: 'Dining area', bedroom: 'Bedroom', bathroom: 'Bathroom', outdoor: 'Outdoor space', view: 'View from the property', amenity: 'Building amenity', exterior: 'Building exterior', detail: 'Property detail', other: 'Property photo' }
// Junk detector: Guesty sometimes stores UUIDs/filenames as captions - treat those as empty.
const realCaption = (s: string) => { const t = (s || '').trim(); if (!t) return ''; if (/^[0-9a-f\-]{16,}$/i.test(t)) return ''; if (/\.(jpe?g|png|webp|gif)$/i.test(t)) return ''; return t }
// A human-written caption is never overwritten — see project-photo-organizer-captions-2026-07-19.
// `regenerate` is the explicit "rewrite every description" mode. Without it a human caption always
// wins — but that ALSO meant that on any listing Guesty already had captions for, the AI captions
// were generated, paid for, and silently discarded, so "optimize photos" produced no new
// descriptions at all. Jon, 2026-08-27: "it should add a description to each one."
const captionFor = (m: { caption?: string; category?: string } | undefined, existing: string, regenerate = false) =>
  (regenerate ? '' : realCaption(existing)) || (m?.caption && m.caption.trim()) || CAT_CAPTION[m?.category || 'other'] || 'Property photo'

// A caption we invented from the category is a placeholder, not a description. It must never be
// pushed to Airbnb as if a human meant it — "Property photo" has been shipping as a real caption.
const isPlaceholderCaption = (c: string) => Object.values(CAT_CAPTION).indexOf(String(c || '').trim()) >= 0

// Tolerant JSON reader for vision output. The model occasionally returns slightly long or truncated
// JSON (one description per photo over many photos); rather than hard-failing, we salvage the largest
// well-formed prefix by cutting at the last clean element boundary and closing any open brackets.
// Downstream code already tolerates a partial items/order array (it fills in any omitted photos).
function closeOpenBrackets(s: string): string {
  let inStr = false, esc = false
  const st: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { if (inStr) esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') st.push('}')
    else if (c === '[') st.push(']')
    else if (c === '}' || c === ']') st.pop()
  }
  let out = s
  if (inStr) out += '"'
  for (let i = st.length - 1; i >= 0; i--) out += st[i]
  return out
}
function safeParseModelJson(text: string): any {
  const start = text.indexOf('{')
  if (start < 0) return null
  const s = text.slice(start).trim()
  try { return JSON.parse(s) } catch { /* fall through to repair */ }
  let inStr = false, esc = false, lastSafe = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { if (inStr) esc = true; continue }
    if (c === '"') { inStr = !inStr; if (!inStr) lastSafe = i + 1; continue }
    if (inStr) continue
    if (c === '}' || c === ']') lastSafe = i + 1
    else if (c === ',') lastSafe = i
  }
  if (lastSafe > 0) {
    const cut = s.slice(0, lastSafe).replace(/,\s*$/, '')
    try { return JSON.parse(closeOpenBrackets(cut)) } catch { /* try whole */ }
  }
  try { return JSON.parse(closeOpenBrackets(s)) } catch { return null }
}

// Downsize Guesty/Cloudinary images before sending to vision. Each image otherwise costs thousands of
// input tokens; a small rendition costs ~90, letting us order many photos within tight rate tiers.
function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) {
    return u.replace('/image/upload/', '/image/upload/w_300,h_300,c_limit,q_auto,f_jpg/')
  }
  return u
}

type Pic = { _id: string; url: string; caption: string }

function readPics(raw: any, listing: any): Pic[] {
  const arr0: any[] = Array.isArray(raw?.pictures) ? raw.pictures
    : (Array.isArray(listing?.pictures) ? listing.pictures : [])
  // Some synced listings store each picture as a JSON STRING - parse those so newer listings work too.
  const arr = arr0.map((p: any) => { if (typeof p === 'string') { try { return JSON.parse(p) } catch { return null } } return p }).filter(Boolean)
  return arr.map((p: any, i: number) => ({
    _id: str(p?._id) || `idx-${i}`,
    url: str(p?.thumbnail) || str(p?.original) || '',
    caption: str(p?.caption),
  })).filter(p => p.url)
}

// Normalize whatever the model calls a room into a stable grouping key. Anything unrecognisable
// becomes the category itself, which reproduces the old category-only behaviour for that photo
// rather than scattering it.
function roomKey(room: string, category: string): string {
  const r = String(room || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return r || String(category || 'other').toLowerCase()
}

export async function POST(req: NextRequest) {
  // 2026-08-21: these routes write to LIVE OTA listings (photo-order PUTs the picture array to
  // Guesty and honours a remove[] that permanently drops photos) yet only checked "is signed in",
  // while the copy route next door required optimize/edit. Same gate on both now.
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
  // Optional: the human's chosen hero _id to keep locked at position 1.
  const lockedHeroId: string | null = typeof body?.heroId === 'string' && body.heroId ? body.heroId : null
  // Optional free-text host correction/guidance to steer the re-run (e.g. fix a mis-tagged photo).
  const guidance: string = typeof body?.guidance === 'string' ? body.guidance.trim().slice(0, 600) : ''
  // "Describe every photo" — rewrites descriptions even where Guesty already has one.
  const regenerate: boolean = body?.regenerateCaptions === true

  // Editable prompts + caption spec + enhance presets. promptPreview lets the settings playground
  // test unsaved text; without it this is the saved config, and without that the Stay defaults.
  const cfg = await loadListingAiWithPreview(body?.promptPreview)
  const MAX_PHOTOS = cfg.photos.maxPhotos

  const sb = supabaseAdmin()
  const { data: listing, error } = await sb.from('guesty_listings')
    .select('id, title, nickname, building, pictures, raw').eq('id', listingId).single()
  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const raw = (listing as any).raw || {}
  const allPics = readPics(raw, listing)
  if (allPics.length < 2) return NextResponse.json({ error: 'Listing has fewer than 2 photos to order.' }, { status: 400 })

  // The hero (position 1) is the human's pick. Default to current first photo. We do NOT ask the model
  // to reorder the hero; we order everything AFTER it, then prepend the hero.
  const heroId = lockedHeroId || allPics[0]._id
  const hero = allPics.find(p => p._id === heroId) || allPics[0]
  const rest = allPics.filter(p => p._id !== hero._id)

  // Cap the vision payload. Photos beyond the cap keep their original relative order at the very end.
  const toOrder = rest.slice(0, MAX_PHOTOS)
  const overflow = rest.slice(MAX_PHOTOS)

  // Label each photo "Photo N" so the model can refer to it unambiguously. We fetch each thumbnail
  // server-side and inline it as BASE64 (not a url source) so we don't hit Anthropic's per-minute
  // URL-content-fetch rate limit when a listing has many photos.
  const photoBlocks: any[] = []
  const fetched = await Promise.all(toOrder.map(async (p) => {
    try {
      const ir = await fetch(smallUrl(p.url))
      if (!ir.ok) return null
      const ct = (ir.headers.get('content-type') || '').toLowerCase()
      const media = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
      const buf = Buffer.from(await ir.arrayBuffer())
      return { data: buf.toString('base64'), media }
    } catch { return null }
  }))
  toOrder.forEach((p, i) => {
    photoBlocks.push({ type: 'text', text: `Photo ${i + 1}${p.caption ? ` (caption: ${p.caption})` : ''}:` })
    const f = fetched[i]
    if (f) photoBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.media, data: f.data } })
    else photoBlocks.push({ type: 'text', text: '(photo unavailable)' })
  })

  // The enhance menu the model may choose from. It picks a NAMED preset and never invents numbers,
  // so whatever it returns is already inside the hard caps in lib/listing-ai.
  const presetMenu = [...cfg.enhance.presets, { key: 'none', name: 'None', when: 'Already good — leave it exactly as shot.' }]
    .map(p => `  "${p.key}" (${p.name}) — ${p.when}`).join('\n')

  const SYS = `You are a short-term-rental listing merchandiser. You are given the photos of one property (the cover/hero photo is already chosen by the host and is NOT included here). Decide the optimal DISPLAY ORDER for the remaining photos to maximize bookings on Airbnb/Vrbo/Booking.com, describe each one, and say how each should be corrected.

${cfg.photos.orderPrompt}

ROOM IDENTITY (this is what makes grouping work): give every photo a "room" id naming the SPECIFIC physical space it shows, not its type — "living", "kitchen", "dining", "bedroom-1", "bedroom-2", "bath-primary", "bath-guest", "balcony", "pool", "gym", "lobby", "exterior". Two photos of the SAME bedroom must share the same room id; two DIFFERENT bedrooms must not. Photos that show no specific room (a stock skyline, a map) get "other". This is used to keep each room's photos together, so be consistent.

CAPTION SPEC (every photo gets one, maximum ${cfg.photos.captionMaxWords} words and ${cfg.photos.captionMaxChars} characters):
${cfg.photos.captionPrompt}

ENHANCE VERDICT: judge each photo's exposure, contrast, colour cast and sharpness, and pick exactly ONE preset key from this menu:
${presetMenu}
Pick "none" when the photo is already well exposed and sharp. Never invent your own values. Give a short "enhanceWhy" grounded in what you see (e.g. "underexposed, shot against the window").

Return ONLY valid JSON, no prose, in exactly this shape:
{"order":[<photo numbers in best order>],"items":[{"n":<photo number>,"kind":"<property|stock>","room":"<room id as described above>","category":"<living|kitchen|dining|bedroom|bathroom|outdoor|view|amenity|exterior|detail|other>","reason":"<<=14 words why it's placed here, grounded in the image>","caption":"<the caption, per the CAPTION SPEC above>","enhance":"<preset key>","enhanceWhy":"<<=10 words>","remove":<true|false>,"removeReason":"<if remove true: <=14 words why; else empty>"}],"heroSuggestion":{"n":<photo number or null>,"why":"<<=14 words, only if one of these would beat the current cover photo, else null>"},"assessment":{"quality":<0-100 overall photo-SET quality for converting bookings: lighting, sharpness, composition, staging, professional feel>,"coverage":"<<=16 words: which key spaces are well-shown vs missing>","notes":["<<=16 words concrete improvement>","..."]}}
"order" MUST be a permutation of 1..${toOrder.length} (every photo exactly once). "items" MUST contain ONE entry for EVERY photo number 1..${toOrder.length} - never skip a photo - and EVERY entry's "caption" must be a non-empty, specific guest-facing description.`

  const USR = `Property: ${str(listing.title) || str(listing.nickname) || 'listing'} (${str(listing.building) || 'building'}). ${toOrder.length} photos to order (the host's cover photo is separate and stays first). Order them now.`
  const USR2 = guidance ? `${USR}\n\nHOST CORRECTION — apply this exactly, it overrides your default judgement: ${guidance}` : USR

  let modelJson: any = null
  let modelErr: string | null = null
  const ac = new AbortController()
  const acTimer = setTimeout(() => ac.abort(), 110_000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 8000,
        system: SYS,
        messages: [{ role: 'user', content: [{ type: 'text', text: USR2 }, ...photoBlocks] }],
      }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) { modelErr = `AI ${r.status}: ${str(j?.error?.message).slice(0, 180)}` }
    else {
      const text = str(j?.content?.[0]?.text)
      modelJson = safeParseModelJson(text)
      if (!modelJson) modelErr = 'AI returned unparseable output.'
    }
  } catch (e: any) { modelErr = e?.name === 'AbortError' ? `Timed out ordering ${toOrder.length} photos. Try again, or hide a few photos first — very photo-heavy listings can exceed the limit.` : String(e).slice(0, 180) } finally { clearTimeout(acTimer) }

  if (!modelJson || !Array.isArray(modelJson.order)) {
    return NextResponse.json({ error: modelErr || 'AI did not return a valid order.' }, { status: 502 })
  }

  // Map "Photo N" (1-based over toOrder) back to picture _ids. Sanitize: keep valid, unique, in range;
  // append any photos the model omitted in their original order.
  const seen = new Set<number>()
  const orderedIds: string[] = []
  for (const n of modelJson.order) {
    const idx = Number(n) - 1
    if (Number.isInteger(idx) && idx >= 0 && idx < toOrder.length && !seen.has(idx)) {
      seen.add(idx); orderedIds.push(toOrder[idx]._id)
    }
  }
  toOrder.forEach((p, idx) => { if (!seen.has(idx)) orderedIds.push(p._id) })

  // Per-photo lookup by photo number + the "recommend removing" list.
  type Meta = { category: string; room: string; reason: string; kind: string; caption: string; enhance: string; enhanceWhy: string }
  const meta: Record<string, Meta> = {}
  const recommendRemove: { _id: string; reason: string }[] = []
  const presetKeys = new Set([...cfg.enhance.presets.map(p => p.key.toLowerCase()), 'none'])
  if (Array.isArray(modelJson.items)) {
    for (const it of modelJson.items) {
      const idx = Number(it?.n) - 1
      if (Number.isInteger(idx) && idx >= 0 && idx < toOrder.length) {
        const id = toOrder[idx]._id
        const category = str(it?.category) || 'other'
        const rawPreset = str(it?.enhance).trim().toLowerCase()
        meta[id] = {
          category,
          room: roomKey(str(it?.room), category),
          reason: str(it?.reason),
          kind: str(it?.kind) === 'stock' ? 'stock' : 'property',
          caption: str(it?.caption).slice(0, cfg.photos.captionMaxChars),
          // An unknown preset key falls back to the configured default rather than silently doing nothing.
          enhance: presetKeys.has(rawPreset) ? rawPreset : cfg.enhance.fallbackPreset,
          enhanceWhy: str(it?.enhanceWhy).slice(0, 90),
        }
        if (it?.remove === true) recommendRemove.push({ _id: id, reason: str(it?.removeReason) || 'Recommended for removal' })
      }
    }
  }

  // ── Deterministic guarantee of the spec, regardless of model variance ──────────────────────────
  // Keep the AI's first 5 as the showcase spread, then sort the rest by:
  //   1. property before stock          (was ignored entirely — stock landed mid-tour)
  //   2. category rank                  (rooms first, shared amenities and exteriors last)
  //   3. the room's first appearance    (keeps ALL photos of one room together — the actual fix)
  //   4. the model's own order within the room
  const ROOM_RANK: Record<string, number> = { living: 0, dining: 1, kitchen: 2, bedroom: 3, bathroom: 4, outdoor: 5, view: 6, detail: 7, other: 8, amenity: 9, exterior: 10 }
  const rankOf = (id: string) => ROOM_RANK[meta[id]?.category || 'other'] ?? 8
  const isStock = (id: string) => (meta[id]?.kind === 'stock' ? 1 : 0)
  const groupOf = (id: string) => `${rankOf(id)}|${meta[id]?.room || 'other'}`

  const highlights = orderedIds.slice(0, 5)
  const tail = orderedIds.slice(5)
  // Where each room-group first appears in the model's own ordering — so rooms stay in the sequence
  // the model chose to walk them, they just stop being interleaved.
  const groupFirst = new Map<string, number>()
  tail.forEach((id, i) => { const g = groupOf(id); if (!groupFirst.has(g)) groupFirst.set(g, i) })
  const grouped = tail
    .map((id, i) => ({ id, i }))
    .sort((a, b) =>
      (isStock(a.id) - isStock(b.id)) ||
      (rankOf(a.id) - rankOf(b.id)) ||
      ((groupFirst.get(groupOf(a.id)) ?? 0) - (groupFirst.get(groupOf(b.id)) ?? 0)) ||
      (a.i - b.i))
    .map(x => x.id)
  const proposedOrder = [hero._id, ...highlights, ...grouped, ...overflow.map(p => p._id)]

  // Hero suggestion (advisory only).
  let heroSuggestion: { _id: string; why: string } | null = null
  const hs = modelJson.heroSuggestion
  if (hs && hs.n != null) {
    const idx = Number(hs.n) - 1
    if (Number.isInteger(idx) && idx >= 0 && idx < toOrder.length) {
      heroSuggestion = { _id: toOrder[idx]._id, why: str(hs.why) }
    }
  }

  // Whole-set photo QUALITY assessment (AI judges lighting/composition/coverage).
  let assessment: { quality: number | null; coverage: string; notes: string[] } | null = null
  const asmt = modelJson.assessment
  if (asmt && typeof asmt === 'object') {
    const q = Number(asmt.quality)
    assessment = {
      quality: Number.isFinite(q) ? Math.max(0, Math.min(100, Math.round(q))) : null,
      coverage: str(asmt.coverage),
      notes: Array.isArray(asmt.notes) ? asmt.notes.map(str).filter(Boolean).slice(0, 4) : [],
    }
  }

  // Any untouched original we already mirrored, so the UI can offer "revert to original" on a photo
  // enhanced in an earlier session — the copy has always existed, it just had no button.
  const mirror: Record<string, any> = (raw._photoMirror && typeof raw._photoMirror === 'object') ? raw._photoMirror : {}
  const photos = allPics.map(p => ({
    _id: p._id, url: p.url, ...(meta[p._id] || {}),
    caption: captionFor(meta[p._id], p.caption, regenerate),
    // Tells the client this is a category placeholder, not a real description — so it is never
    // pushed to Airbnb as though somebody wrote it.
    captionIsPlaceholder: isPlaceholderCaption(captionFor(meta[p._id], p.caption, regenerate)),
    mirrorUrl: str(mirror[p._id]?.orig) || null,
  }))

  // ── PERSIST. This is the change that lets the copywriter stop guessing. `_`-prefixed keys survive
  // the Guesty sync (see reference-listing-raw-annotations), so no migration is needed.
  const at = new Date().toISOString()
  try {
    // What we knew before this run — the source of any human corrections we must not trample.
    const prevIndex: Record<string, any> = (raw?._photoIndex && typeof raw._photoIndex === "object")
      ? raw._photoIndex : {}
    const photoIndex: Record<string, any> = {}
    for (const id of Object.keys(meta)) {
      const m = meta[id]
      // A HUMAN CORRECTION OUTRANKS THE MODEL. Somebody re-tagged this photo through
      // /api/photo-meta; the next vision run must not quietly put it back. Without this the tag
      // editor would look like it worked and then silently revert overnight, which is worse than
      // not having one.
      const human = (prevIndex[id] && (prevIndex[id] as any).by === 'human') ? (prevIndex[id] as any) : null
      photoIndex[id] = {
        room: human?.room || m.room,
        category: human?.category || m.category,
        kind: m.kind,
        caption: human?.caption || captionFor(m, allPics.find(p => p._id === id)?.caption || '', regenerate),
        enhance: m.enhance, enhanceWhy: m.enhanceWhy, at,
        ...(human ? { by: 'human' } : {}),
      }
    }
    const update: any = { raw: { ...raw, _photoIndex: photoIndex } }
    if (assessment && assessment.quality != null) {
      const ps = { score: assessment.quality, coverageNote: assessment.coverage, notes: assessment.notes, count: allPics.length, at }
      update.raw._photoScore = ps
      update.photo_score = ps
    }
    await sb.from('guesty_listings').update(update).eq('id', listingId)
  } catch { /* persist is best-effort — the run still returns */ }

  return NextResponse.json({
    ok: true,
    listingId,
    heroId: hero._id,
    currentOrder: allPics.map(p => p._id),
    proposedOrder,
    photos,
    heroSuggestion,
    assessment,
    recommendRemove,
    overflow: overflow.length,
    presets: cfg.enhance.presets,
    autoPickEnhance: cfg.enhance.autoPick,
    // Printed above the grid so the ordering is not a black box.
    orderRule: '1 cover (yours) · 2–5 showcase spread · then room by room · shared amenities + exteriors last · stock photos last',
  })
}
