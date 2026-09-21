// SOFT-BLOCK A TURNOVER CLEAN — the internals of /api/schedule/block, lifted out so Eve's
// calendar_block executor (lib/eve/executors.ts) and the route share one implementation.
//
// "Block" moves a departure clean to the NEXT day: a schedule_blocks row makes the board show it,
// and best-effort the Breezeway departure task moves its scheduled_date and gets a [MOVED -> date]
// note prepended. The task is never deleted. 'unblock' reverses both halves.
import 'server-only'
import { revalidateTag } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'

export type BlockAction = 'block' | 'unblock'
export type BlockResult = {
  ok: boolean; error?: string; action: BlockAction; listingId: string; origDate: string; blockedUntil: string | null
  breezeway: { attempted: boolean; ok?: boolean; taskId?: string; note?: string; error?: string }
}

function addDays(d: string, n: number) {
  const dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

export async function applyScheduleBlock(opts: { listingId: string; date: string; action: BlockAction; by: string }): Promise<BlockResult> {
  const listingId = String(opts.listingId || '').trim()
  const date = String(opts.date || '').slice(0, 10)
  const action: BlockAction = opts.action === 'unblock' ? 'unblock' : 'block'
  const nextDay = addDays(date, 1)
  const base: BlockResult = { ok: false, action, listingId, origDate: date, blockedUntil: action === 'block' ? nextDay : null, breezeway: { attempted: false } }
  if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ...base, error: 'missing listingId/date' }

  const db = supabaseAdmin()
  try {
    if (action === 'block') {
      const up = await db.from('schedule_blocks').upsert({ listing_id: listingId, orig_date: date, blocked_until: nextDay, created_by: opts.by, created_at: new Date().toISOString() }, { onConflict: 'listing_id,orig_date' })
      if (up.error) return { ...base, error: `Save failed: ${up.error.message} (Run the schedule_blocks SQL in Supabase first.)` }
    } else {
      const del = await db.from('schedule_blocks').delete().eq('listing_id', listingId).eq('orig_date', date)
      if (del.error) return { ...base, error: `Save failed: ${del.error.message}` }
    }
  } catch (e: any) {
    return { ...base, error: `Save failed: ${String(e?.message || e)} (Run the schedule_blocks SQL in Supabase first.)` }
  }

  // Best-effort: reflect the move on the Breezeway departure task (soft-block; never delete it).
  const breezeway: BlockResult['breezeway'] = { attempted: false }
  if (breezewayConfigured()) {
    breezeway.attempted = true; breezeway.ok = false
    try {
      const findDate = action === 'block' ? date : nextDay
      const tasks = await listPropertyHousekeeping(listingId, date, nextDay)
      const clean = pickDepartureClean(tasks, findDate)
      if (clean && clean.id) {
        let desc = ''
        try { const t = await retrieveBreezewayTask(clean.id); desc = String(t?.data?.description || '') } catch { /* no description */ }
        if (action === 'block') {
          const marker = `[MOVED -> ${nextDay}] `
          const newDesc = /^\[MOVED/.test(desc) ? desc : marker + desc
          const r = await updateBreezewayTask(clean.id, { name: clean.name || 'Clean', scheduled_date: nextDay, description: newDesc.slice(0, 1500) })
          breezeway.ok = r.ok; breezeway.taskId = clean.id
        } else {
          const cleaned = desc.replace(/^\[MOVED[^\]]*\]\s*/, '')
          const r = await updateBreezewayTask(clean.id, { name: clean.name || 'Clean', scheduled_date: date, description: cleaned.slice(0, 1500) })
          breezeway.ok = r.ok; breezeway.taskId = clean.id
        }
      } else { breezeway.note = 'no departure clean found for that date' }
    } catch (e: any) { breezeway.error = String(e?.message || e).slice(0, 140) }
  }

  try { revalidateTag('schedule') } catch { /* outside a request context */ }
  return { ...base, ok: true, breezeway }
}
