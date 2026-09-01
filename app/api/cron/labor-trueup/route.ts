// DAILY LABOR — ONE SIMPLE EMAIL (Jon, 2026-08-22: "the labor one is so confusing. We typically
// allow 8 hours per shift. Can we revamp that one to be simple. Today shifts and tasks, Yesterday
// kpi which is Cleaning rev, maintenance rev and payroll and profit. We also need last 7 days and
// last 30 days. Should be easy to read. Remove the noise, do not need any adr and rev numbers
// unless tied to billable labor or cleaning rev, or breezeway task rev").
//
// So the email is exactly two things now:
//   1. TODAY — who is on shift (against the 8h-per-shift standard) and the work on the books:
//      in-house checkouts to clean plus the Breezeway tasks scheduled today.
//   2. THE NUMBERS — one table, three windows (yesterday · last 7 · last 30), five rows:
//      cleaning revenue, Breezeway task revenue (maintenance billed), payroll, profit, and
//      cleans + cost per clean. Nothing else. No ADR, no room revenue, no settlement tables.
// Every figure is lib/labor-econ's — the same engine as the Labor board — so no two surfaces
// can disagree. The gutted sections (weekly KPI card, what-settled deltas, fee-landing audit,
// per-cleaner budgets) all live on in the app: /labor, /schedule?tab=weekly and the full brief.
//
// NEVER ON PARTIAL PAYROLL. Any engine window with missing Homebase weeks skips the snapshot and
// the send — better a quiet morning than a wrong number remembered as truth.
//
// GET                → run, store the snapshot, send
// GET ?force=1       → run and always email
// GET ?preview=1     → return the HTML without sending or storing (signed in)
// GET ?test=1        → send to YOU only
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { laborEconomics, kindOfTask } from '@/lib/labor-econ'
import { sendGmail } from '@/lib/gmail-send'
import { storeForwardSnapshot } from '@/lib/labor-plan'
import { getShifts } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { computeYesterdayLabor } from '@/lib/labor-daily'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
// The house standard (Jon, 2026-08-22): "we typically allow 8 hours per shift."
const SHIFT_STANDARD_H = 8
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
// A RATE NEEDS ITS CENTS. Whole dollars are right for a payroll total, but cost per clean is a
// number Jon compares between two markets — rounding $54.82 and $55.40 both to "$55" hides the
// very gap the table exists to show.
const rate = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTxt = (n: number | null | undefined) => (n == null ? '&mdash;' : Math.round(n) + '%')
const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const niceDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')

// The morning brief's 30-day line reads this snapshot — keep the shape it expects.
type Snap = {
  from: string; to: string; takenAt: string
  maintFrom?: string
  cleans: number; cleaningRevenue: number; hkRevenue?: number; credited: number
  billable: number; payroll: number; margin: number
  costPerClean: number | null
  hkPayroll?: number
  markets?: { key: string; label: string; inHouse: boolean; cleans: number; revenue: number; payroll: number; costPerClean: number | null; hoursPerClean: number | null; margin: number; marginPct: number | null }[]
}

const td = 'padding:7px 9px;border-bottom:1px solid #eef0f3;font-size:13px;text-align:left;vertical-align:top;line-height:1.5'
const th = 'padding:6px 9px;border-bottom:2px solid #111827;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;text-align:left;color:#6b7280;font-weight:700'
const cardStyle = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin:12px 0'
const RED = 'color:#dc2626;font-weight:600'
const AMBER = 'color:#b45309;font-weight:600'
const GREEN = 'color:#047857;font-weight:600'
const MUTED = 'color:#9ca3af'
const secTitle = (t: string, sub: string) =>
  '<p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700">' + t +
  (sub ? ' <span style="color:#c4c9d0;font-weight:400;text-transform:none;letter-spacing:0">&middot; ' + sub + '</span>' : '') + '</p>'

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
    const yd = dISO(addDays(now, -1))
    const d7 = dISO(addDays(now, -7))     // yd back 6 more days
    const d30 = dISO(addDays(now, -30))

    // The three windows, SEQUENTIAL on purpose — parallel runs double up on Homebase and trip its
    // rate limiting; the engine caches its weeks so runs 2 and 3 ride run 1.
    const ecY = await laborEconomics({ from: yd, to: yd, market: 'all' })
    const ec7 = await laborEconomics({ from: d7, to: yd, market: 'all' })
    const ec30 = await laborEconomics({ from: d30, to: yd, market: 'all' })
    // NEVER SEND ON PARTIAL PAYROLL — a snapshot taken while Homebase was rate-limiting would
    // store understated payroll as settled truth and poison every comparison until the next run.
    const badAudit = [ecY.payrollAudit, ec7.payrollAudit, ec30.payrollAudit].find(a => a && !a.complete)
    if (badAudit) {
      const why = 'Homebase did not return timecards for: ' + badAudit.failedWeeks.join(', ')
      // NEVER QUIET-SKIP (Jon doctrine): the numbers are withheld, but the silence is not.
      // A one-line note to the owner says the email did not send and why — otherwise a missing
      // morning email reads as "nothing happened" instead of "the data was incomplete".
      if (!preview && !test) {
        const OWNER = 'jon@stay-hospitality.com'
        await sendGmail({
          fromEmail: OWNER, to: [OWNER],
          subject: 'Daily Labor did not send — payroll incomplete',
          html: '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">' +
            'This morning&rsquo;s Daily Labor email was <b>withheld on purpose</b>: ' + esc(why) + '.<br>' +
            'Partial payroll would print understated numbers and poison every comparison, so nothing was stored or sent. ' +
            'It will run again tomorrow morning; the <a href="' + APP_URL + '/labor">Labor board</a> has the live picture.</p>',
        }).catch(() => null)
      }
      return NextResponse.json({
        ok: false, sent: false, snapshotStored: false,
        reason: 'payroll incomplete — ' + why,
      }, { status: 503 })
    }
    const KY: any = ecY.kpi, K7: any = ec7.kpi, K30: any = ec30.kpi

    // ── 1. TODAY — shifts against the 8h standard, and the work on the books ─────────────────
    // Additive: a Homebase or mirror hiccup never blocks the email.
    let todayCard = ''
    let onShift = 0
    let cleansDueToday: number | null = null
    try {
      const db = supabaseAdmin()
      const presets = await getOpsPresets()
      const VENDOR = vendorRegex(presets.vendorBuildings)
      const [shifts, lRes, coRes, tRes] = await Promise.all([
        getShifts(today, TZ),
        db.from('guesty_listings').select('id,nickname,title,building').limit(2000),
        db.from('guesty_reservations').select('listing_id,check_out,status')
          .eq('check_out', today)
          .not('status', 'in', '("canceled","cancelled","declined")').limit(2000),
        db.from('breezeway_tasks_sync').select('name,type_department,status')
          .eq('scheduled_date', today).limit(3000),
      ])
      // In-house checkouts = today's cleans (a checkout is a clean, whoever remembers the task).
      const vendorUnit: Record<string, boolean> = {}
      for (const l of ((lRes.data || []) as any[])) {
        const nm = l.nickname || l.title || ''
        vendorUnit[String(l.id)] = VENDOR.test(String(l.building || '')) || VENDOR.test(String(nm))
      }
      cleansDueToday = ((coRes.data || []) as any[]).filter(r => !vendorUnit[String(r.listing_id)]).length
      // The Breezeway board for today, by kind.
      const counts = { clean: 0, maintenance: 0, inspection: 0, other: 0 }
      for (const t of ((tRes.data || []) as any[])) {
        if (/delete|cancel/.test(String(t.status || '').toLowerCase())) continue
        counts[kindOfTask(t)]++
      }
      const filled = shifts.filter(s => !s.open && s.startAt)
      const openShifts = shifts.filter(s => s.open).length
      onShift = filled.length
      // WORKED HOURS, NOT WALL SPAN. An 8:00–5:00 shift spans 9 hours but carries an unpaid
      // break — judging the span against the 8h standard flagged 7 of 10 perfectly normal
      // shifts on the first live preview. A shift longer than 6h assumes one unpaid hour.
      const hoursOf = (s: any): number | null => {
        if (!s.startAt || !s.endAt) return null
        const span = (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 36e5
        return r1(span > 6 ? span - 1 : span)
      }
      const totalH = r1(filled.reduce((a, s) => a + (hoursOf(s) || 0), 0))
      const standardH = filled.length * SHIFT_STANDARD_H
      const overStd = filled.filter(s => (hoursOf(s) || 0) > SHIFT_STANDARD_H + 0.25)
      const rows = filled
        .slice()
        .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || a.name.localeCompare(b.name))
        .map(s => {
          const h = hoursOf(s)
          const over = h != null && h > SHIFT_STANDARD_H + 0.25
          return '<tr><td style="' + td + '"><b>' + esc(s.name) + '</b>' +
            (s.role ? ' <span style="' + MUTED + ';font-size:11.5px">' + esc(s.role) + '</span>' : '') + '</td>' +
            '<td style="' + td + ';white-space:nowrap">' + esc(s.label || '') + '</td>' +
            '<td style="' + td + ';text-align:right;white-space:nowrap">' +
            (h == null ? '&mdash;' : over
              ? '<span style="' + AMBER + '">' + h + 'h &middot; over the ' + SHIFT_STANDARD_H + 'h standard</span>'
              : '<b>' + h + 'h</b>') + '</td></tr>'
        }).join('')
      const workBits = [
        '<b>' + (cleansDueToday ?? 0) + '</b> checkouts to clean',
        counts.clean ? counts.clean + ' departure cleans on the Breezeway board' : '',
        counts.maintenance ? '<b>' + counts.maintenance + '</b> maintenance tasks' : '',
        counts.inspection ? counts.inspection + ' inspections' : '',
        counts.other ? counts.other + ' other tasks' : '',
      ].filter(Boolean).join(' &middot; ')
      todayCard = '<div style="' + cardStyle + '">' +
        secTitle('Today &mdash; shifts &amp; tasks', niceDay(today)) +
        '<p style="margin:0 0 10px;font-size:13.5px;line-height:1.6"><b>' + filled.length + '</b> on shift &middot; <b>' + totalH +
        'h</b> scheduled <span style="' + MUTED + '">vs ' + standardH + 'h standard (' + filled.length + ' &times; ' + SHIFT_STANDARD_H + 'h)</span>' +
        (overStd.length ? ' &middot; <span style="' + AMBER + '">' + overStd.length + ' shift' + (overStd.length === 1 ? '' : 's') + ' over ' + SHIFT_STANDARD_H + 'h</span>' : '') +
        (openShifts ? ' &middot; <span style="' + RED + '">' + openShifts + ' open shift' + (openShifts === 1 ? '' : 's') + ' unfilled</span>' : '') +
        '<br>' + workBits + '</p>' +
        (rows
          ? '<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="' + th + '">On today</th><th style="' + th + '">Shift</th><th style="' + th + ';text-align:right">Scheduled</th></tr>' + rows + '</table>' +
            '<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">These are <b>scheduled</b> hours, not punches &mdash; nobody has worked today yet. A shift over 6h assumes one unpaid break hour, so 8:00&ndash;5:00 is counted as 8h. Every dollar elsewhere in this email comes from actual clock punches.</p>'
          : '<p style="margin:0;font-size:13px;color:#6b7280">Nobody is on the Homebase schedule for today.</p>') +
        '</div>'
    } catch {
      // A DROPPED CARD MUST SAY SO (Jon: "each brief should be robust"). A missing section reads
      // as "nothing today" — name the gap instead so nobody plans a day on an empty card.
      todayCard = '<div style="' + cardStyle + '">' + secTitle('Today &mdash; shifts &amp; tasks', niceDay(today)) +
        '<p style="margin:0;font-size:13px;color:#6b7280">This section could not load this morning (Homebase or the task board did not answer). ' +
        'The <a href="' + APP_URL + '/labor" style="color:#2563eb">Labor board</a> has the live picture.</p></div>'
    }

    // ── 2. THE NUMBERS — one table, three windows ─────────────────────────────────────────────
    const col = (K: any) => ({
      cleanRev: K.housekeeping.revenueWithCharged != null ? K.housekeeping.revenueWithCharged : K.housekeeping.revenue,
      maintRev: K.maintenance.revenue,
      payroll: K.allIn.payroll,
      profit: K.allIn.margin,
      marginPct: K.allIn.marginPct,
      cleans: K.housekeeping.cleans,
      cpc: K.housekeeping.costPerClean,
      noCharge: K.maintenance.tasksNoCharge,
    })
    const cY = col(KY), c7 = col(K7), c30 = col(K30)
    const numRow = (label: string, sub: string, f: (c: ReturnType<typeof col>) => string) =>
      '<tr><td style="' + td + '"><b>' + label + '</b>' + (sub ? '<br><span style="' + MUTED + ';font-size:11.5px">' + sub + '</span>' : '') + '</td>' +
      [cY, c7, c30].map(c => '<td style="' + td + ';text-align:right;white-space:nowrap">' + f(c) + '</td>').join('') + '</tr>'
    const profitCell = (c: ReturnType<typeof col>) =>
      '<b style="' + ((c.profit || 0) < 0 ? RED : GREEN) + '">' + money(c.profit) + '</b>' +
      (c.marginPct != null ? ' <span style="' + MUTED + '">(' + pctTxt(c.marginPct) + ')</span>' : '')
    const numbersTable =
      '<table width="100%" cellspacing="0" cellpadding="0">' +
      '<tr><th style="' + th + '"></th><th style="' + th + ';text-align:right">Yesterday<br><span style="font-weight:400">' + esc(niceDay(yd)) + '</span></th>' +
      '<th style="' + th + ';text-align:right">Last 7 days</th><th style="' + th + ';text-align:right">Last 30 days</th></tr>' +
      numRow('Cleaning revenue', 'guest fees net of channel cut, incl. paid cleaning work', c => money(c.cleanRev)) +
      numRow('Maintenance revenue', 'charges entered on Breezeway tasks', c => money(c.maintRev) +
        (c.noCharge ? '<br><span style="' + AMBER + ';font-size:11px;font-weight:400">' + c.noCharge + ' tasks no charge entered</span>' : '')) +
      numRow('Payroll', 'everyone — HK, maintenance, supervisors &amp; salaried management', c => money(c.payroll)) +
      numRow('Profit', 'revenue minus payroll', profitCell) +
      numRow('Departure cleans', 'cost / clean is housekeepers only', c =>
        String(c.cleans || 0) + (c.cpc != null ? ' <span style="' + MUTED + '">&middot; ' + money(c.cpc) + '/clean</span>' : '')) +
      '</table>'

    // ── 2a. COST PER CLEAN, BY CREW AND BY MARKET (Jon, 2026-08-29) ───────────────────────────
    //
    //   "I need to see cost per clean in Broward and Miami broken out, and it needs to be
    //    organized by housekeepers / supervisors / maintenance. Then do a combined total."
    //
    // Built on the 30-day window. A single day cannot carry this table: one supervisor's shift
    // lands entirely on whichever market he happened to hold a task in, and the row swings by
    // dollars a clean for reasons that have nothing to do with how the day was run. Thirty days
    // is also the window the rest of this email says to manage on. The combined line is shown
    // for all three windows underneath, which is where the movement actually belongs.
    let perCleanCard = ''
    try {
      const grid: any = (ec30 as any)?.pnl?.perClean
      const mkts: any[] = (grid?.markets || []).filter((m: any) => m.cleans > 0)
      if (grid && mkts.length) {
        const cols = [...mkts, grid.total]
        const headCells = cols.map((m: any, i: number) =>
          '<th style="' + th + ';text-align:right' + (i === cols.length - 1 ? ';border-left:1px solid #e5e7eb' : '') + '">' +
          (i === cols.length - 1 ? '<b>Combined</b>' : esc(m.label)) + '</th>').join('')
        // One crew row. The dollars-per-clean lead; the payroll behind it is the small print,
        // because the whole point of the table is the rate.
        const crewRow = (label: string, sub: string, pick: (m: any) => any, strong = false) =>
          '<tr><td style="' + td + '">' + (strong ? '<b>' + label + '</b>' : label) +
          (sub ? '<br><span style="' + MUTED + ';font-size:11.5px">' + sub + '</span>' : '') + '</td>' +
          cols.map((m: any, i: number) => {
            const c = pick(m)
            const last = i === cols.length - 1
            return '<td style="' + td + ';text-align:right;white-space:nowrap' + (last ? ';border-left:1px solid #e5e7eb' : '') + '">' +
              (c.perClean != null
                ? '<b style="font-size:' + (strong ? '15px' : '13.5px') + '">' + rate(c.perClean) + '</b>' +
                  '<br><span style="' + MUTED + ';font-size:11px">' + money(c.payroll) + (c.hours ? ' &middot; ' + r1(c.hours) + 'h' : '') + '</span>'
                : '<span style="' + MUTED + '">&mdash;</span>') + '</td>'
          }).join('') + '</tr>'
        const cleansRow =
          '<tr><td style="' + td + ';border-top:2px solid #e5e7eb">Departure cleans<br><span style="' + MUTED + ';font-size:11.5px">the denominator every row above is divided by</span></td>' +
          cols.map((m: any, i: number) => '<td style="' + td + ';text-align:right;border-top:2px solid #e5e7eb' +
            (i === cols.length - 1 ? ';border-left:1px solid #e5e7eb' : '') + '"><b>' + (m.cleans || 0) + '</b></td>').join('') + '</tr>'
        // The combined rate over the three windows — the movement, which the grid cannot show.
        const trend = [
          { lab: 'Yesterday', g: (ecY as any)?.pnl?.perClean?.total },
          { lab: 'Last 7', g: (ec7 as any)?.pnl?.perClean?.total },
          { lab: 'Last 30', g: grid.total },
        ].filter(x => x.g && x.g.all && x.g.all.perClean != null)
        const mtRev = grid.total?.maintenance?.revenue || 0
        perCleanCard = '<div style="' + cardStyle + '">' +
          secTitle('Cost per clean &mdash; by crew, by market', 'last 30 days &middot; ' + niceDay(d30) + ' &ndash; ' + niceDay(yd)) +
          '<table width="100%" cellspacing="0" cellpadding="0">' +
          '<tr><th style="' + th + '"></th>' + headCells + '</tr>' +
          crewRow('Housekeepers', 'the wages spent turning these units', (m: any) => m.housekeeping) +
          crewRow('Supervisors', 'allocated by where their tasks were', (m: any) => m.supervision) +
          crewRow('Maintenance', 'allocated by where their tasks were' + (mtRev > 0 ? ' &middot; earned ' + money(mtRev) + ' billable' : ''), (m: any) => m.maintenance) +
          '<tr><td style="' + td + ';border-top:2px solid #0f172a"><b>All three crews</b><br><span style="' + MUTED + ';font-size:11.5px">what a turn really costs in payroll</span></td>' +
          cols.map((m: any, i: number) => '<td style="' + td + ';text-align:right;white-space:nowrap;border-top:2px solid #0f172a' +
            (i === cols.length - 1 ? ';border-left:1px solid #e5e7eb' : '') + '">' +
            (m.all.perClean != null ? '<b style="font-size:16px">' + rate(m.all.perClean) + '</b><br><span style="' + MUTED + ';font-size:11px">' + money(m.all.payroll) + '</span>'
              : '<span style="' + MUTED + '">&mdash;</span>') + '</td>').join('') + '</tr>' +
          cleansRow +
          '</table>' +
          (trend.length > 1 ? '<p style="margin:12px 0 0;font-size:12.5px;color:#374151">All three crews combined: ' +
            trend.map(x => '<b>' + rate(x.g.all.perClean) + '</b> <span style="' + MUTED + '">' + x.lab.toLowerCase() + '</span>').join(' &middot; ') + '</p>' : '') +
          '<p style="margin:10px 0 0;font-size:11px;color:#9ca3af;line-height:1.7">' +
          'Every row is divided by the departure cleans done in that market, so the three crews add up to the combined line. ' +
          '<b>Housekeepers</b> is a true unit cost &mdash; those wages were spent turning those units. ' +
          '<b>Supervisors</b> and <b>Maintenance</b> answer a different question: what each crew adds to the cost of a turn. ' +
          'Neither crew cleans, and maintenance earns its own billable revenue, so read those two as loaded overhead rather than as cleaning cost. ' +
          'Wages are Homebase punches (salaried people carry their contracted salary instead); a person&rsquo;s pay follows their work &mdash; ' +
          'housekeepers by share of cleans, everyone else by share of tasks, anyone with neither by their Staffing area.</p>' +
          '</div>'
      }
    } catch { /* additive — the rest of the email stands without it */ }

    // ── 2b. CREWS — COMPLETED WORK vs HOURS CLOCKED (Jon, 2026-08-22: "We track departure
    // cleans completed in a particular day, that's how we should determine effectiveness of the
    // cleaning model… Cleaning rev, number of cleans, other tasks, full picture… Same for
    // Maintenance, maybe they assist with cleaning, like stripping units… This is completed vs
    // actual hours worked, not assumed."). Completions come straight from Breezeway finished
    // tasks (the shared classifier); hours are the engine's AUDITED Homebase clock — never a
    // schedule, never an estimate. Additive: a mirror hiccup drops the card, never the email.
    let crewsCard = ''
    try {
      const { getCrew } = await import('@/lib/crew')
      const crew = await getCrew()
      const db2 = supabaseAdmin()
      const rowsT: any[] = []
      // SAME BOUNDS AND SAME DAY RULE AS THE ENGINE (lib/labor-econ): gte(from) / lte(to+'T23:59:59')
      // and the day is the RAW STRING'S date prefix — never a timezone conversion. The first version
      // ran finished_at through new Date() + ET formatting, which shifted early-morning closes onto
      // the previous day and let this card disagree with the numbers table under it.
      for (let i = 0; i < 6; i++) {
        const { data, error } = await db2.from('breezeway_tasks_sync')
          .select('name,type_department,status,finished_at,assignees,finished_by_name')
          .gte('finished_at', d7).lte('finished_at', yd + 'T23:59:59')
          .order('finished_at', { ascending: false })
          .range(i * 1000, i * 1000 + 999)
        if (error) break
        rowsT.push(...((data || []) as any[]))
        if (!data || data.length < 1000) break
      }
      const nameOfAny = (v: any): string => {
        if (!v) return ''
        if (typeof v === 'string') return v
        if (typeof v === 'object') return String(v.name || v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' ') || '')
        return ''
      }
      const cleansByDay: Record<string, number> = {}
      const y = { hkCleans: 0, hkStrips: 0, hkOtherClean: 0, mtTasks: 0, mtCleanAssists: 0, inspections: 0 }
      for (const t of rowsT) {
        if (/delete|cancel/.test(String(t.status || '').toLowerCase())) continue
        const day = String(t.finished_at || '').slice(0, 10)
        const kind = kindOfTask(t)
        const nm = String(t.name || '')
        const isStrip = /strip/i.test(nm)
        const doers = ([] as any[])
          .concat(Array.isArray(t.assignees) ? t.assignees : [])
          .concat([t.finished_by_name])
          .map(nameOfAny).filter(Boolean)
        const maintDoer = doers.some(n => { try { return crew.deptOf(n) === 'maintenance' } catch { return false } })
        if (kind === 'clean') {
          cleansByDay[day] = (cleansByDay[day] || 0) + 1
          if (day === yd) { y.hkCleans++; if (maintDoer) y.mtCleanAssists++ }
        } else if (day === yd) {
          if (kind === 'maintenance') y.mtTasks++
          else if (kind === 'inspection') y.inspections++
          else if (isStrip) { y.hkStrips++; if (maintDoer) y.mtCleanAssists++ }
          else if (/clean|housekeep/i.test(String(t.type_department || '') + ' ' + nm)) y.hkOtherClean++
        }
      }
      // NO DATA IS NOT ZERO WORK: an empty mirror read would render "0 cleans completed" — a
      // false alarm about effectiveness when the truth is the data did not load. Name it instead.
      if (!rowsT.length) throw new Error('no finished tasks returned for the window')
      const hkHours = Number(KY.housekeeping.hours) || 0
      const mtHours = Number(KY.maintenance.hours) || 0
      // ONE DENOMINATOR, NOT TWO. This rate used to divide the ENGINE's housekeeper hours by
      // THIS CARD's board-completion count — a count that includes vendor- and maintenance-closed
      // doors the engine never put hours against. The footnote under the table admitted the two
      // clean counts differ, but the rate quietly mixed them anyway and read low. Both sides of
      // the division now come from the engine, so the number means what it says.
      const hkCleansEng = Number(KY.housekeeping.cleans) || 0
      const perClean = hkCleansEng > 0 && hkHours > 0 ? r1(hkHours / hkCleansEng) : null
      const dayBits: string[] = []
      for (let i = 6; i >= 0; i--) {
        const day = dISO(addDays(now, -(i + 1)))
        const label = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })
        dayBits.push('<span style="white-space:nowrap"><span style="' + MUTED + '">' + label + '</span> <b>' + (cleansByDay[day] || 0) + '</b></span>')
      }
      crewsCard = '<div style="' + cardStyle + '">' +
        secTitle('Crews &mdash; completed vs hours clocked', 'Breezeway completions &middot; actual Homebase hours') +
        '<table width="100%" cellspacing="0" cellpadding="0">' +
        '<tr><th style="' + th + '"></th><th style="' + th + ';text-align:right">Completed yesterday</th><th style="' + th + ';text-align:right">Hours clocked</th><th style="' + th + ';text-align:right">Rate</th></tr>' +
        '<tr><td style="' + td + '"><b>Housekeeping</b><br><span style="' + MUTED + ';font-size:11.5px">effectiveness = departure cleans completed that day</span></td>' +
        '<td style="' + td + ';text-align:right"><b>' + y.hkCleans + '</b> departure cleans' +
        ((y.hkStrips || y.hkOtherClean) ? '<br><span style="' + MUTED + ';font-size:11.5px">+ ' + [y.hkStrips ? y.hkStrips + ' strip' + (y.hkStrips === 1 ? '' : 's') : '', y.hkOtherClean ? y.hkOtherClean + ' other cleaning' : ''].filter(Boolean).join(' · ') + '</span>' : '') + '</td>' +
        '<td style="' + td + ';text-align:right"><b>' + r1(hkHours) + 'h</b></td>' +
        '<td style="' + td + ';text-align:right">' + (perClean != null ? '<b>' + perClean + 'h</b>/clean' : '&mdash;') + '</td></tr>' +
        '<tr><td style="' + td + '"><b>Maintenance</b><br><span style="' + MUTED + ';font-size:11.5px">incl. what they did on the cleaning side</span></td>' +
        '<td style="' + td + ';text-align:right"><b>' + y.mtTasks + '</b> maintenance tasks' +
        (y.mtCleanAssists ? '<br><span style="' + AMBER + ';font-size:11.5px">+ ' + y.mtCleanAssists + ' cleaning assist' + (y.mtCleanAssists === 1 ? '' : 's') + ' (cleans / strips)</span>' : '') + '</td>' +
        '<td style="' + td + ';text-align:right"><b>' + r1(mtHours) + 'h</b></td>' +
        '<td style="' + td + ';text-align:right">' + money(cY.maintRev) + ' billed</td></tr>' +
        (y.inspections ? '<tr><td style="' + td + '" colspan="4"><span style="' + MUTED + ';font-size:11.5px">' + y.inspections + ' inspection' + (y.inspections === 1 ? '' : 's') + ' also completed yesterday.</span></td></tr>' : '') +
        '</table>' +
        '<p style="margin:10px 0 0;font-size:12px;color:#374151"><b>Departure cleans completed by day</b> <span style="' + MUTED + '">&middot; last 7</span> &nbsp; ' + dayBits.join(' &nbsp;&middot;&nbsp; ') + '</p>' +
        // TWO CLEAN COUNTS, ONE EXPLANATION. This card counts every departure clean closed on the
        // board, whoever closed it — that IS Jon's effectiveness measure. The table below credits
        // cleans to housekeepers only (that is what cost/clean divides by). Without this line the
        // same email carries "25" and "18" and somebody has to ask which is wrong. Neither is.
        '<p style="margin:6px 0 0;font-size:11px;color:#9ca3af">Counts here are board completions &mdash; every departure clean closed yesterday, whoever closed it. The h/clean rate beside them is housekeepers only: their punched hours over the cleans credited to them, the same basis as cost/clean below. The two clean counts differ by vendor- and maintenance-closed doors.</p>' +
        '</div>'
    } catch {
      crewsCard = '<div style="' + cardStyle + '">' + secTitle('Crews &mdash; completed vs hours clocked', '') +
        '<p style="margin:0;font-size:13px;color:#6b7280">Breezeway completions could not be read this morning, so this card is withheld rather than shown as zeros. ' +
        'The <a href="' + APP_URL + '/labor" style="color:#2563eb">Labor board</a> has the completed-vs-clocked picture live.</p></div>'
    }

    // Yesterday's schedule flags — one line, names included.
    let flagsLine = ''
    try {
      const [ySh, yTc, lset] = await Promise.all([getShifts(yd, TZ), getTimecards(yd, yd), getLaborSettings('default')])
      const fl = computeYesterdayLabor(yd, ySh, yTc, lset)
      const bits: string[] = []
      if (fl.noShows.length) bits.push('<span style="' + RED + '">' + fl.noShows.length + ' scheduled, never clocked in</span> (' + fl.noShows.slice(0, 3).map(x => esc(x.name)).join(', ') + (fl.noShows.length > 3 ? '…' : '') + ')')
      if (fl.lateClockIns.length) bits.push(fl.lateClockIns.length + ' late (' + fl.lateClockIns.slice(0, 3).map(x => esc(x.name) + ' +' + x.minutesLate + 'm').join(', ') + ')')
      if (fl.overSchedule.length) bits.push(fl.overSchedule.length + ' past schedule (' + fl.overSchedule.slice(0, 3).map(x => esc(x.name) + ' +' + x.overByHours + 'h').join(', ') + ')')
      if (fl.missedClockOuts.length) bits.push(fl.missedClockOuts.length + ' timecard' + (fl.missedClockOuts.length === 1 ? '' : 's') + ' left open')
      flagsLine = '<p style="margin:10px 0 0;font-size:12px;color:#6b7280"><b>Yesterday&rsquo;s clock:</b> ' + fl.totalHoursWorked + 'h worked by ' + fl.headcount + ' (' + fl.totalScheduledHours + 'h scheduled)' +
        (bits.length ? ' &middot; ' + bits.join(' &middot; ') : ' &middot; <span style="' + GREEN + '">no flags</span>') + '</p>'
    } catch {
      flagsLine = '<p style="margin:10px 0 0;font-size:12px;color:#9ca3af"><b>Yesterday&rsquo;s clock:</b> could not be read this morning &mdash; no-show and late flags are on the Labor board.</p>'
    }

    // Two honest footnotes, one line each, only when they apply.
    const A: any = ecY.feeAudit || {}
    const yUnclosed = Number(A.cleanNotClosed) || 0
    const yTotal = yUnclosed + (Number(A.credited) || 0) + (Number(A.noCleanFound) || 0) + (Number(A.cleanNoAssignee) || 0)
    const maturityLine = yTotal > 0 && yUnclosed / yTotal > 0.1
      ? '<p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">' + money(yUnclosed) + ' of yesterday&rsquo;s cleaning fees sit on cleans not yet closed in Breezeway &mdash; yesterday reads expensive until that paperwork lands; the 30-day column is the one to manage on. Maintenance charges land late too, so the 30-day maintenance line keeps filling in.</p>'
      : '<p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">Yesterday trues up as Breezeway paperwork lands &mdash; the 30-day column is the one to manage on.</p>'
    const W: any = K30.seventeenWest
    const w17Line = W && W.covered > 0
      ? '<p style="margin:6px 0 0;font-size:11.5px;color:#9ca3af">17WEST covers ' + money(W.covered) + ' of George Paz + Yoslenis&rsquo;s wages this 30-day window &mdash; payroll above is Stay&rsquo;s share only.</p>'
      : ''
    // SALARIED MANAGEMENT (engine change, 2026-08-24): Roberto's salary is now inside every
    // payroll figure, pro-rated to the window. Say so once — a fixed line appearing inside
    // "payroll" with no label would read as a payroll jump nobody can explain.
    const M30: any = (K30 as any).management
    const mgmtLine = M30 && Number(M30.salaryWindow) > 0
      ? '<p style="margin:6px 0 0;font-size:11.5px;color:#9ca3af">Payroll includes salaried management pro-rated to each window (' +
        (M30.people || []).map((p: any) => esc(p.name)).join(', ') + ' &mdash; ' + money(M30.salaryWindow) + ' over 30 days); the salary is the cost and already sits inside each crew, never added on top.</p>'
      : ''

    const numbersCard = '<div style="' + cardStyle + '">' +
      secTitle('The numbers', 'yesterday &middot; last 7 &middot; last 30 &mdash; same engine as the Labor board') +
      numbersTable + flagsLine + maturityLine + w17Line + mgmtLine + '</div>'

    // ── header + verdict ──────────────────────────────────────────────────────────────────────
    const verdict =
      'Yesterday: <b style="' + ((cY.profit || 0) < 0 ? RED : GREEN) + '">' + money(cY.profit) + ' profit</b> on ' +
      money((cY.cleanRev || 0) + (cY.maintRev || 0)) + ' of revenue &middot; ' + (cY.cleans || 0) + ' cleans' +
      (cY.cpc != null ? ' @ ' + rate(cY.cpc) + '/clean' : '') + '.' +
      (onShift ? ' Today: <b>' + onShift + '</b> on shift' + (cleansDueToday != null ? ', <b>' + cleansDueToday + '</b> cleans due' : '') + '.' : '')

    // ── CAN THESE NUMBERS BE TRUSTED? (Jon, 2026-09-01: "what are we doing to make sure this is
    // always accurate"). The email states its own basis every morning: whether every Homebase
    // week answered, how much fee money found no clean, and who is punching with no roster row.
    // Green and one line when healthy; specific and amber/red when not. The nightly integrity
    // cron runs the deeper version and emails only on failure.
    let healthCard = ''
    try {
      const pa: any = (ec30 as any).payrollAudit || {}
      const fa: any = (ec30 as any).feeAudit || {}
      const unro: any = (ec30 as any).unrostered || {}
      const faTotal = (Number(fa.credited) || 0) + (Number(fa.cleanNotClosed) || 0) + (Number(fa.cleanNoAssignee) || 0) + (Number(fa.noCleanFound) || 0)
      const lost = (Number(fa.noCleanFound) || 0) + (Number(fa.cleanNotClosed) || 0)
      const lostPct = faTotal > 0 ? Math.round((lost / faTotal) * 100) : 0
      const items: string[] = []
      items.push(pa.complete !== false
        ? '<span style="' + GREEN + '">✓</span> every Homebase week answered — hours and wages are actual punches, complete'
        : '<span style="' + RED + '">✗</span> Homebase weeks missing (' + esc((pa.failedWeeks || []).join(', ')) + ') — payroll is a floor this morning')
      items.push((lostPct <= 15
        ? '<span style="' + GREEN + '">✓</span> '
        : '<span style="' + AMBER + '">!</span> ')
        + lostPct + '% of cleaning fees without a matched clean' + (lostPct > 15 ? ' — check Data health on the Labor board' : ''))
      if (Number(unro.people) > 0) items.push('<span style="' + AMBER + '">!</span> ' + unro.people + ' on payroll with no crew set — their wages count in no department')
      healthCard = '<div style="' + cardStyle + '">' +
        secTitle('Is this accurate?', '30-day basis &middot; audited nightly') +
        '<p style="margin:0;font-size:12.5px;line-height:2;color:#374151">' + items.join('<br>') + '</p>' +
        '<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Cleans count on the day they were actually done (a moved clean counts on its new day, never twice); every dollar of payroll is a Homebase punch, or the stated salary for salaried staff.</p>' +
        '</div>'
    } catch { /* additive */ }

    const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220">' +
      '<div style="max-width:720px;margin:0 auto;padding:18px">' +
      '<div style="background:#111827;border-radius:12px;padding:16px 18px">' +
      '<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S T A Y &nbsp; H O S P I T A L I T Y</p>' +
      '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Daily Labor</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">' + niceDay(today) + '</p></div>' +
      '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:13px 18px;margin:12px 0 0">' +
      '<p style="margin:0;font-size:14px;line-height:1.6">' + verdict + '</p></div>' +
      perCleanCard +
      todayCard +
      crewsCard +
      numbersCard +
      healthCard +
      '<table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px"><tr><td>' +
      '<a href="' + APP_URL + '/labor" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">Open the Labor board &rarr;' +
      '<span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Every person, task and billable &middot; the weekly planner lives there too</span></a>' +
      '</td></tr></table>' +
      '<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically every morning. Cleaning and maintenance revenue only &mdash; room revenue lives in your revenue app.</p>' +
      '</div></body></html>'

    // ── snapshot for the morning brief's 30-day line (shape unchanged — it reads this) ────────
    const K = K30
    const snap: Snap = {
      from: d30, to: yd, takenAt: new Date().toISOString(),
      maintFrom: d30,
      cleans: K.housekeeping.cleans,
      cleaningRevenue: ec30.cleaningRevenue,
      hkRevenue: K.housekeeping.revenue,
      credited: ec30.feeAudit ? ec30.feeAudit.credited : 0,
      billable: K.maintenance.billable,
      payroll: K.allIn.payroll,
      margin: K.allIn.margin,
      costPerClean: K.housekeeping.costPerClean,
      hkPayroll: K.housekeeping.payroll,
      markets: (ec30.buckets || []).filter((b: any) => b.cleans > 0 || b.payroll > 0).map((b: any) => ({
        key: String(b.key), label: String(b.label), inHouse: !!b.inHouse,
        cleans: b.cleans, revenue: b.cleaningRevenue, payroll: b.payroll,
        costPerClean: b.laborCostPerClean, hoursPerClean: b.hoursPerClean,
        margin: b.margin, marginPct: b.marginPct,
      })),
    }

    if (preview) return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })

    const moneyPlain = (n: number | null | undefined) =>
      n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
    const subject = 'Daily labor ' + niceDay(today) + ': ' +
      moneyPlain(cY.profit) + ' profit yest' +
      (cY.cpc != null ? ' · ' + moneyPlain(cY.cpc) + '/clean' : '') +
      ' · 30d margin ' + (c30.marginPct != null ? Math.round(c30.marginPct) + '%' : '—') +
      (onShift ? ' · ' + onShift + ' on today' : '')

    // Recipients: the union of the old true-up list ('labor_weekly') and the old daily-report
    // list ('labor_daily'). Jon asked for this email BY NAME, so when nothing is configured it
    // still goes to the owner alone rather than silently nowhere; roberto rides CC on every
    // brief (standing rule, 2026-08-09) unless already a recipient.
    const OWNER = 'jon@stay-hospitality.com'
    const STANDING_CC = ['roberto@stay-hospitality.com']
    const cfgW = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('labor_weekly', {}).catch(() => ({} as any))
    const cfgD = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('labor_daily', {}).catch(() => ({} as any))
    const fromEmail = cfgW?.fromEmail || cfgD?.fromEmail || OWNER
    if (test) {
      const who = user?.email
      if (!who) return NextResponse.json({ ok: false, error: 'no signed-in address' })
      const r = await sendGmail({ fromEmail, to: [who], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, sentTo: who, subject, error: r.error })
    }
    // Store AFTER a successful build so a failed run never poisons the next comparison.
    await setSetting('labor_trueup_snapshot', snap, 'cron').catch(() => null)
    // Staffing planner learning: record today's forward bookings so the planner can learn
    // last-minute pickup per lead time. Cheap, once a day.
    const forward = await storeForwardSnapshot().catch(() => null)
    const seen = new Set<string>()
    const to2: string[] = []
    for (const x of ([] as string[]).concat(cfgW?.to || [], cfgD?.to || [])) {
      const e = String(x || '').trim().toLowerCase()
      if (e && /@/.test(e) && !seen.has(e)) { seen.add(e); to2.push(e) }
    }
    if (!to2.length) to2.push(OWNER)
    // OFF MEANS OFF (super audit, 2026-08-22): switching EITHER legacy key off disables the email.
    // The old `||` needed both keys explicitly false, so the /users toggle (which writes
    // labor_weekly) appeared to do nothing while labor_daily sat unset.
    const enabled = cfgW?.enabled !== false && cfgD?.enabled !== false
    if (!enabled && !force) {
      return NextResponse.json({ ok: true, sent: false, reason: 'switched off in settings', snapshotStored: true, forward, subject })
    }
    const cc = STANDING_CC.filter(c => !seen.has(c))
    const r = await sendGmail({ fromEmail, to: to2, cc, subject, html })
    return NextResponse.json({ ok: r.ok, sent: r.ok, to: to2.length, subject, forward, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
