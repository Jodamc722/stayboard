// THE DAILY CHECKLIST — what has to happen today, and by when.
//
// Jon, 2026-09-15: "a time-sensitive checklist that we build based on things that have to happen
// every single day."
//
// TIME-SENSITIVE IS THE POINT. A list of things to do is a list. A list that knows it is 11:15 and
// the 10:00 walk has not happened is an operating instrument, and the difference is entirely in
// what it does with the clock.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { BANDS, type Band, minutesOf, opsNow, isLate, progressOf, OPS_TZ } from './checklist-shared'
// Re-exported so callers import one module, while the pure time logic stays testable and shared
// with the browser (lib/checklist-shared).
export { BANDS, BAND_LABEL, minutesOf, clockLabel, opsNow, isLate, progressOf, type Band } from './checklist-shared'

export type ChecklistItem = {
  id: string; title: string; detail: string | null
  band: Band; by_time: string | null; owner_role: string | null
  /** In-app path the row links to, so an item points at the tab where the work happens. */
  link: string | null
  /** Name of a live count the app can answer for this item (lib/checklist-signals). */
  signal: string | null
  sort: number | null; active: boolean
}
export type ChecklistRow = ChecklistItem & {
  done: boolean; done_at: string | null; done_by: string | null; note: string | null
  /** Past its by_time, today, and still not done. The only state that needs acting on. */
  late: boolean
  /** Minutes until it is due; negative once it is late. Null when the item has no time. */
  in_minutes: number | null
}

/**
 * Today's list: the standing items, with today's ticks stamped on.
 *
 * FAIL-OPEN on a missing table, like every other late-arriving feature here — before migration 091
 * runs this is an empty checklist, not a broken tab.
 */
export async function todayList(at: Date = new Date()): Promise<{ day: string; clock: string; rows: ChecklistRow[] }> {
  const { day, minutes, clock } = opsNow(at)
  try {
    const sb = supabaseAdmin()
    const { data: items, error } = await sb.from('daily_checklist_items')
      .select('*').eq('active', true)
      .order('sort', { nullsFirst: false }).order('by_time', { nullsFirst: false }).limit(300)
    if (error || !items) return { day, clock, rows: [] }

    const ids = (items as any[]).map(i => String(i.id))
    const { data: ticks } = ids.length
      ? await sb.from('daily_checklist_ticks').select('item_id,done_at,done_by,note').eq('day', day).in('item_id', ids)
      : { data: [] as any[] }
    const byItem: Record<string, any> = {}
    for (const t of ((ticks || []) as any[])) byItem[String(t.item_id)] = t

    const rows: ChecklistRow[] = (items as any[]).map(i => {
      const tick = byItem[String(i.id)]
      const due = minutesOf(i.by_time)
      return {
        id: String(i.id), title: String(i.title || ''), detail: i.detail ?? null,
        band: (BANDS as readonly string[]).includes(i.band) ? i.band : 'morning',
        by_time: i.by_time ?? null, owner_role: i.owner_role ?? null,
        // Absent until the link/signal columns land; an older row is simply a row with no link.
        link: i.link ?? null, signal: i.signal ?? null,
        sort: i.sort == null ? null : Number(i.sort), active: i.active !== false,
        done: !!tick, done_at: tick?.done_at ?? null, done_by: tick?.done_by ?? null, note: tick?.note ?? null,
        late: isLate(i.by_time, !!tick, minutes),
        in_minutes: due == null ? null : due - minutes,
      }
    })
    return { day, clock, rows }
  } catch { return { day, clock, rows: [] } }
}

/**
 * Tick or untick one item for today.
 *
 * Anyone who can edit may tick anything (Jon, 2026-09-15: "Anyone, and it records who and when").
 * The point of a full-team checklist is that the work gets done when somebody is off, so gating a
 * tick to one person would recreate the exact problem the list exists to solve — while `done_by`
 * still records who actually did it.
 */
export async function setTick(itemId: string, done: boolean, who: string, note?: string, at: Date = new Date()) {
  const { day } = opsNow(at)
  const sb = supabaseAdmin()
  if (!done) {
    const { error } = await sb.from('daily_checklist_ticks').delete().eq('item_id', itemId).eq('day', day)
    return error ? { ok: false as const, error: error.message } : { ok: true as const }
  }
  const { error } = await sb.from('daily_checklist_ticks').upsert(
    { item_id: itemId, day, done_at: new Date().toISOString(), done_by: who, note: note || null },
    { onConflict: 'item_id,day' })
  if (error) {
    if (/relation|does not exist/i.test(error.message)) {
      return { ok: false as const, error: 'The checklist needs migration 091 — run it in Supabase and this will work.' }
    }
    return { ok: false as const, error: error.message }
  }
  return { ok: true as const }
}

/**
 * Jon chose "fresh list, nothing kept" — no history screen, no carry-over.
 *
 * A week of rows is still held rather than deleting on the stroke of midnight: a tick has to
 * survive the rest of the shift, and somebody closing out at 1am is still working yesterday.
 * Beyond that the rows are of no use to anybody and go. Best-effort — losing the tidy-up must
 * never cost somebody their tick.
 */
export async function pruneOldTicks(at: Date = new Date()): Promise<void> {
  try {
    const cutoff = new Date(at.getTime() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: OPS_TZ })
    await supabaseAdmin().from('daily_checklist_ticks').delete().lt('day', cutoff)
  } catch { /* the list does not depend on this */ }
}

