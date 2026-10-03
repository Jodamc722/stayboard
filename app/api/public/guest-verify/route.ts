// GUEST ID VERIFICATION — the link we send a Vrbo / Direct / Google guest (Jon, 2026-10-03). Any
// building, any channel whose rule says verify. Phone-first: a photo of their government ID and a
// selfie, the name as it reads on the ID, a consent line. Files land in the PRIVATE bucket
// guest-verify; the desk sees them through 10-minute signed links (api/guest-checks/photo), each
// view logged. The row in guest_checks is stamped id_captured_at the moment the files land.
//   GET  ?token=<signed>                      → guest + unit + dates + status
//   POST { token, idPhoto, selfie, name, agree } → stores, marks verified
// The token is signed (lib/guest-verify-token); a bad one counts toward the per-address lockout
// shared with the Salato link. The link dies two days after check-out.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestVerifyRid } from '@/lib/guest-verify-token'
import { logParking, lockoutReason, LOCKOUT_MINUTES } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const BUCKET = 'guest-verify'
const LOCK_CODE = 'guest-verify'
const GRACE_DAYS = 2

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
function ipOf(req: NextRequest): string | null { const h = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''; return String(h).split(',')[0].trim() || null }
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function daysAgoET(n: number): string { const d = new Date(ymdET(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

async function ridFromToken(req: NextRequest, token: string): Promise<{ rid: string | null; locked: boolean }> {
  const ip = ipOf(req)
  if ((await lockoutReason(LOCK_CODE, ip)) === 'ip') return { rid: null, locked: true }
  const rid = guestVerifyRid(token)
  if (!rid) { if (token) await logParking({ code: LOCK_CODE, action: 'denied', detail: 'bad verify token', ip }); return { rid: null, locked: false } }
  return { rid, locked: false }
}
const LOCKED = () => NextResponse.json({ ok: false, locked: true, error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` }, { status: 429 })
const INVALID = () => NextResponse.json({ ok: false, error: 'This verification link is not valid.' }, { status: 404 })
const EXPIRED = () => NextResponse.json({ ok: false, expired: true, error: 'This link has expired — the stay has ended.' }, { status: 410 })

async function loadRes(db: any, rid: string) {
  const { data: r } = await db.from('guesty_reservations').select('id,listing_id,guest_name,listing_name,check_in,check_out,nights,status,raw').eq('id', rid).maybeSingle()
  if (!r) return null
  const co = str(r.check_out).slice(0, 10)
  if (co && co < daysAgoET(GRACE_DAYS)) return { expired: true }
  const raw = r.raw || {}; const guest = raw.guest || {}
  const full = r.guest_name || raw.guestName || guest.fullName || [guest.firstName, guest.lastName].filter(Boolean).join(' ') || ''
  let unit = str(r.listing_name)
  try { const { data: l } = await db.from('guesty_listings').select('nickname,title').eq('id', str(r.listing_id)).maybeSingle(); if (l) unit = l.nickname || l.title || unit } catch { /* name is fine */ }
  return { rid, unit: unit || 'Your unit', guestName: str(full).trim(), guestFirst: str(full).trim().split(/\s+/)[0] || '', checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: r.nights ?? null, confirmationCode: str(raw.confirmationCode || '') }
}

export async function GET(req: NextRequest) {
  try {
    const { rid, locked } = await ridFromToken(req, str(new URL(req.url).searchParams.get('token')).trim())
    if (locked) return LOCKED()
    if (!rid) return INVALID()
    const db = supabaseAdmin()
    const info: any = await loadRes(db, rid)
    if (!info) return INVALID()
    if (info.expired) return EXPIRED()
    const { data: c } = await db.from('guest_checks').select('id_status,id_captured_at,id_method').eq('reservation_id', rid).maybeSingle()
    return NextResponse.json({ ok: true, ...info, status: (c as any)?.id_status === 'verified' ? 'verified' : 'pending', verifiedAt: (c as any)?.id_captured_at || null })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

function decodeImage(dataUrl: string): { ext: 'jpg' | 'png'; bytes: Buffer } | null {
  const m = str(dataUrl).match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 500 || bytes.length > 12_000_000) return null
  return { ext: m[1] === 'png' ? 'png' : 'jpg', bytes }
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}))
    const { rid, locked } = await ridFromToken(req, str(body?.token).trim())
    if (locked) return LOCKED()
    if (!rid) return INVALID()
    const db = supabaseAdmin()
    const info: any = await loadRes(db, rid)
    if (!info) return INVALID()
    if (info.expired) return EXPIRED()

    const { data: prior } = await db.from('guest_checks').select('id_status').eq('reservation_id', rid).maybeSingle()
    if ((prior as any)?.id_status === 'verified') return NextResponse.json({ ok: false, alreadyVerified: true, error: 'This stay is already verified. If something is wrong, message us and we will reopen it.' }, { status: 409 })

    const name = str(body?.name).trim().slice(0, 120)
    const idImg = decodeImage(str(body?.idPhoto))
    const selfie = decodeImage(str(body?.selfie))
    if (!name) return NextResponse.json({ ok: false, error: 'Please type your name as it reads on the ID.' }, { status: 400 })
    if (!idImg) return NextResponse.json({ ok: false, error: 'Please add a clear photo of your government ID.' }, { status: 400 })
    if (!selfie) return NextResponse.json({ ok: false, error: 'Please take a selfie.' }, { status: 400 })
    if (body?.agree !== true) return NextResponse.json({ ok: false, error: 'Please confirm the consent line.' }, { status: 400 })

    try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }
    const stamp = Date.now()
    const put = async (which: string, img: { ext: string; bytes: Buffer }) => {
      const path = `${rid}/${which}-${stamp}.${img.ext}`
      const up = await db.storage.from(BUCKET).upload(path, img.bytes, { contentType: img.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true })
      if (up.error) throw new Error(`upload ${which}: ${up.error.message}`)
      return path
    }
    const idPath = await put('id', idImg)
    const selfiePath = await put('selfie', selfie)
    const now = new Date().toISOString()
    const { error } = await db.from('guest_checks').upsert({
      reservation_id: rid, id_status: 'verified', id_method: 'link', id_captured_at: now, id_name: name, id_path: idPath, selfie_path: selfiePath,
      updated_at: now, updated_by: 'guest:' + (ipOf(req) || 'link'),
    }, { onConflict: 'reservation_id' })
    if (error) return NextResponse.json({ ok: false, error: 'Could not save your verification — please tap Submit again.' }, { status: 500 })
    // A line on the Today page's notes so the desk sees it without hunting. Best-effort.
    try { await db.from('day_notes').insert({ key: 'gc:' + rid, text: `ID verified by the guest through the link — ${name}`, by: 'guest' }) } catch { /* fine */ }
    return NextResponse.json({ ok: true, verifiedAt: now })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
