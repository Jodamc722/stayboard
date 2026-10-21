// A PERSON'S NOTE ON A CALL (Jon, 2026-10-21: "need to be able to add notes to all calls, welcome
// and recovery calls").
//
// Before this, a welcome call took a note only at the bottom of its script panel or in the strip
// that appears right after a mark; a follow-up (recovery) call took one only together with an
// outcome; a call on the Done tab, on the Command Center's call tiles or in its Calls lane took
// none. Now every call row — live or done, welcome or follow-up, on the Calls desk or on Today —
// has the same note control, and every note lands in the same two places:
//
//   1. guest_calls.note — the call's own record, when the call has one (a row exists as soon as
//      anyone has pressed a button on it: claim, no answer, reached, happy…). The new note goes
//      UNDER the earlier one, dated and signed, so a second note never erases the first. A call
//      nobody has touched yet has no row and gets none here: a note is not an attempt, and must
//      not read as one on the scoreboard.
//   2. the reservation's notes in Guesty — a dated "[date] Welcome call note by X: …" line, so
//      whoever opens the booking in Guesty reads it too (lib/guesty-res-notes appends, never
//      replaces). Best effort: a slow Guesty must not lose a note the call log already holds.
//
// The request fails only when the note landed nowhere.
import 'server-only'
import { getToken } from './guesty'
import { appendReservationNote } from './guesty-res-notes'
import { bustDay } from './bust'

export type CallKind = 'welcome' | 'post_checkout'
export const CALL_NOTE_LABEL: Record<CallKind, string> = { welcome: 'Welcome call note', post_checkout: 'Follow-up call note' }

export type CallNoteResult = {
  ok: boolean
  error?: string
  /** The call's own note after this write (guest_calls.note), '' when the call has no log yet. */
  callNote: string
  /** The reservation's notes in Guesty after this write, '' when Guesty did not take it. */
  notes: string
  /** Guesty holds the line. */
  noteSynced: boolean
  /** The call log holds the line. */
  loggedOnCall: boolean
  by: string
  at: string
}

/** The dated, signed line a note becomes on the call log: "[2026-10-21] Jon: arrives at 11pm". */
export function callNoteLine(note: string, by: string, at = new Date()): string {
  return `[${at.toISOString().slice(0, 10)}] ${by}: ${note}`
}

export async function addCallNote(sb: any, opts: { reservationId: string; kind: CallKind; note: string; by: string }): Promise<CallNoteResult> {
  const note = String(opts.note || '').trim().slice(0, 1000)
  const now = new Date()
  const at = now.toISOString()
  const base = { callNote: '', notes: '', noteSynced: false, loggedOnCall: false, by: opts.by, at }
  if (!note) return { ...base, ok: false, error: 'Type a note first.' }
  if (!opts.reservationId) return { ...base, ok: false, error: 'reservationId required' }

  const [{ data: res }, { data: lg }] = await Promise.all([
    sb.from('guesty_reservations').select('custom_fields, raw').eq('id', opts.reservationId).maybeSingle(),
    sb.from('guest_calls').select('note').eq('reservation_id', opts.reservationId).eq('kind', opts.kind).maybeSingle(),
  ])
  if (!res) return { ...base, ok: false, error: 'reservation not found' }

  // 1. The call's own record, when there is one. Appended, never replaced.
  let callNote = lg ? String((lg as any).note || '').trim() : ''
  let loggedOnCall = false
  if (lg) {
    const line = callNoteLine(note, opts.by, now)
    callNote = callNote ? callNote + '\n' + line : line
    const { error } = await sb.from('guest_calls').update({ note: callNote }).eq('reservation_id', opts.reservationId).eq('kind', opts.kind)
    loggedOnCall = !error
    if (error) callNote = lg ? String((lg as any).note || '') : ''
  }

  // 2. The booking in Guesty — best effort.
  let noteSynced = false
  let notes = ''
  try {
    const token = await getToken()
    if (token) {
      const raw: any = ((res as any).raw && typeof (res as any).raw === 'object') ? (res as any).raw : {}
      const current: any[] = Array.isArray((res as any).custom_fields) ? (res as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])
      const wr = await appendReservationNote({ reservationId: opts.reservationId, token, current, label: CALL_NOTE_LABEL[opts.kind], by: opts.by, note })
      noteSynced = wr.ok
      notes = wr.notes || ''
      if (wr.ok && wr.fields) {
        // Mirror BOTH copies: the column and raw.customFields are read as fallbacks of each other.
        try { await sb.from('guesty_reservations').update({ custom_fields: wr.fields, raw: { ...raw, customFields: wr.fields } }).eq('id', opts.reservationId) } catch { /* mirror best-effort */ }
      }
    }
  } catch { /* the call log is the record that matters when there is one */ }

  if (!loggedOnCall && !noteSynced) {
    return { ...base, ok: false, error: lg ? 'Could not save the note — try again in a moment.' : 'Guesty did not take the note and this call has no log yet (nobody has pressed a button on it). Try again in a moment.' }
  }
  // The Command Center reads call notes through its cached day.
  try { bustDay() } catch { /* cache only */ }
  return { ok: true, callNote, notes, noteSynced, loggedOnCall, by: opts.by, at }
}
