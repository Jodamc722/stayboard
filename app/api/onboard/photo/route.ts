// ONBOARDING PHOTO UPLOAD — a room photo (kind=room) or an item photo (kind=item).
//
// Same pipeline every other field photo in the app uses: sharp rotate + resize, the public
// `audit-photos` bucket, a public URL back. The onboarding code is the key. Room photos are
// appended to onboarding_rooms.photos; item photos land on onboarding_items.photo_url.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'audit-photos'
const MAX_BYTES = 15 * 1024 * 1024
const CODE_RE = /^[a-f0-9]{8,32}$/i

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form expected' }, { status: 400 }) }
  const code = String(form.get('code') || '').toLowerCase()
  const roomId = String(form.get('roomId') || '')
  const itemId = String(form.get('itemId') || '')
  const caption = String(form.get('caption') || '').slice(0, 200)
  if (!CODE_RE.test(code) || !roomId) return NextResponse.json({ error: 'code and roomId required' }, { status: 400 })

  const { data: unit } = await db.from('onboarding_units').select('id,status').eq('code', code).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'link not found' }, { status: 404 })
  if (unit.status === 'archived') return NextResponse.json({ error: 'This link has been closed.' }, { status: 410 })
  const { data: room } = await db.from('onboarding_rooms').select('id,key,photos').eq('id', roomId).eq('unit_id', unit.id).maybeSingle()
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 })

  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'photo too large (15MB max)' }, { status: 413 })

  let jpeg: Buffer
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' })
      .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  } catch { return NextResponse.json({ error: 'could not read that file as an image' }, { status: 415 }) }

  try { await ensureBucket(db) } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }
  const path = 'onboard/' + code + '/' + room.key + (itemId ? '-item-' + itemId.slice(0, 8) : '') + '-' + Date.now() + '.jpg'
  const up = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload: ' + up.error.message }, { status: 500 })
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const now = new Date().toISOString()

  if (itemId) {
    await db.from('onboarding_items').update({ photo_url: url, updated_at: now }).eq('id', itemId).eq('unit_id', unit.id)
  } else {
    const photos = Array.isArray(room.photos) ? room.photos : []
    photos.push({ url, at: now, caption: caption || null })
    await db.from('onboarding_rooms').update({ photos, updated_at: now }).eq('id', room.id)
  }
  await db.from('onboarding_units').update({ updated_at: now, ...(unit.status === 'draft' ? { status: 'in_progress' } : {}) }).eq('id', unit.id)
  return NextResponse.json({ ok: true, url })
}
