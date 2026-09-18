import { bzApi, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'

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
): Promise<{ ok: boolean; upserted: number; properties: number; total: number; done: boolean; reason?: string; sweepFrom?: number; sweepSize?: number }> {
  if (!breezewayConfigured()) return { ok: false, upserted: 0, properties: 0, total: 0, done: false, reason: 'not configured' }
  const db = supabaseAdmin()

  const { data: propRows } = await db
    .from('breezeway_properties')
    .select('home_id, reference_property_id, status')
    .not('reference_property_id', 'is', null)
  const active = ((propRows || []) as any[]).filter((p) => String(p.status || '').toLowerCase() === 'active')
  // Map EVERY property with a Guesty reference — not just 'active' ones. Some real, occupied units
  // (e.g. Oasis) carry a stale status flag here; skipping them meant their tasks never reached the
  // mirror, so the board showed assigned cleans as unassigned. The checkout window below already
  // bounds how many properties we refresh, so this stays cheap.
  const propByRef = new Map<string, any>()
  for (const p of ((propRows || []) as any[])) { if (p.reference_property_id != null) propByRef.set(String(p.reference_property_id), p) }

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

  // COVERAGE SWEEP.
  // The window above only touches units with a checkout in the next three weeks, so a unit that has
  // sat empty for months was NEVER refreshed. That is exactly the unit the day sheet is asked about
  // ("when was anyone last in here?"), and a mirror gap there reads as neglect. So after the urgent
  // properties, each run also sweeps the next slice of the whole portfolio, round-robin via a
  // cursor. 30 per run on a 30-minute cron covers all ~232 units roughly every 4 hours.
  const SWEEP = 40
  const windowed = new Set<string>()
  const all = (active.length ? active : Array.from(propByRef.values()))
    .slice()
    .sort((a, b) => String(a.home_id).localeCompare(String(b.home_id)))
  let cursor = 0
  if (all.length) {
    cursor = Number(await getSetting<number>('breezeway_sweep_cursor', 0)) || 0
    if (!Number.isFinite(cursor) || cursor < 0 || cursor >= all.length) cursor = 0
    const inOrder = new Set(ordered.map((p: any) => String(p.home_id)))
    for (let n = 0; n < ordered.length; n++) windowed.add(String(ordered[n].home_id))
    for (let n = 0; n < SWEEP; n++) {
      const p = all[(cursor + n) % all.length]
      if (p && !inOrder.has(String(p.home_id))) { ordered.push(p); inOrder.add(String(p.home_id)) }
    }
    // Advance the cursor up front: a run that dies half way should still move on rather than
    // re-sweeping the same slice forever.
    try { await setSetting('breezeway_sweep_cursor', (cursor + SWEEP) % all.length, 'cron') } catch {}
  }

  // SCOPED PULL (2026-09-18). Every 30 minutes this fetched and upserted the ENTIRE task history of
  // every property with a checkout in the window — up to 500 rows a property, almost all of them
  // finished months ago and unchanged. That was the largest single source of Supabase writes. The
  // window properties now pull scheduled_date −60d..+60d (everything a board, the PM ledger or the
  // labor week reads live); older rows stay in the mirror from when they were first pulled. The
  // sweep slice still pulls a property's whole history, so an unscheduled task or a very old row
  // is refreshed within ~3 hours instead of never.
  const dISO = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
  const scopedRange = `&scheduled_date=${dISO(-60)},${dISO(60)}`
  const started = Date.now()
  let i = 0
  let upserted = 0
  for (; i < ordered.length; i++) {
    if (Date.now() - started > budgetMs) break
    const p: any = ordered[i]
    let r: any
    try {
      const scoped = windowed.has(String(p.home_id))
      r = await bzApi('/task/?home_id=' + encodeURIComponent(String(p.home_id)) + (scoped ? scopedRange : '') + '&limit=500')
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
  return { ok: true, upserted, properties: i, total: ordered.length, done: i >= ordered.length, sweepFrom: cursor, sweepSize: SWEEP }
}
