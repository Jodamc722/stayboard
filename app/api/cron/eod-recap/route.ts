// END-OF-DAY RECAP (Jon, 2026-09-03: "Should send EOD recap of hours worked, by department and
// cleans / tasks completed. Most important is revenue generated cleans… the main goal is to show
// priority tasks completed, track payroll vs labor, and tasks completed. Also have a 7 day recap
// and an overview of tomorrow.")
//
// The morning brief says what the day should be. This is the evening answer: what it was.
//   1. REVENUE CLEANS      departure cleans that earned a fee today — the number that pays everyone
//   2. PRIORITIES          the things the 7am brief said mattered, and whether they got done
//   3. PAYROLL vs LABOR    what today cost against what it earned, by crew, from punches
//   4. TASKS COMPLETED     everything closed on the board today, by kind
//   5. LAST 7 DAYS         the same money, over the week, with cleans by day
//   6. TOMORROW            who is scheduled, what is booked, what is still unassigned
//
// SAME ENGINE AS EVERYTHING ELSE. Every dollar and hour here is lib/labor-econ over today (and the
// trailing week); cleans are Breezeway completions on their ET finish day; tomorrow is the day
// sheet plus the Homebase schedule. Nothing is re-derived, so this email cannot disagree with the
// Labor board or the morning brief.
//
//   GET  (cron ~8:15pm ET)    → send to the Ops Command list (app_settings ops_brief.full)
//   GET ?preview=1            → signed-in: return the HTML, send nothing
//   GET ?test=1               → signed-in: send to the tester only
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { laborEconomics, kindOfTask } from '@/lib/labor-econ'
import { buildDaySheet } from '@/lib/daysheet'
import { getShifts } from '@/lib/homebase'
import { etDay } from '@/lib/clean-day'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const OWNER = 'jon@stay-hospitality.com'
const STANDING_CC = ['roberto@stay-hospitality.com']
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app'

const dISO = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (iso: string, n: number) => dISO(new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 864e5))
const niceDay = (iso: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso + 'T12:00:00Z')) } catch { return iso } }
const money = (n: any) => (n == null || !Number.isFinite(Number(n))) ? '&mdash;' : (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString('en-US')
const rate = (n: any) => (n == null || !Number.isFinite(Number(n))) ? '&mdash;' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r1 = (n: any) => Math.round((Number(n) || 0) * 10) / 10
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
const RED = 'color:#dc2626;font-weight:600', AMBER = 'color:#b45309;font-weight:600', GREEN = 'color:#047857;font-weight:600', MUTED = 'color:#6b7280'
const cardStyle = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;margin:12px 0 0'
const td = 'padding:6px 4px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top'
const th = 'padding:4px 4px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;font-weight:600'
const secTitle = (t: string, sub?: string) =>
  `<p style="margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#4338ca;font-weight:700">${t}${sub ? ` <span style="font-weight:500;letter-spacing:0;text-transform:none;color:#9ca3af">&middot; ${sub}</span>` : ''}</p>`
const card = (inner: string) => `<div style="${cardStyle}">${inner}</div>`

async function signedIn(): Promise<string | null> {
  try { const sb = createClient(); const { data: { user } } = await sb.auth.getUser(); return user?.email ? String(user.email).toLowerCase() : null } catch { return null }
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : (!!req.headers.get('x-vercel-cron') || auth === '')
  const me = await signedIn()
  const preview = !!sp.get('preview'), test = !!sp.get('test')
  if ((preview || test) && !me) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!preview && !test && !isCron && !me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const today = dISO(new Date())
  const tomorrow = addDays(today, 1)
  const d7 = addDays(today, -6)

  try {
    // ── the engine, today and the week ─────────────────────────────────────────────────────────
    const [ecT, ec7] = await Promise.all([
      laborEconomics({ from: today, to: today, market: 'all' }) as Promise<any>,
      laborEconomics({ from: d7, to: today, market: 'all' }) as Promise<any>,
    ])
    const KT = ecT.kpi, K7 = ec7.kpi
    const punchesOk = ecT.payrollAudit?.complete !== false

    // ── today's sheet (what was promised) and tomorrow's (what is coming) ──────────────────────
    const [sheetT, sheetTm] = await Promise.all([
      buildDaySheet(today, 'all').catch(() => null) as Promise<any>,
      buildDaySheet(tomorrow, 'all').catch(() => null) as Promise<any>,
    ])
    let shiftsTm: any[] = []; let shiftsLoaded = true
    try { shiftsTm = (await getShifts(tomorrow, TZ)).filter((s: any) => !s.open && s.startAt) } catch { shiftsLoaded = false }
    let openShiftsTm = 0
    try { openShiftsTm = (await getShifts(tomorrow, TZ)).filter((s: any) => s.open).length } catch { /* counted above */ }

    // ── tasks closed today, by kind (ET finish day) ────────────────────────────────────────────
    const db = supabaseAdmin()
    const qFrom = addDays(today, -1), qTo = addDays(today, 1)
    const { data: doneRows } = await db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,finished_at,assignees,finished_by_name,reference_property_id')
      .gte('finished_at', qFrom).lte('finished_at', qTo + 'T23:59:59').limit(3000)
    const doneToday = ((doneRows || []) as any[]).filter(t => etDay(t.finished_at) === today && !/delete|cancel/i.test(str(t.status)))
    const byKind = { clean: 0, other: 0, maintenance: 0, inspection: 0 }
    const byPerson: Record<string, { clean: number; jobs: number }> = {}
    for (const t of doneToday) {
      const k = kindOfTask(t) as keyof typeof byKind
      if (k in byKind) byKind[k]++
      const names = ([] as any[]).concat(Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a?.name || a)).filter(Boolean)
      const who = names.length ? names : [str(t.finished_by_name)].filter(Boolean)
      for (const n of who) {
        const p = byPerson[n] ||= { clean: 0, jobs: 0 }
        if (k === 'clean') p.clean++; else p.jobs++
      }
    }

    // ── 1. REVENUE CLEANS ──────────────────────────────────────────────────────────────────────
    const hk = KT.housekeeping || {}
    const revCleans = Number(hk.cleans) || 0
    const depRevenue = Number(hk.revenue) || 0
    const chargedN = Number(hk.chargedCleanCount) || 0
    const chargedRev = Number(hk.chargedCleans) || 0
    const revenue = Number(hk.revenueWithCharged ?? hk.revenue) || 0
    // How the clean count was reached — closed on the board vs assigned today and never closed
    // (the house rule counts those as done on their scheduled day). Printed so the 5-vs-9 kind of
    // question answers itself instead of landing in Jon's inbox.
    const ca = ecT.cleanAudit || {}
    const caClosed = Number(ca.closed) || 0, caOpen = Number(ca.openCounted) || 0
    const hkPayroll = Number(hk.payroll) || 0
    const mtRev = Number(KT.maintenance?.revenue) || 0
    const payrollAll = Number(KT.allIn?.payroll) || 0
    const profit = Number(KT.allIn?.margin) || 0
    const mkRows = ((ecT.pnl?.perClean?.markets || []) as any[]).filter(m => m.cleans > 0)
    const revenueCard = card(
      secTitle('Revenue cleans today', niceDay(today)) +
      `<p style="margin:0;font-size:15px;line-height:1.6"><b style="font-size:22px">${revCleans}</b> departure clean${revCleans === 1 ? '' : 's'} by housekeeping &rarr; <b>${money(depRevenue)}</b> in cleaning fees` +
      (hk.costPerClean != null ? ` <span style="${MUTED}">&middot; ${rate(hk.costPerClean)} of housekeeper pay per clean</span>` : '') + `</p>` +
      (caOpen > 0 ? `<p style="margin:4px 0 0;font-size:12.5px;color:#6b7280">${caClosed} closed on the board &middot; <span style="${AMBER}">${caOpen} assigned today and never closed</span> &mdash; counted as done, per the house rule; the unit is listed under Priorities.</p>` : '') +
      (chargedN > 0 ? `<p style="margin:4px 0 0;font-size:12.5px;color:#6b7280">+ ${chargedN} charged mid-stay${chargedN === 1 ? '' : 's'}/refresh${chargedN === 1 ? '' : 'es'} &rarr; ${money(chargedRev)} &mdash; in the revenue total (<b>${money(revenue)}</b>), never in the clean count.</p>` : '') +
      (mkRows.length ? `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px"><tr><th style="${th}">Market</th><th style="${th};text-align:right">Cleans</th><th style="${th};text-align:right">HK payroll</th><th style="${th};text-align:right">$/clean</th></tr>` +
        mkRows.map(m => `<tr><td style="${td}">${esc(m.label)}</td><td style="${td};text-align:right">${m.cleans}</td><td style="${td};text-align:right">${money(m.housekeeping?.payroll)}</td><td style="${td};text-align:right"><b>${rate(m.housekeeping?.perClean)}</b></td></tr>`).join('') + '</table>' : '') +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">A departure clean lands on the day it was finished in Breezeway (or its scheduled day if nobody closed it), and carries its checkout's cleaning fee net of the channel cut. Cleans moved to another day count on that day. $/clean is housekeeper wages from Homebase punches divided by these cleans.</p>`
    )

    // ── 2. PRIORITIES — did the day's promises get kept ───────────────────────────────────────
    const deps: any[] = (sheetT?.departures || [])
    const sameDay = deps.filter(d => d.sameDayTurn && !d.extension)
    const sameDayDone = sameDay.filter(d => d.clean && d.clean.status === 'done')
    const allDep = deps.filter(d => !d.extension)
    const allDepDone = allDep.filter(d => d.clean && d.clean.status === 'done')
    const noClean = allDep.filter(d => !d.clean)
    const stillOpen = allDep.filter(d => d.clean && d.clean.status !== 'done')
    // Lighthouse's own inspections booked for today (arrival + bad-review), and their fate.
    let inspAll = 0, inspDone = 0
    try {
      const { data: ins } = await db.from('auto_inspections').select('status,check_in').eq('check_in', today).limit(500)
      for (const i of ((ins || []) as any[])) { inspAll++; if (/complet|finish|close|approv|done/i.test(str(i.status))) inspDone++ }
    } catch { /* optional */ }
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
    const pLine = (label: string, done: number, all: number, hot = false) => {
      const p = pct(done, all)
      const tone = all === 0 ? MUTED : done === all ? GREEN : (hot ? RED : AMBER)
      return `<tr><td style="${td}">${label}</td><td style="${td};text-align:right;white-space:nowrap"><span style="${tone}">${done} of ${all}</span>${p != null ? ` <span style="${MUTED}">(${p}%)</span>` : ''}</td></tr>`
    }
    const prioCard = card(
      secTitle('Priorities — what the 7am brief asked for, and what got done') +
      `<table width="100%" cellspacing="0" cellpadding="0">` +
      pLine('Same-day turns finished', sameDayDone.length, sameDay.length, true) +
      pLine('Departure cleans finished', allDepDone.length, allDep.length) +
      (inspAll ? pLine('Lighthouse inspections walked', inspDone, inspAll) : '') +
      `</table>` +
      (stillOpen.length ? `<p style="margin:8px 0 0;font-size:12.5px"><span style="${RED}">Still open at send time:</span> ${esc(stillOpen.slice(0, 8).map(d => d.unit).join(', '))}${stillOpen.length > 8 ? ` +${stillOpen.length - 8} more` : ''}</p>` : '') +
      (noClean.length ? `<p style="margin:6px 0 0;font-size:12.5px"><span style="${AMBER}">Checked out with no clean on the board:</span> ${esc(noClean.slice(0, 8).map(d => d.unit).join(', '))}${noClean.length > 8 ? ` +${noClean.length - 8} more` : ''}</p>` : '') +
      (!stillOpen.length && !noClean.length && allDep.length ? `<p style="margin:8px 0 0;font-size:12.5px"><span style="${GREEN}">Every checkout was cleaned and closed.</span></p>` : '')
    )

    // ── 3. PAYROLL vs LABOR — by crew, from punches ───────────────────────────────────────────
    const depts: any[] = (ecT.departments || []).filter((x: any) => (x.hours || 0) > 0 || (x.payroll || 0) > 0)
    const ORDER = ['housekeeping', 'supervision', 'maintenance', 'ccs', 'inspection', 'other']
    depts.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
    const earnedOf = (k: string) => k === 'housekeeping' ? revenue : k === 'maintenance' ? mtRev : null
    const laborRows = depts.map(x => {
      const earned = earnedOf(x.key)
      return `<tr><td style="${td}"><b>${esc(x.label)}</b> <span style="${MUTED};font-size:11.5px">${x.people} ${x.people === 1 ? 'person' : 'people'}</span></td>` +
        `<td style="${td};text-align:right">${r1(x.hours)}h</td>` +
        `<td style="${td};text-align:right">${money(x.payroll)}</td>` +
        `<td style="${td};text-align:right">${earned != null ? money(earned) : '<span style="' + MUTED + '">&mdash;</span>'}</td>` +
        `<td style="${td};text-align:right;white-space:nowrap">${earned != null && earned > 0 ? `<span style="${(earned - x.payroll) < 0 ? RED : GREEN}">${money(earned - x.payroll)}</span>` : '<span style="' + MUTED + '">&mdash;</span>'}</td></tr>`
    }).join('')
    const totalHours = r1(depts.reduce((a, x) => a + (x.hours || 0), 0))
    const openCards = (ecT.people || []).filter((p: any) => p.openCard || p.hoursSoFar).length
    const laborCard = card(
      secTitle('Payroll vs labor', 'Homebase punches &middot; today') +
      `<p style="margin:0 0 8px;font-size:14px">Earned <b>${money(revenue + mtRev)}</b> <span style="${MUTED}">(${money(revenue)} cleaning + ${money(mtRev)} maintenance billed)</span> against <b>${money(payrollAll)}</b> payroll for <b>${totalHours}h</b> &rarr; ` +
      `<b style="${profit < 0 ? RED : GREEN}">${money(profit)}</b> ${profit < 0 ? 'loss' : 'profit'}` +
      (KT.allIn?.marginPct != null ? ` <span style="${MUTED}">(${Math.round(KT.allIn.marginPct)}% margin)</span>` : '') + `</p>` +
      `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${th}">Crew</th><th style="${th};text-align:right">Hours</th><th style="${th};text-align:right">Payroll</th><th style="${th};text-align:right">Earned</th><th style="${th};text-align:right">Net</th></tr>${laborRows}</table>` +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">${punchesOk ? 'Every Homebase punch for today came back.' : '<span style="' + RED + '">Homebase did not return every punch &mdash; payroll is a floor tonight.</span>'} Anyone still clocked in is counted to now. Salaried people carry their salary, never punches. Housekeeping earns cleaning fees; maintenance earns billable charges; supervisors and CCS are overhead the two crews carry.</p>`
    )

    // ── 4. TASKS COMPLETED ─────────────────────────────────────────────────────────────────────
    const topPeople = Object.keys(byPerson).map(n => ({ n, ...byPerson[n] })).sort((a, b) => (b.clean + b.jobs) - (a.clean + a.jobs)).slice(0, 10)
    const tasksCard = card(
      secTitle('Tasks completed today', `${doneToday.length} closed on the board`) +
      `<p style="margin:0 0 8px;font-size:13px;line-height:1.8">` +
      `<b>${byKind.clean}</b> departure cleans closed &middot; <b>${byKind.other}</b> other housekeeping &middot; <b>${byKind.maintenance}</b> maintenance &middot; <b>${byKind.inspection}</b> inspections</p>` +
      (KT.maintenance?.tasksNoCharge ? `<p style="margin:0 0 8px;font-size:12.5px"><span style="${AMBER}">${KT.maintenance.tasksNoCharge} job${KT.maintenance.tasksNoCharge === 1 ? '' : 's'} closed by the maintenance crew with no charge entered</span> <span style="${MUTED}">&mdash; billable or not, the field was left blank (17WEST excluded).</span></p>` : '') +
      (topPeople.length ? `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${th}">Person</th><th style="${th};text-align:right">Cleans</th><th style="${th};text-align:right">Other jobs</th></tr>` +
        topPeople.map(p => `<tr><td style="${td}">${esc(p.n)}</td><td style="${td};text-align:right">${p.clean || '<span style="' + MUTED + '">&mdash;</span>'}</td><td style="${td};text-align:right">${p.jobs || '<span style="' + MUTED + '">&mdash;</span>'}</td></tr>`).join('') + '</table>' : '')
    )

    // ── 5. LAST 7 DAYS ────────────────────────────────────────────────────────────────────────
    const hk7 = K7.housekeeping || {}
    const rev7 = Number(hk7.revenueWithCharged ?? hk7.revenue) || 0
    const mt7 = Number(K7.maintenance?.revenue) || 0
    const pay7 = Number(K7.allIn?.payroll) || 0
    const prof7 = Number(K7.allIn?.margin) || 0
    const cleansByDay: Record<string, number> = {}
    // The engine's per-person day ledger: { d, cleans, fee, … } keyed by name.
    for (const rows of Object.values((ec7.personDays || {}) as Record<string, any[]>)) for (const day of rows) cleansByDay[day.d] = (cleansByDay[day.d] || 0) + (day.cleans || 0)
    const dayChips = Array.from({ length: 7 }, (_, i) => addDays(d7, i)).map(day => {
      const lbl = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(day + 'T12:00:00Z'))
      return `<span style="white-space:nowrap"><span style="${MUTED}">${lbl}</span> <b>${cleansByDay[day] || 0}</b></span>`
    }).join(' &nbsp; ')
    const weekCard = card(
      secTitle('Last 7 days', `${niceDay(d7)} &ndash; ${niceDay(today)}`) +
      `<table width="100%" cellspacing="0" cellpadding="0">` +
      `<tr><td style="${td}">Revenue cleans</td><td style="${td};text-align:right"><b>${Number(hk7.cleans) || 0}</b>${hk7.costPerClean != null ? ` <span style="${MUTED}">&middot; ${rate(hk7.costPerClean)}/clean</span>` : ''}</td></tr>` +
      `<tr><td style="${td}">Cleaning revenue</td><td style="${td};text-align:right">${money(rev7)}</td></tr>` +
      `<tr><td style="${td}">Maintenance billed</td><td style="${td};text-align:right">${money(mt7)}</td></tr>` +
      `<tr><td style="${td}">Payroll, everyone</td><td style="${td};text-align:right">${money(pay7)}</td></tr>` +
      `<tr><td style="${td}"><b>Profit</b></td><td style="${td};text-align:right"><b style="${prof7 < 0 ? RED : GREEN}">${money(prof7)}</b>${K7.allIn?.marginPct != null ? ` <span style="${MUTED}">(${Math.round(K7.allIn.marginPct)}%)</span>` : ''}</td></tr>` +
      `</table>` +
      `<p style="margin:10px 0 0;font-size:12.5px"><span style="${MUTED}">Cleans by day:</span> ${dayChips}</p>` +
      (ec7.payrollAudit?.complete === false ? `<p style="margin:8px 0 0;font-size:11px;color:#dc2626">Homebase did not return every week in this window &mdash; the payroll here is a floor.</p>` : '')
    )

    // ── 6. TOMORROW ───────────────────────────────────────────────────────────────────────────
    const depsTm: any[] = (sheetTm?.departures || []).filter((d: any) => !d.extension)
    const arrsTm: any[] = (sheetTm?.arrivals || [])
    const sameDayTm = depsTm.filter(d => d.sameDayTurn)
    const unassignedTm = depsTm.filter(d => d.clean && !(Array.isArray(d.clean.assignees) && d.clean.assignees.length))
    const noCleanTm = depsTm.filter(d => !d.clean)
    const crewWord = (role: string) => /maint|tech|repair|handy/i.test(role) ? 'maintenance' : /supervis|lead|manager/i.test(role) ? 'supervision' : /clean|housekeep|hk/i.test(role) ? 'housekeeping' : 'other'
    const shiftCrew: Record<string, string[]> = {}
    for (const s of shiftsTm) (shiftCrew[crewWord(str(s.role))] ||= []).push(str(s.name))
    const crewLine = ['housekeeping', 'supervision', 'maintenance', 'other'].filter(k => shiftCrew[k]?.length)
      .map(k => `<b>${shiftCrew[k].length}</b> ${k === 'other' ? 'other' : k}`).join(' &middot; ')
    // Arrivals worth a heads-up: long or big stays, using the same thresholds the morning brief uses.
    let LONG_N = 14, BIG_USD = 3000
    try { const { getSlackRules } = await import('@/lib/slack-rules'); const R: any = await getSlackRules(); LONG_N = R.longStayNights || 14; BIG_USD = R.bigBookingUsd || 3000 } catch { /* defaults */ }
    const notable = arrsTm.filter(a => (Number(a.nights) || 0) >= LONG_N || (Number(a.moneyTotal ?? a.money_total) || 0) >= BIG_USD || a.ownerFlag)
    const tomorrowCard = card(
      secTitle('Tomorrow', niceDay(tomorrow)) +
      `<p style="margin:0 0 6px;font-size:14px;line-height:1.7"><b>${depsTm.length}</b> checkouts &middot; <b>${arrsTm.length}</b> arrivals` +
      (sameDayTm.length ? ` &middot; <span style="${RED}">${sameDayTm.length} same-day turn${sameDayTm.length === 1 ? '' : 's'}</span>` : '') + `</p>` +
      `<p style="margin:0 0 6px;font-size:13px;line-height:1.7">` +
      (shiftsLoaded
        ? `<b>${shiftsTm.length}</b> on the Homebase schedule${crewLine ? ` &mdash; ${crewLine}` : ''}` + (openShiftsTm ? ` &middot; <span style="${RED}">${openShiftsTm} open shift${openShiftsTm === 1 ? '' : 's'} unfilled</span>` : '')
        : `<span style="${AMBER}">Homebase did not answer &mdash; tomorrow's schedule is on the Labor board.</span>`) + `</p>` +
      `<p style="margin:0;font-size:13px;line-height:1.7">` +
      (unassignedTm.length ? `<span style="${AMBER}">${unassignedTm.length} clean${unassignedTm.length === 1 ? '' : 's'} on the board with nobody assigned</span>` : `<span style="${GREEN}">Every clean on tomorrow's board has a name on it</span>`) +
      (noCleanTm.length ? ` &middot; <span style="${RED}">${noCleanTm.length} checkout${noCleanTm.length === 1 ? '' : 's'} with no clean created yet</span>` : '') +
      `</p>` +
      (notable.length ? `<p style="margin:8px 0 0;font-size:12.5px"><span style="${MUTED}">Worth a heads-up:</span> ${notable.slice(0, 6).map(a => esc(`${a.unit} (${a.guest}${a.nights ? ', ' + a.nights + ' nights' : ''}${a.ownerFlag ? ', ' + a.ownerFlag : ''})`)).join(' &middot; ')}</p>` : '') +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">The 7am brief will carry the full run &mdash; this is the shape of the day so nobody is surprised by it.</p>`
    )

    // ── assemble ───────────────────────────────────────────────────────────────────────────────
    const verdict = `<b>${revCleans}</b> departure clean${revCleans === 1 ? '' : 's'} earned <b>${money(revenue)}</b>` +
      (mtRev > 0 ? `, maintenance billed <b>${money(mtRev)}</b>` : '') + ` &mdash; <b>${money(revenue + mtRev)}</b> against <b>${money(payrollAll)}</b> of payroll ` +
      `&rarr; <b style="${profit < 0 ? RED : GREEN}">${money(profit)} ${profit < 0 ? 'loss' : 'profit'}</b>` +
      (KT.allIn?.marginPct != null ? ` <span style="${MUTED}">(${Math.round(KT.allIn.marginPct)}%)</span>` : '') + `. ` +
      `${allDepDone.length} of ${allDep.length} checkouts cleaned` + (sameDay.length ? `, ${sameDayDone.length} of ${sameDay.length} same-day turns` : '') + `.`
    const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;${FONT};color:#0b1220">` +
      `<div style="max-width:720px;margin:0 auto;padding:18px">` +
      `<div style="background:#111827;border-radius:12px;padding:16px 18px">` +
      `<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S T A Y &nbsp; H O S P I T A L I T Y</p>` +
      `<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">End of day</p>` +
      `<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">${niceDay(today)}</p></div>` +
      `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:13px 18px;margin:12px 0 0"><p style="margin:0;font-size:14px;line-height:1.6">${verdict}</p></div>` +
      revenueCard + prioCard + laborCard + tasksCard + weekCard + tomorrowCard +
      `<table width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0"><tr><td>` +
      `<a href="${APP_URL}/labor" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">Open the Labor board &rarr;</a></td></tr></table>` +
      `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically every evening. Same engine as the Labor board and the morning briefs.</p>` +
      `</div></body></html>`
    const subject = `EOD ${niceDay(today)}: ${revCleans} cleans, ${money(revenue + mtRev)} earned vs ${money(payrollAll)} payroll, ${money(profit)} ${profit < 0 ? 'loss' : 'profit'}`

    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

    const cfg = await getSetting<any>('ops_brief', {})
    const fromEmail = String(cfg.fromEmail || OWNER)
    const to: string[] = test ? [me as string] : Array.from(new Set([...(cfg.full || []), OWNER].filter(Boolean)))
    const cc = test ? [] : STANDING_CC.filter(c => !to.includes(c))
    const r = await sendGmail({ fromEmail, to, cc, subject: (test ? '[TEST] ' : '') + subject, html })
    return NextResponse.json({ ok: r.ok, to: to.length, subject, error: r.error, counts: { revCleans, revenue, payrollAll, profit, done: doneToday.length } })
  } catch (e: any) {
    // A recap that did not send looks like a quiet night — say so, to the owner.
    await sendGmail({ fromEmail: OWNER, to: [OWNER], subject: '⚠️ End-of-day recap did not send', html: `<p style="${FONT};font-size:14px">The EOD recap for ${today} failed to build: ${esc(String(e?.message || e)).slice(0, 300)}</p>` }).catch(() => null)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
