import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

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
  const { data: audits } = await db.from('property_audits').select('id').eq('share_code', code).limit(1)
  if (!(audits && audits[0])) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const urls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 4) : []
  const hint = String(body.hint || '').slice(0, 500)
  if (urls.length === 0) return NextResponse.json({ error: 'photoUrls required' }, { status: 400 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: true, ai: null })

  const imgs: any[] = []
  for (const u of urls) { const b = await toB64(u); if (b) imgs.push({ type: 'image', source: { type: 'base64', media_type: b.media, data: b.data } }) }
  if (imgs.length === 0) return NextResponse.json({ ok: true, ai: null })

  const SYS = 'You assist a short-term-rental inspector. Re-identify the item in the photo(s), and TREAT THE INSPECTOR CORRECTION AS GROUND TRUTH - if they say it is a specific brand/model/device, use that and rewrite the how-to for THAT device. Reply STRICT JSON ONLY, no markdown: {"item":"short name","itemType":"category","condition":"one sentence on visible wear or damage","severity":"low|medium|high","brand":"brand or model","tier":"luxury|high_end|standard|budget|unknown","features":["notable feature"],"amenity":true,"highlight":true,"howTo":"one clear how a guest operates it, else empty"}'
  const userText = 'Inspector correction (authoritative, use this): ' + (hint || '(no correction given - just re-analyze carefully)') + '. Re-identify the item and rewrite the how-to for it.'

  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 40000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, system: SYS, messages: [{ role: 'user', content: [...imgs, { type: 'text', text: userText }] }] }),
    })
    clearTimeout(timer)
    const j = await r.json().catch(() => null)
    const txt = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: true, ai: null })
    const parsed = JSON.parse(m[0])
    return NextResponse.json({ ok: true, ai: parsed && typeof parsed === 'object' ? parsed : null })
  } catch { return NextResponse.json({ ok: true, ai: null }) }
}
