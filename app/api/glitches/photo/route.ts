// Glitch photo upload → Supabase storage (public bucket glitch-photos), returns the URL.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BUCKET = 'glitch-photos'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const b64 = String(b.b64 || '')
    const filename = String(b.filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
    const contentType = String(b.contentType || 'image/jpeg')
    if (!b64) return NextResponse.json({ ok: false, error: 'No image data.' }, { status: 400 })
    if (b64.length > 8_000_000) return NextResponse.json({ ok: false, error: 'Image too large (max ~6MB).' }, { status: 400 })
    const db = supabaseAdmin()
    try { await db.storage.createBucket(BUCKET, { public: true }) } catch { /* exists */ }
    const path = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + filename
    const buf = Buffer.from(b64, 'base64')
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType, upsert: false })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ ok: true, url: pub.publicUrl })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
