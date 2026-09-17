// UPLOAD A PHOTO FOR A DECK — a headshot, a portal screenshot, anything any slide needs.
//
// Jon, 2026-09-17: "also be able to add photo to team section", then "have upload path for all
// images." The picker could already take a pasted URL or one of the owner's own listing photos,
// and neither is any use for a headshot: Roberto's face is not in the Guesty picture array, and
// asking a general manager to first host an image somewhere and paste a link is not a feature.
//
// Every photo slot in the deck goes through the one picker, so wiring upload in there covers the
// cover, the team cards, the portal screenshots, the listing slides and any slide added by hand.
//
// /api/photo-upload next door already does the storage work, but it is bound to a listing — it
// requires a listingId and writes the result into that listing's photo mirror, which is exactly
// wrong for a picture that belongs to a document rather than to a unit, and its gate is the
// optimize/edit level because it feeds a picture array that gets PUT to the OTAs. So this is its
// own route, its own bucket, and no Guesty coupling of any kind.
//
// Images are normalised on the way in: EXIF rotation applied, capped at 1200px on the long edge
// and re-encoded as JPEG. A phone photo of a colleague is 4MB of portrait data that would sit in
// an owner's deck forever; what comes out the other side is 100-200KB and renders the same on a
// slide that shows it 132px tall.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'deck-photos'
const MAX_BYTES = 12 * 1024 * 1024
const EDGE = 1200

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

export async function POST(req: NextRequest) {
  // Signed in is the gate. This writes to our own storage and touches nothing live.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form-data required' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is over 12MB — try a smaller one.' }, { status: 413 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length < 512) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })

  let out: Buffer
  try {
    out = await sharp(buf).rotate().resize(EDGE, EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true }).toBuffer()
  } catch {
    return NextResponse.json({ error: 'That does not look like an image we can read.' }, { status: 400 })
  }

  const sb = supabaseAdmin()
  try { await ensureBucket(sb) } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'storage bucket unavailable' }, { status: 500 })
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const path = 'deck/' + id + '.jpg'
  const up = await sb.storage.from(BUCKET).upload(path, out, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload: ' + up.error.message }, { status: 500 })

  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ ok: true, url, bytes: out.length })
}
