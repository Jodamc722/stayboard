// Guidebook asset uploads — high-quality photos + context docs (PDF) for the builder.
// Stores in the public `guidebook-assets` bucket (auto-created) and returns the public URL.
// Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'guidebook-assets'
const OK_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('guidebooks', 'edit')
  if (!gate.ok) return gate.res
  const user = gate.access.user

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const ext = OK_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: 'Only JPG, PNG, WEBP photos or PDF docs.' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Max 25MB per file.' }, { status: 400 })

  const sb = supabaseAdmin()
  try { await sb.storage.createBucket(BUCKET, { public: true }) } catch { /* exists */ }
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true })
  if (up.error) return NextResponse.json({ error: 'upload failed: ' + up.error.message }, { status: 502 })
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, url: pub.publicUrl, kind: ext === 'pdf' ? 'doc' : 'photo', name: file.name })
}
