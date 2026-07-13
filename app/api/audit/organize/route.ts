import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function toB64(url: string): Promise<{ data: string; media: string } | null> {
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000)
    const r = await fetch(url, { signal: ac.signal }); clearTimeout(t)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) return null
    const ct = r.headers.get('content-type') || 'image/jpeg'
    return { data: buf.toString('base64'), media: /png/i.test(ct) ? 'image/png' : 'image/jpeg' }
  } catch { return null }
}

async function visionOne(key: string, img: any, room: string, answers: string): Promise<{ items: any[]; questions: string[] } | null> {
  const SYS = 'Itemize EVERYTHING visible in this ONE photo of the "' + room + '" of a short-term-rental unit. List each individual item granularly - the bed (with size: King/Queen/Full/Twin), EACH nightstand, each lamp, seating, dresser, desk, TV (with size), rugs, decor, mirrors, curtains, electronics, and any fixtures/appliances in view. Do not lump items together. For appliances/devices include how a guest operates it. Also list any clarifying QUESTIONS to complete the inventory (e.g. exact bed size, does this room have an ensuite bathroom, is the sofa a sleeper, smart TV vs cable box). STRICT JSON ONLY, no markdown: {"items":[{"item":"short name","itemType":"category","size":"if applicable else empty","brand":"if visible else empty","tier":"luxury|high_end|standard|budget|unknown","condition":"one sentence on visible wear","severity":"low|medium|high","amenity":true,"highlight":true,"howTo":"how a guest uses it, else empty"}],"questions":["..."]}'
  const userText = 'Itemize this photo granularly.' + (answers ? ' Inspector already answered (use, do not re-ask): ' + answers : '')
  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 40000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: SYS, messages: [{ role: 'user', content: [img, { type: 'text', text: userText }] }] }),
    })
    clearTimeout(timer)
    const j = await r.json().catch(() => null)
    const txt = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return { items: [], questions: [] }
    const parsed = JSON.parse(m[0])
    return { items: Array.isArray(parsed.items) ? parsed.items : [], questions: Array.isArray(parsed.questions) ? parsed.questions : [] }
  } catch { return { items: [], questions: [] } }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const { data: audits } = await db.from('property_audits').select('id').eq('share_code', code).limit(1)
  if (!(audits && audits[0])) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const room = String(body.room || 'Room').slice(0, 80)
  const urls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 6) : []
  if (urls.length === 0) return NextResponse.json({ error: 'photoUrls required' }, { status: 400 })
  const answers = String(body.answers || '').slice(0, 3000)
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, items: [], questions: [], note: 'no ai key' })

  const withB = (await Promise.all(urls.map(async (u) => { const b = await toB64(u); return b ? { u, img: { type: 'image', source: { type: 'base64', media_type: b.media, data: b.data } } } : null }))).filter(Boolean) as { u: string; img: any }[]
  if (withB.length === 0) return NextResponse.json({ ok: true, items: [], questions: [], note: 'no images fetched' })

  const results = await Promise.all(withB.map(async (x) => ({ url: x.u, r: await visionOne(key, x.img, room, answers) })))
  const items: any[] = []; const seen = new Set<string>()
  const questions: string[] = []; const qseen = new Set<string>()
  for (const { url, r } of results) {
    if (!r) continue
    for (const it of (r.items || [])) { const k = String(it && it.item || '').toLowerCase().trim(); if (k && !seen.has(k)) { seen.add(k); if (it && typeof it === 'object') it.photo = url; items.push(it) } }
    for (const q of (r.questions || [])) { const k = String(q || '').toLowerCase().trim(); if (k && !qseen.has(k)) { qseen.add(k); questions.push(q) } }
  }
  return NextResponse.json({ ok: true, items, questions: questions.slice(0, 8) })
}
