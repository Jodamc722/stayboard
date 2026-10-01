// WHAT THE APP ALREADY KNOWS ABOUT A CHECKLIST ITEM.
//
// Jon, 2026-09-16: "Have part of the checklist eve questions" — and, the day before: "the checklist
// should interact with the app. If there are glitches or claims, you could click on it, and it'll
// push you to the tab with the glitches and claims to be managed."
//
// THE PROBLEM WITH A PLAIN CHECKBOX. "Walk the open glitches" is a promise with no subject. At 9am
// nobody knows whether that means four glitches or none, so the honest answer is to open the tab
// and look — which is exactly the friction that gets an item ticked without being done. Half the
// items on this list are ABOUT something the app can already count.
//
// So an item may name a `signal`. The list then carries a live number next to it and a `link` to
// the tab where the work actually happens. "Answer one of Eve's questions · 45 waiting → Command
// Center" is a different instruction from a checkbox with the same words on it.
//
// WHAT A SIGNAL IS NOT. It does not tick the item. A count is evidence, not completion — "0 open
// glitches" does not mean anybody looked, and a checklist that ticks itself is a checklist that
// stops being read. The person still ticks; the number just means they tick it knowing something.
//
// ADDING ONE is a row in this file and no migration: items store the key as text, and a key with
// no entry here simply shows no number. That is the point of the indirection — the standing list
// is edited by a manager in the browser, and it must not be possible to break the page by typing
// a word this file has never heard of.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { countOpenQuestions } from './eve/questions'
import { SIGNAL_META } from './checklist-shared'
export { SIGNAL_META, SIGNAL_KEYS, signalLabel, signalLink, type SignalMeta } from './checklist-shared'

/** How each signal gets its number. The link and the wording live in lib/checklist-shared. */
const COUNTERS: Record<string, () => Promise<number | null>> = {
  eve_questions: async () => { try { return await countOpenQuestions() } catch { return null } },
  open_glitches: () => headCount(sb => sb.from('glitches')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', '("done","resolved","closed")')),
  unpaid_due: async () => { try { const { countUnpaidDue } = await import('./unpaid'); return await countUnpaidDue() } catch { return null } },
  arrivals_today: () => arrivals(0),
  tomorrow_arrivals: () => arrivals(1),
  cleans_open_today: async () => (await cleans(0)).filter(c => !c.done).length,
  cleans_not_started_today: async () => (await cleans(0)).filter(c => !c.done && !c.started).length,
  cleans_unassigned_today: async () => (await cleans(0)).filter(c => !c.done && !c.who).length,
  same_day_turns_open: async () => { const [cs, arr] = await Promise.all([cleans(0), arrivalSet(0)]); return cs.filter(c => !c.done && arr.has(c.listingId)).length },
  inspections_open_today: async () => (await tasksOn(0)).filter(t => /inspect|unit check|quality/i.test(t.name) && !t.done).length,
  tomorrow_cleans_unassigned: async () => (await cleans(1)).filter(c => !c.done && !c.who).length,
  overdue_tasks: async () => { const d = dayET(0); try { const { count } = await db().from('breezeway_tasks_sync').select('id', { count: 'exact', head: true }).lt('scheduled_date', d).is('finished_at', null).not('status', 'in', '("completed","Completed","closed","Closed","cancelled","Cancelled","finished","Finished")'); return Number(count || 0) } catch { return null } },
  welcome_calls_owed: async () => {
    try {
      const { loadCallsDesk } = await import('./call-desk')
      const today = dayET(0)
      const d = await loadCallsDesk(db(), today)
      return d.rows.filter(r => r.due && !r.closed && !r.done && r.check_in === today).length
    } catch { return null }
  },
}

// ── the small reads behind the counters ─────────────────────────────────────────────────────────
const dayET = (offset: number) => { const d = new Date(Date.now() + offset * 86400_000); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) }
const DONE = /complet|finish|close|approv|done/i
type T = { name: string; listingId: string; done: boolean; started: boolean; who: boolean }
const tasksMemo: Record<string, { at: number; p: Promise<T[]> }> = {}
async function tasksOn(offset: number): Promise<T[]> {
  const day = dayET(offset)
  const hit = tasksMemo[day]
  if (hit && Date.now() - hit.at < 20_000) return hit.p     // one read per request burst, not one per signal
  const p = (async () => {
    try {
      const { data } = await db().from('breezeway_tasks_sync').select('name,status,finished_at,started_at,assignees,reference_property_id').eq('scheduled_date', day).limit(2000)
      return ((data || []) as any[]).filter(t => !/cancel|delet|void/i.test(String(t.status || ''))).map(t => ({
        name: String(t.name || ''), listingId: String(t.reference_property_id || ''),
        done: !!t.finished_at || DONE.test(String(t.status || '')), started: !!t.started_at || /progress|started/i.test(String(t.status || '')),
        who: Array.isArray(t.assignees) ? t.assignees.length > 0 : false,
      }))
    } catch { return [] }
  })()
  tasksMemo[day] = { at: Date.now(), p }
  return p
}
async function cleans(offset: number): Promise<T[]> {
  const { isDepartureCleanName } = await import('./breezeway')
  return (await tasksOn(offset)).filter(t => isDepartureCleanName(t.name))
}
async function arrivalSet(offset: number): Promise<Set<string>> {
  const day = dayET(offset)
  try {
    const { data } = await db().from('guesty_reservations').select('listing_id,status').gte('check_in', day).lt('check_in', dayET(offset + 1)).limit(500)
    return new Set(((data || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(String(r.status || ''))).map(r => String(r.listing_id)))
  } catch { return new Set() }
}
async function arrivals(offset: number): Promise<number | null> {
  const day = dayET(offset)
  try {
    const { data } = await db().from('guesty_reservations').select('id,status').gte('check_in', day).lt('check_in', dayET(offset + 1)).limit(500)
    return ((data || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(String(r.status || ''))).length
  } catch { return null }
}

const db = () => supabaseAdmin()

/** Head-count only: PostgREST returns the number and no rows. */
async function headCount(build: (q: any) => any): Promise<number | null> {
  try {
    const { count, error } = await build(db())
    if (error) return null
    return Number(count || 0)
  } catch { return null }
}

/**
 * The counts for the signals this list actually names — nothing else. A checklist with two
 * signalled items must not pay for every counter this file will ever grow.
 */
export async function countSignals(keys: string[]): Promise<Record<string, number | null>> {
  const wanted = keys.filter((k, i) => k && COUNTERS[k] && SIGNAL_META[k] && keys.indexOf(k) === i)
  if (!wanted.length) return {}
  const counts = await Promise.all(wanted.map(k => COUNTERS[k]().catch(() => null)))
  const out: Record<string, number | null> = {}
  wanted.forEach((k, i) => { out[k] = counts[i] })
  return out
}
