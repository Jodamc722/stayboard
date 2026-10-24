// THE GUESTY CHECK-IN FORM (Jon, 2026-10-24: "it should scan check-in form and messages").
//
// Our guests are sent Guesty's Guest App check-in form (guest-app.guesty.com) — the texts and emails
// that chase "you have not signed your check-in form yet" point there. Guesty's Open API exposes the
// completed form as a SUMMARY FILE: GET /guest-app-api/guest-app-runtime/{reservationId}/module/
// check_in/summary → a link (valid one hour) and a filename; 404 = the guest has not completed it.
//
// So: a booking's form is checked and the answer remembered in app_settings `cif_state`
// ({ [reservationId]: { found, at, filename } }) — found once is found for good; not found is
// re-asked after a few hours. The link itself is never stored: viewing asks Guesty for a fresh one.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestyGet } from '@/lib/guesty'

// v2 (2026-10-24): v1 counted any answer as a completed form; only a summary FILE counts now.
export const CIF_KEY = 'cif_state_v2'
export const CIF_RECHECK_HOURS = 3
export type CifState = Record<string, { found: boolean; at: string; filename?: string | null; checkOut?: string | null }>

const str = (v: any) => (v == null ? '' : String(v))

export async function readCif(): Promise<CifState> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', CIF_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object') return o as CifState
  } catch { /* first run */ }
  return {}
}

async function writeCif(s: CifState): Promise<void> {
  const cutoff = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10)
  for (const [k, v] of Object.entries(s)) if (v?.checkOut && v.checkOut < cutoff) delete s[k]
  await supabaseAdmin().from('app_settings').upsert({ key: CIF_KEY, value: JSON.stringify(s), updated_by: 'guest-cif', updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

/** Ask Guesty for the completed form. found=false on a 404 (not completed); throws on anything else. */
export async function cifSummary(reservationId: string): Promise<{ found: boolean; url: string | null; filename: string | null; shape?: string }> {
  try {
    const v: any = await guestyGet('/guest-app-api/guest-app-runtime/' + encodeURIComponent(reservationId) + '/module/check_in/summary')
    const d = v?.data && typeof v.data === 'object' ? v.data : v
    const url = str(d?.url || d?.fileUrl || d?.link || d?.summaryUrl) || null
    // A completed form is a FILE. An answer with no link (an empty or unfinished form) is not one.
    const shape = d && typeof d === 'object' ? JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? (/^https?:/.test(v) ? '<url>' : v.slice(0, 60)) : typeof v]))).slice(0, 400) : typeof d
    return { found: !!url, url, filename: str(d?.filename || d?.fileName || d?.name) || null, shape }
  } catch (e: any) {
    if (/\b404\b|not ?found/i.test(String(e?.message || e))) return { found: false, url: null, filename: null }
    throw e
  }
}

/** Check up to `max` bookings' forms (skipping ones found, or asked recently) and remember the answers. */
export async function sweepCif(ids: { id: string; checkOut?: string | null }[], max = 10): Promise<{ checked: number; found: number; errors: number }> {
  const s = await readCif()
  const fresh = Date.now() - CIF_RECHECK_HOURS * 3600_000
  const todo = ids.filter(x => { const v = s[x.id]; return !v || (!v.found && Date.parse(v.at) < fresh) }).slice(0, max)
  let found = 0, errors = 0
  for (const x of todo) {
    try {
      const r = await cifSummary(x.id)
      s[x.id] = { found: r.found, at: new Date().toISOString(), filename: r.filename, checkOut: x.checkOut || null }
      if (r.found) found++
    } catch { errors++ }
  }
  if (todo.length) await writeCif(s)
  return { checked: todo.length - errors, found, errors }
}
