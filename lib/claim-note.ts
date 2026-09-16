// Writing a claim onto the reservation.
//
// Two surfaces, deliberately: the claim record itself is the app's truth, and a stamped one-line
// note goes into GUESTY's "Reservation Notes" custom field — the same field the vendor board and
// the comment box write to, so everything anyone has ever recorded about a booking is in one
// place. Six months later, when somebody is reconciling an owner statement in Guesty and wonders
// why $840 moved, the answer is on the booking rather than in a tool they do not open.
//
// SAFE WRITE, PART ONE: Guesty's PUT customFields REPLACES the whole array (this cost us Elser
// 4604's confirmation number on 2026-07-31). writeCustomFields reads the booking back from Guesty
// first, merges, and refuses to write when it cannot read. Never bypass it.
//
// SAFE WRITE, PART TWO (Jon, 2026-09-16: "when we push either way it should not delete exsiting
// notes"). Part one protects every OTHER custom field. It does not protect the notes field itself,
// because whatever value we hand it is written verbatim — and this function used to take `prior`
// from the LOCAL MIRROR. That is a clobber with a timer on it:
//
//   10:00  somebody types a note directly into Guesty
//   10:01  the app appends a line, reading `prior` from a mirror that has not synced yet
//   10:01  the PUT lands — and the 10:00 note is gone, silently, with no error anywhere
//
// So the prior value is now read from GUESTY, immediately before the append, and if that read
// fails nothing is written at all. The rule, stated once:
//
//   GUESTY IS THE SYSTEM OF RECORD FOR RESERVATION NOTES. The app only ever APPENDS to what is
//   already there, having just looked. It never replaces, and it never writes blind.
import 'server-only'
import { getToken } from '@/lib/guesty'
import { writeCustomFields, readCustomFields } from '@/lib/guesty-custom-fields'

const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'

const fieldIdOf = (c: any): string | null => (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
function isNotesField(c: any): boolean {
  return String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))
}

export type NoteResult = { ok: boolean; error?: string }

/** Append one stamped line to the reservation's Guesty notes and mirror it locally. */
export async function appendReservationNote(db: any, reservationId: string, line: string): Promise<NoteResult> {
  if (!reservationId) return { ok: false, error: 'no reservation on this claim' }

  let token = ''
  try { token = await getToken() } catch { token = '' }
  if (!token) return { ok: false, error: 'no Guesty token' }

  // WHAT IS ON THE BOOKING RIGHT NOW — from Guesty, not from our copy of it. If this read fails we
  // write nothing: appending to a value we could not confirm is how a note typed by a person five
  // minutes ago disappears.
  const live = await readCustomFields(reservationId, token)
  if (!live) return { ok: false, error: 'could not read the booking first, so nothing was written' }

  const existing = live.find(x => isNotesField(x))
  const prior = existing && typeof existing.value === 'string' ? existing.value : ''
  // Idempotent-ish: the same line twice in a row is a double-click, not a second event. Checked
  // against Guesty's value, so a retry after a timeout does not double-post either.
  if (prior && prior.trim().endsWith(line.trim())) return { ok: true }
  const next = prior ? prior + '\n' + line : line
  const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD

  const w = await writeCustomFields(reservationId, token, [{ fieldId: notesId, value: next }])
  if (!w.ok) return { ok: false, error: w.note || 'Guesty refused the write' }

  // PULL THE OTHER WAY, FOR FREE. writeCustomFields hands back the merged array it actually sent,
  // which includes anything written in Guesty since our last sync. Storing that is the Guesty → app
  // direction done at the only moment we are certain what Guesty holds.
  try {
    const arr = Array.isArray(w.fields) ? w.fields : []
    if (arr.length) {
      const { data: row } = await db.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle()
      const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
      await db.from('guesty_reservations')
        .update({ custom_fields: arr, raw: Object.assign({}, raw, { customFields: arr }) })
        .eq('id', reservationId)
    }
  } catch { /* the mirror catching up is best-effort; Guesty already has it */ }
  return { ok: true }
}
