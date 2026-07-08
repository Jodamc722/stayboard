import { bzApi, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Mirror refresh for breezeway_tasks_sync. Pulls each relevant property's Breezeway
// tasks (including assignees) and upserts them, so the scheduler shows current
// assignments without waiting on a webhook. Never throws.
//
// Reliability: a full pull of all ~235 properties can exceed one serverless
// invocation, so we (a) scope to properties that have a Guesty checkout in the
// visible window and (b) process them SOONEST-CHECKOUT-FIRST. That guarantees
// today's and tomorrow's cleans always get fresh assignees first, even if the
// run is time-boxed before reaching every property.

function asArray(d: any): any[] {
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.data)) return d.data
  return []
}
function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function syncBreezewayTasks(
  budgetMs = 250000
): Promise<{ ok: boolean; upserted: number; properties: number; total: number; done: boolean; reason?: string }> {
  if (!breezewayConfigured()) return { ok: false, upserted: 0, properties: 0, total: 0, done: false, reason: 'not configured' }
  const db = supabaseAdmin()

  const { data: propRows } = await db
    .from('breezeway_properties')
    .select('home_id, reference_property_id, status')
    .not('reference_property_id', 'is', null)
  const active = ((propRows || []) as any[]).filter((p) => String(p.status || '').toLowerCase() === 'active')
  const propByRef = new Map<string, any>()
  for (const p of active) propByRef.set(String(p.reference_property_id), p)

  // Properties with a checkout in the visible window, ordered soonest-first.
  const today = etToday()
  const from = addDays(today, -1)
  const to = addDays(today, 21)
  const { data: deps } = await db
    .from('guesty_reservations')
    .select('listing_id, check_out')
    .gte('check_out', from)
    .lte('check_out', to)
    .order('check_out', { ascending: true })
    .limit(5000)

  // Sort deps so TODAY and forward come first (ascending), then recent past last.
  const depsSorted = ((deps || []) as any[]).slice().sort((a, b) => {
    const ax = String(a.check_out || ''), bx = String(b.check_out || '')
    const aPast = ax < today ? 1 : 0, bPast = bx < today ? 1 : 0
    if (aPast !== bPast) return aPast - bPast
    return ax < bx ? -1 : ax > bx ? 1 : 0
  })
  const seen = new Set<string>()
  let ordered: any[] = []
  for (const d of depsSorted) {
    const k = String(d.listing_id || '')
    if (!k || seen.has(k)) continue
    seen.add(k)
    const p = propByRef.get(k)
    if (p) ordered.push(p)
  }
  // Fallback: if we somehow found none, refresh everything.
  if (!ordered.length) ordered = active

  const started = Date.now()
  let i = 0
  let upserted = 0
  for (; i < ordered.length; i++) {
    if (Date.now() - started > budgetMs) break
    const p: any = ordered[i]
    let r: any
    try {
      r = await bzApi('/task/?home_id=' + encodeURIComponent(String(p.home_id)) + '&limit=100')
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
  return { ok: true, upserted, properties: i, total: ordered.length, done: i >= ordered.length }
}
