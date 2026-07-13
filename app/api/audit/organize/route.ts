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
  const SYS = 'You are taking a room INVENTORY from this ONE photo of the `' + room + '` of a short-term-rental unit. If this photo is a CLOSE-UP focused on ONE item, return ONLY that item (it is being shown for reference, do not guess the rest of the room). Otherwise list each MEANINGFUL, distinct KIND of item ONCE, WITH A COUNT: the bed, nightstands, lamps, seating, dressers, desk, TV, rugs, mirrors, curtains, electronics, appliances, and NOTABLE decor. If there are two matching nightstands, return ONE entry with count:2 - NEVER list the same kind twice. Skip trivial or barely-visible clutter (stray remotes, tiny hidden objects, generic trinkets). For the BED, always fill size (King/Queen/Full/Twin/Bunk); if you cannot tell, leave size empty and ADD a question asking the exact bed size. Write a howTo ONLY for TECHNOLOGY or things a guest could find confusing (thermostat, smart TV, remotes, sound system, coffee maker, safe, washer/dryer, smart lock, blinds, fireplace); leave howTo empty for obvious items. Also list clarifying QUESTIONS to complete the inventory (e.g. exact bed size, does this room have an ensuite bathroom, is the sofa a sleeper). STRICT JSON ONLY, no markdown: {"items":[{"item":"short name","itemType":"category","count":1,"size":"if applicable else empty","brand":"if visible else empty","tier":"luxury|high_end|standard|budget|unknown","condition":"one sentence on visible wear","severity":"low|medium|high","amenity":true,"highlight":true,"howTo":"tech/confusing items only, else empty"}],"questions":["..."]}'
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
  const items: any[] = []; const seen = new Map<string, any>()
  const questions: string[] = []; const qseen = new Set<string>()
  for (const { url, r } of results) {
    if (!r) continue
    for (const it of (r.items || [])) { if (!it || typeof it !== 'object') continue; const k = String(it.item || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(small|medium|large|left|right|partially|visible|approx|approximately)\b/g, ' ').replace(/\s+/g, ' ').trim(); if (!k || k.length <= 2) continue; const c = Math.max(1, parseInt(it.count, 10) || 1); const prev = seen.get(k); if (prev) { if (c > (prev.count || 1)) prev.count = c; if (!prev.howTo && it.howTo) prev.howTo = it.howTo; if (!prev.size && it.size) prev.size = it.size } else { it.count = c; it.photo = url; seen.set(k, it); items.push(it) } }
    for (const q of (r.questions || [])) { const k = String(q || '').toLowerCase().trim(); if (k && !qseen.has(k)) { qseen.add(k); questions.push(q) } }
  }
  return NextResponse.json({ ok: true, items, questions: questions.slice(0, 8) })
}
