// Property Audit: photo upload (share-code auth) + AI assist. Stores a resized JPEG in the
// public audit-photos bucket and asks Sonnet vision to identify the item + condition. AI only
// ASSISTS - the inspector decides what happens with the item (Jon's rule).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'audit-photos'
const MAX_BYTES = 12 * 1024 * 1024

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

async function analyze(b64: string): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 25000)
    const SYS = 'You assist a short-term-rental property inspector during unit ONBOARDING. Identify the main furniture/fixture/appliance/amenity in the photo, assess visible condition, AND capture marketing + how-to detail for listings and guidebooks. Reply with STRICT JSON only: {"item":"short name e.g. Espresso machine","itemType":"category e.g. kitchen appliance","condition":"one concise sentence on visible wear or damage","severity":"low|medium|high","brand":"visible brand or model, else empty","tier":"luxury|high_end|standard|budget|unknown","features":["notable feature"],"amenity":true,"highlight":true,"howTo":"one short sentence on how a guest operates it, else empty"}. amenity=true if guest-facing and worth listing; highlight=true only if high-end or notable enough to feature in marketing. No markdown, no extra keys.'
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 500,
        system: SYS,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: 'Identify the item and its condition.' },
        ] }],
      }),
    })
    clearTimeout(timer)
    const j = await r.json().catch(() => null)
    const txt = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart form expected' }, { status: 400 }) }
  const code = String(form.get('code') || '')
  const { data: audits } = await db.from('property_audits').select('*').eq('share_code', code).limit(1)
  const audit = audits && audits[0]
  if (!audit) return NextResponse.json({ error: 'invalid audit link' }, { status: 401 })
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'photo too large (12MB max)' }, { status: 413 })
  const buf = Buffer.from(await file.arrayBuffer())
  let jpeg: Buffer
  try {
    jpeg = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  } catch { return NextResponse.json({ error: 'could not read that file as an image' }, { status: 415 }) }
  try { await ensureBucket(db) } catch (e: any) { return NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 }) }
  const path = audit.listing_id + '/' + audit.id + '/' + Date.now() + '.jpg'
  const up = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload: ' + up.error.message }, { status: 500 })
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const ai = await analyze(jpeg.toString('base64'))
  return NextResponse.json({ ok: true, url, ai })
}
