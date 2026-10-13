// NEW UNIT INTAKE — PHOTO UPLOAD (Jon, 2026-10-13: "when add phtoos andress etc").
//
// Same pipeline every other field photo in the app uses: sharp rotate + resize, the public
// `audit-photos` bucket, a public URL back. Public matters here beyond convenience — Guesty's
// photo endpoint takes URLs and fetches them itself ("ensure the repositories are accessible to
// Guesty"), so a signed URL that expires would upload fine today and break on the push.
//
// Photos live on the intake row (data.photos) until the listing exists, because there is nothing
// to attach them to before that. The push sends them in one call per listing.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import sharp from 'sharp'

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
  const g = await requireLevel('buildings', 'edit')
  if (!g.ok) return g.res

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form expected' }, { status: 400 }) }
  const id = String(form.get('id') || '')
  const caption = String(form.get('caption') || '').slice(0, 200)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: row } = await db.from('unit_intake').select('id,data').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'No such unit.' }, { status: 404 })

  const files = form.getAll('file').filter((f): f is File => f instanceof File)
  if (!files.length) return NextResponse.json({ error: 'file required' }, { status: 400 })

  try { await ensureBucket(db) } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }

  const data: any = (row.data && typeof row.data === 'object') ? row.data : {}
  const photos: any[] = Array.isArray(data.photos) ? [...data.photos] : []
  const added: string[] = []
  const failed: string[] = []

  for (const file of files) {
    if (file.size > MAX_BYTES) { failed.push(`${file.name}: over 15MB`); continue }
    let jpeg: Buffer
    try {
      jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' })
        .rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true }).toBuffer()
    } catch { failed.push(`${file.name}: not readable as an image`); continue }
    const path = `unit-intake/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const up = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
    if (up.error) { failed.push(`${file.name}: ${up.error.message}`); continue }
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    photos.push({ url, caption: caption || null, at: new Date().toISOString() })
    added.push(url)
  }

  if (added.length) {
    await db.from('unit_intake').update({ data: { ...data, photos }, updated_at: new Date().toISOString() }).eq('id', id)
  }
  return NextResponse.json({ ok: added.length > 0, added: added.length, failed, photos })
}
