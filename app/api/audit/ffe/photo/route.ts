// FF&E photo upload (Jon, 2026-08-11: "if replacing to add a photo").
//
// A line that says "replace the sofa" starts an argument with whoever is paying for it; a photo of
// the sofa ends it. Same storage pipeline the property-audit photos already use — resize with
// sharp, drop it in the public audit-photos bucket — so there is one bucket to manage, not two.
//
// Auth is the FF&E share code, exactly like every other call on this feature: the link is the key
// and it resolves to one unit. No AI here on purpose — this photo is evidence of a specific piece,
// not something to be interpreted.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveCode } from '@/lib/ffe-links'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'audit-photos'
const MAX_BYTES = 12 * 1024 * 1024
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

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

  const code = String(form.get('code') || '')
  const room = String(form.get('room') || '').slice(0, 40)
  const itemKey = String(form.get('itemKey') || '').slice(0, 40)
  if (!room || !itemKey) return NextResponse.json({ error: 'room and itemKey required' }, { status: 400 })

  const { data: ls } = await db.from('guesty_listings').select('id,status').limit(2000)
  const ids = ((ls || []) as any[])
    .filter(l => !DEAD.includes(String(l.status || '').toLowerCase()))
    .map(l => String(l.id))
  const scope = resolveCode(code, { units: ids, buildings: [], owners: [] })
  if (!scope) return NextResponse.json({ error: 'link not found' }, { status: 404 })

  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'photo too large (12MB max)' }, { status: 413 })

  let jpeg: Buffer
  try {
    // rotate() honours the EXIF orientation phones set — without it half the photos arrive sideways.
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' })
      .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  } catch { return NextResponse.json({ error: 'could not read that file as an image' }, { status: 415 }) }

  try { await ensureBucket(db) } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }
  const path = 'ffe/' + scope.id + '/' + room + '-' + itemKey + '-' + Date.now() + '.jpg'
  const up = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload: ' + up.error.message }, { status: 500 })
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  // Attach it to the answer row if one exists; the walker always answers before photographing.
  try {
    const { data: ex } = await db.from('ffe_answers')
      .select('id').eq('listing_id', scope.id).eq('room', room).eq('item_key', itemKey).limit(1)
    if (ex && ex[0]) await db.from('ffe_answers').update({ photo_url: url, updated_at: new Date().toISOString() }).eq('id', ex[0].id)
  } catch { /* the URL is still returned; the client re-saves with it */ }

  return NextResponse.json({ ok: true, url })
}
