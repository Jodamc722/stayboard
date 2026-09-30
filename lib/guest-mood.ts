// GUEST MOOD → GUESTY (Jon, 2026-09-30: "adding sentiment to the reservation notes, happy, neutral,
// frustrated, sensitive. Any guest that complains should be automatically marked as sensitive in the
// Guesty system").
//
// Four labels, one per thread, set by the sentiment scan:
//   happy       — warm, excited, thankful, praising
//   neutral     — routine logistics and questions (a calm cancellation or fee question included)
//   frustrated  — friction without a complaint: confused, stuck, impatient, repeating themselves
//   sensitive   — the guest COMPLAINS (the unit, cleanliness, something broken, noise, access, a fee
//                 or charge, our service or response time), asks for money back because of a
//                 problem, or threatens a review or dispute
//
// What reaches Guesty, per reservation:
//   · a dated line in Reservation Notes — "[2026-09-30] Guest sentiment: Frustrated — can't pay the
//     deposit (Lighthouse)" — the first label, then each change. A slide back to Neutral is not
//     written (it would turn the notes into a log of every routine question);
//   · the Sensitive box ticked (a BOOLEAN field — the old code wrote the string 'Yes') whenever the
//     label is sensitive. It is never unticked by the app: a person decides that.
//
// SAFE WRITE. The old markReservationSensitive sent a bare PUT with two fields — the call that
// REPLACES a booking's whole custom-field array (door codes, order-form link, confirmation numbers).
// Everything here goes through writeCustomFields: read the live array, merge, write; the notes line
// is appended to the LIVE notes, never to our mirror's copy.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { writeCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'
import { notesDefId } from '@/lib/guesty-res-notes'
import { guestyFetch } from '@/lib/guesty-retry'

export type Mood = 'happy' | 'neutral' | 'frustrated' | 'sensitive'
export const MOODS: Mood[] = ['happy', 'neutral', 'frustrated', 'sensitive']
export const MOOD_LABEL: Record<Mood, string> = { happy: 'Happy', neutral: 'Neutral', frustrated: 'Frustrated', sensitive: 'Sensitive' }

/** The model's label, or one derived from the score when it gave none. */
export function moodOf(raw: any, score: number, complaint: boolean): Mood {
  const m = String(raw || '').toLowerCase().trim()
  if (complaint) return 'sensitive'
  if ((MOODS as string[]).includes(m)) return m as Mood
  return score >= 4 ? 'happy' : score <= 2 ? 'frustrated' : 'neutral'
}

/** Should this label be written, given what was last written? */
export function moodNeedsNote(mood: string | null, noted: string | null): boolean {
  if (!mood || mood === noted) return false
  if (mood === 'neutral' && noted) return false   // don't log every slide back to routine
  return true
}

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const ACCT = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'
const nameOf = (cf: any) => String(cf?.fieldName || cf?.name || cf?.key || cf?.fieldId?.name || cf?.field?.name || '')
const isSensitive = (cf: any) => /^sensitive( guest)?$/i.test(nameOf(cf).trim())
const isNotes = (cf: any) => /reservation[_ ]?notes/i.test(nameOf(cf))

let SENS: { id: string; at: number } | null = null
/** The Sensitive (boolean, reservation) field id — mirror first, then Guesty's definitions. */
async function sensitiveDefId(token: string): Promise<string | null> {
  if (SENS && Date.now() - SENS.at < 10 * 60_000) return SENS.id
  try {
    const { data } = await supabaseAdmin().from('guesty_custom_fields').select('id, name, slug, target')
    const w = (data || []).filter((d: any) => /^sensitive( guest)?$/i.test(String(d?.name || '').trim()) || /^sensitive(_guest)?$/i.test(String(d?.slug || '').trim()))
      .sort((a: any, b: any) => (a.target === 'reservation' ? -1 : 0) - (b.target === 'reservation' ? -1 : 0))[0]
    if (w?.id) { SENS = { id: String(w.id), at: Date.now() }; return SENS.id }
  } catch { /* fall through to Guesty */ }
  try {
    const r = await guestyFetch(`${BASE}/accounts/${ACCT}/custom-fields?limit=200`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (r.ok) {
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.customFields || j?.results || j?.data || [])
      const w = (arr || []).find((d: any) => /^sensitive( guest)?$/i.test(String(d?.key || d?.name || d?.displayName || '').trim()) && (!d?.object || d.object === 'reservation'))
      const id = w ? (w.fieldId || w._id || w.id) : null
      if (id) { SENS = { id: String(id), at: Date.now() }; return SENS.id }
    }
  } catch { /* none */ }
  return null
}

async function token(): Promise<string | null> {
  try { const t = await getToken(); if (t) return t } catch { /* fall back to the stored token */ }
  try {
    const { data: tok } = await supabaseAdmin().from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
    return tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? tok.access_token : null
  } catch { return null }
}

export type MoodWrite = { ok: boolean; note?: string; rateLimited?: boolean; wroteNote?: boolean; markedSensitive?: boolean }

/**
 * Write the label to one reservation in Guesty: the notes line (when `note`), and the Sensitive
 * box when the label is sensitive. One read-merge-write; mirrors the result locally.
 */
export async function writeGuestMood(reservationId: string, mood: Mood, why: string | null, opts: { note?: boolean } = {}): Promise<MoodWrite> {
  if (!reservationId) return { ok: false, note: 'no reservation' }
  const tok = await token()
  if (!tok) return { ok: false, note: 'no Guesty token' }
  const writes: { fieldId: string; value?: any; append?: string }[] = []
  let wroteNote = false, markedSensitive = false
  if (opts.note !== false) {
    const notesId = await notesDefId(tok)
    if (!notesId) return { ok: false, note: 'could not find the Reservation Notes field in Guesty' }
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const w = String(why || '').replace(/\s+/g, ' ').trim().slice(0, 220)
    writes.push({ fieldId: notesId, append: `[${stamp}] Guest sentiment: ${MOOD_LABEL[mood]}${w ? ' — ' + w : ''} (Lighthouse)` })
    wroteNote = true
  }
  if (mood === 'sensitive') {
    const sid = await sensitiveDefId(tok)
    if (!sid) return { ok: false, note: 'could not find the Sensitive field in Guesty' }
    writes.push({ fieldId: sid, value: true })
    markedSensitive = true
  }
  if (!writes.length) return { ok: true }
  const wr = await writeCustomFields(reservationId, tok, writes)
  if (!wr.ok) return { ok: false, note: String(wr.note || 'write failed'), rateLimited: !!wr.rateLimited }
  try {
    const sb = supabaseAdmin()
    const { data: row } = await sb.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle()
    const raw: any = row?.raw && typeof row.raw === 'object' ? row.raw : {}
    await sb.from('guesty_reservations').update({ custom_fields: wr.fields, raw: { ...raw, customFields: wr.fields } }).eq('id', reservationId)
  } catch { /* the mirror is a convenience; Guesty has the truth */ }
  return { ok: true, wroteNote, markedSensitive }
}

/** Is the reservation's Sensitive box ticked in a custom-field array? */
export function sensitiveIn(fields: any[] | null | undefined): boolean {
  const f = (fields || []).find(isSensitive)
  const v = f?.value
  return v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|1)$/i.test(v.trim()))
}
export { isNotes as isNotesField, isSensitive as isSensitiveField, fieldIdOf }

/**
 * The Guesty half of the scan: write the label for every thread whose label is not in Guesty yet.
 * Capped per run — Guesty 429s readily, and the backlog drains over the next runs. Past stays
 * (checked out more than 14 days ago) are left alone.
 */
export async function flushMoodNotes(limit = 12): Promise<{ written: number; sensitive: number; failed: number; pending: number; rateLimited: boolean; lastError?: string }> {
  const sb = supabaseAdmin()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await sb.from('guesty_conversation_sentiment')
    .select('conversation_id, reservation_id, mood, mood_noted, top_issue, guest_excerpt, reason, guesty_error_at, marked_sensitive_at, last_message_at')
    .not('mood', 'is', null).not('reservation_id', 'is', null).gte('last_message_at', since)
    .order('last_message_at', { ascending: false }).limit(600)
  const retryAfter = Date.now() - 6 * 3600000
  let due = (data || []).filter((r: any) => moodNeedsNote(r.mood, r.mood_noted) && !(r.guesty_error_at && Date.parse(r.guesty_error_at) > retryAfter))
  // One reservation can have more than one thread; write each reservation once, newest thread wins.
  const seenRes = new Set<string>()
  due = due.filter((r: any) => { const k = String(r.reservation_id); if (seenRes.has(k)) return false; seenRes.add(k); return true })
  // Sensitive first — the one Jon asked to be automatic.
  due.sort((a: any, b: any) => (a.mood === 'sensitive' ? 0 : 1) - (b.mood === 'sensitive' ? 0 : 1))
  if (due.length) {
    const ids = due.map((r: any) => String(r.reservation_id))
    const { data: res } = await sb.from('guesty_reservations').select('id, check_out').in('id', ids.slice(0, 300))
    const out: Record<string, string> = {}
    for (const r of res || []) out[String(r.id)] = String(r.check_out || '')
    const cut = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const old = due.filter((r: any) => out[String(r.reservation_id)] && out[String(r.reservation_id)].slice(0, 10) < cut && r.mood !== 'sensitive')
    if (old.length) {
      // Past stays: mark as handled without writing, so they leave the queue.
      await sb.from('guesty_conversation_sentiment').update({ guesty_error: 'stay ended over 14 days ago — not written', guesty_error_at: new Date().toISOString() })
        .in('conversation_id', old.map((r: any) => r.conversation_id))
      const oldSet = new Set(old.map((r: any) => r.conversation_id))
      due = due.filter((r: any) => !oldSet.has(r.conversation_id))
    }
  }
  let written = 0, sensitive = 0, failed = 0, rateLimited = false, lastError: string | undefined
  for (const r of due.slice(0, limit)) {
    const why = (r.top_issue ? String(r.top_issue) : '') || (r.mood === 'happy' || r.mood === 'neutral' ? '' : String(r.reason || '').slice(0, 160))
    const w = await writeGuestMood(String(r.reservation_id), r.mood as Mood, why)
    const now = new Date().toISOString()
    if (w.ok) {
      written++
      if (w.markedSensitive) sensitive++
      await sb.from('guesty_conversation_sentiment').update({
        mood_noted: r.mood, mood_noted_at: now, guesty_error: null, guesty_error_at: null,
        ...(w.markedSensitive && !r.marked_sensitive_at ? { marked_sensitive_at: now } : {}),
      }).eq('conversation_id', r.conversation_id)
    } else if (w.rateLimited) { rateLimited = true; break }
    else {
      failed++; lastError = w.note
      await sb.from('guesty_conversation_sentiment').update({ guesty_error: String(w.note || 'failed').slice(0, 300), guesty_error_at: now }).eq('conversation_id', r.conversation_id)
    }
  }
  return { written, sensitive, failed, pending: Math.max(0, due.length - written), rateLimited, ...(lastError ? { lastError } : {}) }
}
