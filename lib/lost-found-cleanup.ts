// LOST & FOUND CLEAN-UP (Jon, 2026-11-05: "clean up the lost and found page, have delete options, or
// close if not an applicable lost and found. Also if not collected or requested after 30 days toss").
//   • NOT_LF — a row that is not a lost-and-found item at all (a Slack post the reader misread,
//     a duplicate, a test). Closed, kept for the record.
//   • Delete — gone. A Slack-read row's post is remembered (setting lost_found_ignored_ts) so the
//     reader never brings it back, not even on "Re-read the last 10 days".
//   • autoToss — Held or Contacted 30+ days after the found date, with no pay request and nothing
//     paid → Discarded, with a history line that says why. Claimed / Sent are never touched: the
//     guest asked for it.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSettingFresh, setSetting } from './app-settings'

import { HOLD_DAYS, SHIPPED_CLOSE_DAYS, isValuable, holdDaysLeft, shippedAt, reopenedAfter } from './lost-found-rules'
export { HOLD_DAYS }
export const NOT_LF = 'not_lost_found'
const IGNORED_KEY = 'lost_found_ignored_ts'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const shift = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10) }

export async function ignoredSlackTs(): Promise<Set<string>> {
  try { const v = await getSettingFresh<string[]>(IGNORED_KEY, []); return new Set(Array.isArray(v) ? v.map(String) : []) } catch { return new Set() }
}
export async function ignoreSlackTs(ts: string[], by: string): Promise<void> {
  if (!ts.length) return
  try {
    const cur = await ignoredSlackTs()
    for (const t of ts) cur.add(String(t))
    await setSetting(IGNORED_KEY, Array.from(cur).slice(-3000), by)
  } catch { /* best effort */ }
}

/** Held / Contacted for HOLD_DAYS+ with nothing requested or paid → Discarded. Returns how many. */
export async function autoToss(): Promise<number> {
  const db = supabaseAdmin()
  const cutoff = shift(todayET(), -HOLD_DAYS)
  // Shipped items close themselves too — same pass, so the cron and the page both run it.
  try { await autoCloseShipped() } catch { /* next run */ }
  const today = todayET()
  const { data } = await db.from('lost_found_items').select('id,item,description,category,history,found_date,contacted_at,status,pay_requested_at,shipping_paid')
    .in('status', ['held', 'contacted']).lte('found_date', cutoff).limit(300)
  let n = 0
  for (const r of (data || []) as any[]) {
    if (r.pay_requested_at || r.shipping_paid) continue
    // VALUABLES ARE NEVER TOSSED BY THE CLOCK (2026-11-10): electronics, jewellery, documents, wallets,
    // IDs stay open and the page lists them under "Hold ended — needs a decision".
    if (isValuable(r)) continue
    // THE HOLD RUNS FROM THE LAST CONTACT, not the find (2026-11-10): a guest told on day 29 gets
    // their own 30 days. lib/lost-found-rules holdStart() is the one definition, shared with the page.
    if (holdDaysLeft(r, today) > 0) continue
    const history = Array.isArray(r.history) ? r.history.slice() : []
    // REOPENED BY A PERSON = their call (2026-11-09 audit): an item reopened after the hold ended was
    // discarded again on the very next page load. A reopen in the last HOLD_DAYS days keeps it open.
    const since = Date.now() - HOLD_DAYS * 86400000
    if (history.some((h: any) => h && h.what === 'status' && h.who !== 'Lighthouse' && /^(returned|donated|discarded|not_lost_found) → /.test(String(h.note || '')) && Date.parse(String(h.at)) > since)) continue
    history.push({ at: new Date().toISOString(), who: 'Lighthouse', what: 'status', note: r.status + ' → discarded: not collected or requested within ' + HOLD_DAYS + ' days of the find — toss it' })
    const { error } = await db.from('lost_found_items').update({ status: 'discarded', resolved_at: new Date().toISOString(), history, updated_at: new Date().toISOString() }).eq('id', r.id).in('status', ['held', 'contacted'])
    if (!error) n++
  }
  return n
}

/**
 * SHIPPED ITEMS CLOSE ON THEIR OWN (2026-11-10): 10 days after shipping, a Shipped item is closed as
 * returned to the guest. They used to sit in Open forever unless someone remembered to close them.
 * "Reopening holds": once a person reopens an item after it shipped, the clock leaves it alone.
 * Nothing is sent to the guest. Returns how many were closed.
 */
export async function autoCloseShipped(): Promise<number> {
  const db = supabaseAdmin()
  const { data } = await db.from('lost_found_items').select('id,status,sent_at,history,updated_at').eq('status', 'shipping').limit(300)
  const cutoff = Date.now() - SHIPPED_CLOSE_DAYS * 86400000
  let n = 0
  for (const r of (data || []) as any[]) {
    // No record of when it shipped (an old row marked Sent by hand): count from its last change.
    const at = shippedAt(r) || (r.updated_at ? String(r.updated_at) : null)
    if (!at) continue
    const t = Date.parse(at)
    if (isNaN(t) || t > cutoff) continue
    if (reopenedAfter(r, at)) continue
    const history = [...(Array.isArray(r.history) ? r.history : []), { at: new Date().toISOString(), who: 'Lighthouse', what: 'status', note: 'shipping → returned: Closed automatically ' + SHIPPED_CLOSE_DAYS + ' days after shipping' }].slice(-60)
    const { error } = await db.from('lost_found_items').update({ status: 'returned', resolved_at: new Date().toISOString(), history, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'shipping')
    if (!error) n++
  }
  return n
}
