// Mark a reservation Sensitive in Guesty (the boolean box) and add a dated line to its notes.
//
// 2026-09-30: this used to send a bare `PUT { customFields: [Sensitive, Notes] }` — the call that
// REPLACES a booking's whole custom-field array — with the string 'Yes' into a BOOLEAN field and the
// notes appended to our mirror's (possibly stale) copy. It now goes through lib/guest-mood, which
// reads the live array, merges, and writes. Kept as a thin wrapper so existing callers still work.
import 'server-only'
import { writeGuestMood } from './guest-mood'

export type MarkResult = { ok: boolean; alreadySet?: boolean; error?: string; fieldId?: string | null }

export async function markReservationSensitive(reservationId: string, reason?: string): Promise<MarkResult> {
  if (!reservationId) return { ok: false, error: 'no reservationId' }
  const w = await writeGuestMood(reservationId, 'sensitive', reason || null)
  return w.ok ? { ok: true } : { ok: false, error: w.note }
}
