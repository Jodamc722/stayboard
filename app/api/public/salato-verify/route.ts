// Salato guest verification — powers the iPad check-in flow.
// GET  ?rid=<reservationId>  -> guest + unit + house rules + current status (capability = the id).
// POST { rid, fullName, initials, signature, idPhoto, selfie } -> stores photos + signature in a
//       PRIVATE Supabase bucket and writes the verification record to app_settings (key sv:<rid>).
// The reservation id is the capability, so the guest device does not need the share password.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SALATO_RULES, SALATO_RULES_VERSION } from '@/lib/salato-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SALATO = /salato/i
const BUCKET = 'salato-verify'
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function keyFor(rid: string) { return 'sv:' + rid }

// Confirm the reservation id belongs to a Salato listing; return light guest/unit detail.
async function loadSalatoRes(db: any, rid: string): Promise<{ ok: boolean; unit?: string; guestName?: string; guestFirst?: string; checkIn?: string; checkOut?: string; nights?: number; guests?: number | null; confirmationCode?: string }> {
  if (!rid || !/^[a-z0-9]{6,40}$/i.test(rid)) return { ok: false }
  const { data: r } = await db.from('guesty_reservations').select('id,listing_id,guest_name,check_in,check_out,nights,raw').eq('id', rid).maybeSingle()
  if (!r) return { ok: false }
  const { data: l } = await db.from('guesty_listings').select('nickname,title,building').eq('id', String(r.listing_id)).maybeSingle()
  const lname = l ? (l.nickname || l.title || '') : ''
  const isSalato = SALATO.test(str(l?.building)) || SALATO.test(str(lname))
  if (!isSalato) return { ok: false }
  const raw = r.raw || {}
  const guest = raw.guest || {}
  const full = r.guest_name || raw.guestName || guest.fullName || [guest.firstName, guest.lastName].filter(Boolean).join(' ') || ''
  const guestFirst = str(full).trim().split(/\s+/)[0] || ''
  const guests = raw.guestsCount ?? raw.numberOfGuests ?? null
  return { ok: true, unit: lname || 'Your unit', guestName: str(full).trim(), guestFirst, checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: r.nights ?? null, guests, confirmationCode: str(raw.confirmationCode) || undefined }
}

async function readRecord(db: any, rid: string): Promise<any | null> {
  const { data } = await db.from('app_settings').select('value').eq('key', keyFor(rid)).limit(1)
  const row: any = Array.isArray(data) ? data[0] : null
  if (row && row.value) { try { const j = JSON.parse(row.value); if (j && typeof j === 'object') return j } catch {} }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const rid = str(new URL(req.url).searchParams.get('rid')).trim()
    const db = supabaseAdmin()
    const info = await loadSalatoRes(db, rid)
    if (!info.ok) return NextResponse.json({ ok: false, error: 'This verification link is not valid.' }, { status: 404 })
    const rec = await readRecord(db, rid)
    return NextResponse.json({
      ok: true, guestName: info.guestName, guestFirst: info.guestFirst, unit: info.unit,
      checkIn: info.checkIn, checkOut: info.checkOut, nights: info.nights, guests: info.guests, confirmationCode: info.confirmationCode,
      rules: SALATO_RULES, rulesVersion: SALATO_RULES_VERSION,
      status: rec?.status || 'pending', verifiedAt: rec?.signedAt || null,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// data:image/jpeg;base64,... -> { ext, bytes } (jpeg/png only)
function decodeImage(dataUrl: string): { ext: 'jpg' | 'png'; bytes: Buffer } | null {
  const m = str(dataUrl).match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const ext = m[1] === 'png' ? 'png' : 'jpg'
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 500 || bytes.length > 12_000_000) return null
  return { ext, bytes }
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}))
    const rid = str(body?.rid).trim()
    const db = supabaseAdmin()
    const info = await loadSalatoRes(db, rid)
    if (!info.ok) return NextResponse.json({ ok: false, error: 'This verification link is not valid.' }, { status: 404 })

    // Name is auto-filled from the reservation; fall back to it if the client didn't send one.
    const fullName = (str(body?.fullName).trim() || str(info.guestName).trim()).slice(0, 120)

    const sig = decodeImage(str(body?.signature))
    const idp = decodeImage(str(body?.idPhoto))
    const self = decodeImage(str(body?.selfie))
    if (!sig) return NextResponse.json({ ok: false, error: 'A signature is required.' }, { status: 400 })
    if (!idp) return NextResponse.json({ ok: false, error: 'A photo of your ID is required.' }, { status: 400 })
    if (!self) return NextResponse.json({ ok: false, error: 'A photo of yourself is required.' }, { status: 400 })

    // PRIVATE bucket — images are served to the front desk via short-lived signed links only.
    try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }
    const base = rid + '/' + Date.now()
    const put = async (name: string, img: { ext: string; bytes: Buffer }, ct: string) => {
      const path = `${base}/${name}.${img.ext}`
      const up = await db.storage.from(BUCKET).upload(path, img.bytes, { contentType: ct, upsert: true })
      if (up.error) throw new Error(`upload ${name}: ${up.error.message}`)
      return path
    }
    const idPath = await put('id', idp, idp.ext === 'png' ? 'image/png' : 'image/jpeg')
    const selfiePath = await put('selfie', self, self.ext === 'png' ? 'image/png' : 'image/jpeg')
    const signaturePath = await put('signature', sig, sig.ext === 'png' ? 'image/png' : 'image/jpeg')

    const record = {
      status: 'verified', rid, unit: info.unit, guestFirst: info.guestFirst,
      fullName, rulesVersion: SALATO_RULES_VERSION, rulesAcknowledged: true,
      idPath, selfiePath, signaturePath,
      signedAt: new Date().toISOString(),
      pushedToGuesty: false,
    }
    const { error } = await db.from('app_settings').upsert({ key: keyFor(rid), value: JSON.stringify(record), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: String(error.message || error).slice(0, 160) }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
