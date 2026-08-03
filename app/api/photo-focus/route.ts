// AI "focus" for the Hero Studio. POST { url, prompt } → { cx, cy, zoom }.
// Claude vision looks at the photo and returns where the hero crop should CENTER (cx,cy as a 0-1
// fraction of the image) and how tight to crop (zoom 1-3). It GUIDES the framing — it does not
// repaint pixels (that would need a generative image model + its own key). The component turns the
// focal point + zoom into the same crop transform a human sets by dragging/zooming.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Ask Cloudinary/Guesty for a modest rendition so the vision call stays fast and cheap.
function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_1024,q_auto/')
  return u
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI is not configured on this deployment.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const url = String(body?.url || '').trim()
  const prompt = String(body?.prompt || '').trim().slice(0, 300)
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  try {
    const ir = await fetch(smallUrl(url), { cache: 'no-store' })
    if (!ir.ok) return NextResponse.json({ error: 'Could not load that image.' }, { status: 400 })
    const buf = Buffer.from(await ir.arrayBuffer())
    if (buf.length > 4_500_000) return NextResponse.json({ error: 'Image too large to analyze.' }, { status: 400 })
    const media = (ir.headers.get('content-type') || '').includes('png') ? 'image/png' : 'image/jpeg'
    const b64 = buf.toString('base64')

    const instruction = `You are framing a short-term-rental HERO photo.${prompt ? ` The host wants to emphasize: "${prompt}".` : ''} Choose the most appealing, on-brand framing. Reply with ONLY compact JSON: {"cx":0-1,"cy":0-1,"zoom":1-3} where cx,cy is the focal point to center the crop on (as a fraction of width and height) and zoom is how tight to crop (1 = whole image, 2 = noticeably tighter on the subject, 3 = very tight). No prose.`

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 120,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data: b64 } }, { type: 'text', text: instruction }] }],
      }),
    })
    const j = await r.json()
    if (!r.ok) return NextResponse.json({ error: j?.error?.message || 'AI request failed.' }, { status: 502 })
    const text = ((j?.content || []) as any[]).map(c => c?.text || '').join(' ')
    const m = text.match(/\{[^{}]*\}/)
    const parsed = m ? JSON.parse(m[0]) : {}
    const cx = Math.max(0, Math.min(1, Number(parsed.cx)))
    const cy = Math.max(0, Math.min(1, Number(parsed.cy)))
    const zoom = Math.max(1, Math.min(3, Number(parsed.zoom) || 1.4))
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return NextResponse.json({ error: 'Could not read a focal point.' }, { status: 200 })
    return NextResponse.json({ ok: true, cx, cy, zoom })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 200 })
  }
}
