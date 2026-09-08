// APPEND A DATED LINE TO A RESERVATION'S NOTES IN GUESTY.
//
// Pulled out of app/api/welcome-call/route.ts on 2026-09-08 so the post-checkout call can write the
// same way. Two rules the original established and this keeps:
//
//   1. APPEND, NEVER REPLACE. Prior notes are read first and the new line goes underneath. The
//      whole reason lib/guesty-custom-fields exists is that a write built on a guess wiped an Elser
//      confirmation number in July; a note that overwrites the last caller's note is the same bug
//      wearing a different hat.
//   2. The line says WHO and WHEN in plain text — "[2026-09-08] Post-checkout call by Roberto: no
//      issues, loved the unit" — because whoever reads it next is reading it in Guesty, without any
//      of Lighthouse's formatting around it.
import 'server-only'
import { writeCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const isNotes = (cf: any) => /reservation[_ ]?notes/i.test(String(cf?.fieldName || cf?.name || cf?.fieldId?.name || cf?.field?.name || ''))

/** The Reservation Notes custom-field id, from the account's field definitions. */
export async function notesDefId(token: string): Promise<string | null> {
  const urls = [
    `${BASE}/accounts/${process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'}/custom-fields?limit=200`,
    `${BASE}/custom-fields?limit=200`,
  ]
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      const w = (arr || []).find((d: any) => /reservation[_ ]?notes/i.test(String(d?.name || d?.fieldName || d?.displayName || d?.label || '')))
      if (w) return w._id || w.id || w.fieldId || null
    } catch { /* try the next shape */ }
  }
  return null
}

/**
 * Append one dated line to the reservation's notes.
 *
 * `current` is the reservation's custom-field array as we already hold it (so the caller does not
 * pay for a second read). Returns the merged field array Guesty now holds, for the local mirror.
 */
export async function appendReservationNote(opts: {
  reservationId: string
  token: string
  current: any[]
  label: string       // "Welcome call" | "Post-checkout call" | "Call note"
  by: string
  note?: string
}): Promise<{ ok: boolean; notes: string; fields: any[] | null; note?: string }> {
  const existing = (opts.current || []).find(isNotes)
  const notesId = existing ? fieldIdOf(existing) : await notesDefId(opts.token)
  if (!notesId) return { ok: false, notes: '', fields: null, note: 'Could not resolve the Reservation Notes custom field id in Guesty.' }
  const prior = existing && typeof existing.value === 'string' ? existing.value : ''
  const stamp = new Date().toISOString().slice(0, 10)
  const line = `[${stamp}] ${opts.label} by ${opts.by}${opts.note ? ': ' + opts.note : ''}`
  const newNotes = prior ? `${prior}\n${line}` : line
  const wr = await writeCustomFields(opts.reservationId, opts.token, [{ fieldId: notesId, value: newNotes }])
  if (!wr.ok) return { ok: false, notes: '', fields: null, note: String(wr.note || 'write failed') }
  return { ok: true, notes: newNotes, fields: Array.isArray(wr.fields) ? wr.fields : null }
}
