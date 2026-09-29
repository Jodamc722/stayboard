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
//   maintenance $   lib/labor-econ departments.maintenance payroll (Homebase wages); the lib/billing
//                   rate side (laborAmount) only when no wages were read — value, delta and compare
//                   always on the same one
//   billable $      lib/billing billingRange → billedAmount > 0, exclusions honoured; share = ÷ wages
//   checklist       lib/daily-checklist todayList + progressOf (today's ticks)
//
// ONE FAILURE NEVER 500s THE STRIP: each source is wrapped, and a tile whose read failed carries
// `degraded` with the reason instead of a number. `compare` carries the raw pair behind `delta` for
// readers that want numbers rather than a formatted delta (the review); `vs` says which days they
// are — the rate and money tiles compare SETTLED days (see buildScoreboard).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getLaborSettings } from '@/lib/labor-settings'
import { ymdET, addDays } from '@/lib/team-schedule'
import { loadCallsDesk, welcomeRate } from '@/lib/call-desk'
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
  /** What `delta` compares, in words — the settled windows differ from "this week to date". */
  vs?: string
  detail: { rows: ScoreRow[]; note?: string }
  degraded?: string
  /** Server-only: the tile prints amounts, so it is blanked for a viewer without the money perm. */
  money?: boolean
  /** Server-only: the raw pair behind `delta` — the two windows `vs` names. */
  compare?: { now: number | null; prev: number | null; unit: string }
}
export type Scoreboard = { ok: true; weekStart: string; weekStartDay: 'sunday' | 'monday'; today: string; generatedAt: string; tiles: ScoreTile[] }

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
/** A DATE column (deadline_on, paid_on, due_date, scheduled_date) — its own calendar day. */
const dayOf = (iso: any) => String(iso || '').slice(0, 10)
/** A TIMESTAMP (created_at, closed_at, finished_at) — the EASTERN day it happened on. Slicing the UTC
 *  string put everything after 8pm ET on the next day, week or month (2026-09-28 audit, P2-4). */
const etDay = (iso: any): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? String(iso).slice(0, 10) : ymdET(d)
}
/** 00:00 Eastern on an ET calendar day as a UTC instant — right through DST. Probed at 05:00Z, before
 *  the clocks change that morning, so a switch day gets the offset in force at ITS midnight. */
const etMidnight = (ymd: string): string => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ymd + 'T05:00:00Z')))
  return ymd + (h === 0 ? 'T05:00:00Z' : 'T04:00:00Z')
}
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

  // SETTLED DAYS (2026-09-28 audit, P1-8). Timecards land after clock-out and the calls close-out
  // writes the day's misses after midnight, so TODAY is always half-counted: its cleans and its
  // completed calls are in, its wages and its missed calls are not. Comparing "this week to date"
  // with a fully settled last week read green every day until evening. So the rate and money tiles
  // (welcome rate, labor per clean, maintenance, billable) compare SETTLED days on both sides — this
  // week through yesterday vs the same weekdays last week — and show today on its own line. On the
  // week's first day nothing has settled yet, so they read LAST week in full against the week before,
  // which is also what Monday's weekly review (lib/eve/review) needs to reason about.
  const yesterday = addDays(today, -1)
  const dayOne = yesterday < weekStart
  const cmpFrom = dayOne ? lastStart : weekStart
  const cmpTo = dayOne ? addDays(weekStart, -1) : yesterday
  const cmpPrevFrom = addDays(cmpFrom, -7)
  const cmpPrevTo = addDays(cmpTo, -7)
  const spanTag = dayOne ? 'last wk' : 'this wk'
  const cmpVs = dayOne
    ? 'last week (' + cmpFrom.slice(5) + ' to ' + cmpTo.slice(5) + ') vs the week before'
    : 'this week through yesterday (' + cmpFrom.slice(5) + ' to ' + cmpTo.slice(5) + ') vs the same days last week'

  const [calls, callsWeek, claims, glitches, econ, billing, checklist] = await Promise.all([
    safe(() => loadCallsDesk(sb, today)),
    // THE welcome-call rate (lib/call-desk welcomeRate) — the one Home and the Calls desk print, from
    // the paged call log. This was its own unpaged `.limit(1000)` read with a copy of the formula.
    safe(async () => {
      const [now, prev] = await Promise.all([welcomeRate(sb, cmpFrom, cmpTo), welcomeRate(sb, cmpPrevFrom, cmpPrevTo)])
      if (now.truncated || prev.truncated) throw new Error('the call log read came back short')
      return { now, prev }
    }),
    safe(async () => {
      const { data, error } = await sb.from('claims')
        .select('id,stage,property,unit_no,guest_name,deadline_on,amount_sought,amount_paid,paid_on,created_at,channel')
        .is('deleted_at', null).or(`stage.neq.closed,paid_on.gte.${monthStart},created_at.gte.${etMidnight(lastStart)}`).limit(500)
      if (error) throw new Error(error.message)
      return (data || []) as any[]
    }),
    safe(async () => {
      const [open, closed] = await Promise.all([
        sb.from('glitches').select('id,unit,status,overview,glitch_type,category,due_date,created_at,assignee')
          .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(500),
        sb.from('glitches').select('id,unit,created_at,closed_at,closed_at_estimated,status')
          .gte('closed_at', etMidnight(monthStart)).limit(1000),
      ])
      if (open.error) throw new Error(open.error.message)
      if (closed.error) throw new Error(closed.error.message)
      // New this week / last week (same days) — a count, from created_at, so the delta is about volume.
      // Eastern-midnight bounds: a glitch logged at 9pm ET on Sunday belongs to Sunday, not Monday.
      const [cntNow, cntPrev] = await Promise.all([
        sb.from('glitches').select('id', { count: 'exact', head: true }).gte('created_at', etMidnight(weekStart)),
        sb.from('glitches').select('id', { count: 'exact', head: true }).gte('created_at', etMidnight(lastStart)).lt('created_at', etMidnight(addDays(lastSame, 1))),
      ])
      return { open: (open.data || []) as any[], closed: (closed.data || []) as any[], newNow: cntNow.count || 0, newPrev: cntPrev.count || 0 }
    }),
    // THE LABOR WINDOWS ONE AFTER ANOTHER (2026-09-29 review, R1-9): each laborEconomics already fans
    // out ~18 reads, so three at once put ~54 queries in flight beside everything else on this strip.
    (async () => {
      const econNow = await safe(() => laborEconomics({ from: cmpFrom, to: cmpTo, market: 'all' }))
      const econPrev = await safe(() => laborEconomics({ from: cmpPrevFrom, to: cmpPrevTo, market: 'all' }))
      // Today on its own line — cleans so far and the wages of whoever has already clocked out.
      const econToday = await safe(() => laborEconomics({ from: today, to: today, market: 'all' }))
      return { econNow, econPrev, econToday }
    })(),
    safe(() => billingRange(cmpPrevFrom, today)),
    safe(() => todayList(now)),
  ])
  const { econNow, econPrev, econToday } = econ

  const tiles: ScoreTile[] = []

  // ── 1. WELCOME CALLS ──────────────────────────────────────────────────────────────────────────
  {
    const base = { key: 'welcome', label: 'Welcome calls' }
    if (!calls.ok) tiles.push(failed(base, calls.err))
    else {
      const due = calls.v.rows.filter(r => r.dueToday)
      const done = due.filter(r => r.done)
      // The week's completion rate — lib/call-desk welcomeRate, on the day each call was DUE, over
      // SETTLED days (today's misses are only written after midnight). Under five verdicts there is
      // no rate — one call is not "100% this week" — and the count is said instead.
      const wNow = callsWeek.ok ? callsWeek.v.now : null
      const wPrev = callsWeek.ok ? callsWeek.v.prev : null
      const pctNow = wNow ? wNow.rate : null, pctPrev = wPrev ? wPrev.rate : null
      const weekCalls = wNow ? wNow.completed + wNow.incomplete : 0
      const rows: ScoreRow[] = due
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.prio - b.prio))
        .slice(0, 12)
        .map(r => ({ text: (r.done ? '✓ ' : '· ') + (r.guest || 'Guest') + ' — ' + r.listing + (r.mandatory ? ' · ' + r.tier : '') + (r.done && r.calledBy ? ' · ' + r.calledBy : ''), href: '/welcome-calls' }))
      const rateTxt = (w: typeof wNow) => !w ? 'no rate' : w.rate != null ? w.rate + '%' : w.n ? w.text + ' (too few for a rate)' : 'no closed calls'
      tiles.push({
        ...base,
        value: done.length + '/' + due.length,
        sub: pctNow != null ? pctNow + '% ' + spanTag : wNow && wNow.n ? wNow.text + ' ' + spanTag : 'due today',
        tone: due.length && done.length === due.length ? 'ok' : due.length - done.length >= 3 ? 'hot' : due.length > done.length ? 'warn' : 'quiet',
        delta: delta(pctNow, pctPrev, n => n + ' pts', 'up'),
        vs: cmpVs,
        compare: { now: pctNow, prev: pctPrev, unit: '% completed' },
        detail: {
          rows,
          note: 'Today: ' + done.length + ' of ' + due.length + ' arrivals called. Completion rate, ' + cmpVs + ': ' + rateTxt(wNow) +
            ' (' + weekCalls + ' closed calls) vs ' + rateTxt(wPrev) + '. Rate = completed ÷ (completed + incomplete), the Calls desk formula; open calls and today are not a verdict yet, and under 5 closed calls there is no rate.' +
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
      const newNow = all.filter(c => inRange(etDay(c.created_at), weekStart, today)).length
      const newPrev = all.filter(c => inRange(etDay(c.created_at), lastStart, lastSame)).length
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
      // No median off one or two closes (the sample rule, lib/money pctOrCount): under five, the
      // tile says how many closed instead of quoting one glitch's time as "the" time to close.
      const MEDIAN_MIN = 5
      const median = spans.length >= MEDIAN_MIN ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : null
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
        detail: { rows, note: open.length + ' open · ' + overdue.length + ' past due · ' + (medianTxt ? 'median ' + medianTxt + ' from logged to closed on the ' + spans.length + ' closed this month' : spans.length + ' closed this month — too few for a median (under ' + MEDIAN_MIN + ')') + ' (observed closed_at only) · ' + newNow + ' logged this week vs ' + newPrev + ' last week to ' + lastSame.slice(5) + '.' },
      })
    }
  }

  // ── 4 + 5. LABOR PER CLEAN, Miami and Broward — the Labor board's own buckets ────────────────
  for (const mk of [{ key: 'miami', label: 'Labor / clean · Miami' }, { key: 'broward', label: 'Labor / clean · Broward' }]) {
    const base = { key: 'lpc:' + mk.key, label: mk.label, money: true }
    if (!econNow.ok) { tiles.push(failed(base, econNow.err)); continue }
    const bNow = econNow.v.buckets.filter(b => b.key === mk.key)[0] || null
    const bPrev = econPrev.ok ? (econPrev.v.buckets.filter(b => b.key === mk.key)[0] || null) : null
    const bToday = econToday.ok ? (econToday.v.buckets.filter(b => b.key === mk.key)[0] || null) : null
    const cpc = bNow ? bNow.laborCostPerClean : null
    const cpcPrev = bPrev ? bPrev.laborCostPerClean : null
    const incomplete = !econNow.v.payrollAudit.complete
    const where = '/labor?market=' + mk.key
    const rows: ScoreRow[] = [
      { text: (dayOne ? 'Last week' : 'This week') + ', ' + cmpFrom.slice(5) + ' to ' + cmpTo.slice(5) + ': ' + (bNow ? bNow.cleans + ' departure cleans · ' + money(bNow.payroll) + ' housekeeper wages · ' + (bNow.hoursPerClean != null ? bNow.hoursPerClean + ' h/clean · ' : '') + (bNow.feePerClean != null ? money(bNow.feePerClean) + ' fee/clean' : '') : 'no cleans or wages'), href: where },
      { text: 'Today so far: ' + (bToday ? bToday.cleans + ' cleans · ' + money(bToday.payroll) + ' wages clocked out — not a cost per clean until the day settles' : econToday.ok ? 'no cleans yet' : 'could not read — ' + econToday.err), href: where },
      { text: (dayOne ? 'The week before' : 'Last week') + ', ' + cmpPrevFrom.slice(5) + ' to ' + cmpPrevTo.slice(5) + ': ' + (bPrev ? bPrev.cleans + ' cleans · ' + money(bPrev.payroll) + ' wages · ' + (cpcPrev != null ? money(cpcPrev) + ' per clean' : 'no rate') : econPrev.ok ? 'no cleans or wages' : 'could not read — ' + econPrev.err), href: where },
    ]
    tiles.push({
      ...base,
      value: cpc != null ? money(cpc) : '—',
      sub: bNow ? bNow.cleans + ' cleans · ' + spanTag + (incomplete ? ' · payroll partial' : '') : dayOne ? 'no cleans last wk' : 'no settled days yet',
      tone: incomplete ? 'warn' : cpc == null ? 'quiet' : cpcPrev != null && cpc > cpcPrev * 1.1 ? 'warn' : cpcPrev != null && cpc < cpcPrev ? 'ok' : 'quiet',
      delta: delta(cpc, cpcPrev, n => money(n), 'down'),
      vs: cmpVs,
      compare: { now: cpc, prev: cpcPrev, unit: '$ per clean' },
      detail: { rows, note: 'Housekeeper wages (Homebase timecards, agency-loaded) ÷ departure cleans housekeepers turned in ' + (mk.key === 'miami' ? 'Miami' : 'Broward') + ' — lib/labor-econ, the same bucket the Labor board prints. Vendor-cleaned buildings are not in it. Compared on settled days, ' + cmpVs + ': timecards land after clock-out, so today would count its cleans but not yet its wages. Today is on its own line.' + (incomplete ? ' A Homebase week failed to load: wages are understated (' + econNow.v.payrollAudit.failedWeeks.join(', ') + ').' : '') },
    })
  }

  // ── 6 + 7. MAINTENANCE LABOR $ and BILLABLE $ — lib/billing's own rows ─────────────────────────
  {
    const mBase = { key: 'maint', label: 'Maintenance labor', money: true }
    const bBase = { key: 'billable', label: 'Billable labor', money: true }
    if (!billing.ok) { tiles.push(failed(mBase, billing.err)); tiles.push(failed(bBase, billing.err)) }
    else {
      const tasks = billing.v.tasks
      // scheduledDate is a DATE; finishedAt a timestamp — its Eastern day.
      const tDay = (t: BillingTask) => t.scheduledDate || etDay(t.finishedAt)
      const isMaint = (t: BillingTask) => /maint|repair|hvac|plumb|electric|pest/i.test(t.department)
      const thisW = tasks.filter(t => inRange(tDay(t), cmpFrom, cmpTo))
      const lastW = tasks.filter(t => inRange(tDay(t), cmpPrevFrom, cmpPrevTo))
      const todayT = tasks.filter(t => tDay(t) === today)
      const maintLabor = (xs: BillingTask[]) => round2(xs.filter(t => isMaint(t) && !t.excluded).reduce((a, t) => a + t.laborAmount, 0))
      const billable = (xs: BillingTask[]) => round2(xs.filter(t => !t.excluded && t.billedAmount > 0).reduce((a, t) => a + t.billedAmount, 0))
      const mNow = maintLabor(thisW), mPrev = maintLabor(lastW)
      const bNow = billable(thisW), bPrev = billable(lastW), bToday = billable(todayT)
      const mTasks = thisW.filter(t => isMaint(t) && !t.excluded && t.laborAmount > 0)
      const bTasks = thisW.filter(t => !t.excluded && t.billedAmount > 0)
      const mtOf = (e: typeof econNow) => e.ok ? (e.v.departments.filter(d => d.key === 'maintenance')[0] || null) : null
      const mtNow = mtOf(econNow), mtPrev = mtOf(econPrev), mtToday = mtOf(econToday)
      const taskRow = (t: BillingTask, amt: number) => ({ text: t.unit + ' — ' + t.name + ' · ' + money(amt) + (t.assignees[0]?.name ? ' · ' + t.assignees[0]!.name : '') + (t.reviewState === 'open' ? ' · to review' : ''), href: '/billing' })
      // ONE BASIS PER TILE (2026-09-28 audit, P0-6). Maintenance tasks rarely carry a Breezeway rate,
      // so the rate side reads near $0 while the crew's Homebase wages are the real cost. The tile
      // used to SHOW wages but compute its delta, its `compare` (what Eve's weekly review reads) and
      // the billable share on the rate side — three numbers measuring something other than the one
      // on screen, and a share divided by almost nothing that painted itself green. Now all of them
      // are wages whenever Homebase has this week's; only when it does not does the tile fall back to
      // the rate side, all three together, and say so.
      const onWages = !!(mtNow && mtNow.payroll > 0)
      const mVal = onWages ? mtNow!.payroll : mNow
      const mPrevVal = onWages ? (mtPrev ? mtPrev.payroll : null) : mPrev
      tiles.push({
        ...mBase,
        value: money(mVal),
        sub: onWages
          ? mtNow!.hours + ' h · ' + spanTag + (mNow > 0 ? ' · ' + money(mNow) + ' rated' : '')
          : mTasks.length + ' rated task' + (mTasks.length === 1 ? '' : 's') + ' · ' + spanTag + ' · no wages read',
        tone: 'quiet',
        delta: delta(mVal, mPrevVal, n => money(n), 'down'),
        vs: cmpVs,
        compare: { now: mVal, prev: mPrevVal, unit: onWages ? '$ maintenance wages (Homebase)' : '$ maintenance labor (Breezeway rate)' },
        detail: {
          rows: mTasks.sort((a, b) => b.laborAmount - a.laborAmount).slice(0, 12).map(t => taskRow(t, t.laborAmount)),
          note: (onWages
            ? 'The maintenance crew\'s Homebase wages, ' + cmpVs + ': ' + money(mVal) + ' (' + mtNow!.hours + ' h clocked) vs ' + (mPrevVal != null ? money(mPrevVal) : 'no wages read') + '.'
            : 'Homebase wages did not load, so this reads the Breezeway rate side instead — labor on completed maintenance tasks (lib/billing laborAmount), ' + cmpVs + ': ' + money(mNow) + ' vs ' + money(mPrev) + '.') +
            ' Rated Breezeway task labor for the same days: ' + money(mNow) + ' on ' + mTasks.length + ' task' + (mTasks.length === 1 ? '' : 's') + '.' +
            ' Today so far: ' + (mtToday ? money(mtToday.payroll) + ' wages clocked out' : 'no wages read yet') + '.',
        },
      })
      // Billable ÷ WAGES — the Labor board's billableCoveragePct basis. No wages, no share.
      const share = onWages ? Math.round((bNow / mtNow!.payroll) * 100) : null
      tiles.push({
        ...bBase,
        value: money(bNow),
        sub: share != null ? share + '% of maint wages' : bTasks.length + ' tasks · ' + spanTag,
        tone: share == null ? 'quiet' : share >= 100 ? 'ok' : share < 50 ? 'warn' : 'quiet',
        delta: delta(bNow, bPrev, n => money(n), 'up'),
        vs: cmpVs,
        compare: { now: bNow, prev: bPrev, unit: '$ billable' },
        detail: {
          rows: bTasks.sort((a, b) => b.billedAmount - a.billedAmount).slice(0, 12).map(t => taskRow(t, t.billedAmount)),
          note: 'What owners are billed for tasks, ' + cmpVs + ': labor + owner-billable items, overrides and exclusions honoured (lib/billing billedAmount), ' + bTasks.length + ' tasks, ' + money(bNow) + ' vs ' + money(bPrev) + '.' +
            (share != null ? ' That is ' + share + '% of the maintenance crew\'s wages for the same days.' : ' No maintenance wages were read, so there is no coverage %.') +
            ' Today so far: ' + money(bToday) + '.' +
            (billing.v.missingDetail ? ' ' + billing.v.missingDetail + ' tasks have no billing detail pulled yet, so their items are missing.' : ''),
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

