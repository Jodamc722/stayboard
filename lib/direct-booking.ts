// DIRECT BOOKING — the booking itself, between "I want these dates" and "you're booked" (Jon,
// 2026-10-13). Guesty does the inventory, the price and the money (lib/guesty-be); this file holds
// the one thing Guesty does not: the guest's ID and selfie, checked BEFORE the reservation exists.
//
// A DRAFT is one person's booking in progress: the listing, dates and guest count, the quote, the
// guest's name/email/phone, and — once uploaded — the ID photo, the selfie and the check's verdict.
// It lives in app_settings under 'dbk:<uuid>' (no migration to hand-run) and its uuid is the only
// handle the browser holds. The photos go to the same PRIVATE bucket the guest-verify link uses
// (guest-verify), so the desk opens them through the same 10-minute signed links, every view logged.
//
// THE CHECK (Claude vision, task 'direct-booking-id'): is the first photo a government photo ID, is
// it readable and unexpired, does the name on it match the booking name, is there a real person's
// face in the selfie. Hard stops ask the guest to retake (not an ID, unreadable, expired, no face,
// name does not match). Whether the selfie face resembles the ID photo is NEVER an automatic no — a
// model is not a face-matching service — it is only a "review" flag the desk sees on the booking.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { aiFetch } from './ai-usage'
import { modelFor } from './ai-models'

export const BUCKET = 'guest-verify'
const KEY = (id: string) => 'dbk:' + id

export type IdCheck = { verdict: 'pass' | 'retake' | 'review'; reasons: string[]; nameOnId: string | null; expires: string | null; isId: boolean; face: boolean; resembles: 'yes' | 'no' | 'unsure'; checkedAt: string
  /** What the model read, untouched by the verdict rules — the guest-verify link decides from this (lib/guest-id-match). null when the check did not run. */
  read: IdRead | null }
export type IdRead = { isId: boolean; readable: boolean; expired: boolean; face: boolean; screen: boolean; nameOnId: string | null; resembles: 'yes' | 'no' | 'unsure' }
export type Draft = {
  id: string; createdAt: string; ip: string | null
  listingId: string; listingTitle: string; checkIn: string; checkOut: string; guests: number
  quoteId?: string | null; ratePlanId?: string | null; total?: number | null; currency?: string | null
  guest?: { firstName: string; lastName: string; email: string; phone: string } | null
  idPath?: string | null; selfiePath?: string | null; check?: IdCheck | null
  booked?: { reservationId: string; confirmationCode: string; at: string; paymentStatus: string } | null
  pending3ds?: { reservationId: string; paymentId: string } | null
}

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function newDraft(d: Omit<Draft, 'id' | 'createdAt'>): Promise<Draft> {
  const draft: Draft = { ...d, id: randomUUID(), createdAt: new Date().toISOString() }
  await saveDraft(draft)
  return draft
}
export async function loadDraft(id: string): Promise<Draft | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY(id)).maybeSingle()
    const raw = (data as any)?.value
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!v || v.id !== id) return null
    // A draft is good for two days; an abandoned one is not a key that works forever.
    if (Date.now() - Date.parse(v.createdAt) > 2 * 86400_000 && !v.booked) return null
    return v as Draft
  } catch { return null }
}
export async function saveDraft(d: Draft): Promise<void> {
  await supabaseAdmin().from('app_settings').upsert({ key: KEY(d.id), value: JSON.stringify(d), updated_by: 'direct-booking', updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export function decodeImage(dataUrl: string): { ext: 'jpg' | 'png'; mime: string; b64: string; bytes: Buffer } | null {
  const m = str(dataUrl).match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 2000 || bytes.length > 8_000_000) return null
  return { ext: m[1] === 'png' ? 'png' : 'jpg', mime: m[1] === 'png' ? 'image/png' : 'image/jpeg', b64: m[2], bytes }
}

export async function storePhotos(draftId: string, idImg: { ext: string; bytes: Buffer; mime: string }, selfie: { ext: string; bytes: Buffer; mime: string }): Promise<{ idPath: string; selfiePath: string }> {
  const db = supabaseAdmin()
  try { await db.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }
  const stamp = Date.now()
  const put = async (which: string, img: { ext: string; bytes: Buffer; mime: string }) => {
    const path = `direct/${draftId}/${which}-${stamp}.${img.ext}`
    const up = await db.storage.from(BUCKET).upload(path, img.bytes, { contentType: img.mime, upsert: true })
    if (up.error) throw new Error(`upload ${which}: ${up.error.message}`)
    return path
  }
  return { idPath: await put('id', idImg), selfiePath: await put('selfie', selfie) }
}

const norm = (s: string) => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
/** First and last name both appear on the ID (order and middle names free). */
export function nameMatches(onId: string, first: string, last: string): boolean {
  const id = ' ' + norm(onId) + ' ', f = norm(first).split(' ')[0], l = norm(last).split(' ').pop() || ''
  return !!f && !!l && id.includes(' ' + f) && id.includes(l)
}

const SYSTEM = `You check identity documents for a vacation-rental company's direct booking page. You receive two photos: (1) what should be a government-issued photo ID (driver's licence, passport, national ID card, residence card), (2) a selfie the guest just took. Answer ONLY with a JSON object:
{"isId": boolean, "readable": boolean, "nameOnId": string|null, "expires": "YYYY-MM-DD"|null, "expired": boolean, "faceInSelfie": boolean, "selfieIsPhotoOfScreenOrPrint": boolean, "resembles": "yes"|"no"|"unsure", "notes": string}
isId: the first photo is a real government photo ID (not a credit card, not a screenshot of a web page, not a blank card).
readable: the name and the expiry date can be read.
nameOnId: the full name exactly as printed.
expired: true only if the printed expiry date is before today (${new Date().toISOString().slice(0, 10)}).
faceInSelfie: the second photo shows one real person's face, clearly.
selfieIsPhotoOfScreenOrPrint: the selfie looks like a photo of a screen or of a printed picture rather than a live person.
resembles: whether the selfie face plausibly matches the ID photo — say "unsure" whenever in doubt; this is a hint for a human, never a decision.
notes: one short sentence a front-desk person would find useful. Never repeat ID numbers or addresses.`

export async function checkId(idImg: { mime: string; b64: string }, selfie: { mime: string; b64: string }, first: string, last: string, task = 'direct-booking-id'): Promise<IdCheck> {
  const now = new Date().toISOString()
  const key = process.env.ANTHROPIC_API_KEY || ''
  // No model available: the photos are still captured; the desk reviews them by hand.
  if (!key) return { verdict: 'review', reasons: ['automatic check unavailable — the desk will review the photos'], nameOnId: null, expires: null, isId: true, face: true, resembles: 'unsure', checkedAt: now, read: null }
  try {
    const r = await aiFetch(task, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor(task), max_tokens: 400, system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Photo 1 — the ID:' }, { type: 'image', source: { type: 'base64', media_type: idImg.mime, data: idImg.b64 } },
          { type: 'text', text: 'Photo 2 — the selfie:' }, { type: 'image', source: { type: 'base64', media_type: selfie.mime, data: selfie.b64 } },
          { type: 'text', text: 'Return the JSON.' },
        ] }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d?.error?.message || 'check failed')
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const m = text.match(/\{[\s\S]*\}/)
    const j: any = m ? JSON.parse(m[0]) : {}
    const reasons: string[] = []
    let verdict: IdCheck['verdict'] = 'pass'
    const retake = (why: string) => { verdict = 'retake'; reasons.push(why) }
    if (!j.isId) retake('The first photo does not look like a government photo ID. Please photograph your driver\'s licence, passport or national ID.')
    else if (!j.readable) retake('We could not read the ID. Retake it flat, in good light, with no glare, the whole card in the frame.')
    else if (j.expired) retake('This ID looks expired. Please use a current ID.')
    if (!j.faceInSelfie) retake('We could not see your face clearly in the selfie. Retake it facing the camera, in good light.')
    else if (j.selfieIsPhotoOfScreenOrPrint) retake('The selfie needs to be taken live with your camera, not a photo of a picture or screen.')
    const nameOnId = j.nameOnId ? String(j.nameOnId).slice(0, 120) : null
    if (verdict === 'pass' && nameOnId && !nameMatches(nameOnId, first, last)) retake(`The name on the ID ("${nameOnId}") must match the name on the booking. Fix the name above, or use the ID of the person booking.`)
    if (verdict === 'pass' && j.resembles === 'no') { verdict = 'review'; reasons.push('selfie may not match the ID photo — desk to review') }
    if (verdict === 'pass' && !nameOnId) { verdict = 'review'; reasons.push('name on the ID was not read — desk to review') }
    const resembles: IdRead['resembles'] = j.resembles === 'yes' || j.resembles === 'no' ? j.resembles : 'unsure'
    const read: IdRead = { isId: !!j.isId, readable: !!j.readable, expired: !!j.expired, face: !!j.faceInSelfie, screen: !!j.selfieIsPhotoOfScreenOrPrint, nameOnId, resembles }
    return { verdict, reasons, nameOnId, expires: j.expires ? String(j.expires).slice(0, 10) : null, isId: !!j.isId, face: !!j.faceInSelfie, resembles, checkedAt: now, read }
  } catch {
    // The model failed, not the guest. Let them through and put the photos in front of a person.
    return { verdict: 'review', reasons: ['automatic check did not complete — the desk will review the photos'], nameOnId: null, expires: null, isId: true, face: true, resembles: 'unsure', checkedAt: now, read: null }
  }
}

/**
 * The booking exists: the verification belongs to it now. The desk's guest-checks row is written as
 * verified (method 'direct') with the photo paths, and a note goes on the Today page — so a direct
 * booking arrives already checked, with the ID one click away, like a guest who used the link.
 */
export async function attachToReservation(d: Draft, reservationId: string): Promise<void> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const name = d.check?.nameOnId || [d.guest?.firstName, d.guest?.lastName].filter(Boolean).join(' ')
  try {
    const { upsertGuestCheck } = await import('./guest-checks-write')
    await upsertGuestCheck(db, {
      // 'check', not 'pending', when the model could not vouch for it (2026-10-21): the photos ARE
      // on file and a person has to look — a blank row read as "nothing received".
      reservation_id: reservationId, id_status: d.check?.verdict === 'review' ? 'check' : 'verified', id_method: 'direct', id_captured_at: now,
      id_name: name, id_path: d.idPath || null, selfie_path: d.selfiePath || null, updated_at: now, updated_by: 'guest:direct-booking',
      ...(d.check ? { id_check: { verdict: d.check.verdict, reasons: d.check.reasons, nameOnId: d.check.nameOnId, checkedAt: d.check.checkedAt, read: d.check.read, source: 'direct-booking' }, id_match: d.check.nameOnId ? (d.check.verdict === 'pass' ? 'match' : 'mismatch') : 'unread', id_read_name: d.check.nameOnId } : {}),
    })
  } catch { /* the booking stands; the desk can attach by hand */ }
  try {
    const flag = d.check?.verdict === 'review' ? ` — needs a look: ${d.check.reasons.join('; ')}` : ''
    await db.from('day_notes').insert({ key: 'gc:' + reservationId, text: `Direct booking — ID + selfie taken at booking (${name})${flag}`, by: 'guest' })
  } catch { /* fine */ }
}
