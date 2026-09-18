// THE WEEK'S SCOREBOARD — the KPI tiles the Command Center strip prints and Eve's weekly review
// reads. Extracted from app/api/command/scoreboard/route.ts (2026-09-18) so the review can reason
// over the SAME numbers the strip shows, never a second derivation. The route keeps its five-minute
// cache and the per-viewer money redaction; this file only builds.
//
// EVERY TILE REUSES AN EXISTING COMPUTATION rather than re-deriving it, so a number here can never
// disagree with the page it links to:
//   welcome calls   lib/call-desk loadCallsDesk (today's due/done) + guest_calls (the week's rate,
//                   the exact formula of /api/calls/stats: completed / (completed + incomplete))
//   claims          claims table, the same open/filed/deadline rules as lib/command-day
//   glitches        glitches table, open/overdue as lib/command-day; time-to-close from closed_at
//                   (migration 085), estimated backfills excluded
//   labor / clean   lib/labor-econ laborEconomics → buckets.miami / buckets.broward
//                   (housekeeper wages ÷ departure cleans, Homebase timecards, the Labor board's own)
//   maintenance $   lib/billing billingRange → laborAmount on maintenance-department tasks
//   billable $      lib/billing billingRange → billedAmount > 0, exclusions honoured
//   checklist       lib/daily-checklist todayList + progressOf (today's ticks)
//
// ONE FAILURE NEVER 500s THE STRIP: each source is wrapped, and a tile whose read failed carries
// `degraded` with the reason instead of a number. `compare` carries the raw this-week / same-days-
// last-week pair for readers that want numbers rather than a formatted delta (the review).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getLaborSettings } from '@/lib/labor-settings'
import { ymdET, addDays } from '@/lib/team-schedule'
import { loadCallsDesk, isCompleted } from '@/lib/call-desk'
import { laborEconomics } from '@/lib/labor-econ'
import { billingRange, type BillingTask } from '@/lib/billing'
import { todayList, progressOf } from '@/lib/daily-checklist'
import { STAGE_LABEL as CLAIM_STAGE_LABEL } from '@/lib/claims'

export type ScoreDelta = { value: string; dir: 'up' | 'down' | 'flat'; goodWhen: 'up' | 'down' }
export type ScoreRow = { text: string; href?: string }
export type ScoreTile = {
  key: string; label: string; value: string; sub: string
  tone: 'ok' | 'warn' | 'hot' | 'quiet'
  delta?: ScoreDelta
  detail: { rows: ScoreRow[]; note?: string }
  degraded?: string
  /** Server-only: the tile prints amounts, so it is blanked for a viewer without the money perm. */
  money?: boolean
  /** Server-only: the raw pair behind `delta` — this week to date vs the same weekdays last week. */
  compare?: { now: number | null; prev: number | null; unit: string }
}
export type Scoreboard = { ok: true; weekStart: string; weekStartDay: 'sunday' | 'monday'; today: string; generatedAt: string; tiles: ScoreTile[] }

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const dayOf = (iso: any) => String(iso || '').slice(0, 10)
const inRange = (d: string, a: string, b: string) => !!d && d >= a && d <= b

/** A delta line: the difference, its direction, and which direction is good. */
function delta(now: number | null, prev: number | null, fmt: (n: number) => string, goodWhen: 'up' | 'down'): ScoreDelta | undefined {
  if (now == null || prev == null) return undefined
  const diff = round2(now - prev)
  const dir: ScoreDelta['dir'] = Math.abs(diff) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down'
  return { value: (dir === 'flat' ? '' : dir === 'up' ? '+' : '−') + fmt(Math.abs(diff)), dir, goodWhen }
}

/** One source read. A throw becomes `degraded` on the tile, never a 500 for the strip. */
async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; err: string }> {
  try { return { ok: true, v: await fn() } }
  catch (e: any) { return { ok: false, err: String(e?.message || e).slice(0, 120) } }
}
const failed = (t: Omit<ScoreTile, 'value' | 'sub' | 'tone' | 'detail'>, err: string): ScoreTile =>
  ({ ...t, value: '—', sub: 'could not read', tone: 'quiet', detail: { rows: [] }, degraded: err })

/** Week start: labor_settings.week_start, then app_settings 'week_start', else Monday. */
async function weekStartDay(): Promise<'sunday' | 'monday'> {
  try {
    const ls: any = await getLaborSettings('default')
    if (ls && (ls.week_start === 'sunday' || ls.week_start === 'monday')) return ls.week_start
  } catch { /* fall through */ }
  try {
    const s: any = await getSetting<any>('week_start', null)
    const v = typeof s === 'string' ? s : s && typeof s === 'object' ? (s.value || s.week_start) : null
    if (v === 'sunday' || v === 'monday') return v
  } catch { /* fall through */ }
  return 'monday'
}

export async function buildScoreboard(): Promise<Scoreboard> {
  const now = new Date()
  const today = ymdET(now)
  const wsd = await weekStartDay()
  const dow = new Date(today + 'T12:00:00Z').getUTCDay()            // 0 = Sunday
  const offset = wsd === 'sunday' ? dow : (dow + 6) % 7
  const weekStart = addDays(today, -offset)
  const lastStart = addDays(weekStart, -7)
  const lastSame = addDays(lastStart, offset)                          // the same weekday, last week
  const monthStart = today.slice(0, 7) + '-01'
  const sb = supabaseAdmin()

  const [calls, callsWeek, claims, glitches, econNow, econPrev, billing, checklist] = await Promise.all([
    safe(() => loadCallsDesk(sb, today)),
    safe(async () => {
      const { data, error } = await sb.from('guest_calls')
        .select('reservation_id,outcome,scheduled_for,called_at,guest_name,tier')
        .eq('kind', 'welcome')
        .or(`scheduled_for.gte.${lastStart},and(scheduled_for.is.null,called_at.gte.${lastStart}T00:00:00Z)`)
        .order('reservation_id').limit(1000)
      if (error) throw new Error(error.message)
      return (data || []) as any[]
    }),
    safe(async () => {
      const { data, error } = await sb.from('claims')
        .select('id,stage,property,unit_no,guest_name,deadline_on,amount_sought,amount_paid,paid_on,created_at,channel')
        .is('deleted_at', null).or(`stage.neq.closed,paid_on.gte.${monthStart},created_at.gte.${lastStart}T00:00:00Z`).limit(500)
      if (error) throw new Error(error.message)
      return (data || []) as any[]
    }),
    safe(async () => {
      const [open, closed] = await Promise.all([
        sb.from('glitches').select('id,unit,status,overview,glitch_type,category,due_date,created_at,assignee')
          .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(500),
        sb.from('glitches').select('id,unit,created_at,closed_at,closed_at_estimated,status')
          .gte('closed_at', monthStart + 'T00:00:00Z').limit(1000),
      ])
      if (open.error) throw new Error(open.error.message)
      if (closed.error) throw new Error(closed.error.message)
      // New this week / last week (same days) — a count, from created_at, so the delta is about volume.
      const [cntNow, cntPrev] = await Promise.all([
        sb.from('glitches').select('id', { count: 'exact', head: true }).gte('created_at', weekStart + 'T00:00:00Z'),
        sb.from('glitches').select('id', { count: 'exact', head: true }).gte('created_at', lastStart + 'T00:00:00Z').lt('created_at', addDays(lastSame, 1) + 'T00:00:00Z'),
      ])
      return { open: (open.data || []) as any[], closed: (closed.data || []) as any[], newNow: cntNow.count || 0, newPrev: cntPrev.count || 0 }
    }),
    safe(() => laborEconomics({ from: weekStart, to: today, market: 'all' })),
    safe(() => laborEconomics({ from: lastStart, to: lastSame, market: 'all' })),
    safe(() => billingRange(lastStart, today)),
    safe(() => todayList(now)),
  ])

  const tiles: ScoreTile[] = []

  // ── 1. WELCOME CALLS ──────────────────────────────────────────────────────────────────────────
  {
    const base = { key: 'welcome', label: 'Welcome calls' }
    if (!calls.ok) tiles.push(failed(base, calls.err))
    else {
      const due = calls.v.rows.filter(r => r.dueToday)
      const done = due.filter(r => r.done)
      // The week's completion rate — /api/calls/stats' own formula, on the day the call was DUE.
      const rate = (rows: any[]) => {
        let c = 0, i = 0
        for (const r of rows) { if (isCompleted(r.outcome)) c++; else if (r.outcome === 'incomplete') i++ }
        return c + i ? Math.round((c / (c + i)) * 100) : null
      }
      const weekRows = callsWeek.ok ? callsWeek.v : []
      const dOf = (r: any) => dayOf(r.scheduled_for) || ymdET(new Date(r.called_at))
      const thisWeek = weekRows.filter(r => inRange(dOf(r), weekStart, today))
      const lastWeek = weekRows.filter(r => inRange(dOf(r), lastStart, lastSame))
      const pctNow = rate(thisWeek), pctPrev = rate(lastWeek)
      const rows: ScoreRow[] = due
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.prio - b.prio))
        .slice(0, 12)
        .map(r => ({ text: (r.done ? '✓ ' : '· ') + (r.guest || 'Guest') + ' — ' + r.listing + (r.mandatory ? ' · ' + r.tier : '') + (r.done && r.calledBy ? ' · ' + r.calledBy : ''), href: '/welcome-calls' }))
      tiles.push({
        ...base,
        value: done.length + '/' + due.length,
        sub: pctNow == null ? 'due today' : pctNow + '% this week',
        tone: due.length && done.length === due.length ? 'ok' : due.length - done.length >= 3 ? 'hot' : due.length > done.length ? 'warn' : 'quiet',
        delta: delta(pctNow, pctPrev, n => n + ' pts', 'up'),
        compare: { now: pctNow, prev: pctPrev, unit: '% completed' },
        detail: {
          rows,
          note: 'Today: ' + done.length + ' of ' + due.length + ' arrivals called. This week ' + (pctNow == null ? 'has no closed calls yet' : pctNow + '% completed') +
            ' (' + thisWeek.length + ' calls) vs ' + (pctPrev == null ? 'no rate' : pctPrev + '%') + ' last week to ' + lastSame.slice(5) + '. Rate = completed ÷ (completed + incomplete), the Calls desk formula; open calls do not count yet.' +
            (callsWeek.ok ? '' : ' Week rate unavailable: ' + callsWeek.err),
        },
      })
    }
  }

  // ── 2. CLAIMS ─────────────────────────────────────────────────────────────────────────────────
  {
    const base = { key: 'claims', label: 'Claims', money: true }
    if (!claims.ok) tiles.push(failed(base, claims.err))
    else {
      const all = claims.v
      const open = all.filter(c => String(c.stage) !== 'closed')
      const daysLeft = (c: any) => c.deadline_on ? Math.round((Date.parse(dayOf(c.deadline_on) + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null
      const filed = (c: any) => ['submitted', 'decided', 'settle'].indexOf(String(c.stage)) >= 0
      const dueSoon = open.filter(c => { const d = daysLeft(c); return !filed(c) && d != null && d <= 7 })
      const recovered = all.filter(c => c.paid_on && dayOf(c.paid_on) >= monthStart && dayOf(c.paid_on) <= today).reduce((a, c) => a + num(c.amount_paid), 0)
      const newNow = all.filter(c => inRange(dayOf(c.created_at), weekStart, today)).length
      const newPrev = all.filter(c => inRange(dayOf(c.created_at), lastStart, lastSame)).length
      const unitOf = (c: any) => [c.property, c.unit_no].filter(Boolean).join(' ') || 'Unit'
      const rows: ScoreRow[] = dueSoon
        .sort((a, b) => (daysLeft(a) ?? 99) - (daysLeft(b) ?? 99))
        .concat(open.filter(c => dueSoon.indexOf(c) < 0).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
        .slice(0, 12)
        .map(c => {
          const d = daysLeft(c)
          const when = d == null ? '' : d < 0 ? ' · deadline passed ' + Math.abs(d) + 'd ago' : d <= 7 && !filed(c) ? ' · file in ' + d + 'd' : ''
          return { text: unitOf(c) + ' — ' + (c.guest_name || 'Guest') + ' · ' + (CLAIM_STAGE_LABEL[String(c.stage)] || c.stage) + (c.amount_sought ? ' · ' + money(num(c.amount_sought)) : '') + when, href: '/claims' }
        })
      tiles.push({
        ...base,
        value: String(open.length),
        sub: [dueSoon.length ? dueSoon.length + ' due ≤7d' : '', recovered > 0 ? money(recovered) + ' back' : ''].filter(Boolean).join(' · ') || 'open',
        tone: dueSoon.some(c => (daysLeft(c) ?? 9) <= 2) ? 'hot' : dueSoon.length ? 'warn' : 'quiet',
        delta: delta(newNow, newPrev, n => n + ' new', 'down'),
        compare: { now: newNow, prev: newPrev, unit: 'claims opened' },
        detail: { rows, note: open.length + ' open · ' + dueSoon.length + ' unfiled with a deadline inside 7 days · ' + money(recovered) + ' recovered this month (amount_paid by paid_on) · ' + newNow + ' opened this week vs ' + newPrev + ' last week to ' + lastSame.slice(5) + '.' },
      })
    }
  }

  // ── 3. GLITCHES ───────────────────────────────────────────────────────────────────────────────
  {
    const base = { key: 'glitches', label: 'Glitches' }
    if (!glitches.ok) tiles.push(failed(base, glitches.err))
    else {
      const { open, closed, newNow, newPrev } = glitches.v
      const overdue = open.filter(g => g.due_date && dayOf(g.due_date) < today)
      // Median days-to-resolve, this month: observed closed_at only (the 085 backfill is estimated).
      const spans = closed
        .filter(g => g.closed_at && g.created_at && !g.closed_at_estimated)
        .map(g => (Date.parse(g.closed_at) - Date.parse(g.created_at)) / 86400000)
        .filter(d => Number.isFinite(d) && d >= 0)
        .sort((a, b) => a - b)
      const median = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : null
      const medianTxt = median == null ? null : median < 1 ? Math.round(median * 24) + 'h' : (Math.round(median * 10) / 10) + 'd'
      const rows: ScoreRow[] = overdue
        .concat(open.filter(g => overdue.indexOf(g) < 0))
        .slice(0, 12)
        .map(g => {
          const unit = String(g.unit || 'Unit')
          const issue = String(g.overview || g.glitch_type || g.category || 'Guest issue').slice(0, 90)
          const due = g.due_date ? dayOf(g.due_date) : null
          return { text: unit + ' — ' + issue + (due && due < today ? ' · was due ' + due.slice(5) : due ? ' · by ' + due.slice(5) : '') + (g.assignee ? ' · ' + g.assignee : ''), href: '/glitches?q=' + encodeURIComponent(unit) }
        })
      tiles.push({
        ...base,
        value: String(open.length),
        sub: [overdue.length ? overdue.length + ' overdue' : '', medianTxt ? medianTxt + ' to close' : ''].filter(Boolean).join(' · ') || 'open',
        tone: overdue.length ? 'hot' : open.length ? 'quiet' : 'ok',
        delta: delta(newNow, newPrev, n => n + ' new', 'down'),
        compare: { now: newNow, prev: newPrev, unit: 'glitches logged' },
        detail: { rows, note: open.length + ' open · ' + overdue.length + ' past due · median ' + (medianTxt || '—') + ' from logged to closed on the ' + spans.length + ' closed this month (observed closed_at only) · ' + newNow + ' logged this week vs ' + newPrev + ' last week to ' + lastSame.slice(5) + '.' },
      })
    }
  }

  // ── 4 + 5. LABOR PER CLEAN, Miami and Broward — the Labor board's own buckets ────────────────
  for (const mk of [{ key: 'miami', label: 'Labor / clean · Miami' }, { key: 'broward', label: 'Labor / clean · Broward' }]) {
    const base = { key: 'lpc:' + mk.key, label: mk.label, money: true }
    if (!econNow.ok) { tiles.push(failed(base, econNow.err)); continue }
    const bNow = econNow.v.buckets.filter(b => b.key === mk.key)[0] || null
    const bPrev = econPrev.ok ? (econPrev.v.buckets.filter(b => b.key === mk.key)[0] || null) : null
    const cpc = bNow ? bNow.laborCostPerClean : null
    const cpcPrev = bPrev ? bPrev.laborCostPerClean : null
    const incomplete = !econNow.v.payrollAudit.complete
    const rows: ScoreRow[] = [
      { text: 'This week to ' + today.slice(5) + ': ' + (bNow ? bNow.cleans + ' departure cleans · ' + money(bNow.payroll) + ' housekeeper wages · ' + (bNow.hoursPerClean != null ? bNow.hoursPerClean + ' h/clean · ' : '') + (bNow.feePerClean != null ? money(bNow.feePerClean) + ' fee/clean' : '') : 'no cleans or wages yet'), href: '/labor?market=' + mk.key },
      { text: 'Last week to ' + lastSame.slice(5) + ': ' + (bPrev ? bPrev.cleans + ' cleans · ' + money(bPrev.payroll) + ' wages · ' + (cpcPrev != null ? money(cpcPrev) + ' per clean' : 'no rate') : econPrev.ok ? 'no cleans or wages' : 'could not read — ' + econPrev.err), href: '/labor?market=' + mk.key },
    ]
    tiles.push({
      ...base,
      value: cpc != null ? money(cpc) : '—',
      sub: bNow ? bNow.cleans + ' cleans' + (incomplete ? ' · payroll partial' : '') : 'no cleans yet',
      tone: incomplete ? 'warn' : cpc == null ? 'quiet' : cpcPrev != null && cpc > cpcPrev * 1.1 ? 'warn' : cpcPrev != null && cpc < cpcPrev ? 'ok' : 'quiet',
      delta: delta(cpc, cpcPrev, n => money(n), 'down'),
      compare: { now: cpc, prev: cpcPrev, unit: '$ per clean' },
      detail: { rows, note: 'Housekeeper wages (Homebase timecards, agency-loaded) ÷ departure cleans housekeepers turned in ' + (mk.key === 'miami' ? 'Miami' : 'Broward') + ' — lib/labor-econ, the same bucket the Labor board prints. Vendor-cleaned buildings are not in it. Timecards land after clock-out, so the current day is always a floor.' + (incomplete ? ' A Homebase week failed to load: wages are understated (' + econNow.v.payrollAudit.failedWeeks.join(', ') + ').' : '') },
    })
  }

  // ── 6 + 7. MAINTENANCE LABOR $ and BILLABLE $ — lib/billing's own rows ─────────────────────────
  {
    const mBase = { key: 'maint', label: 'Maintenance labor', money: true }
    const bBase = { key: 'billable', label: 'Billable labor', money: true }
    if (!billing.ok) { tiles.push(failed(mBase, billing.err)); tiles.push(failed(bBase, billing.err)) }
    else {
      const tasks = billing.v.tasks
      const tDay = (t: BillingTask) => t.scheduledDate || dayOf(t.finishedAt)
      const isMaint = (t: BillingTask) => /maint|repair|hvac|plumb|electric|pest/i.test(t.department)
      const thisW = tasks.filter(t => inRange(tDay(t), weekStart, today))
      const lastW = tasks.filter(t => inRange(tDay(t), lastStart, lastSame))
      const maintLabor = (xs: BillingTask[]) => round2(xs.filter(t => isMaint(t) && !t.excluded).reduce((a, t) => a + t.laborAmount, 0))
      const billable = (xs: BillingTask[]) => round2(xs.filter(t => !t.excluded && t.billedAmount > 0).reduce((a, t) => a + t.billedAmount, 0))
      const mNow = maintLabor(thisW), mPrev = maintLabor(lastW)
      const bNow = billable(thisW), bPrev = billable(lastW)
      const mTasks = thisW.filter(t => isMaint(t) && !t.excluded && t.laborAmount > 0)
      const bTasks = thisW.filter(t => !t.excluded && t.billedAmount > 0)
      const mtPayroll = econNow.ok ? (econNow.v.departments.filter(d => d.key === 'maintenance')[0] || null) : null
      const share = mNow > 0 ? Math.round((bNow / mNow) * 100) : null
      const taskRow = (t: BillingTask, amt: number) => ({ text: t.unit + ' — ' + t.name + ' · ' + money(amt) + (t.assignees[0]?.name ? ' · ' + t.assignees[0]!.name : '') + (t.reviewState === 'open' ? ' · to review' : ''), href: '/billing' })
      // Maintenance tasks rarely carry a Breezeway rate, so the rate side reads $0 while the crew's
      // Homebase wages are the real number. Wages lead; the rate side rides in the sub when it exists.
      const wages = mtPayroll && mtPayroll.payroll > 0 ? mtPayroll.payroll : 0
      tiles.push({
        ...mBase,
        value: money(wages > 0 ? wages : mNow),
        sub: wages > 0 ? (mtPayroll!.hours + ' h · ' + mTasks.length + ' rated task' + (mTasks.length === 1 ? '' : 's') + (mNow > 0 ? ' · ' + money(mNow) : '')) : mTasks.length + ' tasks',
        tone: 'quiet',
        delta: delta(mNow, mPrev, n => money(n), 'down'),
        compare: { now: mNow, prev: mPrev, unit: '$ maintenance labor' },
        detail: {
          rows: mTasks.sort((a, b) => b.laborAmount - a.laborAmount).slice(0, 12).map(t => taskRow(t, t.laborAmount)),
          note: 'Labor on completed maintenance-department Breezeway tasks this week (rate × hours, or the piece rate — lib/billing laborAmount; open tasks bill nothing). Last week to ' + lastSame.slice(5) + ': ' + money(mPrev) + '.' + (mtPayroll ? ' The crew\'s Homebase wages for the same days: ' + money(mtPayroll.payroll) + ' (' + mtPayroll.hours + ' h clocked).' : ''),
        },
      })
      tiles.push({
        ...bBase,
        value: money(bNow),
        sub: share != null ? share + '% of maint labor' : bTasks.length + ' tasks',
        tone: share == null ? 'quiet' : share >= 100 ? 'ok' : share < 50 ? 'warn' : 'quiet',
        delta: delta(bNow, bPrev, n => money(n), 'up'),
        compare: { now: bNow, prev: bPrev, unit: '$ billable' },
        detail: {
          rows: bTasks.sort((a, b) => b.billedAmount - a.billedAmount).slice(0, 12).map(t => taskRow(t, t.billedAmount)),
          note: 'What owners are billed for this week\'s tasks: labor + owner-billable items, overrides and exclusions honoured (lib/billing billedAmount), ' + bTasks.length + ' tasks. Last week to ' + lastSame.slice(5) + ': ' + money(bPrev) + '.' + (billing.v.missingDetail ? ' ' + billing.v.missingDetail + ' tasks have no billing detail pulled yet, so their items are missing.' : ''),
        },
      })
    }
  }

  // ── 8. CHECKLIST — today's ticks (migration 091 stores them) ─────────────────────────────────
  {
    const base = { key: 'checklist', label: 'Checklist' }
    if (!checklist.ok) tiles.push(failed(base, checklist.err))
    else if (!checklist.v.rows.length) tiles.push({ ...base, value: '—', sub: 'coming soon', tone: 'quiet', detail: { rows: [], note: 'The Daily Checklist has no items yet (or migration 091 has not run). Add items on /checklist and today\'s completion shows here.' } })
    else {
      const p = progressOf(checklist.v.rows)
      const rows: ScoreRow[] = checklist.v.rows
        .filter(r => !r.done)
        .sort((a, b) => Number(b.late) - Number(a.late) || (a.in_minutes ?? 9999) - (b.in_minutes ?? 9999))
        .slice(0, 12)
        .map(r => ({ text: (r.late ? '! ' : '· ') + r.title + (r.by_time ? ' · by ' + String(r.by_time).slice(0, 5) : '') + (r.owner_role ? ' · ' + r.owner_role : ''), href: r.link || '/checklist' }))
      tiles.push({
        ...base,
        value: p.pct + '%',
        sub: p.done + '/' + p.total + (p.late ? ' · ' + p.late + ' late' : ''),
        tone: p.late ? 'hot' : p.done === p.total ? 'ok' : 'quiet',
        compare: { now: p.pct, prev: null, unit: '% ticked today' },
        detail: { rows, note: 'Today\'s Daily Checklist: ' + p.done + ' of ' + p.total + ' ticked' + (p.late ? ', ' + p.late + ' past their time' : '') + '. Ticks are kept seven days and the list resets nightly, so there is no last-week rate yet.' },
      })
    }
  }

  return { ok: true, weekStart, weekStartDay: wsd, today, generatedAt: now.toISOString(), tiles }
}

