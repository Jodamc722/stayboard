// Guest Guidebook engine v2 — "30 years of experience" pipeline.
// POST: (1) gathers listing facts, guest-review praise, per-building local recs (welcome-call guide),
// uploaded photos + PDF context docs; (2) VISION pass categorizes every photo (room type, brightness,
// cover-worthiness) so pages get the RIGHT image with readable text; (3) an expert hospitality
// copywriter prompt REWRITES the operator's raw answers into polished editorial prose, keeps the book
// LEAN (only sections that earn their place; appliance how-tos only for non-traditional gear), and
// assigns photos per page. GET/PUT/DELETE unchanged. AI failure falls back to a clean template.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildingGuideFor } from '@/lib/welcome-call-guide'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// Guest-friendly local time: "16:00" -> "4 PM", "10:00" -> "10 AM". Never military time.
function fmtTime(v: any): string {
  const m = str(v).trim().match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return str(v)
  let h = Number(m[1]); const min = m[2] && m[2] !== '00' ? ':' + m[2] : ''
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return h + min + ' ' + ap
}

async function requireUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const id = sp.get('id')
  const db = supabaseAdmin()
  if (id) {
    const { data, error } = await db.from('guidebooks').select('*').eq('id', id).limit(1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, guidebook: (data || [])[0] || null })
  }
  const { data, error } = await db.from('guidebooks').select('id, listing_id, listing_name, title, theme, status, created_at, updated_at').order('updated_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, guidebooks: data || [] })
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.sections && typeof body.sections === 'object') patch.sections = body.sections
  if (body.title != null) patch.title = str(body.title).slice(0, 160)
  if (body.theme != null) patch.theme = str(body.theme).slice(0, 40)
  if (body.status != null) patch.status = str(body.status).slice(0, 40)
  const { error } = await supabaseAdmin().from('guidebooks').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin().from('guidebooks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

const MODEL = 'claude-sonnet-4-6'

async function anthropic(key: string, payload: any): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    return Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = str(body?.listingId)
  const answers = (body?.answers && typeof body.answers === 'object') ? body.answers : {}
  const theme = str(body?.theme) || 'editorial'
  const tone = str(body?.tone) || 'warm'
  const audience = str(body?.audience) || 'all guests'
  const highlights = str(body?.highlights).slice(0, 1500)
  const uploadedPhotos: string[] = Array.isArray(body?.uploadedPhotos) ? body.uploadedPhotos.filter((u: any) => typeof u === 'string').slice(0, 16) : []
  const docUrls: string[] = Array.isArray(body?.docUrls) ? body.docUrls.filter((u: any) => typeof u === 'string').slice(0, 3) : []
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const db = supabaseAdmin()
  const [{ data: rows }, { data: revRows }] = await Promise.all([
    db.from('guesty_listings')
      .select("id, title, nickname, building, unit, bedrooms, bathrooms, max_occupancy, address_full, address_city, pictures, amenities, pub:raw->publicDescription, wifiName:raw->>wifiName, wifiPassword:raw->>wifiPassword, ci:raw->>defaultCheckInTime, co:raw->>defaultCheckOutTime")
      .eq('id', listingId).limit(1),
    db.from('guesty_reviews').select('rating, content, created_at').eq('listing_id', listingId).not('content', 'is', null).order('created_at', { ascending: false }).limit(60),
  ])
  const l: any = (rows || [])[0]
  if (!l) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const name = l.title || l.nickname || 'Your Residence'
  const building = str(l.building)
  const city = str(l.address_city) || ''
  const pub = l.pub || {}
  const summary = [str(pub.summary), str(pub.space), str(pub.neighborhood)].filter(Boolean).join('\n').slice(0, 3500)
  const praise = (revRows || []).filter((r: any) => Number(r.rating) >= 4 && str(r.content).length > 40).slice(0, 6).map((r: any) => str(r.content).replace(/\s+/g, ' ').slice(0, 240))
  const bg = buildingGuideFor(name) || buildingGuideFor(building)

  // Photo pool: operator uploads FIRST (they chose them for quality), then Guesty pictures.
  const guestyPics: string[] = (Array.isArray(l.pictures) ? l.pictures : []).filter((u: any) => typeof u === 'string')
  const pool: string[] = [...uploadedPhotos, ...guestyPics].slice(0, 12)

  const key = process.env.ANTHROPIC_API_KEY

  // ---- PASS 1: VISION — know what every photo shows before laying out pages. ----
  let photoMeta: { url: string; category: string; brightness: string; quality: number; coverWorthy: boolean; hasText: boolean; label?: string }[] =
    pool.map(u => ({ url: u, category: 'other', brightness: 'mid', quality: 3, coverWorthy: false, hasText: false, label: '' }))
  if (key && pool.length) {
    const content: any[] = pool.map((u, i) => ({ type: 'image', source: { type: 'url', url: u } }))
    content.push({ type: 'text', text: `You are a photo editor for a luxury rental guidebook. For EACH of the ${pool.length} images above, in order, return a JSON array of objects: {"i":index,"category":"bedroom|living|kitchen|dining|bathroom|pool|beach|view|exterior|amenity|appliance|logo|other","brightness":"dark|mid|bright","quality":1-5,"coverWorthy":true|false,"hasText":true|false,"label":""}. coverWorthy = striking, well-lit, works full-bleed behind white text. hasText = the image itself contains ANY visible caption, label, watermark, map text, or lettering (we will overlay type, so text-bearing images are unusable). category "appliance" = a close-up of a specific appliance or control (cooktop, oven, thermostat, washer, smart panel) - never coverWorthy; for appliance photos ONLY, set "label" to a 2-4 word name of what is shown (e.g. "induction cooktop"). A logo/graphic is category "logo" and never coverWorthy. STRICT minified JSON array only.` })
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await anthropic(key, { model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content }] })
      const parsed = parseJson(text || '')
      if (Array.isArray(parsed) && parsed.length) {
        parsed.forEach((p: any) => {
          const i = Number(p?.i)
          if (Number.isFinite(i) && photoMeta[i]) photoMeta[i] = { url: pool[i], category: str(p.category) || 'other', brightness: str(p.brightness) || 'mid', quality: Number(p.quality) || 3, coverWorthy: p.coverWorthy === true, hasText: p.hasText === true, label: str(p.label).slice(0, 40) }
        })
        break
      }
    }
  }
  // Text-bearing images (captions, map labels, watermarks) are NEVER used behind our type.
  // Appliance close-ups are reserved for the House Guide, never full-bleed pages.
  const usable = photoMeta.filter(p => p.category !== 'logo' && p.category !== 'appliance' && !p.hasText)
  const pick = (cats: string[], fallbackCover = false): string | null => {
    const c = usable.filter(p => cats.includes(p.category)).sort((a, b) => b.quality - a.quality)[0]
    if (c) return c.url
    if (fallbackCover) { const alt = usable.filter(p => p.coverWorthy).sort((a, b) => b.quality - a.quality)[0]; return alt ? alt.url : (usable[0]?.url || null) }
    return null
  }
  const photoAssign: Record<string, string | null> = {
    cover: (usable.filter(p => p.coverWorthy).sort((a, b) => b.quality - a.quality)[0]?.url) || pick(['living', 'bedroom', 'view', 'exterior'], true),
    about: pick(['living', 'dining', 'kitchen']),
    arrival: pick(['exterior', 'view', 'pool']),
    special: pick(['pool', 'beach', 'amenity', 'view']),
    closing: pick(['bedroom', 'view', 'beach']),
  }
  // GUARANTEE imagery: if vision matching left a page empty (or the vision call failed), give
  // every slot the next-best unused photo. A premium book never runs photo-less when photos exist.
  {
    const used = new Set(Object.values(photoAssign).filter(Boolean) as string[])
    const ranked = usable.slice().sort((a, b) => b.quality - a.quality).map(p => p.url)
    for (const slot of ['cover', 'about', 'arrival', 'special', 'closing']) {
      if (!photoAssign[slot]) {
        const nxt = ranked.find(u => !used.has(u)) || ranked[0] || null
        if (nxt) { photoAssign[slot] = nxt; used.add(nxt) }
      }
    }
  }

  // ---- Context docs (PDFs the operator uploaded). ----
  const docBlocks: any[] = []
  for (const u of docUrls) {
    try {
      const r = await fetch(u)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 8 * 1024 * 1024) continue
      docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
    } catch { /* skip doc */ }
  }

  const fallback = buildFallback({ name, building, city, l, answers })

  // ---- PASS 2: COMPOSE — the 30-years-of-experience writer. ----
  let sections: any = fallback
  if (key) {
    const SYSTEM = `You are the most experienced luxury-hospitality guidebook designer and copywriter in the world - 30 years of boutique-hotel welcome books. You write for Stay Hospitality (Miami/Broward, FL).
PRINCIPLES:
1. REWRITE, never copy. The operator's answers are raw notes - transform them into polished, ${tone}, editorial prose. Keep every FACT exactly (codes, floors, times, names); elevate every WORD.
2. LEAN. A great guidebook is short. Omit any section that adds no real value for this specific home by listing its key in "omit". The "houseGuide" section exists ONLY for non-traditional equipment (induction cooktops, Wolf/Sub-Zero appliances, smart-home systems, unusual controls) - and then frame it as a premium feature, not a manual. Standard appliances: omit.
3. NEVER INVENT. No made-up hours, codes, addresses, amenities, or place names. Only what's provided.
4. FIT THE PAGE. cover lines <= 4 words each; about.body 50-80 words; retreat.lines 3 lines, each <= 20 words; special: 2-4 groups of 2-4 short items; guidelines: <= 5 items, one sentence each; arrival entry/parking 30-60 words each; host.body 50-70 words; gettingThere 40-70 words; gettingAround.body 40-60 words (ONLY from operator notes - omit if none); beforeYouGo <= 5 short items; review.body 40-60 words. houseGuide item titles must NAME the equipment (e.g. "Induction Cooktop", not "Kitchen").
5. Audience: ${audience}. ${highlights ? 'MUST gracefully feature: ' + highlights : ''}
6. localPlaces and restaurants are MANDATORY (never omit): 4-6 REAL spots each with a 6-12 word "note". Prefer the provided LOCAL KNOWLEDGE; if absent, use well-known, long-established places near the given city (no inventions, no chains unless iconic).
Return STRICT minified JSON with EXACTLY the same keys/shapes as the EXAMPLE object, plus an "omit" array of section keys to drop (choose from: retreat, special, host, houseGuide, gettingThere, gettingAround, addons). No markdown.`
    const USER_TEXT = `THE HOME:
name: ${name} | building: ${building} | ${city}
${l.bedrooms} BR / ${l.bathrooms} BA / sleeps ${l.max_occupancy}
address: ${str(l.address_full)}
check-in ${fmtTime(l.ci) || '4 PM'} / check-out ${fmtTime(l.co) || '10 AM'} (always show times in this friendly local format, never 24-hour)
amenities: ${(Array.isArray(l.amenities) ? l.amenities : []).slice(0, 40).join(', ')}
LISTING DESCRIPTION (context, do not copy):
${summary}
${praise.length ? 'WHAT GUESTS LOVED (weave the themes in naturally, never quote):\n' + praise.map(p => '- ' + p).join('\n') : ''}
${bg ? `LOCAL KNOWLEDGE for ${bg.name} (${bg.area}) - use for localPlaces/restaurants (real names only): eat: ${bg.recs.food.join(', ')} | coffee: ${bg.recs.coffee} | grocery: ${bg.recs.grocery} | beach: ${bg.recs.beach} | insider tip: ${bg.recs.tip} | parking notes: ${bg.parking} | access notes: ${bg.access}` : ''}
OPERATOR'S RAW NOTES (facts are authoritative; the wording is yours to elevate):
${JSON.stringify(answers).slice(0, 4000)}
EXAMPLE OBJECT (schema contract):
${JSON.stringify(fallback)}`
    const content: any[] = [...docBlocks, { type: 'text', text: USER_TEXT }]
    const text = await anthropic(key, { model: MODEL, max_tokens: 4500, system: SYSTEM, messages: [{ role: 'user', content }] })
    const parsed = parseJson(text || '')
    if (parsed && parsed.cover && parsed.wifi) sections = { ...fallback, ...parsed, wifi: fallback.wifi }
  }

  // LOCAL PAGES ARE MANDATORY: refill from the building guide if the AI came back empty.
  sections.omit = (Array.isArray(sections.omit) ? sections.omit : []).filter((k: string) => k !== 'localPlaces' && k !== 'restaurants')
  if (!(sections.restaurants?.items || []).length && bg) {
    sections.restaurants = { items: bg.recs.food.slice(0, 4).map((n: string) => ({ name: n, note: '' })) }
  }

  // Getting Around renders ONLY when the operator supplied notes (audit: never invent transport info).
  if (!str(answers?.gettingAround).trim() && !sections.omit.includes('gettingAround')) sections.omit.push('gettingAround')

  // APPLIANCE HOW-TOS get a photo of the ACTUAL appliance when one was uploaded (vision-labeled).
  {
    const appl = photoMeta.filter(p => p.category === 'appliance')
    const claimed = new Set<string>()
    for (const it of (sections.houseGuide?.items || [])) {
      const hay = (str(it?.title) + ' ' + str(it?.body)).toLowerCase()
      const hit = appl.find(p => !claimed.has(p.url) && str(p.label).toLowerCase().split(/\s+/).some(w => w.length > 3 && hay.includes(w)))
      if (hit) { it.photo = hit.url; claimed.add(hit.url) }
    }
  }

  // LOCAL IMAGERY - every spot gets a photo. Pexels first (if key set), then Openverse
  // (keyless, commercial-license filter), then a varied section-appropriate stock query.
  const pex = process.env.PEXELS_API_KEY
  const GEN: Record<string, string[]> = {
    restaurants: ['fine dining restaurant interior', 'chef plating gourmet dish', 'al fresco dining table', 'cocktail bar ambiance', 'seafood dinner platter', 'restaurant candlelight table'],
    localPlaces: ['florida beach palm trees', 'coastal boardwalk sunset', 'marina boats florida', 'tropical ocean pier', 'florida lighthouse coast', 'palm lined street florida'],
  }
  async function imageFor(q: string): Promise<string | null> {
    if (pex) {
      try {
        const r = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=1&orientation=landscape', { headers: { Authorization: pex } })
        const d: any = await r.json().catch(() => ({}))
        const src = d?.photos?.[0]?.src?.large
        if (src) return src
      } catch { /* fall through */ }
    }
    try {
      const r = await fetch('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) + '&license_type=commercial&per_page=1&mature=false', { headers: { 'User-Agent': 'StayBoardGuidebook/1.0' } })
      const d: any = await r.json().catch(() => ({}))
      const res = d?.results?.[0]
      // Prefer the Openverse-proxied thumbnail (reliably hotlinkable) over origin URLs.
      const u = res?.thumbnail || res?.url
      if (u) return u
    } catch { /* fall through */ }
    return null
  }
  for (const k of ['localPlaces', 'restaurants']) {
    const items = Array.isArray(sections[k]?.items) ? sections[k].items : []
    await Promise.all(items.slice(0, 6).map(async (it: any, i: number) => {
      const nm = String(it?.name || '').slice(0, 60)
      if (!nm) return
      it.photo = (await imageFor(nm + (city ? ' ' + city : ' florida'))) || (await imageFor(GEN[k][i % GEN[k].length])) || undefined
    }))
  }

  sections._photos = pool
  sections._photoMeta = photoMeta
  sections._photoAssign = photoAssign
  if (!Array.isArray(sections.omit)) sections.omit = []

  const { data: ins, error } = await db.from('guidebooks').insert({
    listing_id: listingId,
    listing_name: name,
    title: `${name} — Guest Guidebook`,
    theme,
    status: 'draft',
    answers: { ...answers, _tone: tone, _audience: audience, _highlights: highlights },
    sections,
    created_by: user.email || null,
  }).select('id').limit(1)
  if (error) return NextResponse.json({ error: error.message + ' (run the guidebooks SQL in Supabase first?)' }, { status: 500 })
  return NextResponse.json({ ok: true, id: (ins || [])[0]?.id })
}

function buildFallback(ctx: { name: string; building: string; city: string; l: any; answers: any }) {
  const { name, building, city, l, answers } = ctx
  const a = (k: string, dflt = '') => str(answers?.[k]) || dflt
  const place = [building || name, city].filter(Boolean).join('  ·  ')
  return {
    omit: [],
    cover: { line1: 'welcome', line2: 'to your stay', subtitle: place.toUpperCase() },
    about: { heading: 'about the space', body: `Welcome to ${building || name}. Your residence has been prepared for a seamless, restful stay${city ? ' in ' + city : ''} — settle in, slow down, and make yourself at home.` },
    retreat: { heading: 'your private retreat', lines: [
      `THANK YOU FOR CHOOSING ${(building || name).toUpperCase()}. WE'RE HONORED TO HOST YOU.`,
      'MORE THAN A STAY — A PRIVATE ESCAPE DESIGNED FOR COMFORT AND EASE.',
      'OUR TEAM IS A MESSAGE AWAY FOR ANYTHING YOU NEED.',
    ] },
    special: { heading: 'what makes this stay special', groups: [
      { title: 'The Residence', items: [`${l.bedrooms ?? '-'} bedroom${l.bedrooms === 1 ? '' : 's'} · ${l.bathrooms ?? '-'} bath${l.bathrooms === 1 ? '' : 's'}`, `Sleeps ${l.max_occupancy ?? '-'}`] },
      { title: 'Amenities', items: (Array.isArray(l.amenities) ? l.amenities : []).slice(0, 4) },
    ] },
    host: { heading: 'meet your host', body: 'We manage beautiful stays across South Florida with one obsession: the details. Whether you\'re here to relax, explore, or celebrate, our team is close by to make every day effortless.' },
    guidelines: { heading: 'house guidelines', intro: `A few notes that keep ${building || name} exceptional for every guest:`, items: [
      { title: 'No Parties or Events', body: 'Gatherings require prior written approval.' },
      { title: 'Quiet Hours', body: a('quietHours', 'Please keep the peace for neighbors and fellow guests.') },
      { title: 'Registered Guests Only', body: 'Maximum occupancy must be observed at all times.' },
      { title: 'No Smoking', body: 'Strictly non-smoking, including balconies.' },
      { title: 'Pets', body: a('petPolicy', 'Not permitted unless approved in advance.') },
    ], address: str(l.address_full) },
    arrival: { heading: 'arrival & check-in', checkIn: fmtTime(l.ci) || '4 PM', checkOut: fmtTime(l.co) || '10 AM', entry: a('entry', 'Arrival details are provided in your confirmation message.'), parking: a('parking', 'Parking details are provided in your confirmation message.') },
    contact: { customerService: '954-526-8998', gmName: 'Jon McGill', gmPhone: '954-391-2116', concierge: a('concierge', ''), email: 'support@stay-hospitality.com' },
    houseGuide: { items: [
      { title: 'Thermostat', body: a('thermostat', '') },
      { title: 'Smart Home', body: a('smartHome', '') },
      { title: 'Kitchen', body: a('stove', '') },
      { title: 'Trash & Disposal', body: a('trash', '') },
    ].filter(x => x.body) },
    wifi: { network: str(l.wifiName), password: str(l.wifiPassword) },
    gettingThere: { heading: 'getting to the residence', body: a('entry', 'Follow the check-in instructions in your confirmation message — and if you need a hand, the team is one message away.') },
    gettingAround: { heading: 'getting around', body: a('gettingAround', '') },
    localPlaces: { items: splitList(a('localPlaces', '')) },
    restaurants: { items: splitList(a('restaurants', '')) },
    addons: { intro: 'Optional experiences, arranged on request. Advance notice recommended.', items: splitList(a('addons', '')) },
    beforeYouGo: { items: [
      'Gather your belongings — a quick sweep of rooms, drawers, and closets.',
      'Return the thermostat to its arrival setting and close the windows.',
      a('checkoutKey', 'Follow the key/access return note in your confirmation message.'),
      'Start the dishwasher if you\'ve used dishes.',
      'Lights off, doors locked — and travel safe.',
    ] },
    review: { body: 'If we earned it, a review means the world — it supports our team and helps future guests book with confidence. Thank you for staying with us.' },
    thankyou: { line: 'WE HOPE TO SEE YOU AGAIN SOON' },
  }
}

function splitList(s: string): { name: string; note?: string }[] {
  return str(s).split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12).map(name => ({ name, note: '' }))
}

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.search(/[[{]/); const b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']')); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}
