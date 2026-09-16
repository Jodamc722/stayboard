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
