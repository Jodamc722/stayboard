// WORK THAT WAS DONE TWICE, AND WORK THAT SHOULD NEVER HAVE BEEN CREATED.
//
// Jon, 2026-08-31: "scan for duplicate tasks, meaning the same task completed twice, maybe created
// two different ways. There should be an audit of that." And: "that should be run before moving the
// task forward."
//
// Those two sentences are one feature. A duplicate is not interesting as a statistic — it is
// interesting because it is about to happen AGAIN. The trip sweep drags pending work onto today's
// visit; if the thing it is dragging was already completed last Tuesday through a different route,
// the tech walks into a unit to redo a job that is done. The audit exists to stop that, and the
// report is the by-product.
//
// ── WHAT COUNTS AS A DUPLICATE (Jon chose this) ────────────────────────────────────────────────
// Same unit, same day, both completed. That is deliberately the tight definition rather than the
// wide one. Two cleans on one unit on one date is almost never legitimate; two cleans in the same
// week often is (a departure and a mid-stay touch-up). A duplicate audit that cries wolf gets
// ignored by the second week, and an ignored audit is worse than none because it launders the
// problem into "we have a report for that".
//
// ── WHY TASKS GET CREATED TWICE ────────────────────────────────────────────────────────────────
// Not carelessness. Two systems both being right: the calendar sync creates a departure clean from
// the reservation, and a supervisor creates one by hand because the sync had not run yet. Both are
// reasonable acts. Nobody is at fault, which is exactly why nobody catches it.
import { supabaseAdmin } from './supabase-admin'
import { completeBreezewayTask, breezewayConfigured } from './breezeway'
import { deptOf } from './pending-work'

const str = (v: any) => String(v ?? '').trim()
const dOf = (v: any) => (v ? String(v).slice(0, 10) : '')
const DONE = /\b(complete|finish|close|approv)/i
const GONE = /\b(cancel|delet|void)/i

/** Lighthouse says so on the task itself. Provenance lives in the description, not in a column. */
export const LIGHTHOUSE_MARK = /lighthouse/i

/**
 * The comparison key. Names drift wildly between the sync and whatever a supervisor types, so the
 * NAME is not the key — the category is. "Departure Clean", "departure clean 305", "DEP CLEAN" and
 * "Turnover" all have to collapse to the same thing or the audit finds nothing.
 */
export function auditKey(name: string, department: any): string {
  const n = str(name).toLowerCase()
  if (/departure|turnover|check ?out clean/.test(n)) return 'departure-clean'
  if (/deep clean/.test(n)) return 'deep-clean'
  if (/mid[- ]?stay|touch ?up|refresh/.test(n)) return 'midstay'
  if (/inspect/.test(n)) return 'inspection'
  if (/linen|towel|restock|supply|supplies/.test(n)) return 'restock'
  if (/a\/?c|hvac|filter/.test(n)) return 'hvac'
  if (/clean/.test(n)) return 'clean-other'
  return deptOf(department) + ':' + n.replace(/[^a-z]+/g, ' ').trim().split(' ').slice(0, 3).join('-')
}

export type DupTask = {
  id: string; name: string; dept: string; key: string
  scheduledDate: string; finishedAt: string | null
  assignees: string[]; byLighthouse: boolean
}
export type DupGroup = {
  listingId: string; unit: string; date: string; key: string
  tasks: DupTask[]
  /** The one a person would keep: finished first, and preferably the one somebody's name is on. */
  keepId: string
}
export type DupAudit = {
  ok: boolean; error?: string
  from: string; to: string
  scanned: number
  groups: DupGroup[]
  /** Straight counts for the settings panel — how bad is this, in one line. */
  summary: { groups: number; extraTasks: number; byKey: Record<string, number> }
}

/**
 * Find work completed twice. Read-only, always — this closes nothing and moves nothing.
 * Scoped to `listingIds` when the sweep asks about one unit; portfolio-wide when the panel asks.
 */
export async function auditDuplicates(opts: {
  listingIds?: string[]
  days?: number
  today?: string
} = {}): Promise<DupAudit> {
  const today = opts.today || new Date().toISOString().slice(0, 10)
  const days = Math.min(365, Math.max(1, opts.days ?? 30))
  const from = new Date(Date.parse(today + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10)
  const base: DupAudit = {
    ok: true, from, to: today, scanned: 0, groups: [],
    summary: { groups: 0, extraTasks: 0, byKey: {} },
  }
  try {
    const db = supabaseAdmin()
    let q = db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,property_name,name,status,scheduled_date,finished_at,assignees,type_department,description')
      .gte('scheduled_date', from).lte('scheduled_date', today)
      // Recent-first, and a secondary sort key so paging cannot drop or repeat rows — the same
      // PostgREST trap that made the stale-clean job blind to everything newer than six months.
      .order('scheduled_date', { ascending: false }).order('id', { ascending: true })
      .limit(1000)
    if (opts.listingIds?.length) q = q.in('reference_property_id', opts.listingIds.slice(0, 400))
    const { data, error } = await q
    if (error) return { ...base, ok: false, error: error.message }

    const rows = (data || []) as any[]
    base.scanned = rows.length

    // Bucket by unit + day + category. Only COMPLETED work counts: two open tasks on one unit is a
    // scheduling smell, but it is not yet waste — nobody has driven anywhere twice.
    const buckets: Record<string, DupTask[]> = {}
    const unitOf: Record<string, string> = {}
    for (const t of rows) {
      const st = str(t.status).toLowerCase()
      if (GONE.test(st)) continue
      if (!DONE.test(st) && !t.finished_at) continue
      const lid = str(t.reference_property_id); if (!lid) continue
      const date = dOf(t.scheduled_date); if (!date) continue
      unitOf[lid] = unitOf[lid] || str(t.property_name) || lid
      const key = auditKey(t.name, t.type_department)
      const k = `${lid}|${date}|${key}`
      ;(buckets[k] = buckets[k] || []).push({
        id: str(t.id), name: str(t.name), dept: deptOf(t.type_department), key,
        scheduledDate: date, finishedAt: t.finished_at ? String(t.finished_at) : null,
        assignees: Array.isArray(t.assignees)
          ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean)
          : [],
        byLighthouse: LIGHTHOUSE_MARK.test(str(t.description)),
      })
    }

    for (const k of Object.keys(buckets)) {
      const tasks = buckets[k]
      if (tasks.length < 2) continue
      const [lid, date, key] = k.split('|')
      // KEEP THE ONE WITH A PERSON AND A FINISH TIME. The record somebody's name is on is the one
      // that reflects what actually happened in the unit; the bare one is the artefact.
      const ranked = tasks.slice().sort((a, b) =>
        (b.assignees.length ? 1 : 0) - (a.assignees.length ? 1 : 0)
        || String(a.finishedAt || '￿').localeCompare(String(b.finishedAt || '￿')))
      base.groups.push({ listingId: lid, unit: unitOf[lid] || lid, date, key, tasks: ranked, keepId: ranked[0].id })
      base.summary.byKey[key] = (base.summary.byKey[key] || 0) + (tasks.length - 1)
      base.summary.extraTasks += tasks.length - 1
    }
    base.groups.sort((a, b) => b.date.localeCompare(a.date) || a.unit.localeCompare(b.unit))
    base.summary.groups = base.groups.length
    return base
  } catch (e: any) {
    return { ...base, ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

/**
 * The gate the sweep runs through. Answers one question per unit: which categories were ALREADY
 * completed here recently? Anything in that set must not be dragged onto today's visit.
 */
export async function completedRecently(listingIds: string[], today: string, days = 14): Promise<Record<string, Set<string>>> {
  const out: Record<string, Set<string>> = {}
  if (!listingIds.length) return out
  try {
    const db = supabaseAdmin()
    const from = new Date(Date.parse(today + 'T12:00:00Z') - Math.max(1, days) * 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
      .in('reference_property_id', listingIds.slice(0, 400))
      .gte('scheduled_date', from).lte('scheduled_date', today)
      .order('scheduled_date', { ascending: false }).order('id', { ascending: true })
      .limit(1000)
    if (error) return out
    for (const t of (data || []) as any[]) {
      const st = str(t.status).toLowerCase()
      if (GONE.test(st)) continue
      if (!DONE.test(st) && !t.finished_at) continue
      const lid = str(t.reference_property_id); if (!lid) continue
      ;(out[lid] = out[lid] || new Set()).add(auditKey(t.name, t.type_department))
    }
  } catch { /* a failed gate must not block the sweep; it just stops filtering */ }
  return out
}

// ── STRAY INSPECTIONS ───────────────────────────────────────────────────────────────────────────
// Jon, 2026-08-31: "the only inspections that get moved up are the automated inspections created by
// Lighthouse. All other inspections should be deleted."
//
// CLOSED, NOT DELETED (Jon confirmed, 2026-08-31). Closing empties the board exactly as well —
// they stop counting open, stop inflating the late numbers, stop appearing on the grid — and the
// record survives, so if this rule turns out to be wrong about a category, you can see everything
// it touched and put it back. A hard delete would make its own mistakes unreviewable.
export type StrayRun = {
  ok: boolean; error?: string
  enabled: boolean
  cutoff: string
  found: number
  closed: { id: string; unit: string; name: string; date: string }[]
  skipped: { lighthouse: number; overCap: number }
  failed: { id: string; error: string }[]
}

export async function closeStrayInspections(opts: { dryRun?: boolean; olderThanDays?: number; maxPerRun?: number } = {}): Promise<StrayRun> {
  const today = new Date().toISOString().slice(0, 10)
  const olderThan = Math.max(0, opts.olderThanDays ?? 1)
  const cap = Math.max(1, opts.maxPerRun ?? 40)
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - olderThan * 86400000).toISOString().slice(0, 10)
  const base: StrayRun = {
    ok: true, enabled: true, cutoff, found: 0, closed: [],
    skipped: { lighthouse: 0, overCap: 0 }, failed: [],
  }
  try {
    const db = supabaseAdmin()
    // 180 days back, same outer bound the stale-clean closer uses: older than that is archaeology
    // and closing it changes nothing anybody is looking at.
    const from = new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,property_name,name,status,scheduled_date,finished_at,description,type_department')
      .gte('scheduled_date', from).lte('scheduled_date', cutoff)
      .ilike('name', '%inspect%')
      .order('scheduled_date', { ascending: false }).order('id', { ascending: true })
      .limit(1000)
    if (error) return { ...base, ok: false, error: error.message }

    const queue: StrayRun['closed'] = []
    for (const t of (data || []) as any[]) {
      const st = str(t.status).toLowerCase()
      if (GONE.test(st)) continue
      if (DONE.test(st) || t.finished_at) continue          // only OPEN inspections
      base.found++
      // Lighthouse's own inspections are the point of the automation — they carry a real brief and
      // they are the ones allowed to move forward. Never close those.
      if (LIGHTHOUSE_MARK.test(str(t.description))) { base.skipped.lighthouse++; continue }
      if (queue.length >= cap) { base.skipped.overCap++; continue }
      queue.push({
        id: str(t.id), unit: str(t.property_name) || str(t.reference_property_id),
        name: str(t.name), date: dOf(t.scheduled_date),
      })
    }

    if (opts.dryRun) return { ...base, closed: queue }
    if (!breezewayConfigured()) return { ...base, ok: false, error: 'Breezeway is not configured.' }

    for (const q of queue) {
      try {
        const r = await completeBreezewayTask(q.id)
        if (!r.ok) throw new Error('Breezeway ' + r.status)
        try {
          await db.from('breezeway_tasks_sync')
            .update({ status: 'completed', finished_at: new Date().toISOString(), synced_at: new Date().toISOString() })
            .eq('id', q.id)
        } catch { /* the next sync catches up */ }
        base.closed.push(q)
      } catch (e: any) {
        base.failed.push({ id: q.id, error: String(e?.message || e).slice(0, 140) })
      }
    }
    base.ok = base.failed.length === 0
    return base
  } catch (e: any) {
    return { ...base, ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}
