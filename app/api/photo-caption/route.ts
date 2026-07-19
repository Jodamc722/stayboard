// Regenerate ONE photo's guest-facing description with AI vision. POST { listingId, photoId }.
// Returns { ok, caption } - the UI decides where to put it; nothing is written to Guesty here.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : '' }
function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) {
    return u.replace('/image/upload/', '/image/upload/w_300,h_300,c_limit,q_auto,f_jpg/')
  }
  return u
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = str(body?.listingId)
  const photoId = str(body?.photoId)
  if (!listingId || !photoId) return NextResponse.json({ error: 'listingId and photoId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: listing, error } = await sb.from('guesty_listings').select('id, title, building, pictures, raw').eq('id', listingId).single()
  if (error || !listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw: any = (listing as any).raw || {}
  const arr0: any[] = Array.isArray(raw?.pictures) ? raw.pictures : (Array.isArray((listing as any).pictures) ? (listing as any).pictures : [])
  const arr = arr0.map((p: any) => { if (typeof p === 'string') { try { return JSON.parse(p) } catch { return null } } return p }).filter(Boolean)
  const idx = arr.findIndex((p: any, i: number) => (str(p?._id) || ('idx-' + i)) === photoId)
  const pic = idx >= 0 ? arr[idx] : null
  const url = pic ? (str(pic.thumbnail) || str(pic.original)) : ''
  if (!url) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

  try {
    const ir = await fetch(smallUrl(url))
    if (!ir.ok) return NextResponse.json({ error: 'could not load the photo' }, { status: 502 })
    const ct = (ir.headers.get('content-type') || '').toLowerCase()
    const media = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 100,
        system: 'You caption short-term-rental listing photos. Reply with ONLY the caption text: a specific, guest-facing description of what the photo shows, 8 words or fewer, no quotes, no unit/room/listing numbers, no marketing fluff.',
        messages: [{ role: 'user', content: [ { type: 'text', text: 'Property: ' + (str((listing as any).title) || 'listing') + ' (' + (str((listing as any).building) || 'building') + '). Caption this photo:' }, { type: 'image', source: { type: 'base64', media_type: media, data: b64 } } ] }],
      }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: 'AI ' + r.status + ': ' + str(j?.error?.message).slice(0, 140) }, { status: 502 })
    const text = Array.isArray(j?.content) ? j.content.map((x: any) => str(x?.text)).join('').trim() : ''
    const caption = text.split('\n')[0].replace(/["']/g, '').slice(0, 90).trim()
    if (!caption) return NextResponse.json({ error: 'AI returned no caption' }, { status: 502 })
    return NextResponse.json({ ok: true, caption })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
