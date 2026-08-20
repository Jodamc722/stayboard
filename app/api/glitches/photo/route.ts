// GLITCH PHOTOS — now a PRIVATE bucket with short-lived signed reads.
//
// Why this changed (2026-08-20): this route used to write into a PUBLIC bucket and store
// `getPublicUrl()` on the glitch. That is a permanent, un-revokable, no-login link to the image.
// It was already questionable for a photo of a broken water heater; it is not acceptable now that
// the team pastes SCREENSHOTS OF GUEST CONVERSATIONS onto an issue — those carry the guest's name
// and whatever they said. Same reasoning, and the same shape, as /api/claims/file.
//
//   POST           -> {b64, filename, contentType} -> { ok, path }
//   GET ?path=...  -> 302 to a 5-minute signed URL (works directly as an <img src>)
//
// BACKWARD COMPATIBILITY: glitches created before today hold full https:// URLs in `photos[]`.
// Those still render — the client only routes a value through this GET when it is NOT a URL (see
// `glitchPhotoSrc` in components/GlitchBoard.tsx). Nothing needs migrating for the board to work.
// The old public bucket can be emptied separately once the existing rows are backfilled.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'glitch-files'
const SIGNED_SECONDS = 300

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'glitches' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('glitches', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const b64 = str(b.b64)
    const glitchId = str(b.glitchId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'unfiled'
    const filename = str(b.filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
    const contentType = str(b.contentType) || 'image/jpeg'
    if (!b64) return NextResponse.json({ ok: false, error: 'No image data.' }, { status: 400 })
    if (b64.length > 8_000_000) return NextResponse.json({ ok: false, error: 'Image too large (max ~6MB).' }, { status: 400 })
    const db = supabaseAdmin()
    try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* already there */ }
    const path = glitchId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + filename
    const { error } = await db.storage.from(BUCKET).upload(path, Buffer.from(b64, 'base64'), { contentType, upsert: false })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, path })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const path = str(req.nextUrl.searchParams.get('path')).trim()
  // No traversal, no absolute paths, no reaching sideways into another bucket.
  if (!path || path.startsWith('/') || path.indexOf('..') >= 0) {
    return NextResponse.json({ ok: false, error: 'Bad path.' }, { status: 400 })
  }
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS)
    if (error || !data?.signedUrl) return NextResponse.json({ ok: false, error: (error && error.message) || 'Not found.' }, { status: 404 })
    return NextResponse.redirect(data.signedUrl)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
