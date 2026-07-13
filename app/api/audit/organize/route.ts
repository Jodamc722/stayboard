import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function toB64(url: string): Promise<{ data: string; media: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) return null
    const ct = r.headers.get('content-type') || 'image/jpeg'
    return { data: buf.toString('base64'), media: /png/i.test(ct) ? 'image/png' : 'image/jpeg' }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const { data: audits } = await db.from('property_audits').select('id, share_code').eq('share_code', code).limit(1)
  const audit = audits && audits[0]
  if (!audit) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const room = String(body.room || 'Room').slice(0, 80)
  const urls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 8) : []
  if (urls.length === 0) return NextResponse.json({ error: 'photoUrls required' }, { status: 400 })
  const answers = String(body.answers || '').slice(0, 3000)
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, items: [], questions: [] })

  const imgs: any[] = []
  for (const u of urls) { const b = await toB64(u); if (b) imgs.push({ type: 'image', source: { type: 'base64', media_type: b.media, data: b.data } }) }
  if (imgs.length === 0) return NextResponse.json({ ok: true, items: [], questions: [] })

  const SYS = 'You are itemizing ONE room ("' + room + '") of a short-term-rental unit during onboarding, from several photos of that room. Build a ROBUST, COMPLETE inventory: list EVERY individual item you can see - each nightstand, the bed (with size if inferable: King/Queen/Full/Twin), lamps, seating, dressers, desk, TV (with size if visible), rugs, decor, curtains, mirrors, electronics, and any kitchen/bath fixtures or appliances in view. Be granular and thorough - do not lump items together. For appliances/devices also capture how a guest operates it. ALSO produce clarifying QUESTIONS a human inspector should answer to COMPLETE the inventory (e.g. "Does this bedroom have an ensuite bathroom?", "Is the sofa a sleeper?", "What is the exact bed size?", "Is that a smart TV or cable box?"). Reply STRICT JSON ONLY, no markdown: {"items":[{"item":"short name","itemType":"category","size":"if applicable else empty","brand":"if visible else empty","tier":"luxury|high_end|standard|budget|unknown","condition":"one sentence on visible wear or damage","severity":"low|medium|high","amenity":true,"highlight":true,"howTo":"how a guest uses it, else empty"}],"questions":["..."]}'
  const userText = 'Room: ' + room + '. Itemize everything visible across these photos, granularly.' + (answers ? ' The inspector already answered these - use them and do NOT re-ask: ' + answers : '')

  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 55000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: SYS, messages: [{ role: 'user', content: [...imgs, { type: 'text', text: userText }] }] }),
    })
    clearTimeout(timer)
    const j = await r.json().catch(() => null)
    const txt = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: true, items: [], questions: [] })
    const parsed = JSON.parse(m[0])
    return NextResponse.json({ ok: true, items: Array.isArray(parsed.items) ? parsed.items : [], questions: Array.isArray(parsed.questions) ? parsed.questions : [] })
  } catch { return NextResponse.json({ ok: true, items: [], questions: [] }) }
}
