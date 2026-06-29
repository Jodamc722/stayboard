// Push a generated hero/collage image to a listing's Guesty photos.
// POST { listingId, dataUrl, caption?, cover? }
// Hosts the image in Supabase Storage (public bucket), then PUTs the listing's pictures array with the
// new image appended (or inserted at index 0 if cover=true). MASTER content -> syncs to all channels.
// Logged-in users only; the human approves the push in the UI.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const BUCKET = 'hero-images'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  const dataUrl: string = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const caption: string = typeof body?.caption === 'string' ? body.caption.slice(0, 120) : 'Featured'
  const cover = body?.cover === true
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const m = dataUrl.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return NextResponse.json({ error: 'dataUrl must be a base64 image (jpeg/png)' }, { status: 400 })
  const ext = m[1] === 'png' ? 'png' : 'jpg'
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 1000) return NextResponse.json({ error: 'image too small / empty' }, { status: 400 })
  if (bytes.length > 15_000_000) return NextResponse.json({ error: 'image too large (>15MB)' }, { status: 400 })

  const sb = supabaseAdmin()

  // Ensure a public bucket exists (idempotent).
  try { await sb.storage.createBucket(BUCKET, { public: true }) } catch { /* exists */ }

  const path = `${listingId}/${Date.now()}.${ext}`
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: `image/${ext === 'jpg' ? 'jpeg' : 'png'}`, upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 502 })
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = pub?.publicUrl
  if (!publicUrl) return NextResponse.json({ error: 'could not get public URL' }, { status: 502 })

  // Load the listing's current pictures.
  const { data: row, error } = await sb.from('guesty_listings').select('raw, pictures').eq('id', listingId).single()
  if (error || !row) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const current: any[] = Array.isArray(raw.pictures) ? raw.pictures
    : (Array.isArray((row as any).pictures) ? (row as any).pictures : [])

  // Guesty imports a new photo when only `original` is supplied. Keep captions short.
  const newPic: any = { original: publicUrl, caption }
  const pictures = cover ? [newPic, ...current] : [...current, newPic]

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  const r = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pictures }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}`, hostedUrl: publicUrl }, { status: 502 })

  // Mirror locally so StayBoard reflects it immediately.
  try {
    const newRaw = { ...raw, pictures, _lastOptimized: new Date().toISOString() }
    const update: any = { raw: newRaw, last_optimized: new Date().toISOString() }
    if (Array.isArray((row as any).pictures)) update.pictures = pictures
    await sb.from('guesty_listings').update(update).eq('id', listingId)
  } catch { /* mirror is best-effort */ }

  return NextResponse.json({ ok: true, hostedUrl: publicUrl, count: pictures.length, cover })
}
