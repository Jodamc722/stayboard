// THE PHOTO ANALYST — v2 (Jon, 2026-09-08: "full deep audit and improvement… photo order matters
// big time").
//
// What changed and why (the audit ran on Arya 1704/1, 55 photos):
//   1. EVERY photo is analysed, the cover included. v1 skipped the cover and capped the rest at 40,
//      so 15 photos came back unseen, unordered and captioned "Property photo".
//   2. The model returns FACTS, not an order. It is asked, per photo: which room, what it shows,
//      wide / medium / detail, a 0–100 quality, faults, selling points, whether it is a near-
//      duplicate of another photo, and a caption. The ORDER is built by lib/photo-order from those
//      facts — deterministic, unit-type aware, and every position carries a reason. v1 asked the
//      model for an order and then re-sorted it by category, so a room's wide shots and its detail
//      shots ended up 20 positions apart.
//   3. Vision runs in PARALLEL BATCHES of 18 photos. 55 photos = 4 calls at once ≈ 25s instead of
//      one 90s call that hit the timeout on photo-heavy listings.
//   4. Junk captions ("DSC03072", "IMG_4412") no longer beat the AI caption. They are the reason
//      live listings were showing camera filenames under photos.
//   5. Title ideas: the strongest photographed features (pool, bay view, king bed…) are aggregated
//      into `titleHooks`, and three title options are written from them — so what the title
//      promises is what the photos show.
//
// Generate-only. Nothing goes to Guesty until the human pushes via /api/photo-order.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadListingAiWithPreview } from '@/lib/listing-ai-server'
import { buildOrder, normalizeRooms, marketingChecks, titleHooks, isJunkCaption, ORDER_RULE, PLAYBOOK, type PhotoFacts, type ShotType } from '@/lib/photo-order'
import { modelFor } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH = 18
// MODEL is resolved per request via modelFor('photos') — see lib/ai-models (editable on Users & admin).
function str(v: any): string { return typeof v === 'string' ? v : '' }
const CAT_CAPTION: Record<string, string> = { living: 'Living area', kitchen: 'Kitchen', dining: 'Dining area', bedroom: 'Bedroom', bathroom: 'Bathroom', outdoor: 'Outdoor space', view: 'View from the property', amenity: 'Building amenity', exterior: 'Building exterior', detail: 'Property detail', other: 'Property photo' }
const CATS = new Set(Object.keys(CAT_CAPTION))
const isPlaceholderCaption = (c: string) => Object.values(CAT_CAPTION).indexOf(String(c || '').trim()) >= 0

// ── tolerant JSON (the model occasionally truncates a long array) ──────────────────────────────
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
  try { return JSON.parse(s) } catch { /* repair */ }
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
  if (lastSafe > 0) { try { return JSON.parse(closeOpenBrackets(s.slice(0, lastSafe).replace(/,\s*$/, ''))) } catch { /* whole */ } }
  try { return JSON.parse(closeOpenBrackets(s)) } catch { return null }
}

function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_360,h_360,c_limit,q_auto,f_jpg/')
  return u
}
type Pic = { _id: string; url: string; caption: string }
function readPics(raw: any, listing: any): Pic[] {
  const arr0: any[] = Array.isArray(raw?.pictures) ? raw.pictures : (Array.isArray(listing?.pictures) ? listing.pictures : [])
  const arr = arr0.map((p: any) => { if (typeof p === 'string') { try { return JSON.parse(p) } catch { return null } } return p }).filter(Boolean)
  return arr.map((p: any, i: number) => ({ _id: str(p?._id) || `idx-${i}`, url: str(p?.thumbnail) || str(p?.original) || '', caption: str(p?.caption) })).filter(p => p.url)
}
function roomKey(room: string, category: string): string {
  const r = String(room || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return r || String(category || 'other').toLowerCase()
}
async function fetchImage(url: string): Promise<{ data: string; media: string } | null> {
  try {
    const ir = await fetch(smallUrl(url))
    if (!ir.ok) return null
    const ct = (ir.headers.get('content-type') || '').toLowerCase()
    const media = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    return { data: Buffer.from(await ir.arrayBuffer()).toString('base64'), media }
  } catch { return null }
}
async function callModel(key: string, system: string, content: any[], maxTokens: number, signal: AbortSignal): Promise<{ json: any; err: string | null }> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: await modelFor('photos'), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) return { json: null, err: `AI ${r.status}: ${str(j?.error?.message).slice(0, 180)}` }
    const text = Array.isArray(j?.content) ? j.content.map((x: any) => str(x?.text)).join('') : ''
    const json = safeParseModelJson(text)
    return json ? { json, err: null } : { json: null, err: 'AI returned unparseable output.' }
  } catch (e: any) { return { json: null, err: e?.name === 'AbortError' ? 'Timed out analysing photos. Try again.' : String(e).slice(0, 180) } }
}

export async function POST(req: NextRequest) {
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
  const lockedHeroId: string | null = typeof body?.heroId === 'string' && body.heroId ? body.heroId : null
  const guidance: string = typeof body?.guidance === 'string' ? body.guidance.trim().slice(0, 600) : ''
  const regenerate: boolean = body?.regenerateCaptions === true
  // Let the engine choose the cover (Jon can ask for it explicitly; default keeps the current one).
  const autoHero: boolean = body?.autoHero === true
  const cfg = await loadListingAiWithPreview(body?.promptPreview)

  const sb = supabaseAdmin()
  const { data: listing, error } = await sb.from('guesty_listings').select('id, title, nickname, building, bedrooms, bathrooms, room_type, max_occupancy, address_city, pictures, raw').eq('id', listingId).single()
  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw = (listing as any).raw || {}
  const allPics = readPics(raw, listing)
  if (allPics.length < 2) return NextResponse.json({ error: 'Listing has fewer than 2 photos to order.' }, { status: 400 })
  const prevIndex: Record<string, any> = (raw?._photoIndex && typeof raw._photoIndex === 'object') ? raw._photoIndex : {}

  const bedrooms = Number((listing as any).bedrooms)
  const bathrooms = Number((listing as any).bathrooms)
  const profile = { bedrooms: Number.isFinite(bedrooms) ? bedrooms : null, bathrooms: Number.isFinite(bathrooms) ? bathrooms : null, isStudio: bedrooms === 0 || /studio/i.test(str((listing as any).nickname) + ' ' + str((listing as any).title) + ' ' + str((listing as any).room_type)) }
  const beds = profile.isStudio ? 1 : Math.max(1, profile.bedrooms ?? 1)
  const baths = Math.max(1, Math.ceil(profile.bathrooms ?? 1))
  // The room vocabulary the model may use for THIS unit — so batch 1 and batch 3 name the same
  // bedroom the same way, and nobody invents a bedroom-3 in a 1-bedroom.
  const roomVocab = ['living', 'dining', 'kitchen', 'entry', 'workspace', ...Array.from({ length: beds }, (_, i) => 'bedroom-' + (i + 1)), ...(baths > 1 ? ['bath-primary', 'bath-guest'] : ['bath-primary']), 'balcony', 'view', 'pool', 'rooftop', 'gym', 'lobby', 'lounge', 'parking', 'exterior', 'other']
  const unitLine = `${str((listing as any).nickname) || str((listing as any).title) || 'listing'} — ${profile.isStudio ? 'STUDIO' : (profile.bedrooms != null ? profile.bedrooms + '-bedroom' : 'unit')}, ${baths} bath${baths === 1 ? '' : 's'}${(listing as any).max_occupancy ? `, sleeps ${(listing as any).max_occupancy}` : ''}, ${str((listing as any).building) || 'building'}, ${str((listing as any).address_city) || ''}`

  // ── PASS 1: facts per photo, in parallel batches. Photo numbers are GLOBAL (1..N) so the model can
  // point at a duplicate in the same batch by number.
  const images = await Promise.all(allPics.map(p => fetchImage(p.url)))
  const presetMenu = [...cfg.enhance.presets, { key: 'none', name: 'None', when: 'Already good — leave it exactly as shot.' }].map(p => `  "${p.key}" (${p.name}) — ${p.when}`).join('\n')
  const SYS = `You are a short-term-rental photo analyst for Stay Hospitality. You are shown a batch of photos from ONE listing. Report FACTS about each photo — you are NOT choosing the order; a separate engine orders them from your facts, so accuracy per photo is what matters.

For EVERY photo return:
- "room": the SPECIFIC physical space, using ONLY these ids for this unit: ${roomVocab.map(r => '"' + r + '"').join(', ')}. Two photos of the same bedroom share the id; different bedrooms do not. In a STUDIO the sleeping/living space is "bedroom-1". A rooftop pool deck is "pool" or "rooftop", never "balcony" (balcony = the unit's own). Never invent an id outside this list.
- "category": one of living|kitchen|dining|bedroom|bathroom|outdoor|view|amenity|exterior|detail|other. Use "detail" ONLY for tight close-ups of an object (a towel, a coffee maker, a plant) — a wide shot of a kitchen is "kitchen".
- "subject": ≤ 8 words, what the photo literally shows ("king bed facing balcony with bay view").
- "shotType": "wide" (shows most of a space), "medium" (part of a space), "detail" (an object).
- "quality": 0–100 for CONVERTING BOOKINGS, judged the way a guest scanning Airbnb does: natural daylight, sharp, straight verticals, staged and clutter-free, a real sense of space, landscape framing. Be strict: a dark or tilted phone shot is 30–45; a clean bright wide interior 70–85; a professional hero-grade shot 85+. A collage, text overlay or watermark caps at 40.
- "faults": any of ["dark","blurry","clutter","people","watermark","signage","vertical","tight","mirror-selfie","text","collage"], else []. "vertical" = portrait orientation (taller than wide) — grids crop it. "text" = any words/logos/price overlaid on the image. "collage" = several photos stitched into one frame. Be strict on these three: OTAs suppress or crop them.
- "sellingPoints": 0–4 tags a guest books for that this photo PROVES: e.g. "pool","infinity-pool","rooftop","ocean-view","bay-view","city-view","balcony","king-bed","workspace","full-kitchen","kitchenette","walk-in-shower","soaking-tub","gym","washer-dryer","natural-light","smart-tv","dining-for-4". Only what is visible.
- "duplicateOf": the photo NUMBER of a near-identical photo in this batch that is the STRONGER of the two, or null. Two angles of the same room are NOT duplicates; the same angle twice is.
- "heroWorthy": true only if this photo could be the listing's cover — wide, bright, a space or view a guest would stop scrolling for.
- "kind": "property" for a real photo of this home/building; "stock" for generic imagery (skyline, map, generic beach, attraction, promo graphic).
- "caption": ${cfg.photos.captionMaxWords} words / ${cfg.photos.captionMaxChars} characters max. ${cfg.photos.captionPrompt}
- "enhance": one preset key from the menu below; "enhanceWhy": ≤ 10 words grounded in what you see.
${presetMenu}

Return ONLY JSON: {"items":[{"n":<photo number>,"room":"…","category":"…","subject":"…","shotType":"…","quality":<0-100>,"faults":[…],"sellingPoints":[…],"duplicateOf":<number|null>,"heroWorthy":<bool>,"kind":"…","caption":"…","enhance":"…","enhanceWhy":"…"}, …]} with ONE entry for EVERY photo number you were given.`

  const batches: { start: number; pics: Pic[] }[] = []
  for (let i = 0; i < allPics.length; i += BATCH) batches.push({ start: i, pics: allPics.slice(i, i + BATCH) })
  const ac = new AbortController()
  const acTimer = setTimeout(() => ac.abort(), 105_000)
  const results = await Promise.all(batches.map(async (b) => {
    const content: any[] = [{ type: 'text', text: `Listing: ${unitLine}. Photos ${b.start + 1}–${b.start + b.pics.length} of ${allPics.length}.${guidance ? `\nHOST CORRECTION — apply exactly: ${guidance}` : ''}` }]
    b.pics.forEach((p, i) => {
      const n = b.start + i + 1
      content.push({ type: 'text', text: `Photo ${n}${p.caption && !isJunkCaption(p.caption) ? ` (current caption: ${p.caption})` : ''}:` })
      const f = images[b.start + i]
      content.push(f ? { type: 'image', source: { type: 'base64', media_type: f.media, data: f.data } } : { type: 'text', text: '(photo unavailable)' })
    })
    return callModel(key, SYS, content, 6000, ac.signal)
  }))
  clearTimeout(acTimer)
  const errs = results.map(r => r.err).filter(Boolean) as string[]
  const gotAny = results.some(r => r.json && Array.isArray(r.json.items))
  if (!gotAny) return NextResponse.json({ error: errs[0] || 'AI did not return photo facts.' }, { status: 502 })

  // ── Assemble facts. Anything the model skipped gets safe defaults (never dropped).
  const presetKeys = new Set([...cfg.enhance.presets.map(p => p.key.toLowerCase()), 'none'])
  const facts: PhotoFacts[] = []
  const byN: Record<number, any> = {}
  for (const r of results) if (r.json && Array.isArray(r.json.items)) for (const it of r.json.items) { const n = Number(it?.n); if (Number.isInteger(n) && n >= 1 && n <= allPics.length) byN[n] = it }
  allPics.forEach((p, i) => {
    const it = byN[i + 1] || {}
    const category0 = str(it.category).toLowerCase()
    const category = CATS.has(category0) ? category0 : 'other'
    const shot0 = str(it.shotType).toLowerCase()
    const shotType: ShotType = shot0 === 'wide' || shot0 === 'medium' || shot0 === 'detail' ? shot0 : (category === 'detail' ? 'detail' : 'medium')
    const q = Number(it.quality)
    const dupN = Number(it.duplicateOf)
    const human = prevIndex[p._id] && prevIndex[p._id].by === 'human' ? prevIndex[p._id] : null
    const aiCaption = str(it.caption).trim().slice(0, cfg.photos.captionMaxChars)
    const existing = isJunkCaption(p.caption) ? '' : p.caption.trim()
    // Human > existing real caption (unless regenerating) > AI > category placeholder.
    const caption = (human?.caption as string) || (!regenerate && existing) || aiCaption || CAT_CAPTION[category]
    const rawPreset = str(it.enhance).trim().toLowerCase()
    facts.push({
      _id: p._id, url: p.url,
      room: (human?.room as string) || roomKey(str(it.room), category),
      category: (human?.category as string) || category,
      subject: str(it.subject).slice(0, 80),
      shotType,
      quality: Number.isFinite(q) ? Math.max(0, Math.min(100, Math.round(q))) : 50,
      kind: str(it.kind) === 'stock' ? 'stock' : 'property',
      faults: Array.isArray(it.faults) ? it.faults.map((f: any) => str(f).toLowerCase()).filter(Boolean).slice(0, 6) : [],
      sellingPoints: Array.isArray(it.sellingPoints) ? it.sellingPoints.map((f: any) => str(f).toLowerCase().replace(/\s+/g, '-')).filter(Boolean).slice(0, 4) : [],
      duplicateOf: Number.isInteger(dupN) && dupN >= 1 && dupN <= allPics.length && dupN !== i + 1 ? allPics[dupN - 1]._id : null,
      heroWorthy: it.heroWorthy === true,
      caption,
      captionSource: human?.caption ? 'human' : (caption === aiCaption && aiCaption) ? 'ai' : (existing && caption === existing) ? 'human' : 'placeholder',
      enhance: presetKeys.has(rawPreset) ? rawPreset : cfg.enhance.fallbackPreset,
      enhanceWhy: str(it.enhanceWhy).slice(0, 90),
    })
  })

  // ── PASS 2: the order, from the facts. Cover = the host's current #1 unless they locked another
  // or asked the engine to choose.
  const heroId = lockedHeroId || (autoHero ? null : allPics[0]._id)
  const normalized = normalizeRooms(facts, profile)
  const { placed, heroCandidates, sections } = buildOrder(normalized, heroId, profile)
  const proposedOrder = placed.map(p => p._id)
  const hooks = titleHooks(normalized)
  const recommendRemove = placed.filter(p => p.placement.slot === 'demoted').map(p => ({ _id: p._id, reason: p.placement.why }))
  const checks = marketingChecks(placed, profile)

  // Whole-set assessment from the facts — no second model call needed for the number.
  const property = normalized.filter(f => f.kind === 'property')
  const wide = property.filter(f => f.shotType === 'wide')
  const avgQ = property.length ? Math.round(property.reduce((s, f) => s + f.quality, 0) / property.length) : 0
  const rooms = new Set(property.map(f => f.room))
  const has = (re: RegExp) => property.some(f => re.test(f.room) || re.test(f.category))
  const missing: string[] = []
  if (!profile.isStudio && !has(/living/)) missing.push('living area')
  if (!has(/kitchen/)) missing.push('kitchen')
  if (!has(/bed/)) missing.push('bedroom')
  if (!has(/bath/)) missing.push('bathroom')
  if (!has(/balcony|outdoor|view/)) missing.push('view / outdoor')
  const notes: string[] = []
  const dupCount = placed.filter(p => p.placement.flag === 'duplicate').length
  const faultCount = placed.filter(p => p.placement.flag === 'fault').length
  const stockCount = placed.filter(p => p.placement.flag === 'stock').length
  if (dupCount) notes.push(`${dupCount} near-duplicate${dupCount === 1 ? '' : 's'} — remove them; repeats make the set look padded.`)
  if (faultCount) notes.push(`${faultCount} weak shot${faultCount === 1 ? '' : 's'} (dark, blurry, signage or clutter) demoted to the end.`)
  if (stockCount) notes.push(`${stockCount} stock/location image${stockCount === 1 ? '' : 's'} — Airbnb ranks listings on real photos; keep at most one, last.`)
  if (missing.length) notes.push(`Not shown: ${missing.join(', ')}. Guests skip listings that hide a room.`)
  const keptN = placed.filter(p => p.placement.slot !== 'demoted').length
  if (keptN > PLAYBOOK.targetCount.max) notes.push(`${keptN} photos would remain after cuts — aim for ${PLAYBOOK.targetCount.min}–${PLAYBOOK.targetCount.max}; attention drops off after ~30.`)
  const coverage = `${rooms.size} spaces shown across ${property.length} real photos (${wide.length} wide)${missing.length ? '; missing ' + missing.join(', ') : ''}.`
  // The set score is the average photo quality, docked for what costs clicks and bookings.
  const failed = checks.filter(c => c.ok === false).length
  const quality = Math.max(0, Math.min(100, Math.round(avgQ - Math.min(15, dupCount * 2) - Math.min(10, stockCount * 3) - missing.length * 4 - failed * 3)))
  const assessment = { quality, coverage, notes: notes.slice(0, 5) }

  // ── Title ideas from what the photos prove. Small, fast text call; failure is silent.
  let titleIdeas: string[] = []
  if (hooks.length) {
    const tcfg = cfg.sections.title
    const TSYS = `You write Airbnb/Vrbo listing TITLES for Stay Hospitality. ${tcfg.guide} Never use these phrases: ${cfg.bannedPhrases}. Reply ONLY with JSON {"titles":["…","…","…"]} — three distinct options, each ≤ ${tcfg.hardCap} characters, each leading with a DIFFERENT hook.`
    const TUSR = `Listing: ${unitLine}. Current title: "${str((listing as any).title)}". The photos PROVE these features (strongest first): ${hooks.map(h => h.hook.replace(/-/g, ' ')).join(', ')}. Spaces photographed: ${Array.from(rooms).join(', ')}. Write three titles that promise only what the photos show.`
    const tac = new AbortController(); const tt = setTimeout(() => tac.abort(), 20_000)
    const t = await callModel(key, TSYS, [{ type: 'text', text: TUSR }], 400, tac.signal)
    clearTimeout(tt)
    if (t.json && Array.isArray(t.json.titles)) titleIdeas = t.json.titles.map((x: any) => str(x).trim()).filter(Boolean).map((x: string) => x.slice(0, tcfg.hardCap || 50)).slice(0, 3)
  }

  // ── PERSIST the index (human corrections outrank the model, as before) + the score + the hooks.
  const at = new Date().toISOString()
  try {
    const photoIndex: Record<string, any> = {}
    for (const f of normalized) {
      const human = prevIndex[f._id] && prevIndex[f._id].by === 'human' ? prevIndex[f._id] : null
      photoIndex[f._id] = { room: f.room, category: f.category, kind: f.kind, subject: f.subject, shotType: f.shotType, quality: f.quality, sellingPoints: f.sellingPoints, caption: f.caption, enhance: f.enhance, enhanceWhy: f.enhanceWhy, at, ...(human ? { by: 'human' } : {}) }
    }
    const ps = { score: assessment.quality, coverageNote: assessment.coverage, notes: assessment.notes, count: allPics.length, hooks: hooks.map(h => h.hook), at }
    await sb.from('guesty_listings').update({ raw: { ...raw, _photoIndex: photoIndex, _photoScore: ps }, photo_score: ps }).eq('id', listingId)
  } catch { /* best-effort */ }

  const mirror: Record<string, any> = (raw._photoMirror && typeof raw._photoMirror === 'object') ? raw._photoMirror : {}
  const photos = placed.map(p => ({
    _id: p._id, url: p.url, caption: p.caption, captionIsPlaceholder: isPlaceholderCaption(p.caption) || p.captionSource === 'placeholder',
    category: p.category, room: p.room, kind: p.kind, subject: p.subject, shotType: p.shotType, quality: p.quality, faults: p.faults, sellingPoints: p.sellingPoints, duplicateOf: p.duplicateOf, heroWorthy: p.heroWorthy,
    reason: p.placement.why, placement: p.placement, enhance: p.enhance, enhanceWhy: p.enhanceWhy,
    mirrorUrl: str(mirror[p._id]?.orig) || null,
  }))

  return NextResponse.json({
    ok: true, listingId,
    heroId: proposedOrder[0],
    currentOrder: allPics.map(p => p._id),
    proposedOrder, photos, sections,
    heroCandidates,
    heroSuggestion: heroCandidates[0] && heroCandidates[0]._id !== proposedOrder[0] ? { _id: heroCandidates[0]._id, why: heroCandidates[0].why } : null,
    assessment, recommendRemove,
    titleHooks: hooks, titleIdeas, checks, playbook: PLAYBOOK, profile, rooms: Array.from(new Set(normalized.map(f => f.room))).sort(), roomVocab,
    overflow: 0,
    presets: cfg.enhance.presets, autoPickEnhance: cfg.enhance.autoPick,
    orderRule: ORDER_RULE,
    partial: errs.length ? `${errs.length} of ${batches.length} photo batches failed (${errs[0]}) — those photos kept safe defaults; re-run for a full pass.` : null,
  })
}
