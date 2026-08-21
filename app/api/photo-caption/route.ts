// Regenerate ONE photo's guest-facing description with AI vision. POST { listingId, photoId }.
// Returns { ok, caption } - the UI decides where to put it; nothing is written to Guesty here.
//
// 2026-08-21: the caption spec used to be written out separately here AND in /api/optimize-photos,
// in different words, free to drift apart. Both now read the single editable spec from
// app_settings 'listing_ai' (/users -> App settings -> Listing & photo AI), and the result is
// stored onto raw._photoIndex so the copywriter sees the same description the guest will.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadListingAiWithPreview } from '@/lib/listing-ai-server'

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
  // 2026-08-21: these routes write to LIVE OTA listings (photo-order PUTs the picture array to
  // Guesty and honours a remove[] that permanently drops photos) yet only checked "is signed in",
  // while the copy route next door required optimize/edit. Same gate on both now.
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = str(body?.listingId)
  const photoId = str(body?.photoId)
  // Optional free-text steer for one caption ("call out the balcony, not the bed").
  const instruction = str(body?.instruction).trim().slice(0, 300)
  if (!listingId || !photoId) return NextResponse.json({ error: 'listingId and photoId required' }, { status: 400 })

  const cfg = await loadListingAiWithPreview(body?.promptPreview)

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

  // What the analyst already worked out about this photo, so a single-caption rerun keeps the same
  // room identity instead of re-guessing it from one image with no context.
  const known = (raw._photoIndex && typeof raw._photoIndex === 'object') ? raw._photoIndex[photoId] : null

  const SYS = `You caption short-term-rental listing photos for Stay Hospitality. Reply with ONLY the caption text — no quotes, no prose, no explanation.

${cfg.photos.captionPrompt}

Maximum ${cfg.photos.captionMaxWords} words and ${cfg.photos.captionMaxChars} characters.`

  try {
    const ir = await fetch(smallUrl(url))
    if (!ir.ok) return NextResponse.json({ error: 'could not load the photo' }, { status: 502 })
    const ct = (ir.headers.get('content-type') || '').toLowerCase()
    const media = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
    const ctx = [
      'Property: ' + (str((listing as any).title) || 'listing') + ' (' + (str((listing as any).building) || 'building') + ').',
      known?.room ? `This photo shows: ${known.room}.` : '',
      instruction ? `The host wants this emphasised: "${instruction}".` : '',
      'Caption this photo:',
    ].filter(Boolean).join(' ')
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 200,
        system: SYS,
        messages: [{ role: 'user', content: [{ type: 'text', text: ctx }, { type: 'image', source: { type: 'base64', media_type: media, data: b64 } }] }],
      }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: 'AI ' + r.status + ': ' + str(j?.error?.message).slice(0, 140) }, { status: 502 })
    const text = Array.isArray(j?.content) ? j.content.map((x: any) => str(x?.text)).join('').trim() : ''
    const caption = text.split('\n')[0].replace(/["']/g, '').slice(0, cfg.photos.captionMaxChars).trim()
    if (!caption) return NextResponse.json({ error: 'AI returned no caption' }, { status: 502 })

    // Keep the index in step, so the copywriter reads the caption the host just accepted.
    try {
      const index = (raw._photoIndex && typeof raw._photoIndex === 'object') ? { ...raw._photoIndex } : {}
      index[photoId] = { ...(index[photoId] || {}), caption, at: new Date().toISOString() }
      await sb.from('guesty_listings').update({ raw: { ...raw, _photoIndex: index } }).eq('id', listingId)
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, caption })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
