// LABOR TRUE-UP — every day, re-settle the last 30.
//
// Jon, 2026-08-14: "make sure we run trueup everyday for past days loading back 30 days."
//
// WHY A TRUE-UP EXISTS AT ALL. A cleaning fee is earned the day a guest checks out, but the clean
// that earns it is often closed later — or moved, deleted and recreated for another day. Measured
// live: 97 of 331 departure cleans in a fortnight were never closed on the day they were booked.
// So the number the morning brief prints is always a first draft. A week later the same window
// looks different, and better, because the paperwork caught up.
//
// This route re-runs the labor P&L over the trailing 30 days, compares it against the snapshot it
// stored last time, and reports what moved. Nothing here is an estimate: it is the same engine the
// board and the briefs use, run again on a window whose data has settled.
//
// Because it now runs DAILY, it does not email daily. A true-up is only news when history
// actually moved, so the mail goes out when something settled beyond a rounding error — or on
// demand with ?force=1. The snapshot is stored every single run either way, so the trail is
// unbroken even on the quiet days.
//
// GET                → run, store the snapshot, email only if something moved
// GET ?force=1       → run and always email
// GET ?preview=1     → return the HTML without sending or storing (signed in)
// GET ?test=1        → send to YOU only
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { laborEconomics } from '@/lib/labor-econ'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const pctTxt = (n: number | null | undefined) => (n == null ? '&mdash;' : Math.round(n) + '%')
const r1 = (n: number) => Math.round(n * 10) / 10

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
    const to = dISO(addDays(now, -1))               // yesterday: today is still moving
    const from = dISO(addDays(now, -30))
    // MAINTENANCE RUNS ON A LONGER WINDOW (Jon, 2026-08-18): maintenance revenue lands late —
    // charges get typed into Breezeway days or weeks after the work — so a 30-day maintenance
    // margin is chronically understated. HK settles fast (fees are earned at checkout), so HK
    // stays on 30 days and maintenance gets 45. Two engine runs, run SEQUENTIALLY on purpose:
    // parallel runs would double up on Homebase and trip its rate limiting.
    const maintFrom = dISO(addDays(now, -45))
    const ec = await laborEconomics({ from, to, market: 'all' })
    const ecM = await laborEconomics({ from: maintFrom, to, market: 'all' })
    // NEVER TRUE-UP ON PARTIAL PAYROLL. A snapshot taken while Homebase was rate-limiting would
    // store understated payroll as "settled truth" and poison the brief's 30-day line until the
    // next clean run. Better to skip a day than to remember a wrong number.
    const badAudit = [ec.payrollAudit, ecM.payrollAudit].find(a => a && !a.complete)
    if (badAudit) {
      return NextResponse.json({
        ok: false, sent: false, snapshotStored: false,
        reason: 'payroll incomplete — Homebase did not return timecards for: ' + badAudit.failedWeeks.join(', '),
      }, { status: 503 })
    }
    const K = ec.kpi
    // Maintenance figures come from the 45-day run everywhere below.
    const M = ecM.kpi.maintenance

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

    // ── THE THREE METRICS, FIRST (Jon, 2026-08-17): ────────────────────────
    //   1. cost per clean — payroll ÷ departure cleans, with hours ÷ cleans beside it
    //   2. housekeeping revenue ÷ labor — margin as a dollar figure AND a percentage.
    //      Housekeeping revenue includes its billable work ("if housekeeping does billable work,
    //      that should count as the revenue"): departure fees + charged cleaning tasks + our
    //      cleans in vendor buildings.
    //   3. the same revenue with supervisors loaded on — the housekeeping OPERATION.
    //   Maintenance sits apart, its own department, never blended in.
    const HL = K.housekeepingLoaded || null
    const tile = (big: string, label: string, sub: string, color?: string) =>
      '<td style="padding:10px 8px;text-align:center;vertical-align:top">' +
      '<div style="font-size:22px;font-weight:800;color:' + (color || '#111827') + '">' + big + '</div>' +
      '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:700;margin-top:2px">' + label + '</div>' +
      (sub ? '<div style="font-size:11px;color:#9ca3af;margin-top:1px">' + sub + '</div>' : '') + '</td>'
    const mTone = (n: number) => (n < 0 ? '#dc2626' : '#047857')
    const headline =
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:12px 0">' +
      '<p style="margin:2px 4px 4px;font-size:13px;font-weight:700">The numbers that matter &middot; HK trailing 30 days &middot; maintenance trailing 45</p>' +
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
      '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Labor true-up &mdash; HK last 30 days &middot; maintenance last 45</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">HK ' + from + ' to ' + to + ' &middot; maintenance since ' + maintFrom +
      (prev ? ' &middot; compared with the run on ' + String(prev.takenAt).slice(0, 10) : ' &middot; first run, nothing to compare yet') + '</p></div>' +
      headline +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0">' +
      '<p style="margin:0 0 8px;font-size:13px;font-weight:700">What settled since the last true-up</p>' +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">Measure</th><th style="' + th + ';text-align:right">Last run</th>' +
      '<th style="' + th + ';text-align:right">Now</th><th style="' + th + ';text-align:right">Change</th></tr>' +
      rows + '</table>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">A rise here is not new work &mdash; it is paperwork catching up on work already done.</p>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0">' +
      '<p style="margin:0 0 8px;font-size:13px;font-weight:700">Where every cleaning fee landed</p>' +
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '">Outcome</th><th style="' + th + ';text-align:right">Fees</th></tr>' + auditRows + '</table>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">' + movedTxt + '.</p>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0">' +
      '<p style="margin:0 0 8px;font-size:13px;font-weight:700">The settled picture</p>' +
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
      '</table></div>' +
      '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Runs every day &mdash; HK over the trailing 30 days, maintenance over the trailing 45 (charges land late) &mdash; and only writes when something settles. Full detail on the Labor board.</p>' +
      '</div></body></html>'

    if (preview) return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })

    const subject = 'Labor true-up ' + from + ' to ' + to + ': ' + money(snap.cleaningRevenue) + ' cleaning rev, ' +
      money(snap.costPerClean) + '/clean' +
      (prev && prev.credited != null ? ', ' + money(snap.credited - prev.credited) + ' settled since last run' : '')

    const cfg = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('labor_weekly', {}).catch(() => ({} as any))
    const fromEmail = cfg?.fromEmail || ''
    if (test) {
      const me = user?.email
      if (!me || !fromEmail) return NextResponse.json({ ok: false, error: 'no sender or signed-in address' })
      const r = await sendGmail({ fromEmail, to: [me], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, sentTo: me, subject, error: r.error })
    }
    // Store AFTER a successful build so a failed run never poisons the next comparison.
    await setSetting('labor_trueup_snapshot', snap, 'cron').catch(() => null)
    const to2 = (cfg?.to || []).filter(Boolean)
    if (!cfg?.enabled || !fromEmail || !to2.length) {
      return NextResponse.json({ ok: true, sent: false, reason: 'not configured', snapshotStored: true, subject })
    }
    const r = await sendGmail({ fromEmail, to: to2, subject, html })
    return NextResponse.json({ ok: r.ok, sent: r.ok, to: to2.length, subject, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
