// GE LOG ENTRIES — the to-dos the office writes straight onto the log (Jon, 2026-10-22: "need a space
// to be able to add task to the GE log, where we can also create a breezeway task").
//
// Two kinds of line, one box:
//   · A LOG LINE — kept in Lighthouse only. "Call the building about the elevator", "Mirian to drop
//     keys at 906": real work for a person today that is not a Breezeway task and never will be.
//     The sheet carried these for years as free-typed rows; the app had nowhere to put them.
//   · A BREEZEWAY TASK — the same box with "Create in Breezeway" ticked goes through
//     /api/ops-today/add-task (templates, the unit brief, never-assign — every rule a task already
//     gets) and then shows on the log as the task it is. A log line can be sent to Breezeway later
//     too; it then carries the task id and stops drawing its own row.
//
// STORAGE: app_settings `ge_log_entries` = { [date]: Entry[] }. No table, so no hand-run migration;
// the volume is a handful of lines a day and anything older than 60 days is dropped on write.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const GE_ENTRIES_KEY = 'ge_log_entries'
const KEEP_DAYS = 60

export type GeEntry = {
  id: string
  title: string
  listingId: string | null
  unit: string
  hub: string
  person: string
  personId: number | null
  dept: string
  note: string
  done: boolean
  taskId: string | null
  by: string
  at: string
}
type Store = Record<string, GeEntry[]>

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

async function readStore(): Promise<Store> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', GE_ENTRIES_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object') return o as Store
  } catch { /* empty */ }
  return {}
}

async function writeStore(s: Store, by: string): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10)
  for (const d of Object.keys(s)) if (d < cutoff || !(s[d] || []).length) delete s[d]
  const { error } = await supabaseAdmin().from('app_settings').upsert(
    { key: GE_ENTRIES_KEY, value: JSON.stringify(s), updated_by: by || 'ge-log', updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

export async function entriesFor(date: string): Promise<GeEntry[]> {
  const s = await readStore()
  return Array.isArray(s[date]) ? s[date] : []
}

export function cleanEntry(b: any, by: string, prev?: GeEntry): GeEntry {
  const pick = (k: string, max: number) => (k in (b || {}) ? str(b[k]).trim().slice(0, max) : str((prev as any)?.[k]))
  const pid = 'personId' in (b || {}) ? Number(b.personId) : prev?.personId
  return {
    id: prev?.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    title: pick('title', 160),
    listingId: ('listingId' in (b || {}) ? str(b.listingId).trim() : str(prev?.listingId)) || null,
    unit: pick('unit', 120),
    hub: pick('hub', 60),
    person: pick('person', 80),
    personId: Number.isFinite(pid) && (pid as number) > 0 ? (pid as number) : null,
    dept: pick('dept', 30) || 'housekeeping',
    note: pick('note', 600),
    done: 'done' in (b || {}) ? b.done === true : !!prev?.done,
    taskId: ('taskId' in (b || {}) ? str(b.taskId).trim() : str(prev?.taskId)) || null,
    by: prev?.by || by,
    at: prev?.at || new Date().toISOString(),
  }
}

/** add | update | delete — returns the day's entries after the change. */
export async function changeEntries(date: string, op: 'add' | 'update' | 'delete', b: any, by: string): Promise<GeEntry[]> {
  const s = await readStore()
  const list = Array.isArray(s[date]) ? s[date].slice() : []
  if (op === 'add') {
    const e = cleanEntry(b, by)
    if (!e.title) throw new Error('Give it a title.')
    list.push(e)
  } else {
    const i = list.findIndex(x => x.id === str(b?.id))
    if (i < 0) throw new Error('That line is no longer on the log.')
    if (op === 'delete') list.splice(i, 1)
    else list[i] = cleanEntry(b, by, list[i])
  }
  s[date] = list
  await writeStore(s, by)
  return list
}
