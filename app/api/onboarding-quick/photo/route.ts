// A PHOTO ON A QUICK-ONBOARDING UNIT: multipart { id, file, caption? } → resized JPEG in the
// audit-photos bucket, the URL appended to the unit's data.photos. Same bucket and sizing as the
// room inventory (app/api/onboard/photo). DELETE { id, url } removes one from the list.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import sharp from 'sharp'
import { normData } from '@/lib/onboarding-quick'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BUCKET = 'audit-photos'
const MAX_BYTES = 15 * 1024 * 1024
async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('onboarding', 'edit')
  if (!g.ok) return g.res
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form expected' }, { status: 400 }) }
  const id = String(form.get('id') || '')
  const caption = String(form.get('caption') || '').slice(0, 120)
  const file = form.get('file') as File | null
  if (!id || !file) return NextResponse.json({ error: 'id and file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'photo too large (15MB max)' }, { status: 413 })
  const db = supabaseAdmin()
  const { data: unit } = await db.from('onboarding_quick').select('id,data').eq('id', id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'unit not found' }, { status: 404 })
  let jpeg: Buffer
  try { jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer() }
  catch { return NextResponse.json({ error: 'could not read that file as an image' }, { status: 415 }) }
  try { await ensureBucket(db) } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }
  const path = 'quick/' + id + '/' + Date.now() + '.jpg'
  const up = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload: ' + up.error.message }, { status: 500 })
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const data = normData(unit.data)
  data.photos.push({ url, at: new Date().toISOString(), caption: caption || null })
  await db.from('onboarding_quick').update({ data, updated_at: new Date().toISOString(), updated_by: String(g.access.email || '') }).eq('id', id)
  return NextResponse.json({ ok: true, url, photos: data.photos })
}
export async function DELETE(req: NextRequest) {
  const g = await requireLevel('onboarding', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const id = String(b.id || ''), url = String(b.url || '')
  const db = supabaseAdmin()
  const { data: unit } = await db.from('onboarding_quick').select('id,data').eq('id', id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'unit not found' }, { status: 404 })
  const data = normData(unit.data)
  data.photos = data.photos.filter(p => p.url !== url)
  await db.from('onboarding_quick').update({ data, updated_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true, photos: data.photos })
}
