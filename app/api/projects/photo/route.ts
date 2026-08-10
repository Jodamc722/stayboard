// PROJECT PHOTOS — before / during / after.
//
// Two ways in, one code path: a signed-in teammate (requireLevel), or a vendor holding a share
// token. The vendor path is why this is its own route rather than an action on [id] — it must be
// reachable WITHOUT a session, so the token is the only credential and it is checked first.
//
// Images are resized and re-encoded to JPEG before storage: phone photos are 4-8MB, the board
// shows them at a few hundred pixels, and nobody should wait on that.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { getProjectByToken, addNote, PHOTO_PHASES } from '@/lib/projects'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'project-photos'
const MAX_BYTES = 15 * 1024 * 1024

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const token = String(form.get('token') || '').trim()
    const phase = String(form.get('phase') || 'during')
    const caption = String(form.get('caption') || '').trim().slice(0, 300)
    let projectId = String(form.get('projectId') || '').trim()
    if (!file) return NextResponse.json({ error: 'No file.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large (max 15MB).' }, { status: 400 })

    // WHO IS THIS? Token first — a vendor has no session and must still be able to post.
    let uploader = 'vendor', viaShare = false
    if (token) {
      const p = await getProjectByToken(token)
      if (!p) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
      projectId = p.id
      uploader = p.vendor_name || 'vendor'
      viaShare = true
    } else {
      const access = await getAccess()
      if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      if (!atLeast(access.levels['projects'], 'edit')) return NextResponse.json({ error: 'no-access' }, { status: 403 })
      if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
      uploader = access.email || 'someone'
    }

    const sb = supabaseAdmin()
    await ensureBucket(sb)
    const raw = Buffer.from(await file.arrayBuffer())
    // rotate() honours the EXIF orientation phones set — without it half the photos arrive sideways.
    const jpeg = await sharp(raw).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer()

    const key = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(key, jpeg, { contentType: 'image/jpeg', upsert: false })
    if (upErr) return NextResponse.json({ error: 'upload failed: ' + upErr.message }, { status: 500 })
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key)

    const { data, error } = await sb.from('project_photos').insert({
      project_id: projectId, url: pub.publicUrl, caption: caption || null,
      phase: (PHOTO_PHASES as readonly string[]).includes(phase) ? phase : 'during',
      uploaded_by: uploader, via_share: viaShare,
    }).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await addNote(projectId, `Photo added${caption ? ' — ' + caption : ''} (${phase}) by ${uploader}.`, uploader, 'event', viaShare)
    return NextResponse.json({ ok: true, photo: data })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
