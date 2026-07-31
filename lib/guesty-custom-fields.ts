// SAFE CUSTOM-FIELD WRITES.
//
// THE BUG THIS EXISTS TO PREVENT — learned the hard way on 2026-07-31:
// Guesty's `PUT /reservations/{id}` with `{ customFields: [...] }` REPLACES the reservation's
// entire custom-field array. It does NOT merge. Sending one field therefore DELETES every other
// custom field on that booking. We proved it: writing the "email sent" flag and a note to Elser
// 4604 silently wiped that reservation's Elser Confirmation Number, while an untouched Elser
// booking still had its own.
//
// So every write goes through here. We READ the reservation back from Guesty first — not from our
// local mirror, which can be minutes stale or missing fields — merge our changes into whatever is
// actually there, and PUT the complete array back.
//
// If the read fails we DO NOT WRITE. A write built on a guess about what else is on the booking is
// exactly the thing that destroyed data the first time. Failing to record a note is recoverable;
// erasing a field nobody notices for a month is not.
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

/** Custom-field entries come back with fieldId as a string OR as a populated `{_id}` object. */
export function fieldIdOf(c: any): string | null {
  return (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
}

export type CustomFieldWrite = { fieldId: string; value: any }

export type WriteResult = {
  ok: boolean
  /** The full merged array as sent to Guesty — mirror this locally on success. */
  fields?: any[]
  note?: string
}

/**
 * Merge `updates` into the reservation's existing custom fields and write the whole set back.
 * Returns the merged array so callers can mirror it into guesty_reservations without re-reading.
 */
export async function writeCustomFields(
  reservationId: string,
  token: string,
  updates: CustomFieldWrite[],
): Promise<WriteResult> {
  if (!token) return { ok: false, note: 'no Guesty token' }
  if (!reservationId) return { ok: false, note: 'no reservation id' }
  if (!updates.length) return { ok: false, note: 'nothing to write' }

  // 1. What is actually on the booking right now, straight from Guesty.
  let existing: any[] = []
  try {
    const r = await fetch(
      BASE + '/reservations/' + encodeURIComponent(reservationId) + '?fields=customFields',
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } },
    )
    if (!r.ok) {
      return { ok: false, note: 'could not read the booking first (Guesty ' + r.status + '), so nothing was written' }
    }
    const j: any = await r.json().catch(() => null)
    if (!j || typeof j !== 'object') {
      return { ok: false, note: 'Guesty returned an unreadable booking, so nothing was written' }
    }
    existing = Array.isArray(j.customFields) ? j.customFields : []
  } catch (e: any) {
    return { ok: false, note: 'could not read the booking first (' + String(e?.message || e).slice(0, 80) + '), so nothing was written' }
  }

  // 2. Merge — every field that was there stays there, ours are upserted.
  const merged: any[] = existing.map((c) => ({ ...c }))
  for (const u of updates) {
    const i = merged.findIndex((c) => String(fieldIdOf(c) || '') === u.fieldId)
    if (i >= 0) merged[i] = { ...merged[i], value: u.value }
    else merged.push({ fieldId: u.fieldId, value: u.value })
  }

  // 3. Send the COMPLETE array, flattened to the {fieldId, value} shape the API accepts. A
  //    populated fieldId object here is rejected, so normalise every entry, not just ours.
  const payload = merged
    .map((c) => ({ fieldId: String(fieldIdOf(c) || ''), value: c.value }))
    .filter((c) => c.fieldId)

  try {
    const r = await fetch(BASE + '/reservations/' + encodeURIComponent(reservationId), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ customFields: payload }),
    })
    if (!r.ok) {
      return { ok: false, note: 'Guesty said ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 140) }
    }
    return { ok: true, fields: merged }
  } catch (e: any) {
    return { ok: false, note: String(e?.message || e).slice(0, 140) }
  }
}

/** Read one custom field's current value straight from Guesty. */
export async function readCustomFields(reservationId: string, token: string): Promise<any[] | null> {
  try {
    const r = await fetch(
      BASE + '/reservations/' + encodeURIComponent(reservationId) + '?fields=customFields',
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } },
    )
    if (!r.ok) return null
    const j: any = await r.json().catch(() => null)
    return Array.isArray(j?.customFields) ? j.customFields : []
  } catch { return null }
}
