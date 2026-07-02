// Guest Guidebook engine. POST generates a guidebook for a listing: pulls the listing's Guesty
// data (description, photos, Wi-Fi, details) + the user's interview answers, asks the AI to
// compose every section in the Stay editorial voice (Salato-template structure), and saves to
// `guidebooks`. GET lists/fetches, PUT edits sections/title/theme, DELETE removes.
// Logged-in users only. AI failure falls back to a deterministic template so the builder always works.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

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

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = str(body?.listingId)
  const answers = (body?.answers && typeof body.answers === 'object') ? body.answers : {}
  const theme = str(body?.theme) || 'editorial'
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: rows } = await db.from('guesty_listings')
    .select("id, title, nickname, building, unit, bedrooms, bathrooms, max_occupancy, address_full, address_city, pictures, amenities, pub:raw->publicDescription, wifiName:raw->>wifiName, wifiPassword:raw->>wifiPassword, ci:raw->>defaultCheckInTime, co:raw->>defaultCheckOutTime")
    .eq('id', listingId).limit(1)
  const l: any = (rows || [])[0]
  if (!l) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const name = l.title || l.nickname || 'Your Residence'
  const building = str(l.building) || str(answers.building) || ''
  const city = str(l.address_city) || ''
  const pub = l.pub || {}
  const summary = [str(pub.summary), str(pub.space)].filter(Boolean).join('\n').slice(0, 3000)

  // Deterministic fallback sections (used if AI is unavailable) - Salato structure.
  const fallback = buildFallback({ name, building, city, l, answers })

  let sections: any = fallback
  const key = process.env.ANTHROPIC_API_KEY
  if (key) {
    try {
      const SYSTEM = `You write luxury short-term-rental guest guidebooks for Stay Hospitality (Miami/Broward, FL). Voice: warm, refined, editorial - like a boutique hotel. Never invent facts (no made-up door codes, hours, addresses, or amenities). Use ONLY the provided data. Return STRICT minified JSON matching exactly the schema of the EXAMPLE object you are given (same keys, same shapes). Improve wording, fill gaps tastefully, keep items concise.`
      const USER = `LISTING DATA:\nname: ${name}\nbuilding: ${building}\ncity: ${city}\nbedrooms: ${l.bedrooms} baths: ${l.bathrooms} sleeps: ${l.max_occupancy}\naddress: ${str(l.address_full)}\ncheck-in: ${str(l.ci)} check-out: ${str(l.co)}\nwifi network: ${str(l.wifiName)} wifi password: ${str(l.wifiPassword)}\namenities: ${(Array.isArray(l.amenities) ? l.amenities : []).slice(0, 40).join(', ')}\nDESCRIPTION:\n${summary}\n\nOPERATOR ANSWERS (authoritative - use verbatim facts):\n${JSON.stringify(answers).slice(0, 4000)}\n\nEXAMPLE OBJECT (match this schema exactly, rewrite content for THIS listing):\n${JSON.stringify(fallback)}`
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
      })
      const d: any = await r.json().catch(() => ({}))
      if (r.ok) {
        const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
        const parsed = parseJson(text)
        if (parsed && parsed.cover && parsed.wifi) sections = { ...fallback, ...parsed, wifi: fallback.wifi }
      }
    } catch { /* fall back */ }
  }

  const photos = (Array.isArray(l.pictures) ? l.pictures : []).slice(0, 12)
  sections._photos = photos

  const { data: ins, error } = await db.from('guidebooks').insert({
    listing_id: listingId,
    listing_name: name,
    title: `${name} — Guest Guidebook`,
    theme,
    status: 'draft',
    answers,
    sections,
    created_by: user.email || null,
  }).select('id').limit(1)
  if (error) return NextResponse.json({ error: error.message + ' (run the guidebooks SQL in Supabase first?)' }, { status: 500 })
  return NextResponse.json({ ok: true, id: (ins || [])[0]?.id })
}

function buildFallback(ctx: { name: string; building: string; city: string; l: any; answers: any }) {
  const { name, building, city, l, answers } = ctx
  const a = (k: string, dflt = '') => str(answers?.[k]) || dflt
  const place = [building || name, city].filter(Boolean).join(' | ')
  return {
    cover: { line1: "we're so glad", line2: "you're here to stay", subtitle: place.toUpperCase() },
    about: { heading: 'about the space', body: `Welcome to ${building || name}. Designed for comfort and refined coastal living, your residence offers everything you need for a seamless, memorable stay${city ? ' in ' + city : ''}.` },
    retreat: { heading: 'Welcome to Your Private Retreat', lines: [
      `THANK YOU FOR CHOOSING OUR RESIDENCE AT ${(building || name).toUpperCase()}. WE'RE HONORED TO HOST YOU.`,
      'THIS IS MORE THAN A STAY — IT\'S A PRIVATE ESCAPE DESIGNED FOR COMFORT, DISCRETION, AND REFINED LIVING.',
      'SHOULD YOU NEED ANYTHING DURING YOUR TIME HERE, OUR TEAM IS AVAILABLE TO ASSIST WITH LOCAL RECOMMENDATIONS OR SPECIAL ARRANGEMENTS.',
      'ENJOY THE PRIVACY. RELAX — YOU\'RE EXACTLY WHERE YOU SHOULD BE.',
    ] },
    special: { heading: 'What Makes This Stay Special', groups: [
      { title: 'The Residence', items: [`${l.bedrooms ?? '-'} bedroom${l.bedrooms === 1 ? '' : 's'} · ${l.bathrooms ?? '-'} bath${l.bathrooms === 1 ? '' : 's'}`, `Sleeps ${l.max_occupancy ?? '-'}`] },
      { title: 'Amenities', items: (Array.isArray(l.amenities) ? l.amenities : []).slice(0, 6) },
    ] },
    host: { heading: 'meet your host', body: 'With years of experience managing beautiful vacation rentals, we specialize in creating unforgettable stays for our guests. Our team is passionate about attention to detail and providing seamless, luxurious experiences. Whether you\'re here to relax, explore, or celebrate, you can count on us to ensure your trip is smooth and memorable.' },
    guidelines: { heading: 'House Guidelines', intro: `To preserve the comfort, privacy, and elevated experience of ${building || name}, we kindly ask that you observe the following:`, items: [
      { title: 'No Parties or Events', body: 'Gatherings or events are not permitted without prior written approval.' },
      { title: 'Quiet Hours', body: a('quietHours', 'Please respect building quiet hours and maintain a peaceful environment for all residents and guests.') },
      { title: 'Occupancy Limits', body: 'Only registered guests may stay overnight. Maximum occupancy must be observed at all times.' },
      { title: 'No Smoking', body: 'This is a strictly non-smoking residence, including balconies and common areas.' },
      { title: 'Pet Policy', body: a('petPolicy', 'Pets are not permitted unless explicitly approved in advance as part of your reservation.') },
    ], address: str(l.address_full) },
    arrival: { heading: 'Arrival & Check-In', checkIn: str(l.ci) || '4:00 PM', checkOut: str(l.co) || '11:00 AM', entry: a('entry', 'We\'ve made arrival simple and seamless. Details are provided in your confirmation message.'), parking: a('parking', 'Parking details will be provided in your confirmation message. Please park only in designated areas.') },
    contact: { customerService: '954-526-8998', gmName: 'Jon McGill', gmPhone: '954-391-2116', concierge: a('concierge', ''), email: 'support@stay-hospitality.com' },
    houseGuide: { items: [
      { title: 'Smart Home Device', body: a('smartHome', '') },
      { title: 'Thermostat', body: a('thermostat', '') },
      { title: 'Stove Top', body: a('stove', '') },
      { title: 'Trash & Disposal', body: a('trash', '') },
    ].filter(x => x.body) },
    wifi: { network: str(l.wifiName), password: str(l.wifiPassword) },
    gettingThere: { heading: 'getting to the apartment', body: a('entry', 'Upon arrival, please follow the check-in instructions in your confirmation message. If you need assistance at any point, our team is happy to help.') },
    localPlaces: { items: splitList(a('localPlaces', '')) },
    restaurants: { items: splitList(a('restaurants', '')) },
    addons: { intro: 'Enhance your stay with optional experiences arranged upon request. Advance notice recommended to ensure availability.', items: splitList(a('addons', 'Private Chef Experience, Mid-Stay Refresh Cleaning, Pre-Arrival Provisioning, Airport Transport, Luxury Car Services, Wellness Package, Boat / Jet Ski Rentals, Dog Walker, Babysitting Services')) },
    beforeYouGo: { items: [
      'Kindly ensure all personal belongings are taken with you before departure. Double-check all rooms, drawers, and closets.',
      'Please close all windows and return the thermostat to the setting it was on when you checked in.',
      a('checkoutKey', 'Please follow the key/access return instructions in your confirmation message.'),
      'Load used dishes into the dishwasher and start the cycle if needed.',
      'Turn off lights and appliances, and make sure all doors are locked before leaving.',
    ] },
    review: { body: 'If your stay met your expectations, we would truly appreciate you taking a moment to leave a review. Your feedback not only supports our team, but also helps future guests choose their stay with confidence. Thank you again for choosing our residence — it was a pleasure hosting you.' },
    thankyou: { line: 'WE HOPE TO SEE YOU AGAIN SOON!' },
  }
}

function splitList(s: string): { name: string; note?: string }[] {
  return str(s).split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12).map(name => ({ name }))
}

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}
