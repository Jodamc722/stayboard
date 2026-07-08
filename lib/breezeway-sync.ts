import { bzApi, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Mirror refresh for breezeway_tasks_sync. Pulls each active property's Breezeway
// tasks (including assignees) and upserts them, so the scheduler shows current
// assignments without waiting on a webhook. Loops to completion within a time
// budget; never throws. Mirrors the logic in /api/sync/breezeway?sync=tasks.

function asArray(d: any): any[] {
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.data)) return d.data
  return []
}

export async function syncBreezewayTasks(
  budgetMs = 200000
): Promise<{ ok: boolean; upserted: number; properties: number; total: number; done: boolean; reason?: string }> {
  if (!breezewayConfigured()) return { ok: false, upserted: 0, properties: 0, total: 0, done: false, reason: 'not configured' }
  const db = supabaseAdmin()
  const { data: props } = await db
    .from('breezeway_properties')
    .select('home_id, reference_property_id, name, status')
    .not('reference_property_id', 'is', null)
    .order('home_id')
  const active = ((props || []) as any[]).filter((p) => String(p.status || '').toLowerCase() === 'active')
  const started = Date.now()
  let i = 0
  let upserted = 0
  for (; i < active.length; i++) {
    if (Date.now() - started > budgetMs) break
    const p: any = active[i]
    let r: any
    try {
      r = await bzApi('task?home_id=' + encodeURIComponent(String(p.home_id)) + '&limit=100')
    } catch {
      continue
    }
    if (!r?.ok) continue
    const arr = asArray(r.data)
    if (!arr.length) continue
    const now = new Date().toISOString()
    const rows = arr
      .map(mapBreezewayTask)
      .filter((t: any) => t?.id)
      .map((t: any) => {
        const rp = parseFloat(String(t.rate_paid ?? '').replace(/[^0-9.]/g, ''))
        return {
          ...t,
          rate_paid: Number.isFinite(rp) ? rp : null,
          home_id: p.home_id,
          reference_property_id: p.reference_property_id,
          synced_at: now,
        }
      })
    if (!rows.length) continue
    try {
      const { error } = await db.from('breezeway_tasks_sync').upsert(rows, { onConflict: 'id' })
      if (!error) upserted += rows.length
    } catch {
      // keep going; a single property failure should not abort the whole refresh
    }
  }
  return { ok: true, upserted, properties: i, total: active.length, done: i >= active.length }
}
