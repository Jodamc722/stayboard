// Writing a claim onto the reservation.
//
// Two surfaces, deliberately: the claim record itself is the app's truth, and a stamped one-line
// note goes into GUESTY's "Reservation Notes" custom field — the same field the vendor board and
// the comment box write to, so everything anyone has ever recorded about a booking is in one
// place. Six months later, when somebody is reconciling an owner statement in Guesty and wonders
// why $840 moved, the answer is on the booking rather than in a tool they do not open.
//
// SAFE WRITE: Guesty's PUT customFields REPLACES the whole array (this cost us Elser 4604's
// confirmation number on 2026-07-31). writeCustomFields reads the booking back from Guesty first,
// merges, and refuses to write when it cannot read. Never bypass it.
import 'server-only'
import { getToken } from '@/lib/guesty'
import { writeCustomFields } from '@/lib/guesty-custom-fields'

const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'

const fieldIdOf = (c: any): string | null => (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
function isNotesField(c: any): boolean {
  return String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))
}

export type NoteResult = { ok: boolean; error?: string }

/** Append one stamped line to the reservation's Guesty notes and mirror it locally. */
export async function appendReservationNote(db: any, reservationId: string, line: string): Promise<NoteResult> {
  if (!reservationId) return { ok: false, error: 'no reservation on this claim' }
  const { data: row } = await db.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).maybeSingle()
  if (!row) return { ok: false, error: 'reservation not in the mirror' }
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const cf: any[] = Array.isArray((row as any).custom_fields)
    ? (row as any).custom_fields
    : (Array.isArray(raw.customFields) ? raw.customFields : [])
  const existing = cf.find(x => isNotesField(x))
  const prior = existing && typeof existing.value === 'string' ? existing.value : ''
  // Idempotent-ish: the same line twice in a row is a double-click, not a second event.
  if (prior && prior.trim().endsWith(line.trim())) return { ok: true }
  const next = prior ? prior + '\n' + line : line
  const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD

  let token = ''
  try { token = await getToken() } catch { token = '' }
  if (!token) return { ok: false, error: 'no Guesty token' }
  const w = await writeCustomFields(reservationId, token, [{ fieldId: notesId, value: next }])
  if (!w.ok) return { ok: false, error: w.note || 'Guesty refused the write' }

  try {
    const arr = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields.slice() : []
    const idx = arr.findIndex((x: any) => isNotesField(x))
    if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], { value: next })
    else arr.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: next })
    await db.from('guesty_reservations').update({ custom_fields: arr, raw: Object.assign({}, raw, { customFields: arr }) }).eq('id', reservationId)
  } catch { /* the mirror catching up is best-effort; Guesty already has it */ }
  return { ok: true }
}
