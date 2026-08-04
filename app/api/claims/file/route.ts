// CLAIM ATTACHMENTS — damage photos, receipts, quotes, police reports.
//
// The bucket is PRIVATE and nothing is ever served from it directly. A receipt can carry the last
// four of a card and a claim file carries a guest's name next to an accusation of theft; a public
// bucket URL is a guessable, permanent, un-revokable link to that. So bytes go in under a random
// path, and reading one goes back through this route, which checks the session first and then
// hands out a link that dies in five minutes.
//   POST            -> upload {b64, filename, contentType} -> { path }
//   GET ?path=...   -> redirect to a short-lived signed URL (works as an <img src>)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'claim-files'
const SIGNED_SECONDS = 300

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'claims' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('claims', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const b64 = str(b.b64)
    const claimId = str(b.claimId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'unfiled'
    const filename = str(b.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
    const contentType = str(b.contentType) || 'application/octet-stream'
    if (!b64) return NextResponse.json({ ok: false, error: 'No file data.' }, { status: 400 })
    // ~10MB of base64 is ~7.5MB of file. Phone photos land around 3-5MB.
    if (b64.length > 14_000_000) return NextResponse.json({ ok: false, error: 'File too large (max ~10MB). Take a smaller photo or compress the PDF.' }, { status: 400 })
    const db = supabaseAdmin()
    try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* already there */ }
    const path = claimId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + filename
    const { error } = await db.storage.from(BUCKET).upload(path, Buffer.from(b64, 'base64'), { contentType, upsert: false })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, path, name: filename, contentType })
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
