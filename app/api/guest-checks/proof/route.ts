// DEPOSIT PROOF — the desk uploads the hold / authorization screenshot or receipt. Private bucket,
// viewed through api/guest-checks/photo?which=proof. multipart: file + reservationId.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BUCKET = 'guest-verify'

export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file') as File | null
  const rid = String(fd?.get('reservationId') || '').trim()
  if (!file || !rid) return NextResponse.json({ ok: false, error: 'file and reservationId required' }, { status: 400 })
  if (file.size > 12_000_000) return NextResponse.json({ ok: false, error: 'That file is over 12 MB.' }, { status: 400 })
  const type = file.type || 'application/octet-stream'
  if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(type)) return NextResponse.json({ ok: false, error: 'A JPG, PNG, WEBP or PDF, please.' }, { status: 400 })
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const db = supabaseAdmin()
  try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }
  const path = `${rid}/deposit-proof-${Date.now()}.${ext}`
  const up = await db.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: true })
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 })
  const now = new Date().toISOString()
  const { data: cur } = await db.from('guest_checks').select('*').eq('reservation_id', rid).maybeSingle()
  const row = { ...(cur || {}), reservation_id: rid, deposit_proof_path: path, updated_at: now, updated_by: String(g.access.email || '') }
  const { error } = await db.from('guest_checks').upsert(row, { onConflict: 'reservation_id' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
