// AI photo-order optimizer. Reads a listing's photos, shows them to Claude vision, and returns a
// recommended display order (with a one-line reason + category per photo) following short-term-rental
// best practice: lead with the most striking spaces, show variety early, group rooms sensibly,
// push detail/utility shots toward the end. The HERO (position 1) is chosen by the human - this route
// never forces a hero; it may flag a photo that would make a stronger hero, but the UI keeps #1 manual.
// Generate-only; the human approves and pushes via /api/photo-order.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PHOTOS = 40 // keep total vision input tokens under the org's 10k/min tier

function str(v: any): string { return typeof v === 'string' ? v : '' }

// Downsize Guesty/Cloudinary images before sending to vision. Each image otherwise costs thousands of
// input tokens; a ~420px-wide rendition costs ~90, letting us order many photos within tight rate tiers.
function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) {
    return u.replace('/image/upload/', '/image/upload/w_300,h_300,c_limit,q_auto,f_jpg/')
  }
  return u
}

type Pic = { _id: string; url: string; caption: string }

function readPics(raw: any, listing: any): Pic[] {
  const arr: any[] = Array.isArray(raw?.pictures) ? raw.pictures
    : (Array.isArray(listing?.pictures) ? listing.pictures : [])
  return arr.map((p: any, i: number) => ({
    _id: str(p?._id) || `idx-${i}`,
    url: str(p?.thumbnail) || str(p?.original) || '',
    caption: str(p?.caption),
  })).filter(p => p.url)
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
  // Optional: the human's chosen hero _id to keep locked at position 1.
  const lockedHeroId: string | null = typeof body?.heroId === 'string' && body.heroId ? body.heroId : null

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

  const SYS = `You are a short-term-rental listing merchandiser. You are given the photos of one property (the cover/hero photo is already chosen by the host and is NOT included here). Decide the optimal DISPLAY ORDER for the remaining photos to maximize bookings on Airbnb/Vrbo/Booking.com.

Ordering principles (in priority):
1. FIRST 5 = HIGHLIGHTS: the opening 5 photos (the host's COVER is already #1) must be the 5 most beautiful, impressive shots that sell THIS unit - the best-looking spaces regardless of room type (a stunning living area, a gorgeous kitchen, the best bedroom, the unit's view/balcony, a standout feature). Pick the 5 strongest images and lead with wow factor. These are the hook.
2. NEXT = ROOMS, GROUPED BY ROOM: after the 5 highlights, walk the rest of the unit room by room, keeping every photo of the SAME room together (a0ll living-room shots, then each bedroom's shots together, then bathrooms, then kitchen/dining, then the unit's own balcony/outdoor). Never split a room's photos across the set - one clean grouped tour.
3. LAST = AMENITIES + EXTERIORS: building/shared amenities (gym, pool, lobby, common areas, parking) and exterior/building shots go at the VERY END, after all the unit's own rooms.
4. PROPERTY vs STOCK: classify every photo. "property" = an actual photo OF THIS home or its building (rooms, the unit's view/balcony, the real building exterior/lobby/pool/gym). "stock" = generic location/marketing imagery that is NOT this specific home: a city skyline, a generic beach, a map, a sunset, an attraction, a restaurant, lifestyle/decor stock, or a watermarked promo graphic. Stock photos must NOT be woven into the room-by-room tour - order all property photos first, then any stock photos last.
5. RECOMMEND DELETIONS: set remove=true for photos that hurt conversion: stock/location photos that misrepresent the home, EXACT or near-duplicates (keep the single best, flag the rest), dark/blurry/badly-lit/crooked shots, cluttered or unstaged messes, tiny detail/closeups that add nothing, and screenshots/graphics. Give a short removeReason. Be willing to recommend several - a tight set of strong real photos beats a padded set.
6. Never invent what a photo shows - judge only from the image. Every "reason" must be grounded in what you actually see.

Return ONLY valid JSON, no prose, in exactly this shape:
{"order":[<photo numbers in best order>],"items":[{"n":<photo number>,"kind":"<property|stock>","category":"<living|kitchen|dining|bedroom|bathroom|outdoor|view|amenity|exterior|detail|other>","reason":"<<=14 words why it's placed here, grounded in the image>","remove":<true|false>,"removeReason":"<if remove true: <=14 words why; else empty>"}],"heroSuggestion":{"n":<photo number or null>,"why":"<<=14 words, only if one of these would beat the current cover photo, else null>"},"assessment":{"quality":<0-100 overall photo-SET quality for converting bookings: lighting, sharpness, composition, staging, professional feel>,"coverage":"<<=16 words: which key spaces are well-shown vs missing>","notes":["<<=16 words concrete improvement>","..."]}}
"order" MUST be a permutation of 1..${toOrder.length} (every photo exactly once).`

  const USR = `Property: ${str(listing.title) || str(listing.nickname) || 'listing'} (${str(listing.building) || 'building'}). ${toOrder.length} photos to order (the host's cover photo is separate and stays first). Order them now.`

  let modelJson: any = null
  let modelErr: string | null = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 3500,
        system: SYS,
        messages: [{ role: 'user', content: [{ type: 'text', text: USR }, ...photoBlocks] }],
      }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) { modelErr = `AI ${r.status}: ${str(j?.error?.message).slice(0, 180)}` }
    else {
      const text = str(j?.content?.[0]?.text)
      const m = text.match(/\{[\s\S]*\}/)
      if (m) modelJson = JSON.parse(m[0])
    }
  } catch (e) { modelErr = String(e).slice(0, 180) }

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

  // Build the full proposed order: hero first, AI-ordered middle, untouched overflow last.
  const proposedOrder = [hero._id, ...orderedIds, ...overflow.map(p => p._id)]

  // Per-photo reason/category/kind lookup by photo number + the "recommend removing" list.
  const meta: Record<string, { category: string; reason: string; kind: string }> = {}
  const recommendRemove: { _id: string; reason: string }[] = []
  if (Array.isArray(modelJson.items)) {
    for (const it of modelJson.items) {
      const idx = Number(it?.n) - 1
      if (Number.isInteger(idx) && idx >= 0 && idx < toOrder.length) {
        const id = toOrder[idx]._id
        meta[id] = { category: str(it?.category) || 'other', reason: str(it?.reason), kind: str(it?.kind) === 'stock' ? 'stock' : 'property' }
        if (it?.remove === true) recommendRemove.push({ _id: id, reason: str(it?.removeReason) || 'Recommended for removal' })
      }
    }
  }

  // Hero suggestion (advisory only).
  let heroSuggestion: { _id: string; why: string } | null = null
  const hs = modelJson.heroSuggestion
  if (hs && hs.n != null) {
    const idx = Number(hs.n) - 1
    if (Number.isInteger(idx) && idx >= 0 && idx < toOrder.length) {
      heroSuggestion = { _id: toOrder[idx]._id, why: str(hs.why) }
    }
  }

  // Whole-set photo QUALITY assessment (AI judges lighting/composition/coverage). Persisted to the
  // listing's raw as _photoScore so the listing + health scores can fold in photo quality, not just count.
  let assessment: { quality: number | null; coverage: string; notes: string[] } | null = null
  const asmt = modelJson.assessment
  if (asmt && typeof asmt === 'object') {
    const q = Number(asmt.quality)
    assessment = {
      quality: Number.isFinite(q) ? Math.max(0, Math.min(100, Math.round(q))) : null,
      coverage: str(asmt.coverage),
      notes: Array.isArray(asmt.notes) ? asmt.notes.map(str).filter(Boolean).slice(0, 4) : [],
    }
    if (assessment.quality != null) {
      try {
        const newRaw = { ...raw, _photoScore: { score: assessment.quality, coverageNote: assessment.coverage, notes: assessment.notes, count: allPics.length, at: new Date().toISOString() } }
        await sb.from('guesty_listings').update({ raw: newRaw }).eq('id', listingId)
      } catch { /* persist is best-effort */ }
    }
  }

  return NextResponse.json({
    ok: true,
    listingId,
    heroId: hero._id,
    currentOrder: allPics.map(p => p._id),
    proposedOrder,
    photos: allPics.map(p => ({ _id: p._id, url: p.url, caption: p.caption, ...(meta[p._id] || {}) })),
    heroSuggestion,
    assessment,
    recommendRemove,
    overflow: overflow.length,
  })
}
