// BOARD PHOTOS — a picture on a leadership-board row. Resized to JPEG before storage (phone photos
// are 4-8MB; the board shows them at a few hundred pixels). Public bucket, same as project photos.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BUCKET = 'board-photos'
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const gate = await requireLevel('leadership', 'edit')
  if (!gate.ok) return gate.res
  const me = gate.access.user.email.toLowerCase()
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const itemId = String(form.get('itemId') || '').trim()
    const caption = String(form.get('caption') || '').trim().slice(0, 300)
    if (!file) return NextResponse.json({ ok: false, error: 'No file.' }, { status: 400 })
    if (!itemId) return NextResponse.json({ ok: false, error: 'itemId required' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That image is too large (max 15MB).' }, { status: 400 })
    const sb = supabaseAdmin()
    const { data: bucket } = await sb.storage.getBucket(BUCKET)
    if (!bucket) { const { error } = await sb.storage.createBucket(BUCKET, { public: true }); if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message) }
    const jpeg = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    const key = `${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(key, jpeg, { contentType: 'image/jpeg', upsert: false })
    if (upErr) return NextResponse.json({ ok: false, error: 'upload failed: ' + upErr.message }, { status: 500 })
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key)
    const { data, error } = await sb.from('board_photos').insert({ item_id: itemId, url: pub.publicUrl, caption: caption || null, uploaded_by: me }).select('*').single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, photo: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
