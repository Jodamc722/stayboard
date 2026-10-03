// VIEW THE ID / SELFIE / DEPOSIT PROOF — a 10-minute signed link from the private bucket, every view
// written to the vault log (action guest_id_view) under the person who looked.
//   GET ?rid=<reservation>&which=id|selfie|proof → { url, expires }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logAccess } from '@/lib/vault'
export const dynamic = 'force-dynamic'
const BUCKET = 'guest-verify'
const TTL = 600

export async function GET(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  const rid = String(req.nextUrl.searchParams.get('rid') || '').trim()
  const which = String(req.nextUrl.searchParams.get('which') || 'id')
  if (!rid || !['id', 'selfie', 'proof'].includes(which)) return NextResponse.json({ ok: false, error: 'rid and which (id|selfie|proof) required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data: c } = await db.from('guest_checks').select('id_path,selfie_path,deposit_proof_path,id_name').eq('reservation_id', rid).maybeSingle()
  const path = which === 'id' ? (c as any)?.id_path : which === 'selfie' ? (c as any)?.selfie_path : (c as any)?.deposit_proof_path
  if (!path) return NextResponse.json({ ok: false, error: 'Nothing on file for that.' }, { status: 404 })
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(String(path), TTL)
  if (error || !data?.signedUrl) return NextResponse.json({ ok: false, error: error?.message || 'Could not sign the link.' }, { status: 500 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await logAccess({ email: String(g.access.email || ''), action: 'guest_id_view', detail: `${which} · reservation ${rid}${(c as any)?.id_name ? ' · ' + (c as any).id_name : ''}`, ip })
  return NextResponse.json({ ok: true, url: data.signedUrl, expires: Date.now() + TTL * 1000 })
}
