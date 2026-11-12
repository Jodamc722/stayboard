// WHERE "HANDLED / SNOOZED / MINE" LIVES (inbox audit, 2026-11-09).
//
// The guest inbox had no state of its own: a thread was waiting or it was not, for everyone, and
// the only way to clear a guest's closing "thanks!" from Needs reply was to answer it or wait 72
// hours. Two agents working the queue could not see who had which thread.
//
// One small shared map (lib/inbox-queue ThreadState) in app_settings under `inbox_thread_state` —
// no migration, and at the inbox's size (dozens of waiting threads, a handful of marks a day) a
// table buys nothing yet. Every change is read-fresh → modify → write (getSettingFresh, the same
// read-modify-write rule the A/C settings learned on 2026-11-02), entries untouched for 14 days are
// dropped, and the map is capped. If this grows past a few hundred live marks, the table in the
// audit report's SQL proposal replaces it without touching the callers.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'
import type { InboxStateMap, ThreadState } from './inbox-queue'

const KEY = 'inbox_thread_state'
const KEEP_MS = 14 * 86400_000
const ARCHIVE_KEEP_MS = 60 * 86400_000
const MAX_ENTRIES = 1500

type Stored = { threads?: InboxStateMap }

function prune(map: InboxStateMap, now: number): InboxStateMap {
  const live = Object.keys(map).filter(k => {
    const s = map[k]
    const t = Date.parse(String(s?.at || ''))
    if (!Number.isFinite(t) || now - t > (s.archived ? ARCHIVE_KEEP_MS : KEEP_MS)) return false
    return !!(s.done || s.snoozeUntil || s.assignee || s.archived)
  })
  // Newest first, so the cap drops the oldest marks.
  live.sort((a, b) => String(map[b].at).localeCompare(String(map[a].at)))
  const out: InboxStateMap = {}
  for (const k of live.slice(0, MAX_ENTRIES)) out[k] = map[k]
  return out
}

/** Every live mark. Never throws: an unreadable store is an empty one (the queue then shows everything). */
export async function readInboxState(): Promise<InboxStateMap> {
  const v = await getSettingFresh<Stored>(KEY, {}).catch(() => ({} as Stored))
  const map = v && typeof v === 'object' && v.threads && typeof v.threads === 'object' ? v.threads : {}
  return prune(map, Date.now())
}

/** Change one thread's mark. `change` gets the current mark (or a blank one) and returns the new one. */
export async function updateThreadState(key: string, by: string, change: (cur: ThreadState) => ThreadState): Promise<{ ok: boolean; state?: ThreadState | null; error?: string }> {
  const k = String(key || '').trim()
  if (!/^(g|p):.{1,80}$/.test(k)) return { ok: false, error: 'Which thread?' }
  const now = Date.now()
  const map = await readInboxState()
  const next = change({ ...(map[k] || { at: new Date(now).toISOString() }) })
  next.at = new Date(now).toISOString()
  if (next.done || next.snoozeUntil || next.assignee) map[k] = next
  else delete map[k]
  const w = await setSetting(KEY, { threads: prune(map, now) }, by)
  if (!w.ok) return { ok: false, error: w.error || 'Could not save that.' }
  return { ok: true, state: map[k] || null }
}
