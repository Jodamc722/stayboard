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
import { guestyFetch } from '@/lib/guesty-retry'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const isNotes = (cf: any) => /reservation[_ ]?notes/i.test(String(cf?.fieldName || cf?.name || cf?.fieldId?.name || cf?.field?.name || ''))

// THE DEFINITION ID DOES NOT CHANGE BETWEEN CLICKS (2026-09-17).
//
// Silvia: "when I click 'reached', it just sits there thinking for a moment and doesn't update. It
// also wouldn't let me save the notes." Both paths run this, and a reservation that has never had a
// note has no notes field on it — so every single press asked Guesty for the account's whole
// custom-field list (200 definitions) before it could write anything, on top of a token call, a
// reservation read and the write itself. That is a lot of sequential latency to hang a button on.
//
// The account's field definitions are configuration, not data. Held for ten minutes per instance:
// long enough to take this off the click path, short enough that adding a field in Guesty shows up
// without a deploy. A miss simply costs what it always cost.
let CACHED: { id: string | null; at: number } | null = null
const DEF_TTL = 10 * 60_000

/** The Reservation Notes custom-field id, from the account's field definitions. */
export async function notesDefId(token: string): Promise<string | null> {
  if (CACHED && CACHED.id && Date.now() - CACHED.at < DEF_TTL) return CACHED.id
  const urls = [
    `${BASE}/accounts/${process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'}/custom-fields?limit=200`,
    `${BASE}/custom-fields?limit=200`,
  ]
  for (const u of urls) {
    try {
      // Same treatment: the definitions endpoint is exactly the one that 429s under load.
      const r = await guestyFetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      const w = (arr || []).find((d: any) => /reservation[_ ]?notes/i.test(String(d?.name || d?.fieldName || d?.displayName || d?.label || '')))
      if (w) {
        const id = w._id || w.id || w.fieldId || null
        // Only a HIT is cached. Caching a miss would pin a broken lookup for ten minutes across
        // every call the desk makes, which is worse than paying for the retry.
        if (id) CACHED = { id, at: Date.now() }
        return id
      }
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
