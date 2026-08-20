// DAILY LABOR — ONE EMAIL (Jon, 2026-08-18: "the daily labor true up for 30 days and
// yesterday's labor and projected today should show on one email. Make it easy and great
// instead of 3 different emails").
//
// This route used to be the 30-day true-up alone, with yesterday living in labor-daily and the
// week in labor-weekly. Those crons are retired; everything labor now arrives here, once a
// morning, in reading order:
//   1. TODAY — the staffing plan: expected cleans, the hours they need, the most hours the
//      target margin allows, what Homebase actually has scheduled, and the days to fix.
//   2. YESTERDAY — what happened: departure cleans, net revenue, housekeeping payroll, margin,
//      cost per clean, plus the schedule flags (no-shows, late clock-ins, open timecards).
//   3. SETTLED — the trailing 30 days for housekeeping and 45 for maintenance (charges land
//      late), with what moved since the last run and where every cleaning fee landed.
// Every number is the shared engine's (lib/labor-econ) or the planner's (lib/labor-plan) — the
// same figures as the Labor board, the Weekly planner and the morning brief, so no two screens
// or emails can disagree.
//
// NEVER ON PARTIAL PAYROLL. Any engine window that came back with missing Homebase weeks skips
// the snapshot and the send — better a quiet morning than a wrong number remembered as truth.
//
// GET                → run, store the snapshot, send
// GET ?force=1       → run and always email
// GET ?preview=1     → return the HTML without sending or storing (signed in)
// GET ?test=1        → send to YOU only
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { laborEconomics } from '@/lib/labor-econ'
import { sendGmail } from '@/lib/gmail-send'
import { storeForwardSnapshot, buildWeekPlan, projectCleaners } from '@/lib/labor-plan'
import { getShifts } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { computeYesterdayLabor } from '@/lib/labor-daily'
import { weeklyKpiCard } from '@/lib/kpi-week'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const pctTxt = (n: number | null | undefined) => (n == null ? '&mdash;' : Math.round(n) + '%')
const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const niceDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })

type Snap = {
  from: string; to: string; takenAt: string
  // Maintenance is measured over its own, longer window (charges land late).
  maintFrom?: string
  cleans: number; cleaningRevenue: number; hkRevenue?: number; credited: number
  billable: number; payroll: number; margin: number
  costPerClean: number | null
  // HOUSEKEEPING payroll on its own. Cost per clean is housekeepers only (Jon, 2026-08-17: "not
  // with supervisors"), so the payroll printed beside it has to be the SAME base — otherwise the
  // line invites the reader to divide all-in payroll by cleans and get a number that contradicts
  // the one next to it. All-in stays available as `payroll`, on its own line, clearly labelled.
  hkPayroll?: number
  // Per-market housekeeping economics, so the morning brief can show a SETTLED Miami-vs-Broward
  // comparison instead of one noisy day (Jon, 2026-08-17: "need to see how Miami is performing
  // and Broward"). Payroll is already split across markets in proportion to each housekeeper's
  // cleans there, so someone working both markets is never counted twice.
  markets?: { key: string; label: string; inHouse: boolean; cleans: number; revenue: number; payroll: number; costPerClean: number | null; hoursPerClean: number | null; margin: number; marginPct: number | null }[]
}

const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left'
const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
const cardStyle = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0'
const secTitle = (t: string, sub: string) =>
  '<p style="margin:0 0 8px;font-size:13px;font-weight:700">' + t +
  (sub ? ' <span style="color:#9ca3af;font-weight:400;font-size:12px">' + sub + '</span>' : '') + '</p>'

/** A row that shows then, now, and the difference — the difference is the whole point. */
function deltaRow(label: string, then: number | null, now: number, fmt: (n: any) => string) {
  const d = then == null ? null : now - then
  const color = d == null ? '#6b7280' : d > 0 ? '#047857' : d < 0 ? '#dc2626' : '#6b7280'
  const sign = d == null ? '' : d > 0 ? '+' : ''
  return '<tr><td style="' + td + '">' + label + '</td>' +
    '<td style="' + td + ';text-align:right;color:#6b7280">' + (then == null ? 'first run' : fmt(then)) + '</td>' +
    '<td style="' + td + ';text-align:right"><b>' + fmt(now) + '</b></td>' +
    '<td style="' + td + ';text-align:right;color:' + color + ';font-weight:600">' + (d == null ? '&mdash;' : sign + fmt(d)) + '</td></tr>'
}

const tile = (big: string, label: string, sub: string, color?: string) =>
  '<td style="padding:10px 8px;text-align:center;vertical-align:top">' +
  '<div style="font-size:22px;font-weight:800;color:' + (color || '#111827') + '">' + big + '</div>' +
  '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:700;margin-top:2px">' + label + '</div>' +
  (sub ? '<div style="font-size:11px;color:#9ca3af;margin-top:1px">' + sub + '</div>' : '') + '</td>'
const mTone = (n: number) => (n < 0 ? '#dc2626' : '#047857')
const RED = 'color:#dc2626;font-weight:600'
const AMBER = 'color:#b45309;font-weight:600'
const GREEN = 'color:#047857;font-weight:600'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const preview = sp.get('preview') === '1'
  const test = sp.get('test') === '1'
  const force = sp.get('force') === '1'
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if ((preview || test) && !user) return NextResponse.json({ error: 'sign in' }, { status: 401 })

    const now = new Date()
    const today = dISO(now)
    const to = dISO(addDays(now, -1))               // yesterday: today is still moving
    const from = dISO(addDays(now, -30))
    // MAINTENANCE RUNS ON A LONGER WINDOW (Jon, 2026-08-18): maintenance revenue lands late —
    // charges get typed into Breezeway days or weeks after the work — so a 30-day maintenance
    // margin is chronically understated. HK settles fast (fees are earned at checkout), so HK
    // stays on 30 days and maintenance gets 45. Engine runs are SEQUENTIAL on purpose:
    // parallel runs would double up on Homebase and trip its rate limiting.
    const maintFrom = dISO(addDays(now, -45))
    const ecY = await laborEconomics({ from: to, to, market: 'all' })     // yesterday
    const ec = await laborEconomics({ from, to, market: 'all' })          // HK 30d
    const ecM = await laborEconomics({ from: maintFrom, to, market: 'all' })  // maintenance 45d
    // NEVER SEND ON PARTIAL PAYROLL. A snapshot taken while Homebase was rate-limiting would
    // store understated payroll as "settled truth" and poison the brief's 30-day line until the
    // next clean run. Better to skip a day than to remember a wrong number.
    const badAudit = [ecY.payrollAudit, ec.payrollAudit, ecM.payrollAudit].find(a => a && !a.complete)
    if (badAudit) {
      return NextResponse.json({
        ok: false, sent: false, snapshotStored: false,
        reason: 'payroll incomplete — Homebase did not return timecards for: ' + badAudit.failedWeeks.join(', '),
      }, { status: 503 })
    }
    const K = ec.kpi
    const KY = ecY.kpi
    // Maintenance figures come from the 45-day run everywhere below.
    const M = ecM.kpi.maintenance

    // ── 1. TODAY — the staffing plan ───────────────────────────────────────
    // Additive: a planner hiccup never blocks the labor email.
    let todayCard = ''
    let todayCleans: number | null = null
    try {
      const plan = await buildWeekPlan()
      const d0 = plan.days.filter(d => d.date === today)[0]
      if (d0) {
        todayCleans = d0.projectedCleans
        const mkBits = d0.byMarket.map(m => esc(m.label) + ' ' + m.cleans).join(' &middot; ')
        const fut = plan.days.filter(d => !d.isPast && (d.projectedCleans > 0 || (d.scheduledHours || 0) > 0))
        const short = fut.filter(d => d.verdict === 'under_floor')
          .map(d => d.day + ' &minus;' + r1(Math.max(0, d.floorHours - (d.scheduledHours || 0))) + 'h')
        const over = fut.filter(d => d.verdict === 'over_budget')
          .map(d => d.day + ' +' + r1(Math.max(0, (d.scheduledHours || 0) - (d.budgetHours || d.floorHours))) + 'h')
        const verdictTxt = d0.verdict === 'under_floor'
          ? '<span style="' + AMBER + '">under-staffed for the work booked</span>'
          : d0.verdict === 'over_budget'
            ? '<span style="' + RED + '">over the hours budget</span>'
            : d0.verdict === 'on_budget' ? '<span style="' + GREEN + '">on budget</span>' : ''
        todayCard = '<div style="' + cardStyle + '">' +
          secTitle('Today &mdash; the plan', niceDay(today) + ' &middot; target ' + plan.targetMarginPct + '% kept') +
          '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
          tile(String(d0.projectedCleans || 0), 'Cleans expected', mkBits || 'none booked') +
          tile(d0.floorHours ? r1(d0.floorHours) + 'h' : '&mdash;', 'Hours the work needs', 'incl. unmatched-hours share') +
          tile(d0.budgetHours ? r1(d0.budgetHours) + 'h' : '&mdash;', 'Hours budget', 'most the target allows') +
          tile(d0.scheduledHours != null ? r1(d0.scheduledHours) + 'h' : '&mdash;', 'Homebase scheduled',
            d0.marginAtScheduledPct != null ? 'keeps ' + d0.marginAtScheduledPct + '%' : '') +
          '</tr></table>' +
          (verdictTxt ? '<p style="margin:4px 0 0;font-size:12.5px">' + verdictTxt + '</p>' : '') +
          ((short.length || over.length)
            ? '<p style="margin:6px 0 0;font-size:12px;color:#374151"><b>Rest of week:</b> ' +
              (short.length ? '<span style="' + AMBER + '">short: ' + short.join(', ') + '</span>' : '') +
              (short.length && over.length ? ' &middot; ' : '') +
              (over.length ? '<span style="' + RED + '">over budget: ' + over.join(', ') + '</span>' : '') + '</p>'
            : '<p style="margin:6px 0 0;font-size:12px;color:#047857">Rest of week is on plan.</p>') +
          '<p style="margin:6px 0 0;font-size:11px;color:#9ca3af"><a href="https://lighthouse-stay.vercel.app/schedule?tab=weekly" style="color:#2563eb">Open the Weekly planner</a> to move hours.</p>' +
          '</div>'
        // PER-CLEANER, PROFIT-FIRST (Jon, 2026-08-19: "base hours on work and rev to make
        // sure profitable"): what each cleaner's assigned cleans earn, the hours that revenue
        // supports at the target margin, and her actual shift.
        try {
          const proj = await projectCleaners(today)
          const ppl = proj.people.filter(pp => pp.cleans > 0)
          if (ppl.length) {
            const rowsP = ppl.map(pp => {
              const over = pp.scheduledHours != null && pp.scheduledHours > pp.budgetHours
              const readTxt = pp.scheduledHours == null ? '<span style="color:#9ca3af">no shift found</span>'
                : over ? '<span style="' + RED + '">over by ' + r1((pp.scheduledHours as number) - pp.budgetHours) + 'h</span>'
                : '<span style="' + GREEN + '">profitable' + (pp.marginAtScheduledPct != null ? ' · keeps ' + pp.marginAtScheduledPct + '%' : '') + '</span>'
              return '<tr><td style="' + td + '"><b>' + esc(pp.name) + '</b> <span style="color:#9ca3af;font-size:11px">' + pp.byMarket.map(bm => bm.market + ' ' + bm.cleans).join(' · ') + '</span></td>' +
                '<td style="' + td + ';text-align:right">' + pp.cleans + '</td>' +
                '<td style="' + td + ';text-align:right">' + money(pp.revenue) + '</td>' +
                '<td style="' + td + ';text-align:right"><b>' + pp.budgetHours + 'h</b></td>' +
                '<td style="' + td + ';text-align:right">' + (pp.scheduledHours != null ? pp.scheduledHours + 'h' : '&mdash;') + '</td>' +
                '<td style="' + td + '">' + readTxt + '</td></tr>'
            }).join('')
            todayCard += '<div style="' + cardStyle + '">' +
              secTitle('Cleaner hours today', 'profitable at ' + proj.targetMarginPct + '%? &middot; hours budget = net revenue of assigned cleans &times; (1 &minus; target) &divide; wage') +
              '<table width="100%" cellspacing="0" cellpadding="0">' +
              '<tr><th style="' + th + '">Cleaner</th><th style="' + th + ';text-align:right">Cleans</th>' +
              '<th style="' + th + ';text-align:right">Earns</th><th style="' + th + ';text-align:right">Hours it affords</th>' +
              '<th style="' + th + ';text-align:right">Shift</th><th style="' + th + '">Read</th></tr>' + rowsP + '</table>' +
              '<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Finish inside the budget and the day is profitable at target. A clean with two names counts half to each; unassigned cleans show on the ops brief priorities.</p>' +
              '</div>'
          }
        } catch { /* additive */ }
      }
    } catch { /* plan section is additive */ }

    // ── 2. YESTERDAY — what happened ───────────────────────────────────────
    // Money from the same 1-day engine run every screen uses; schedule flags from Homebase.
    let flagsLine = ''
    try {
      const [ySh, yTc, lset] = await Promise.all([
        getShifts(to, TZ), getTimecards(to, to), getLaborSettings('default'),
      ])
      const fl = computeYesterdayLabor(to, ySh, yTc, lset)
      const bits: string[] = []
      if (fl.noShows.length) bits.push('<span style="' + RED + '">' + fl.noShows.length + ' scheduled, never clocked in</span> (' + fl.noShows.slice(0, 3).map(x => esc(x.name)).join(', ') + (fl.noShows.length > 3 ? '…' : '') + ')')
      if (fl.lateClockIns.length) bits.push(fl.lateClockIns.length + ' late clock-in' + (fl.lateClockIns.length === 1 ? '' : 's') + ' (' + fl.lateClockIns.slice(0, 3).map(x => esc(x.name) + ' +' + x.minutesLate + 'm').join(', ') + ')')
      if (fl.overSchedule.length) bits.push(fl.overSchedule.length + ' worked past schedule (' + fl.overSchedule.slice(0, 3).map(x => esc(x.name) + ' +' + x.overByHours + 'h').join(', ') + ')')
      if (fl.missedClockOuts.length) bits.push(fl.missedClockOuts.length + ' timecard' + (fl.missedClockOuts.length === 1 ? '' : 's') + ' left open')
      flagsLine = '<p style="margin:6px 0 0;font-size:12px;color:#6b7280"><b>' + fl.totalHoursWorked + 'h</b> worked by ' + fl.headcount + ' people (' + fl.totalScheduledHours + 'h scheduled)' +
        (bits.length ? ' &middot; ' + bits.join(' &middot; ') : ' &middot; <span style="color:#047857">no schedule flags</span>') + '</p>'
    } catch { /* flags are additive */ }
    const yHL = KY.housekeepingLoaded || null
    // YESTERDAY IS ALWAYS A FIRST DRAFT. The morning after, a chunk of yesterday's fees sit on
    // cleans nobody has closed in Breezeway yet — so cost/clean reads HIGH and settles down as
    // paperwork lands. Say it out loud whenever the unclosed share is material, and point at the
    // settled figure as the one to manage on.
    const yA: any = ecY.feeAudit || {}
    const yUnclosed = Number(yA.cleanNotClosed) || 0
    const yTotalFees = yUnclosed + (Number(yA.credited) || 0) + (Number(yA.noCleanFound) || 0) + (Number(yA.cleanNoAssignee) || 0)
    const maturityLine = yTotalFees > 0 && yUnclosed / yTotalFees > 0.1
      ? '<p style="margin:6px 0 0;font-size:12px;color:#b45309"><b>' + money(yUnclosed) + ' of yesterday&rsquo;s cleaning fees sit on cleans not yet closed in Breezeway</b> — cost/clean reads high until that paperwork lands. Manage on the settled 30-day figure below; yesterday trues up in it automatically.</p>'
      : ''
    const yesterdayCard = '<div style="' + cardStyle + '">' +
      secTitle('Yesterday', niceDay(to) + ' &middot; net of channel cut') +
      '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
      tile(String(KY.housekeeping.cleans || 0), 'Departure cleans', r1(KY.housekeeping.hoursPerClean || 0) + 'h each') +
      tile(money(KY.housekeeping.revenueWithCharged != null ? KY.housekeeping.revenueWithCharged : KY.housekeeping.revenue), 'HK revenue', 'incl. charged cleaning work') +
      tile(money(KY.housekeeping.payroll), 'HK payroll', KY.housekeeping.costPerClean != null ? money(KY.housekeeping.costPerClean) + ' / clean' : '') +
      tile(pctTxt(KY.housekeeping.marginPct), 'HK margin', money(KY.housekeeping.margin) + ' kept', mTone(KY.housekeeping.margin)) +
      (yHL ? tile(pctTxt(yHL.marginPct), '+ Supervisors', money(yHL.costPerClean) + ' loaded / clean', mTone(yHL.margin)) : '') +
      tile(money(KY.maintenance.revenue), 'Maint billed', 'vs ' + money(KY.maintenance.payroll) + ' wages &middot; separate dept', mTone(KY.maintenance.margin)) +
      '</tr></table>' + maturityLine + flagsLine + '</div>'

    // ── 2b. WEEKLY KPI REVIEW (Jon, 2026-08-20: "Need a weekly kpi review in the brief. The
    // KPI weeks are Sunday - Saturday. This can be included in the labor brief"). Built by
    // lib/kpi-week on the KPI board's own engine; returns '' on any failure — additive.
    const weekCard = await weeklyKpiCard()

    // ── 3. SETTLED — HK 30d, maintenance 45d ──────────────────────────────
    const prev = await getSetting<Snap | null>('labor_trueup_snapshot', null).catch(() => null)
    const snap: Snap = {
      from, to, takenAt: new Date().toISOString(),
      maintFrom,
      cleans: K.housekeeping.cleans,
      cleaningRevenue: ec.cleaningRevenue,        // in-house, all crews — the same base 'credited' is drawn from
      hkRevenue: K.housekeeping.revenue,
      credited: ec.feeAudit ? ec.feeAudit.credited : 0,
      billable: M.billable,
      payroll: K.allIn.payroll,
      margin: K.allIn.margin,
      costPerClean: K.housekeeping.costPerClean,
      hkPayroll: K.housekeeping.payroll,
      markets: (ec.buckets || []).filter((b: any) => b.cleans > 0 || b.payroll > 0).map((b: any) => ({
        key: String(b.key), label: String(b.label), inHouse: !!b.inHouse,
        cleans: b.cleans, revenue: b.cleaningRevenue, payroll: b.payroll,
        costPerClean: b.laborCostPerClean, hoursPerClean: b.hoursPerClean,
        margin: b.margin, marginPct: b.marginPct,
      })),
    }

    // ── what settled since last time ───────────────────────────────────────
    const rows =
      deltaRow('Revenue cleans', prev ? prev.cleans : null, snap.cleans, (n: any) => String(Math.round(n))) +
      deltaRow('In-house cleaning revenue', prev ? prev.cleaningRevenue : null, snap.cleaningRevenue, money) +
      deltaRow('Housekeeping share of it', prev && prev.hkRevenue != null ? prev.hkRevenue : null, K.housekeeping.revenue, money) +
      deltaRow('Fees credited to a person', prev ? prev.credited : null, snap.credited, money) +
      deltaRow('Maintenance billable (45d)', prev ? prev.billable : null, snap.billable, money) +
      deltaRow('Payroll (all in)', prev ? prev.payroll : null, snap.payroll, money) +
      deltaRow('Margin (all in)', prev ? prev.margin : null, snap.margin, money) +
      deltaRow('Cost per clean', prev ? prev.costPerClean : null, snap.costPerClean ?? 0, money)

    // ── where every fee landed, this window ────────────────────────────────
    const A = ec.feeAudit || {}
    const auditRows = [
      ['Credited to a person', A.credited, 'matched to a clean somebody closed'],
      ['Clean never closed', A.cleanNotClosed, 'on the board, finished in real life, not in Breezeway'],
      ['Clean had no assignee', A.cleanNoAssignee, 'closed, but nobody is named on it'],
      ['No clean found at all', A.noCleanFound, 'no task within a week either side of the checkout'],
    ].map(([l, v, why]) =>
      '<tr><td style="' + td + '">' + l + '<br><span style="color:#9ca3af;font-size:11.5px">' + why + '</span></td>' +
      '<td style="' + td + ';text-align:right">' + money(Number(v) || 0) + '</td></tr>').join('')

    const movedTxt = A.movedCleansMatched
      ? A.movedCleansMatched + ' clean' + (A.movedCleansMatched === 1 ? '' : 's') + ' matched on a different day than the checkout' +
        (A.movedOffsets && Object.keys(A.movedOffsets).length
          ? ' (' + Object.keys(A.movedOffsets).sort((a, b) => Number(a) - Number(b))
              .map(k => (Number(k) > 0 ? '+' : '') + k + 'd × ' + A.movedOffsets[k]).join(', ') + ')'
          : '')
      : 'every matched clean sat on the checkout day or the morning after'

    const HL = K.housekeepingLoaded || null
    const headline =
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:12px 0">' +
      '<p style="margin:2px 4px 4px;font-size:13px;font-weight:700">Settled &middot; HK trailing 30 days &middot; maintenance trailing 45</p>' +
      '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
      tile(money(K.housekeeping.costPerClean), 'Cost / clean', r1(K.housekeeping.hoursPerClean || 0) + 'h each &middot; ' + K.housekeeping.cleans + ' departure cleans') +
      tile(money(K.housekeeping.margin), 'HK margin', money(K.housekeeping.revenue) + ' rev vs ' + money(K.housekeeping.payroll) + ' labor', mTone(K.housekeeping.margin)) +
      tile(pctTxt(K.housekeeping.marginPct), 'HK margin %', 'incl. billable cleaning work', mTone(K.housekeeping.margin)) +
      (HL ? tile(pctTxt(HL.marginPct), '+ Supervisors', money(HL.margin) + ' on ' + money(HL.payroll) + ' loaded labor &middot; ' + money(HL.costPerClean) + '/clean', mTone(HL.margin)) : '') +
      tile(pctTxt(M.marginPct), 'Maintenance &middot; 45d', money(M.revenue) + ' billed vs ' + money(M.payroll) + ' &middot; separate dept', mTone(M.margin)) +
      '</tr></table></div>'

    const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
      '<div style="max-width:720px;margin:0 auto;padding:18px">' +
      '<div style="background:#111827;border-radius:12px;padding:16px 18px">' +
      '<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S T A Y &nbsp; H O S P I T A L I T Y</p>' +
      '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Daily Labor &mdash; today&rsquo;s plan &middot; yesterday &middot; settled</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">' + niceDay(today) + ' &middot; HK ' + from + ' to ' + to + ' &middot; maintenance since ' + maintFrom +
      (prev ? ' &middot; compared with the run on ' + String(prev.takenAt).slice(0, 10) : ' &middot; first run, nothing to compare yet') + '</p></div>' +
      todayCard +
      yesterdayCard +
      weekCard +
      headline +
      '<div style="' + cardStyle + '">' +
      secTitle('What settled since the last run', 'paperwork catching up on work already done') +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">Measure</th><th style="' + th + ';text-align:right">Last run</th>' +
      '<th style="' + th + ';text-align:right">Now</th><th style="' + th + ';text-align:right">Change</th></tr>' +
      rows + '</table>' +
      '</div>' +
      '<div style="' + cardStyle + '">' +
      secTitle('Where every cleaning fee landed', 'trailing 30 days') +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">Outcome</th><th style="' + th + ';text-align:right">Fees</th></tr>' + auditRows + '</table>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">' + movedTxt + '.</p>' +
      '</div>' +
      '<div style="' + cardStyle + '">' +
      secTitle('The settled picture', 'HK 30 days &middot; maintenance 45') +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">Crew</th><th style="' + th + ';text-align:right">Revenue</th>' +
      '<th style="' + th + ';text-align:right">Payroll</th><th style="' + th + ';text-align:right">Margin</th>' +
      '<th style="' + th + ';text-align:right">Margin %</th></tr>' +
      '<tr><td style="' + td + '"><b>Housekeeping</b><br><span style="color:#6b7280;font-size:11.5px">' + K.housekeeping.cleans +
        ' revenue cleans &middot; ' + money(K.housekeeping.costPerClean) + ' / clean &middot; ' + r1(K.housekeeping.hoursPerClean || 0) + 'h each</span></td>' +
      '<td style="' + td + ';text-align:right">' + money(K.housekeeping.revenue) + '</td>' +
      '<td style="' + td + ';text-align:right">' + money(K.housekeeping.payroll) + '</td>' +
      '<td style="' + td + ';text-align:right">' + money(K.housekeeping.margin) + '</td>' +
      '<td style="' + td + ';text-align:right">' + pctTxt(K.housekeeping.marginPct) + '</td></tr>' +
      (HL
        ? '<tr><td style="' + td + '"><b>+ Supervisors</b><br><span style="color:#6b7280;font-size:11.5px">same revenue, supervision loaded on &middot; ' + money(HL.costPerClean) + ' loaded / clean</span></td>' +
          '<td style="' + td + ';text-align:right">' + money(HL.revenue) + '</td>' +
          '<td style="' + td + ';text-align:right">' + money(HL.payroll) + '</td>' +
          '<td style="' + td + ';text-align:right">' + money(HL.margin) + '</td>' +
          '<td style="' + td + ';text-align:right">' + pctTxt(HL.marginPct) + '</td></tr>'
        : '') +
      '<tr><td style="' + td + ';border-top:2px solid #111827"><b>Maintenance</b> <span style="color:#6b7280;font-size:11.5px">separate department &middot; trailing 45 days</span><br><span style="color:#6b7280;font-size:11.5px">' + M.tasksBilled +
        ' billed &middot; ' + M.tasksNoCharge + ' with no charge entered</span></td>' +
      '<td style="' + td + ';text-align:right">' + money(M.revenue) + '</td>' +
      '<td style="' + td + ';text-align:right">' + money(M.payroll) + '</td>' +
      '<td style="' + td + ';text-align:right">' + money(M.margin) + '</td>' +
      '<td style="' + td + ';text-align:right">' + pctTxt(M.marginPct) + '</td></tr>' +
      '<tr><td style="' + td + ';background:#fafaf9">Supervisors <span style="color:#6b7280;font-size:11.5px">fixed</span></td>' +
      '<td style="' + td + ';background:#fafaf9;text-align:right;color:#9ca3af">n/a</td>' +
      '<td style="' + td + ';background:#fafaf9;text-align:right">' + money(K.supervisors.payroll) + '</td>' +
      '<td style="' + td + ';background:#fafaf9;text-align:right;color:#9ca3af">&mdash;</td>' +
      '<td style="' + td + ';background:#fafaf9;text-align:right;color:#9ca3af">&mdash;</td></tr>' +
      // THE 17WEST RECEIPT (Jon, 2026-08-20): they pay $100k/yr toward George Paz + Yoslenis, so
      // every payroll line above already carries only Stay's share — this row shows the deduction
      // so the numbers stay auditable instead of quietly smaller.
      (() => {
        const W: any = (K as any).seventeenWest
        return W && W.covered > 0
          ? '<tr><td colspan="5" style="' + td + ';font-size:11.5px;color:#6b7280">17WEST covers <b>' + money(W.covered) +
            '</b> of George Paz + Yoslenis&rsquo;s ' + money(W.wages) + ' wages this window ($100k/yr, pro-rated) &mdash; Stay pays ' +
            money(W.stayPays) + '. Maintenance and supervisor lines above are Stay&rsquo;s share only; 17WEST tasks are unbilled by design.</td></tr>'
          : ''
      })() +
      '</table></div>' +
      '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">One email, every morning: today&rsquo;s staffing plan, yesterday&rsquo;s labor, and the settled economics &mdash; HK over the trailing 30 days, maintenance over the trailing 45 (charges land late). Full detail on the Labor board and the Weekly planner.</p>' +
      '</div></body></html>'

    if (preview) return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })

    const subject = 'Daily labor ' + today + ': ' +
      (todayCleans != null ? todayCleans + ' cleans planned, ' : '') +
      'yest ' + (KY.housekeeping.costPerClean != null ? money(KY.housekeeping.costPerClean) + '/clean' : KY.housekeeping.cleans + ' cleans') +
      ', 30d margin ' + pctTxt(K.housekeeping.marginPct)

    // Recipients: the union of the old true-up list ('labor_weekly') and the old daily-report
    // list ('labor_daily'), so retiring the separate emails never silently drops a reader.
    const cfgW = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('labor_weekly', {}).catch(() => ({} as any))
    const cfgD = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('labor_daily', {}).catch(() => ({} as any))
    const fromEmail = cfgW?.fromEmail || cfgD?.fromEmail || ''
    if (test) {
      const who = user?.email
      if (!who || !fromEmail) return NextResponse.json({ ok: false, error: 'no sender or signed-in address' })
      const r = await sendGmail({ fromEmail, to: [who], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, sentTo: who, subject, error: r.error })
    }
    // Store AFTER a successful build so a failed run never poisons the next comparison.
    await setSetting('labor_trueup_snapshot', snap, 'cron').catch(() => null)
    // Staffing planner learning: record today's forward bookings (next 14 days) so the planner
    // can learn how much last-minute pickup to expect at each lead time. Cheap, once a day.
    const forward = await storeForwardSnapshot().catch(() => null)
    const seen = new Set<string>()
    const to2: string[] = []
    for (const x of ([] as string[]).concat(cfgW?.to || [], cfgD?.to || [])) {
      const e = String(x || '').trim().toLowerCase()
      if (e && /@/.test(e) && !seen.has(e)) { seen.add(e); to2.push(e) }
    }
    const enabled = cfgW?.enabled === true || cfgD?.enabled === true
    if ((!enabled && !force) || !fromEmail || !to2.length) {
      return NextResponse.json({ ok: true, sent: false, reason: 'not configured', snapshotStored: true, forward, subject })
    }
    const r = await sendGmail({ fromEmail, to: to2, subject, html })
    return NextResponse.json({ ok: r.ok, sent: r.ok, to: to2.length, subject, forward, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
