// Photo UPLOAD (one file per request, sent as multipart FormData from PhotoOrganizer).
// Mirrors the untouched original to Supabase Storage AND creates the same gently-enhanced
// version /api/photo-enhance makes, so uploaded photos behave exactly like existing ones:
// { _id (temp 'up-...' id), originalUrl, enhancedUrl }. Nothing touches Guesty here — the
// human slots the photo into the order and pushes via /api/photo-order (adds map).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'listing-photos'
const MAX_BYTES = 12 * 1024 * 1024 // hard stop well under any platform limit

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error(`storage bucket: ${error.message}`)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form-data required' }, { status: 400 }) }
  const listingId = String(form.get('listingId') || '')
  const file = form.get('file')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (12MB max)' }, { status: 413 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length < 1024) return NextResponse.json({ error: 'file too small or empty' }, { status: 400 })

  const sb = supabaseAdmin()
  try { await ensureBucket(sb) } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'storage bucket unavailable' }, { status: 500 })
  }

  const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let origOut: Buffer, enhOut: Buffer
  try {
    // MIRROR: jpeg-normalized untouched original (also validates the file is a real image)
    origOut = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer()
    // ENHANCE: identical pipeline to /api/photo-enhance so all photos get the same look
    enhOut = await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .modulate({ brightness: 1.04, saturation: 1.08 })
      .linear(1.06, -6)
      .sharpen({ sigma: 0.9 })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'could not read that file as an image (JPG/PNG/WebP work best)' }, { status: 415 })
  }

  const origPath = `${listingId}/${id}/original.jpg`
  const enhPath = `${listingId}/${id}/enhanced-${Date.now()}.jpg`
  const up1 = await sb.storage.from(BUCKET).upload(origPath, origOut, { contentType: 'image/jpeg', upsert: true })
  if (up1.error) return NextResponse.json({ error: `mirror upload: ${up1.error.message}` }, { status: 500 })
  const up2 = await sb.storage.from(BUCKET).upload(enhPath, enhOut, { contentType: 'image/jpeg', upsert: true })
  if (up2.error) return NextResponse.json({ error: `enhanced upload: ${up2.error.message}` }, { status: 500 })

  const originalUrl = sb.storage.from(BUCKET).getPublicUrl(origPath).data.publicUrl
  const enhancedUrl = sb.storage.from(BUCKET).getPublicUrl(enhPath).data.publicUrl

  // Mirror bookkeeping (same shape as photo-enhance) so uploads are tracked too.
  try {
    const { data: row } = await sb.from('guesty_listings').select('raw').eq('id', listingId).single()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : null
    if (raw) {
      const mirror: any = (raw._photoMirror && typeof raw._photoMirror === 'object') ? { ...raw._photoMirror } : {}
      mirror[id] = { orig: originalUrl, enhanced: enhancedUrl, at: new Date().toISOString(), uploaded: true }
      await sb.from('guesty_listings').update({ raw: { ...raw, _photoMirror: mirror } }).eq('id', listingId)
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, _id: id, originalUrl, enhancedUrl })
}
