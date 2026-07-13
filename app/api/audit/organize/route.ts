import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function toB64(url: string): Promise<{ data: string; media: string } | null> {
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000)
    const r = await fetch(url, { signal: ac.signal }); clearTimeout(t)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) return null
    const ct = r.headers.get('content-type') || 'image/jpeg'
    return { data: buf.toString('base64'), media: /png/i.test(ct) ? 'image/png' : 'image/jpeg' }
  } catch { return null }
}

async function visionOne(key: string, content: any[], room: string): Promise<{ items: any[]; questions: string[] } | null> {
  const SYS = 'You are doing a QUICK, smart onboarding inventory of a short-term rental ' + room + ' from SEVERAL photos of the SAME room. Look at EVERY photo together and REASON before you speak. RULES: there is normally only ONE of each big appliance in a room (one TV, one thermostat). A close-up, a brand or logo shot, or a REMOTE is NOT a separate item - it is more evidence about that SAME device, so MERGE it in and NEVER create a second TV. A remote reveals its device: an LG remote means the TV is an LG - use it to fill the brand and model. Capture the MAJOR furniture and the functional inventory a guest uses: bed, nightstands, TV, seating, dresser, desk, and real appliances and equipment (in a kitchen the knife set, utensils, cookware, blender, toaster, coffee maker, kettle, microwave, dishwasher, oven). Do NOT list decor, art, plants, or trinkets. Give a COUNT per kind (two nightstands = count 2, not two rows). Put the KEY attribute in size: bed -> King/Queen/Full/Twin; TV -> Smart or Standard (always include brand if any photo shows it); bathroom -> Shower, Tub, or Shower + Tub; closet -> Walk-in or Reach-in. BRANDS MATTER: for every appliance and tech item - especially kitchen appliances (coffee maker, blender, toaster, microwave, oven, dishwasher), the thermostat, TVs, and washer/dryer - ALWAYS record the brand (and model if any photo shows it) and ALWAYS write a clear step-by-step howTo manual a guest can follow to operate it (power on, key buttons/settings, what to avoid). These manuals feed the FAQ, so write one even if it seems obvious. Leave howTo empty only for plain non-mechanical items like a knife set, utensils, cookware, or furniture. For each item set photoIndex to the photo number that best shows it. QUESTIONS: think hard and ask ONLY what you truly cannot see or infer from ANY photo. If a close-up, logo, or remote reveals the brand, model, or size, do NOT ask about it. Never ask whether something exists that you can see, and never ask the same thing twice. Prefer ZERO questions; max 2. STRICT JSON ONLY, no markdown: {"items":[{"item":"","itemType":"","count":1,"size":"","brand":"","tier":"luxury|high_end|standard|budget|unknown","condition":"","severity":"low|medium|high","amenity":true,"highlight":true,"howTo":"","photoIndex":1}],"questions":["..."]}'
  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 35000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: SYS, messages: [{ role: 'user', content }] })
    })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = await r.json()
    const txt = (j && j.content && j.content[0] && j.content[0].text) || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!parsed || !Array.isArray(parsed.items)) return null
    return { items: parsed.items, questions: Array.isArray(parsed.questions) ? parsed.questions : [] }
  } catch { return null }
}

async function consolidate(key: string, room: string, items: any[], questions: string[]): Promise<{ items: any[]; questions: string[] } | null> {
  if (!items.length) return { items, questions }
  const SYS = 'You are merging ONE room inventory built from several BATCHES of photos of the same ' + room + '. The same physical object may appear in more than one batch (a wide shot in one, a brand close-up or a REMOTE in another). MERGE duplicates into ONE entry - there is only ONE of each big appliance (one TV, one thermostat); combine their details, fill in brand, model and size from the close-ups, keep the best count, keep any howTo and the photo field. PRESERVE brand and howTo, never drop them. Return QUESTIONS only for details still genuinely unknown after merging; if any batch revealed the brand, model or size do NOT ask about it. Max 2 questions or none. STRICT JSON ONLY, no markdown: {"items":[{"item":"","itemType":"","count":1,"size":"","brand":"","tier":"","condition":"","severity":"","amenity":true,"highlight":true,"howTo":"","photo":""}],"questions":["..."]}'
  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 11000)
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, signal: ac.signal, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: SYS, messages: [{ role: 'user', content: 'Merge this inventory. INPUT JSON: ' + JSON.stringify({ items, questions }).slice(0, 14000) }] }) })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = await r.json()
    const txt = (j && j.content && j.content[0] && j.content[0].text) || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!parsed || !Array.isArray(parsed.items)) return null
    return { items: parsed.items, questions: Array.isArray(parsed.questions) ? parsed.questions : [] }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const { data: audits } = await db.from('property_audits').select('id').eq('share_code', code).limit(1)
  if (!(audits && audits[0])) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const room = String(body.room || 'Room').slice(0, 80)
  const urls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 18) : []
  if (urls.length === 0) return NextResponse.json({ error: 'photoUrls required' }, { status: 400 })
  const answers = String(body.answers || '').slice(0, 3000)
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, items: [], questions: [], note: 'no ai key' })

  const withB = (await Promise.all(urls.map(async (u) => { const b = await toB64(u); return b ? { u, img: { type: 'image', source: { type: 'base64', media_type: b.media, data: b.data } } } : null }))).filter(Boolean) as { u: string; img: any }[]
  if (withB.length === 0) return NextResponse.json({ ok: true, items: [], questions: [], note: 'no images fetched' })

  const B = 6
  const batches: { u: string; img: any }[][] = []
  for (let bi = 0; bi < withB.length; bi += B) batches.push(withB.slice(bi, bi + B))
  const batchOut = await Promise.all(batches.map(async (batch) => {
    const content: any[] = [{ type: 'text', text: 'These are photos of the SAME ' + room + '. Study ALL of them together before answering.' }]
    batch.forEach((x, i) => { content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' }); content.push(x.img) })
    content.push({ type: 'text', text: 'Now give the inventory.' + (answers ? ' Inspector already told you (use this, do not re-ask): ' + answers : '') })
    const out = await visionOne(key, content, room)
    const its: any[] = (out && Array.isArray(out.items)) ? out.items : []
    for (const it of its) { if (it && typeof it === 'object') { const pi = Math.max(1, Math.min(batch.length, parseInt(it.photoIndex, 10) || 1)); it.photo = batch[pi - 1] ? batch[pi - 1].u : (batch[0] ? batch[0].u : '') } }
    return { items: its, questions: (out && Array.isArray(out.questions)) ? out.questions : [] }
  }))
  let items: any[] = []; let questions: string[] = []
  for (const br of batchOut) { items = items.concat(br.items); questions = questions.concat(br.questions) }
  if (batches.length > 1 && items.length) {
    const con = await consolidate(key, room, items, questions)
    if (con && Array.isArray(con.items) && con.items.length) {
      const valid: any = {}; for (const x of items) if (x && x.photo) valid[x.photo] = 1
      const nrm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      const byName: any = {}; for (const x of items) byName[nrm(x.item)] = x
      for (const it of con.items) { if (it && (!it.photo || !valid[it.photo])) { const src = byName[nrm(it.item)]; it.photo = (src && src.photo) || (items[0] && items[0].photo) || '' } }
      items = con.items; questions = Array.isArray(con.questions) ? con.questions : []
    }
  }
  return NextResponse.json({ ok: true, items, questions: questions.slice(0, 3) })
}
