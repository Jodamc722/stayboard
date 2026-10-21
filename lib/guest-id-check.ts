// THE ID CHECK, SERVER SIDE (Jon, 2026-10-21). lib/guest-id-match decides; this file reads the
// photos, runs the model, writes the row, and keeps Guesty's "verified" field in step.
//
//   checkPhotos       — the model reads an ID + selfie (lib/direct-booking checkId, task 'guest-id-link')
//                       and lib/guest-id-match decides: verified / check / retake.
//   recheckRow        — the same, on the photos a row already holds (the desk's Re-check, and the
//                       sweep over rows verified before anything read them).
//   upsertGuestCheck  — (lib/guest-checks-write) writes a row, and still writes it when migration
//                       158 has not run yet: the new columns are dropped, the status survives.
//   syncGuestyVerified— ticks or unticks the "verified" custom field on the booking in Guesty, so the
//                       team's own Guesty habit and the desk agree in both directions. Best effort.
//   verifiedFieldId   — that field's definition id, from the custom-field mirror (reservation
//                       entries carry no name).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { checkId } from './direct-booking'
import { decideLink, type IdVerdict } from './guest-id-match'
import { getToken } from './guesty'
import { writeCustomFields } from './guesty-custom-fields'
import { guestyFieldId } from './guesty-field-id'
import { upsertGuestCheck } from './guest-checks-write'
export { upsertGuestCheck }

export const VERIFY_BUCKET = 'guest-verify'
/** The Guesty reservation custom field the team ticks when an ID has been checked. */
export const GUESTY_VERIFIED_FIELD = 'verified'

export async function verifiedFieldId(): Promise<string | null> {
  try { return await guestyFieldId(GUESTY_VERIFIED_FIELD) } catch { return null }
}

export type Photo = { mime: string; b64: string }

/** First and last name off a booking's guest name, the way checkId wants them. */
export function splitName(full: string): { first: string; last: string } {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '') }
}

/** The model reads the two photos; the match module decides. `ran` says whether the model answered. */
export async function checkPhotos(idImg: Photo, selfie: Photo, typedName: string, bookingName: string): Promise<{ verdict: IdVerdict; ran: boolean; checkedAt: string; expires: string | null }> {
  const { first, last } = splitName(bookingName)
  const c = await checkId(idImg, selfie, first, last, 'guest-id-link')
  const verdict = decideLink(c.read, typedName, bookingName)
  return { verdict, ran: !!c.read, checkedAt: c.checkedAt, expires: c.expires }
}

/** The stored JSON for id_check. */
export function checkRecord(v: IdVerdict, ran: boolean, checkedAt: string, typed: string, source: string) {
  return { verdict: v.status, match: v.match, reasons: v.reasons, nameOnId: v.nameOnId, typed, ran, checkedAt, source }
}

/** Tick (true) or untick (false) the "verified" field on the booking in Guesty. Best effort; says whether it landed. */
export async function syncGuestyVerified(reservationId: string, value: boolean): Promise<boolean> {
  try {
    const fid = await verifiedFieldId()
    if (!fid) return false
    const token = await getToken()
    if (!token) return false
    const wr = await writeCustomFields(reservationId, token, [{ fieldId: fid, value: value as any }])
    if (!wr.ok) return false
    try {
      const db = supabaseAdmin()
      const { data: r } = await db.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle()
      const raw: any = (r as any)?.raw && typeof (r as any).raw === 'object' ? (r as any).raw : {}
      const cf = Array.isArray(wr.fields) ? wr.fields : null
      if (cf) await db.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', reservationId)
    } catch { /* mirror best-effort */ }
    return true
  } catch { return false }
}

async function readPhoto(db: any, path: string): Promise<Photo | null> {
  try {
    const { data, error } = await db.storage.from(VERIFY_BUCKET).download(path)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    if (!buf.length) return null
    const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg'
    return { mime, b64: buf.toString('base64') }
  } catch { return null }
}

/**
 * Re-run the check on the photos a row already holds. Verified rows that nothing ever read (every
 * link verification before 2026-10-21) go through this once; a flagged row goes through it when
 * the desk asks. The result is written like a fresh submission — a human's "Looks right" is kept.
 */
export async function recheckRow(db: any, reservationId: string, by: string): Promise<{ ok: boolean; error?: string; status?: string; verdict?: IdVerdict; degraded?: boolean }> {
  const [{ data: c }, { data: r }] = await Promise.all([
    db.from('guest_checks').select('*').eq('reservation_id', reservationId).maybeSingle(),
    db.from('guesty_reservations').select('guest_name').eq('id', reservationId).maybeSingle(),
  ])
  if (!c) return { ok: false, error: 'No verification on file for this booking.' }
  if (!c.id_path || !c.selfie_path) return { ok: false, error: 'No photos on file to check — the guest never used the link.' }
  if (c.id_checked_by) return { ok: false, error: 'A person already cleared this one by hand (' + String(c.id_checked_by).split('@')[0] + ').' }
  const [idImg, selfie] = await Promise.all([readPhoto(db, String(c.id_path)), readPhoto(db, String(c.selfie_path))])
  if (!idImg || !selfie) return { ok: false, error: 'The photos could not be read from storage.' }
  const booking = String((r as any)?.guest_name || '')
  const { verdict, ran, checkedAt } = await checkPhotos(idImg, selfie, String(c.id_name || ''), booking)
  // A retake verdict on stored photos (not an ID at all) is a check for a person — nobody can ask the guest to retake from here.
  const status = verdict.status === 'verified' ? 'verified' : 'check'
  const now = new Date().toISOString()
  const w = await upsertGuestCheck(db, {
    reservation_id: reservationId, id_status: status, id_match: verdict.match, id_read_name: verdict.nameOnId,
    id_check: checkRecord(verdict, ran, checkedAt, String(c.id_name || ''), 'recheck:' + by),
    updated_at: now, updated_by: by,
  })
  if (!w.ok) return { ok: false, error: w.error }
  if (status === 'verified' && c.id_status !== 'verified') { try { await syncGuestyVerified(reservationId, true) } catch { /* best effort */ } }
  return { ok: true, status, verdict, degraded: w.degraded }
}
