// RESOLVING A GUESTY RESERVATION CUSTOM FIELD BY NAME — one definition, several callers.
//
// This was the guest-order link's private helper until the parking permits needed the same thing:
// "write this URL onto that booking" is now two features, and two copies of a lookup that has its
// own failure modes is how one of them quietly stops finding a field the other still finds.
//
// TAKES A NAME **OR THE FIELD'S OWN ID**. Resolving by name needs the `guesty_custom_fields`
// mirror, and that mirror is filled from the account custom-fields endpoint — which has been empty
// before (the definitions are nested in the account payload) and on 2026-08-25 answered 429 Too
// Many Requests on every attempt, leaving a feature unable to find a field that plainly existed.
// An id pasted from Guesty skips all of it: no mirror, no lookup, no rate limit. Guesty ids are
// 24 hex characters.
//
// A RESERVATION-TARGET FIELD ALWAYS WINS. Both of these links belong on a BOOKING; a listing-level
// field with the same label would be written once and read by nobody.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { syncCustomFields } from './guesty'

const FIELD_ID_RE = /^[a-f0-9]{24}$/i

/** Keyed by the name asked for, because two callers ask for two different fields. */
const _cache = new Map<string, { id: string | null; at: number }>()
const TTL_MS = 10 * 60_000
/**
 * A MISS IS CACHED TOO, and that is the whole point of this shorter TTL.
 *
 * The original version stored nulls and then refused to honour them (`if (hit && fresh && hit.id)`),
 * so a name that resolves to nothing re-ran syncCustomFields() on EVERY call. Harmless while one
 * caller asked once per link; not harmless now that a retry batch asks twenty times an hour, which
 * fired twenty full account custom-field syncs against an API that has answered 429 — and painted
 * the custom-fields feed red on the health page every hour from a feature that was merely
 * misconfigured. A miss is remembered, briefly, so a field created in Guesty is still picked up
 * within a couple of minutes without anyone redeploying.
 */
const MISS_TTL_MS = 2 * 60_000

export async function guestyFieldId(name: string): Promise<string | null> {
  const direct = String(name || '').trim()
  if (!direct) return null
  if (FIELD_ID_RE.test(direct)) return direct

  const hit = _cache.get(direct)
  if (hit && Date.now() - hit.at < (hit.id ? TTL_MS : MISS_TTL_MS)) return hit.id

  const db = supabaseAdmin()
  // Match the LABEL or the MERGE-TAG SLUG, so both "Guest Order Form1" and the tag Jon actually
  // pastes into Guesty templates — {{guest_order_form1}} — find the same field.
  const bare = direct.replace(/^\{\{|\}\}$/g, '').trim()
  const find = async () => {
    const { data } = await db.from('guesty_custom_fields').select('id,name,slug,target').or(
      ['name.ilike.' + bare, 'slug.ilike.' + bare].join(','),
    ).limit(20)
    const rows = (data || []) as any[]
    const res = rows.find(r => /reserv/i.test(String(r.target || ''))) || rows[0]
    return res ? String(res.id) : null
  }
  let id = await find()
  if (!id) { try { await syncCustomFields() } catch { /* offline: stays null */ } id = await find() }
  _cache.set(direct, { id, at: Date.now() })
  return id
}

/**
 * The sentence a person can act on when the lookup comes back empty. Same advice, one place.
 *
 * `settingLabel` is the name of the box they have to type into, spelled the way their screen
 * spells it — "paste it into the setting" is advice nobody can follow.
 */
export function fieldIdHelp(name: string, settingLabel = 'Custom field name'): string {
  return 'Guesty reservation custom field "' + name + '" could not be resolved. Either it does not '
    + 'exist (Guesty > Settings > Custom fields > Reservation), or Guesty is rate-limiting the '
    + 'field list. Fastest fix: paste the field’s own ID (24 hex characters, from its URL in '
    + 'Guesty) into "' + settingLabel + '" — that skips the lookup entirely.'
}
