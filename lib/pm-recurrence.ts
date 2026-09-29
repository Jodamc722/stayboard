// PM RECURRENCE — a completed job books the next one.
//
// Jon, 2026-09-28: "a task management system that creates recurring tasks once certain tasks are
// completed. Central A/C filter cleans, A/C deep cleans every 6 months, battery changes once a year
// for remotes, remote door locks… Once a task is completed, it creates the next task and manages
// that for the next 6 months." And: "a place to add or create new cadences that are managed and
// tasks created."
//
// The cadence catalogue (lib/cadences.ts, edited in /users → Settings → Cadences) says what the
// jobs are and how often. The due calendar (lib/pm-calendar.ts) already works out, per unit × per
// cadence, when each was last done from the completed Breezeway task and therefore when it is next
// due. This file is the part that MANAGES it:
//
//   1. THE LEDGER. Every unit × cadence with a recorded completion gets a row in pm_schedule: last
//      done, next due. A new completion (the field team closed the task) moves the row forward —
//      that is the "once a task is completed" trigger, read from the same mirror everything else
//      reads, so nobody logs anything twice.
//   2. THE SUCCESSOR. `leadDays` before next-due (14 by default) the next task is created in
//      Breezeway — on the due date, or, for a job that needs the unit empty, on the unit's best
//      workable day (a vacancy a technician is already booked into wins). A cadence set to AUTO
//      creates it outright; SUGGEST proposes it through Eve's task_create rung, so a ✅ creates it.
//      Never twice: an open task that already matches the cadence IS the successor.
//   3. MISSED RIDES FORWARD. A successor whose day passed unfinished is moved to the next workable
//      day, once a week, and counted, so it stays visible instead of ageing off the board.
//   4. DONE STARTS THE NEXT CYCLE — by 1, on the next run.
//
// A job with NO recorded completion is left alone here (it shows in the calendar's "no record"
// band, addable by hand): the recurrence starts from the first completion, which is the only honest
// place to start it from.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { buildDueCalendar, type DueItem } from './pm-calendar'
import { CADENCE_KEY, resolveCadences, type CadenceDef } from './cadences'
import { workableDays } from './unit-windows'
import { updateBreezewayTask, breezewayConfigured } from './breezeway'
import { getTaskAutomation } from './auto-inspections'
import { marketOf } from './segments'

const STATE_KEY = 'pm_recurrence_state'
const MAX_CREATE_PER_RUN = 25
const MAX_MOVE_PER_RUN = 25
const RIDE_FORWARD_EVERY_DAYS = 7
const REPROPOSE_AFTER_DAYS = 7

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
const shift = (ymd: string, days: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + days * 86400000))

export type PmRun = {
  ok: boolean; error?: string; enabled: boolean; today: string
  ledger: number; created: number; proposed: number; moved: number; waiting: number; skipped: number
  /** Due today but held for tomorrow because the day's cap (Settings → Cadences) was spent. */
  capped: number
  lines: string[]
}

/**
 * HOW MUCH OF TODAY'S CAP IS LEFT (audit 2026-09-28). `dailyCap` is THE cap — "we can't have 200
 * tasks auto populate" — and this pass never read it: 25 per run, four runs a day, so the first
 * morning after activation could put a hundred asks in the approval queue. Every proposal and every
 * outright creation stamps its row `proposed <day>` / `created <day>`, so the day's spend is read
 * back from the ledger itself and holds across runs, instances and restarts. If the count cannot be
 * read, nothing is spent this run — a cap that fails open is not a cap.
 */
async function capLeftToday(db: ReturnType<typeof supabaseAdmin>, today: string, cap: number): Promise<{ left: number; error?: string }> {
  const [p, c] = await Promise.all([
    db.from('pm_schedule').select('listing_id', { count: 'exact', head: true }).ilike('note', `proposed ${today}%`),
    db.from('pm_schedule').select('listing_id', { count: 'exact', head: true }).ilike('note', `created ${today}%`),
  ])
  if (p.error || c.error) return { left: 0, error: String((p.error || c.error)?.message || 'count failed') }
  return { left: Math.max(0, cap - (p.count || 0) - (c.count || 0)) }
}

/**
 * The pass. Idempotent: rows are keyed (listing, cadence), a successor is never created while an
 * open matching task exists, and a proposal is not repeated inside a week.
 */
export async function runPmRecurrence(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<PmRun> {
  const today = ymdET(new Date())
  const out: PmRun = { ok: true, enabled: true, today, ledger: 0, created: 0, proposed: 0, moved: 0, waiting: 0, skipped: 0, capped: 0, lines: [] }
  const db = supabaseAdmin()
  const probe = await db.from('pm_schedule').select('listing_id', { count: 'exact', head: true })
  if (probe.error) return { ...out, ok: false, error: `pm_schedule is missing — run migration 113 (${probe.error.message})` }

  const cfg = resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
  const byKey: Record<string, CadenceDef> = {}
  for (const c of cfg.cadences) byKey[c.key] = c
  const live = cfg.cadences.filter(c => c.mode !== 'off' && c.successor !== false)
  if (!cfg.enabled && !opts.force) { out.enabled = false; out.lines.push('cadences are switched off (Settings → Cadences)'); return out }
  if (!live.length) { out.lines.push('no cadence has the successor rule on'); return out }

  const maxLead = live.reduce((m, c) => Math.max(m, c.leadDays ?? 14), 14)
  const cal = await buildDueCalendar(today, { horizonDays: Math.max(30, maxLead + 7) })
  const items: DueItem[] = cal.buildings.flatMap(b => b.items).filter(i => byKey[i.cadenceKey] && byKey[i.cadenceKey].successor !== false && i.lastDone)

  // ── 1. the ledger ──────────────────────────────────────────────────────────────────────────────
  const { data: rowsRes } = await db.from('pm_schedule').select('*').limit(5000)
  const rows: Record<string, any> = {}
  for (const r of ((rowsRes || []) as any[])) rows[`${r.listing_id}|${r.cadence_key}`] = r
  const upserts: any[] = []
  for (const it of items) {
    const k = `${it.listingId}|${it.cadenceKey}`
    const r = rows[k]
    const patch: any = { listing_id: it.listingId, cadence_key: it.cadenceKey, unit_name: it.unit, building: it.building, last_done: it.lastDone, next_due: it.dueOn, updated_at: new Date().toISOString() }
    if (it.scheduled) { patch.task_id = it.scheduled.taskId; patch.task_date = it.scheduled.date; patch.status = 'created' }
    else if (!r || r.last_done !== it.lastDone) { patch.task_id = null; patch.task_date = null; patch.status = 'scheduled'; patch.moved = 0; patch.note = null }
    else if (r.status === 'created' && !it.scheduled) {
      // The successor we made is gone from the open set: finished (then lastDone would have moved —
      // handled above on the next run) or cancelled. Either way the row waits to be created again.
      patch.status = 'scheduled'; patch.task_id = null; patch.task_date = null
    }
    const changed = !r || Object.keys(patch).some(f => f !== 'updated_at' && f !== 'unit_name' && f !== 'building' && String(r[f] ?? '') !== String(patch[f] ?? ''))
    if (changed) upserts.push({ ...(r || { status: 'scheduled', moved: 0 }), ...patch })
    rows[k] = { ...(r || { status: 'scheduled', moved: 0, note: null }), ...patch }
  }
  if (upserts.length && !opts.dryRun) {
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await db.from('pm_schedule').upsert(upserts.slice(i, i + 200), { onConflict: 'listing_id,cadence_key' })
      if (error) { out.lines.push(`ledger write: ${error.message}`); break }
    }
  }
  out.ledger = upserts.length

  // ── 2. the successor ───────────────────────────────────────────────────────────────────────────
  // ONE PER BUILDING (perBuilding cadences): of a building's due units, only the first creates a
  // task; the rest ride on it. An open task on any unit of the building counts as the building's.
  const perBuildingSeen = new Set<string>()
  const buildingHasTask = new Set<string>()
  for (const it of items) if (byKey[it.cadenceKey]?.perBuilding && it.scheduled) buildingHasTask.add(`${it.cadenceKey}|${it.building || it.unit}`)
  const due = items.filter(it => {
    const cb = byKey[it.cadenceKey]
    if (cb?.perBuilding) {
      const bk = `${it.cadenceKey}|${it.building || it.unit}`
      if (buildingHasTask.has(bk) || perBuildingSeen.has(bk)) return false
      perBuildingSeen.add(bk)
    }
    const c = byKey[it.cadenceKey]
    const r = rows[`${it.listingId}|${it.cadenceKey}`]
    if (!r || r.status !== 'scheduled' || it.scheduled) return false
    if (it.dueOn > shift(today, c.leadDays ?? 14)) return false
    // A proposal already out this week: do not ask again.
    if (r.note && /^proposed /.test(str(r.note)) && r.updated_at && Date.parse(r.updated_at) > Date.now() - REPROPOSE_AFTER_DAYS * 86400000 && !opts.force) return false
    return true
  }).sort((a, b) => b.daysOver - a.daysOver).slice(0, MAX_CREATE_PER_RUN)

  const needWindow = due.filter(it => byKey[it.cadenceKey].needsVacant).map(it => it.listingId)
  const windows = needWindow.length ? await workableDays(Array.from(new Set(needWindow)), today, Math.max(21, maxLead + 7)).catch(() => ({} as any)) : {}
  const automation = await getTaskAutomation().catch(() => null)
  const { runExecutor } = await import('./eve/executors')
  const { agentAllowed, stepDown, recordAgentAction } = await import('./eve/agent-mode')

  // THE DAILY CAP, shared by proposals and outright creations. Only a job that is actually proposed
  // or created spends it — one waiting for an empty day costs nothing.
  const cap = due.length ? await capLeftToday(db, today, cfg.dailyCap) : { left: 0 }
  if (cap.error) out.lines.push(`daily cap could not be read (${cap.error}) — nothing proposed this run`)
  let spent = 0

  for (const it of due) {
    const c = byKey[it.cadenceKey]
    let date = it.dueOn < today ? today : it.dueOn
    if (c.needsVacant) {
      const w = windows[it.listingId]
      const best = w?.best || null
      if (!best) { out.waiting++; if (!opts.dryRun) await db.from('pm_schedule').update({ note: 'waiting for an empty day', updated_at: new Date().toISOString() }).eq('listing_id', it.listingId).eq('cadence_key', it.cadenceKey); continue }
      date = best.date
    }
    if (spent >= cap.left) { out.capped++; continue }
    const sup = automation ? (automation.supervisors[it.market] || automation.supervisors.Miami) : ''
    const assignees = c.dept === 'housekeeping' ? [] : Array.from(new Set([automation?.assignAlways, sup].filter(Boolean))) as string[]
    const title = c.perBuilding ? `${c.label} — ${it.building || it.unit}` : `${c.label} — ${it.unit}`
    const description = `Preventative ${c.label.toLowerCase()} on ${it.unit}, every ${c.everyDays} days. Last done ${it.lastDone}; due ${it.dueOn}${it.daysOver > 0 ? ` (${it.daysOver} days over)` : ''}.` +
      (c.needsVacant ? ` Scheduled on an empty day; if it slips, Lighthouse moves it to the next one.` : '') +
      `\n\nWhen this is completed, the next one is booked automatically for ${shift(date, c.everyDays)}. (Cadence "${c.label}", Users & admin → Settings → Cadences.)`
    const payload = { listingId: it.listingId, title, department: c.dept, priority: it.daysOver > 30 ? 'high' : 'normal', date, description, assignees }
    if (opts.dryRun) { spent++; out.lines.push(`${c.mode === 'auto' ? 'would create' : 'would propose'}: ${title} on ${date}`); continue }

    if (c.mode === 'auto') {
      const r = await runExecutor('task_create', payload, { by: 'cron:pm-recurrence', human: false })
      await recordAgentAction('task_create', { rung: 4, allowed: r.ok, mode: 'act', reason: r.ok ? `cadence "${c.label}" is set to auto` : `create failed: ${r.error || 'unknown'}`, summary: r.summary, ref: r.ref || null, by: 'cron:pm-recurrence', countAs: r.ok ? 'action' : 'none', undo: r.undo || undefined })
      if (r.ok && r.ref) {
        spent++
        await db.from('pm_schedule').update({ status: 'created', task_id: str(r.ref), task_date: date, note: `created ${today}`, updated_at: new Date().toISOString() }).eq('listing_id', it.listingId).eq('cadence_key', it.cadenceKey)
        out.created++; out.lines.push(`created ${title} on ${date}`)
      } else { out.lines.push(`create failed ${title}: ${r.error || 'unknown'}`); out.skipped++ }
      continue
    }
    // SUGGEST: through the rung. At "act" it is created; at "propose" a ✅ creates it; at "draft" it waits.
    const gate = await agentAllowed('task_create')
    const r = await stepDown(gate, {
      action: 'task_create', summary: `create "${title}" for ${date} (preventative, every ${c.everyDays} days — last done ${it.lastDone})`,
      exec: payload, why: `${c.label} is due ${it.dueOn} on ${it.unit}${it.daysOver > 0 ? `, ${it.daysOver} days over` : ''}.`, by: 'cron:pm-recurrence',
      watchKey: 'pm_recurrence', subject: `pm:${it.listingId}:${it.cadenceKey}`, metric: 'tasks_completed', thoughtCooldownHours: 24 * REPROPOSE_AFTER_DAYS,
    })
    if (r.mode === 'act' && r.ok && r.ref) {
      spent++
      await db.from('pm_schedule').update({ status: 'created', task_id: str(r.ref), task_date: date, note: `created ${today}`, updated_at: new Date().toISOString() }).eq('listing_id', it.listingId).eq('cadence_key', it.cadenceKey)
      out.created++; out.lines.push(`created ${title} on ${date}`)
    } else if (r.ok && r.mode !== 'observe') {
      spent++
      await db.from('pm_schedule').update({ note: `proposed ${today} (${r.mode})`, updated_at: new Date().toISOString() }).eq('listing_id', it.listingId).eq('cadence_key', it.cadenceKey)
      out.proposed++; out.lines.push(`proposed ${title} on ${date}`)
    } else { out.skipped++; out.lines.push(`${title}: ${r.error || gate.reason}`) }
  }
  if (out.capped) out.lines.push(`daily cap of ${cfg.dailyCap} reached — ${out.capped} more ${out.capped === 1 ? 'waits' : 'wait'} for tomorrow`)

  // ── 3. missed rides forward ────────────────────────────────────────────────────────────────────
  // Only successors Lighthouse created (task_id on the row), scheduled before today, still open,
  // and not moved in the last week.
  const stale = Object.values(rows).filter((r: any) => r.status === 'created' && r.task_id && r.task_date && r.task_date < today
    && (!r.updated_at || Date.parse(r.updated_at) < Date.now() - RIDE_FORWARD_EVERY_DAYS * 86400000 || r.moved === 0)).slice(0, MAX_MOVE_PER_RUN)
  if (stale.length && breezewayConfigured() && !opts.dryRun) {
    const { data: ts } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at').in('id', stale.map((r: any) => str(r.task_id)))
    const tmap: Record<string, any> = {}
    for (const t of ((ts || []) as any[])) tmap[str(t.id)] = t
    const open = stale.filter((r: any) => { const t = tmap[str(r.task_id)]; return t && !t.finished_at && !/complet|finish|close|approv|cancel|delet|void/i.test(str(t.status)) })
    const w2 = await workableDays(Array.from(new Set(open.map((r: any) => str(r.listing_id)))), today, 21).catch(() => ({} as any))
    for (const r of open as any[]) {
      const c = byKey[r.cadence_key]
      const best = c?.needsVacant ? (w2[r.listing_id]?.best?.date || null) : today
      if (!best) { out.waiting++; continue }
      try {
        const u = await updateBreezewayTask(str(r.task_id), { name: str(tmap[str(r.task_id)]?.name) || `${c?.label || r.cadence_key} — ${r.unit_name}`, scheduled_date: best })
        if (!u.ok) throw new Error('Breezeway ' + u.status)
        await db.from('breezeway_tasks_sync').update({ scheduled_date: best, synced_at: new Date().toISOString() }).eq('id', str(r.task_id))
        await db.from('pm_schedule').update({ task_date: best, moved: (Number(r.moved) || 0) + 1, note: `moved from ${r.task_date}`, updated_at: new Date().toISOString() }).eq('listing_id', r.listing_id).eq('cadence_key', r.cadence_key)
        out.moved++; out.lines.push(`moved ${r.unit_name} ${c?.label || r.cadence_key} → ${best}`)
      } catch (e: any) { out.lines.push(`move failed ${r.unit_name}: ${String(e?.message || e).slice(0, 80)}`) }
    }
  }

  if (!opts.dryRun) await setSetting(STATE_KEY, { lastRun: new Date().toISOString(), today, created: out.created, proposed: out.proposed, moved: out.moved }, 'pm-recurrence').catch(() => {})
  return out
}

/** Has the pass run in the last N hours? The cron rides an hourly line but this pass is heavier. */
export async function pmRecurrenceRanWithin(hours: number): Promise<boolean> {
  const st = await getSetting<any>(STATE_KEY, null).catch(() => null)
  return !!(st && st.lastRun && Date.parse(st.lastRun) > Date.now() - hours * 3600_000)
}

/** The ledger, for the settings screen: every row with the unit, cadence label, and where it stands. */
export async function pmLedger(): Promise<any[]> {
  const cfg = resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
  const label: Record<string, string> = {}
  for (const c of cfg.cadences) label[c.key] = c.label
  const { data } = await supabaseAdmin().from('pm_schedule').select('*').order('next_due', { ascending: true }).limit(2000)
  const today = ymdET(new Date())
  return ((data || []) as any[]).map(r => ({ ...r, label: label[r.cadence_key] || r.cadence_key, daysOver: Math.round((Date.parse(today) - Date.parse(str(r.next_due))) / 86400000), market: marketOf(r.building, null, r.unit_name) }))
}
