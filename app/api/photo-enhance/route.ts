// Photo ENHANCE + MIRROR. POST { listingId, photoIds?: string[] }
// For each listing photo: (1) MIRRORS the untouched original into Supabase Storage (our own copy,
// independent of Guesty/OTA CDNs), (2) creates an ENHANCED version (exif-rotate, gentle brightness/
// saturation/contrast lift, mild sharpen, max 2048px, quality-88 JPEG) and uploads it too.
// Generate-only: returns { photos: [{ _id, enhancedUrl, mirroredUrl }] } — nothing touches Guesty here.
// The human approves in the UI; /api/photo-order swaps the picture URLs on push.
// Mirror bookkeeping lives in guesty_listings.raw._photoMirror = { [photoId]: { orig, enhanced, at } }.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'listing-photos'
const CONCURRENCY = 4
const MAX_PER_CALL = 40 // matches the organizer's MAX_PHOTOS; UI can page if a listing has more

function str(v: any): string { return typeof v === 'string' ? v : '' }

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  // public: photo URLs must be fetchable by Guesty + OTAs
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error(`storage bucket: ${error.message}`)
}

async function processOne(sb: ReturnType<typeof supabaseAdmin>, listingId: string, pic: any, mirrorOnly = false) {
  const id = String(pic?._id || '')
  const src = str(pic?.original) || str(pic?.large) || str(pic?.thumbnail)
  if (!id || !src) return { _id: id, error: 'no source url' }

  const ir = await fetch(src, { cache: 'no-store' })
  if (!ir.ok) return { _id: id, error: `download ${ir.status}` }
  const buf = Buffer.from(await ir.arrayBuffer())
  if (buf.length < 1024) return { _id: id, error: 'source too small' }

  // 1) MIRROR the untouched original (jpeg-normalized so the copy is always web-servable)
  const origOut = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer()
  const origPath = `${listingId}/${id}/original.jpg`
  const up1 = await sb.storage.from(BUCKET).upload(origPath, origOut, { contentType: 'image/jpeg', upsert: true })
  if (up1.error) return { _id: id, error: `mirror upload: ${up1.error.message}` }
  const mirroredUrl = sb.storage.from(BUCKET).getPublicUrl(origPath).data.publicUrl
  if (mirrorOnly) return { _id: id, mirroredUrl, bytesBefore: buf.length }

  // 2) ENHANCE — deliberately gentle: real-estate honest, never fake-looking.
  const enhOut = await sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .modulate({ brightness: 1.04, saturation: 1.08 })
    .linear(1.06, -6) // mild contrast lift
    .sharpen({ sigma: 0.9 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
  const enhPath = `${listingId}/${id}/enhanced-${Date.now()}.jpg` // timestamped so CDNs never serve a stale edit
  const up2 = await sb.storage.from(BUCKET).upload(enhPath, enhOut, { contentType: 'image/jpeg', upsert: true })
  if (up2.error) return { _id: id, error: `enhanced upload: ${up2.error.message}` }
  const enhancedUrl = sb.storage.from(BUCKET).getPublicUrl(enhPath).data.publicUrl

  return { _id: id, mirroredUrl, enhancedUrl, bytesBefore: buf.length, bytesAfter: enhOut.length }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const wanted: Set<string> | null = Array.isArray(body?.photoIds) && body.photoIds.length > 0
    ? new Set(body.photoIds.filter((x: any) => typeof x === 'string')) : null
  // mirrorOnly: back up originals to Stay storage WITHOUT creating enhanced versions.
  const mirrorOnly = body?.mirrorOnly === true

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_listings').select('raw, pictures').eq('id', listingId).single()
  if (error || !row) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const all: any[] = Array.isArray(raw.pictures) ? raw.pictures
    : (Array.isArray((row as any).pictures) ? (row as any).pictures : [])
  if (all.length === 0) return NextResponse.json({ error: 'listing has no pictures' }, { status: 400 })

  const targets = all
    .filter(p => !wanted || wanted.has(String(p?._id || '')))
    .slice(0, MAX_PER_CALL)
  if (targets.length === 0) return NextResponse.json({ error: 'no matching photos' }, { status: 400 })

  try { await ensureBucket(sb) } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'storage bucket unavailable' }, { status: 500 })
  }

  // Small-batch concurrency so 40 downloads + sharp passes stay well inside maxDuration.
  const results: any[] = []
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(chunk.map(p => processOne(sb, listingId, p, mirrorOnly).catch((e: any) => ({ _id: String(p?._id || ''), error: e?.message || String(e) }))))
    results.push(...settled)
  }

  const ok = results.filter(r => (r as any).mirroredUrl)
  const failed = results.filter(r => !(r as any).mirroredUrl)

  // Best-effort mirror bookkeeping in raw (sync preserves _-prefixed keys).
  if (ok.length > 0) {
    try {
      const mirror: any = (raw._photoMirror && typeof raw._photoMirror === 'object') ? { ...raw._photoMirror } : {}
      const at = new Date().toISOString()
      for (const r of ok) mirror[r._id] = { ...(mirror[r._id] || {}), orig: r.mirroredUrl, ...(r.enhancedUrl ? { enhanced: r.enhancedUrl } : {}), at }
      await sb.from('guesty_listings').update({ raw: { ...raw, _photoMirror: mirror } }).eq('id', listingId)
    } catch { /* bookkeeping is best-effort */ }
  }

  return NextResponse.json({
    ok: true,
    count: ok.length,
    failedCount: failed.length,
    mirrorOnly,
    photos: ok.map(r => ({ _id: r._id, ...(r.enhancedUrl ? { enhancedUrl: r.enhancedUrl } : {}), mirroredUrl: r.mirroredUrl })),
    errors: failed.map(r => ({ _id: r._id, error: r.error })),
  })
}
