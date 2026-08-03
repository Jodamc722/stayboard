// Front-desk viewer for a guest's verification photos. Share-PASSWORD gated (unlike the public
// Salato board): returns short-lived signed URLs for the ID photo, selfie, and signature so the
// sensitive images are never exposed on the public board or via a permanent URL.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BUCKET = 'salato-verify'
const TTL = 600 // signed URLs valid 10 minutes
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const rid = str(new URL(req.url).searchParams.get('rid')).trim()
    if (!/^[a-z0-9]{6,40}$/i.test(rid)) return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 })
    const db = supabaseAdmin()
    const { data } = await db.from('app_settings').select('value').eq('key', 'sv:' + rid).limit(1)
    const row: any = Array.isArray(data) ? data[0] : null
    let rec: any = null
    if (row && row.value) { try { rec = JSON.parse(row.value) } catch {} }
    if (!rec || rec.status !== 'verified') return NextResponse.json({ ok: false, error: 'No verification on file for this guest yet.' }, { status: 404 })
    const sign = async (p: string) => { if (!p) return null; const s = await db.storage.from(BUCKET).createSignedUrl(p, TTL); return s.data ? s.data.signedUrl : null }
    const idUrl = await sign(str(rec.idPath))
    const selfieUrl = await sign(str(rec.selfiePath))
    const signatureUrl = await sign(str(rec.signaturePath))
    return NextResponse.json({ ok: true, fullName: rec.fullName || null, unit: rec.unit || null, signedAt: rec.signedAt || null, idUrl, selfieUrl, signatureUrl })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
