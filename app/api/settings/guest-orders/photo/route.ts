// Catalog item photo upload (Jon, 2026-08-24: "the items should have a place to add photos").
// One file per request as multipart FormData → resized, jpeg-normalised, stored in the PUBLIC
// `guest-order-photos` bucket (the guest page is public, so the image must be too) → public URL.
// Admins only; the URL is saved onto the item when the catalog is saved.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'
import { renderPhoto } from '@/lib/photo-fix'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'guest-order-photos'
const MAX_BYTES = 12 * 1024 * 1024

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form-data required' }, { status: 400 }) }
  const file = form.get('file')
  const sku = String(form.get('sku') || 'item').toLowerCase().replace(/[^a-z0-9\-]/g, '-').slice(0, 40) || 'item'
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (12MB max)' }, { status: 413 })
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length < 256) return NextResponse.json({ error: 'file too small or empty' }, { status: 400 })
  const sb = supabaseAdmin()
  try { await ensureBucket(sb) } catch (e: any) { return NextResponse.json({ error: e?.message || 'storage bucket unavailable' }, { status: 500 }) }
  // TWO FILES ARE STORED. The ORIGINAL is kept untouched so every later edit re-renders from it
  // rather than stacking crops and re-compressions on top of each other; the RENDERED one is what
  // guests see, squared and levelled on the way in so nobody has to remember to tidy it.
  let orig: Buffer, out: Buffer
  try {
    orig = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
  } catch { return NextResponse.json({ error: 'that file is not an image we can read' }, { status: 400 }) }
  // If the smart pass fails for any reason the upload still succeeds with a plain square — a photo
  // that is slightly worse beats an upload that mysteriously did not happen.
  try { out = await renderPhoto(orig) } catch {
    out = await sharp(orig).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer()
  }
  const stamp = Date.now().toString(36)
  const path = sku + '/' + stamp + '.jpg'
  const origPath = sku + '/' + stamp + '-original.jpg'
  const up = await sb.storage.from(BUCKET).upload(path, out, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload failed: ' + up.error.message }, { status: 500 })
  await sb.storage.from(BUCKET).upload(origPath, orig, { contentType: 'image/jpeg', upsert: true })
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const originalUrl = sb.storage.from(BUCKET).getPublicUrl(origPath).data.publicUrl
  return NextResponse.json({ ok: true, url, originalUrl })
}
