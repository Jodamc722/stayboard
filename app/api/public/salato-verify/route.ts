// Salato guest verification — powers the iPad check-in flow.
// GET  ?rid=<reservationId>  -> guest + unit + house rules + current status (capability = the id).
// POST { rid, fullName, initials, signature, idPhoto, selfie } -> stores photos + signature in a
//       PRIVATE Supabase bucket and writes the verification record to app_settings (key sv:<rid>).
// The reservation id is the capability, so the guest device does not need the share password.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadSalatoRules } from '@/lib/salato-rules'
import { getToken } from '@/lib/guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'
import { getSetting } from '@/lib/app-settings'
import { buildVerifyPdf } from '@/lib/salato-pdf'
import { sendGmail } from '@/lib/gmail-send'
import { getAccess } from '@/lib/access'
import { adminPasswordOk } from '@/lib/shareAuth'

function escapeHtml(s: any): string { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function fmtDay(d?: string): string { if (!d) return '—'; const x = new Date(d + 'T12:00:00'); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function validEmails(s: string): string[] { const out: string[] = []; const seen: Record<string, boolean> = {}; const parts = String(s || '').split(/[,;\s]+/); for (let i = 0; i < parts.length; i++) { const e = parts[i].trim(); if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) continue; const k = e.toLowerCase(); if (seen[k]) continue; seen[k] = true; out.push(e) } return out }

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
    const { rules, version } = await loadSalatoRules(db)
    return NextResponse.json({
      ok: true, guestName: info.guestName, guestFirst: info.guestFirst, unit: info.unit,
      checkIn: info.checkIn, checkOut: info.checkOut, nights: info.nights, guests: info.guests, confirmationCode: info.confirmationCode,
      rules, rulesVersion: version,
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

    // REOPEN: a verification was done incorrectly — reset it to pending so the guest can redo it.
    // Gated: a signed-in Stayboard user, or the admin password (the same credential that gates other
    // destructive actions). Front-desk share-only users must supply that password.
    if (str(body?.action) === 'reopen') {
      const access = await getAccess()
      if (!access.user) {
        const gate = await adminPasswordOk(body?.password)
        if (!gate.ok) return NextResponse.json({ ok: false, needsAdminPassword: true, error: gate.reason }, { status: 403 })
      }
      const rec = await readRecord(db, rid)
      if (!rec || rec.status !== 'verified') return NextResponse.json({ ok: true, reopened: true, note: 'Nothing to reopen — this stay is not verified.' })
      const reopened = Object.assign({}, rec, { status: 'pending', reopenedAt: new Date().toISOString(), reopenedBy: access.user ? (access.email || 'admin') : 'front-desk', priorSignedAt: rec.signedAt || null })
      const { error: rErr } = await db.from('app_settings').upsert({ key: keyFor(rid), value: JSON.stringify(reopened), updated_at: new Date().toISOString() })
      if (rErr) return NextResponse.json({ ok: false, error: String(rErr.message || rErr).slice(0, 160) }, { status: 500 })
      return NextResponse.json({ ok: true, reopened: true })
    }

    // Name is auto-filled from the reservation; fall back to it if the client didn't send one.
    const fullName = (str(body?.fullName).trim() || str(info.guestName).trim()).slice(0, 120)
    // Per-rule initials — the guest must initial EVERY house & building rule. Validated against the
    // server's own (possibly team-edited) rule list so a client can't skip any.
    const { rules: activeRules, version: rulesVersion } = await loadSalatoRules(db)
    const riRaw: any = (body && typeof body.ruleInitials === 'object' && body.ruleInitials) ? body.ruleInitials : {}
    const ruleInitials: Record<string, string> = {}
    for (let i = 0; i < activeRules.length; i++) {
      const rule = activeRules[i]
      const v = str(riRaw[rule.id]).trim().slice(0, 12)
      if (!v) return NextResponse.json({ ok: false, error: 'Please initial every rule before submitting.' }, { status: 400 })
      ruleInitials[rule.id] = v
    }
    // Representative initials for the summary note (the guest normally uses the same initials on each).
    const initials = (activeRules[0] && ruleInitials[activeRules[0].id]) || str(body?.initials).trim().slice(0, 12)

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
      fullName, initials, ruleInitials, rulesVersion, rulesAcknowledged: true,
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
          const line = '[' + stamp + '] ✅ In-person verification completed — ' + fullName + ' (all ' + activeRules.length + ' rules initialed: ' + initials + '). View ID, selfie & signature: ' + link
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

    // Team notification: details + ID/selfie/signature images + a PDF record of the initialed rules.
    // Recipients are editable in App settings (app_settings 'salato_verify_notify'). Best-effort.
    try {
      const cfg: any = await getSetting('salato_verify_notify', { emails: '', enabled: true })
      const to = validEmails(cfg && cfg.emails)
      const cc = validEmails(cfg && cfg.cc)
      const fromEmail = (validEmails(cfg && cfg.from)[0]) || 'jon@stay-hospitality.com'
      if ((cfg?.enabled !== false) && (to.length || cc.length)) {
        const origin = new URL(req.url).origin
        const viewLink = origin + '/salato/share?verify=' + rid
        const details: { label: string; value: string }[] = [
          { label: 'Guest', value: fullName || '—' },
          { label: 'Unit', value: info.unit || '—' },
          { label: 'Check-in', value: fmtDay(info.checkIn) },
          { label: 'Check-out', value: fmtDay(info.checkOut) },
        ]
        if (info.confirmationCode) details.push({ label: 'Confirmation', value: info.confirmationCode })
        details.push({ label: 'Verified', value: new Date(record.signedAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' })
        const pdfRules = activeRules.map((r, i) => ({ n: i + 1, title: r.title, body: r.body, initials: ruleInitials[r.id] || '' }))
        const ctOf = (ext: string) => ext === 'png' ? 'image/png' : 'image/jpeg'
        const att: any[] = [
          { filename: 'id.' + idp.ext, content: idp.bytes, contentType: ctOf(idp.ext), contentId: 'idimg' },
          { filename: 'selfie.' + self.ext, content: self.bytes, contentType: ctOf(self.ext), contentId: 'selfieimg' },
          { filename: 'signature.' + sig.ext, content: sig.bytes, contentType: ctOf(sig.ext), contentId: 'sigimg' },
        ]
        try {
          const pdfImages: { caption: string; jpeg: Buffer }[] = []
          if (idp.ext !== 'png') pdfImages.push({ caption: 'Government ID', jpeg: idp.bytes })
          if (self.ext !== 'png') pdfImages.push({ caption: 'Selfie', jpeg: self.bytes })
          if (sig.ext !== 'png') pdfImages.push({ caption: 'Signature', jpeg: sig.bytes })
          const pdf = buildVerifyPdf({ title: 'Salato — Guest Verification', subtitle: 'In-person verification completed', details, rulesVersion, rules: pdfRules, images: pdfImages })
          att.push({ filename: 'salato-verification-' + (info.confirmationCode || rid) + '.pdf', content: pdf, contentType: 'application/pdf' })
        } catch {}
        const rowsHtml = details.map(d => '<tr><td style="padding:2px 12px 2px 0;color:#6b7280;font-size:13px">' + escapeHtml(d.label) + '</td><td style="padding:2px 0;font-weight:600;font-size:13px">' + escapeHtml(d.value) + '</td></tr>').join('')
        const rulesHtml = pdfRules.map(r => '<li style="margin-bottom:8px"><b>' + escapeHtml(r.title) + '</b> &mdash; <span style="color:#059669;font-weight:700">initialed ' + escapeHtml(r.initials) + '</span>' + (r.body ? '<br><span style="color:#6b7280;font-size:12px">' + escapeHtml(r.body) + '</span>' : '') + '</li>').join('')
        const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto">'
          + '<div style="background:#111827;color:#fff;border-radius:14px;padding:18px 20px;margin-bottom:16px"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#fcd34d;font-weight:700">Stay Hospitality</div><div style="font-size:20px;font-weight:800;margin-top:4px">Salato verification completed</div></div>'
          + '<table style="border-collapse:collapse;margin-bottom:16px">' + rowsHtml + '</table>'
          + '<div style="font-weight:700;margin:8px 0">ID &amp; selfie</div>'
          + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px"><img src="cid:idimg" alt="ID" style="max-width:300px;border:1px solid #e5e7eb;border-radius:10px"><img src="cid:selfieimg" alt="Selfie" style="max-width:220px;border:1px solid #e5e7eb;border-radius:10px"></div>'
          + '<div style="font-weight:700;margin:8px 0">Signature</div><img src="cid:sigimg" alt="Signature" style="max-width:360px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;margin-bottom:16px">'
          + '<div style="font-weight:700;margin:8px 0">House &amp; building rules (v' + rulesVersion + ') — initialed by guest</div><ol style="padding-left:18px;margin-top:4px">' + rulesHtml + '</ol>'
          + '<p style="font-size:12px;color:#6b7280;margin-top:16px">A PDF copy is attached. View on the board: <a href="' + viewLink + '">' + viewLink + '</a></p></div>'
        const send = await sendGmail({ fromEmail, to, cc, subject: 'Salato verification — ' + (fullName || 'Guest') + (info.unit ? ' — ' + info.unit : ''), html, attachments: att })
        record.emailedTo = send.ok ? to : []
        record.emailedCc = send.ok ? cc : []
        record.emailedFrom = fromEmail
        if (!send.ok) record.emailError = send.error
      }
    } catch (e: any) { record.emailError = String(e?.message || e) }

    const { error } = await db.from('app_settings').upsert({ key: keyFor(rid), value: JSON.stringify(record), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: String(error.message || error).slice(0, 160) }, { status: 500 })

    return NextResponse.json({ ok: true, pushedToGuesty: record.pushedToGuesty, emailedTo: record.emailedTo || [] })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
