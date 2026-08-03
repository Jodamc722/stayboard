// Salato guest verification — powers the iPad check-in flow.
// GET  ?rid=<reservationId>  -> guest + unit + house rules + current status (capability = the id).
// POST { rid, fullName, initials, signature, idPhoto, selfie } -> stores photos + signature in a
//       PRIVATE Supabase bucket and writes the verification record to app_settings (key sv:<rid>).
// The reservation id is the capability, so the guest device does not need the share password.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SALATO_RULES, SALATO_RULES_VERSION } from '@/lib/salato-rules'
import { getToken } from '@/lib/guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SALATO = /salato/i
const BUCKET = 'salato-verify'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff' // Guesty reservation "reservation_notes" custom field
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
    // Per-rule initials — the guest must initial EVERY house & building rule. Validated against the
    // server's own rule list so a client can't skip any.
    const riRaw: any = (body && typeof body.ruleInitials === 'object' && body.ruleInitials) ? body.ruleInitials : {}
    const ruleInitials: Record<string, string> = {}
    for (let i = 0; i < SALATO_RULES.length; i++) {
      const rule = SALATO_RULES[i]
      const v = str(riRaw[rule.id]).trim().slice(0, 12)
      if (!v) return NextResponse.json({ ok: false, error: 'Please initial every rule before submitting.' }, { status: 400 })
      ruleInitials[rule.id] = v
    }
    // Representative initials for the summary note (the guest normally uses the same initials on each).
    const initials = ruleInitials[SALATO_RULES[0].id] || str(body?.initials).trim().slice(0, 12)

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

    const record: any = {
      status: 'verified', rid, unit: info.unit, guestFirst: info.guestFirst,
      fullName, initials, ruleInitials, rulesVersion: SALATO_RULES_VERSION, rulesAcknowledged: true,
      idPath, selfiePath, signaturePath,
      signedAt: new Date().toISOString(),
      pushedToGuesty: false,
    }

    // Push to the Guesty reservation: mark in-person verification complete + a link the team can
    // open (share-password gated) to view the ID, selfie, and signature. Best-effort — never blocks
    // the guest's submission. Uses the safe read-merge-write helper so no other custom field is lost.
    try {
      const origin = new URL(req.url).origin
      const link = origin + '/salato/share?verify=' + rid
      let token = ''
      try { token = await getToken() } catch { token = '' }
      if (token) {
        const live = await readCustomFields(rid, token)
        if (live) {
          const isNotes = (c: any) => String(fieldIdOf(c) || '') === RES_NOTES_FIELD
          const existing = live.find(isNotes)
          const prior = existing && typeof existing.value === 'string' ? existing.value : ''
          const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
          const line = '[' + stamp + '] ✅ In-person verification completed — ' + fullName + ' (all ' + SALATO_RULES.length + ' rules initialed: ' + initials + '). View ID, selfie & signature: ' + link
          const newNotes = prior ? prior + '\n' + line : line
          const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD
          const w = await writeCustomFields(rid, token, [{ fieldId: notesId, value: newNotes }])
          record.pushedToGuesty = !!w.ok
          if (w.ok && w.fields) {
            try {
              const { data: rrow } = await db.from('guesty_reservations').select('raw').eq('id', rid).maybeSingle()
              const rraw: any = (rrow && rrow.raw && typeof rrow.raw === 'object') ? rrow.raw : {}
              await db.from('guesty_reservations').update({ custom_fields: w.fields, raw: Object.assign({}, rraw, { customFields: w.fields }) }).eq('id', rid)
            } catch {}
          }
        }
      }
    } catch {}

    const { error } = await db.from('app_settings').upsert({ key: keyFor(rid), value: JSON.stringify(record), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: String(error.message || error).slice(0, 160) }, { status: 500 })

    return NextResponse.json({ ok: true, pushedToGuesty: record.pushedToGuesty })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
