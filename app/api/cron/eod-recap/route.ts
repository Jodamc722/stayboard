// END-OF-DAY RECAP (Jon, 2026-09-03: "Should send EOD recap of hours worked, by department and
// cleans / tasks completed. Most important is revenue generated cleans… the main goal is to show
// priority tasks completed, track payroll vs labor, and tasks completed. Also have a 7 day recap
// and an overview of tomorrow.")
//
// Jon, 2026-09-11: "separate HK profit, supervisor another line item, and then maintenance. Instead
// of having the profit at the top, just have it based on housekeeping hours and revenue generated.
// Also show the cleans a little bit more breakdown of what was completed that day. The goal is to
// have a general idea of our effectiveness and efficiency in revenue and labor management."
//
// So the recap reads like an owner-operator's evening: no blended company profit at the top —
// the headline is the housekeeping line, because that is the line the staffing decisions live on.
//   1. HOUSEKEEPING        cleans · revenue · HK hours → revenue per hour, cost per clean, HK profit
//   2. SUPERVISION         its own line: what it cost, what it covered, HK profit after supervision
//   3. MAINTENANCE         separate: billed vs its own payroll, jobs billed / left blank
//   4. CLEANS COMPLETED    the breakdown: by market and building, by type, by person (cleans per hour)
//   5. PRIORITIES          the things the 7am brief said mattered, and whether they got done
//   6. LAST 7 DAYS         the same three lines over the week, with today against the week's average
//   7. TOMORROW            who is scheduled, what is booked, what is still unassigned
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
      .select('id,name,type_department,status,finished_at,assignees,finished_by_name,reference_property_id,total_minutes,scheduled_date')
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

    // ── 1. HOUSEKEEPING — the line the staffing decisions live on ──────────────────────────
    const hk = KT.housekeeping || {}
    const revCleans = Number(hk.cleans) || 0
    const depRevenue = Number(hk.revenue) || 0
    const chargedN = Number(hk.chargedCleanCount) || 0
    const chargedRev = Number(hk.chargedCleans) || 0
    const revenue = Number(hk.revenueWithCharged ?? hk.revenue) || 0
    const hkHours = Number(hk.hours) || 0
    const hkPayroll = Number(hk.payroll) || 0
    const hkProfit = Math.round((revenue - hkPayroll) * 100) / 100
    const hkMarginPct = revenue > 0 ? Math.round(hkProfit / revenue * 100) : null
    const revPerHour = hkHours > 0 ? revenue / hkHours : null
    const cleansPerHour = hkHours > 0 && revCleans > 0 ? revCleans / hkHours : null
    const hoursPerClean = revCleans > 0 && hkHours > 0 ? hkHours / revCleans : null
    const costPerClean = revCleans > 0 ? hkPayroll / revCleans : null
    const feePerClean = revCleans > 0 ? depRevenue / revCleans : null
    const ca = ecT.cleanAudit || {}
    const caClosed = Number(ca.closed) || 0, caOpen = Number(ca.openCounted) || 0
    // The week's pace, so today can be read against something. Same engine, same rules.
    const hk7 = K7.housekeeping || {}
    const rev7 = Number(hk7.revenueWithCharged ?? hk7.revenue) || 0
    const hkHours7 = Number(hk7.hours) || 0, hkPay7 = Number(hk7.payroll) || 0, cleans7 = Number(hk7.cleans) || 0
    const avgRevPerHour7 = hkHours7 > 0 ? rev7 / hkHours7 : null
    const avgCostPerClean7 = cleans7 > 0 ? hkPay7 / cleans7 : null
    const avgHoursPerClean7 = cleans7 > 0 && hkHours7 > 0 ? hkHours7 / cleans7 : null
    const vs = (today: number | null, week: number | null, goodWhen: 'higher' | 'lower', fmt: (n: number) => string) => {
      if (today == null || week == null || week === 0) return ''
      const diff = (today - week) / week
      if (Math.abs(diff) < 0.03) return ` <span style="${MUTED}">(on the week's pace)</span>`
      const good = goodWhen === 'higher' ? diff > 0 : diff < 0
      return ` <span style="${good ? GREEN : AMBER}">(${diff > 0 ? '+' : ''}${Math.round(diff * 100)}% vs 7-day ${fmt(week)})</span>`
    }
    const mkRows = ((ecT.buckets || []) as any[]).filter(m => m.inHouse && (m.cleans > 0 || m.hours > 0))
    const tile = (label: string, value: string, sub?: string) =>
      `<td style="padding:6px 10px 6px 0;vertical-align:top"><div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:600">${label}</div><div style="font-size:20px;font-weight:800;line-height:1.2">${value}</div>${sub ? `<div style="font-size:11.5px;color:#6b7280">${sub}</div>` : ''}</td>`
    const hkCard = card(
      secTitle('Housekeeping', niceDay(today) + ' &middot; the line that pays') +
      `<table cellspacing="0" cellpadding="0" style="width:100%"><tr>` +
      tile('Departure cleans', String(revCleans), Number(hk.cleansByOtherCrews) > 0 ? `${hk.cleansByOtherCrews} covered by other crews` : (caOpen > 0 ? `${caClosed} closed on the board, ${caOpen} counted by rule` : 'all closed on the board')) +
      tile('Cleaning revenue', money(revenue), chargedN > 0 ? `${money(depRevenue)} fees + ${money(chargedRev)} charged extras` : 'net of channel cut') +
      tile('HK hours', `${r1(hkHours)}h`, `${money(hkPayroll)} housekeeper payroll`) +
      tile('HK profit', `<span style="${hkProfit < 0 ? RED : GREEN}">${money(hkProfit)}</span>`, hkMarginPct != null ? `${hkMarginPct}% of cleaning revenue` : 'no revenue today') +
      `</tr></table>` +
      `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">` +
      `<tr><td style="${td}">Revenue per HK hour</td><td style="${td};text-align:right"><b>${revPerHour != null ? rate(revPerHour) : '&mdash;'}</b>${vs(revPerHour, avgRevPerHour7, 'higher', n => rate(n))}</td></tr>` +
      `<tr><td style="${td}">Labor cost per clean</td><td style="${td};text-align:right"><b>${costPerClean != null ? rate(costPerClean) : '&mdash;'}</b>${vs(costPerClean, avgCostPerClean7, 'lower', n => rate(n))}${feePerClean != null ? ` <span style="${MUTED}">&middot; fee ${rate(feePerClean)}/clean</span>` : ''}</td></tr>` +
      `<tr><td style="${td}">Hours per clean</td><td style="${td};text-align:right"><b>${hoursPerClean != null ? r1(hoursPerClean) + 'h' : '&mdash;'}</b>${vs(hoursPerClean, avgHoursPerClean7, 'lower', n => r1(n) + 'h')}${cleansPerHour != null ? ` <span style="${MUTED}">&middot; ${r1(cleansPerHour * 8)} cleans per 8h shift</span>` : ''}</td></tr>` +
      `</table>` +
      (mkRows.length > 1 ? `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px"><tr><th style="${th}">Market</th><th style="${th};text-align:right">Cleans</th><th style="${th};text-align:right">HK hours</th><th style="${th};text-align:right">Payroll</th><th style="${th};text-align:right">Revenue</th><th style="${th};text-align:right">HK profit</th><th style="${th};text-align:right">$/clean</th></tr>` +
        mkRows.map(m => `<tr><td style="${td}">${esc(m.label)}</td><td style="${td};text-align:right">${m.cleans}</td><td style="${td};text-align:right">${r1(m.hours)}h</td><td style="${td};text-align:right">${money(m.payroll)}</td><td style="${td};text-align:right">${money(m.cleaningRevenue)}</td><td style="${td};text-align:right"><span style="${(m.margin || 0) < 0 ? RED : GREEN}">${money(m.margin)}</span></td><td style="${td};text-align:right"><b>${m.laborCostPerClean != null ? rate(m.laborCostPerClean) : '&mdash;'}</b></td></tr>`).join('') + '</table>' : '') +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Housekeeper wages from Homebase punches only. A departure clean lands on the day it was finished (or its scheduled day if nobody closed it) and carries its checkout's cleaning fee net of the channel cut. Charged mid-stays and refreshes are in revenue, never in the clean count. ${punchesOk ? 'Every Homebase punch for today came back.' : '<span style="' + RED + '">Homebase did not return every punch &mdash; hours and payroll are a floor tonight.</span>'}</p>`
    )

    // ── 2. SUPERVISION — its own line ──────────────────────────────────────────────────────────
    const sup = KT.supervision || {}
    const supPayroll = Number(sup.payroll) || 0, supHours = Number(sup.hours) || 0, supPeople = Number(sup.people) || 0
    const supCleans = Number(sup.cleans) || 0
    const hkAfterSup = Math.round((hkProfit - supPayroll) * 100) / 100
    const loadedPerClean = revCleans > 0 ? (hkPayroll + supPayroll) / revCleans : null
    const supCard = card(
      secTitle('Supervision', 'its own line &middot; overhead the cleaning line carries') +
      `<table cellspacing="0" cellpadding="0" style="width:100%"><tr>` +
      tile('Cost today', money(supPayroll), `${supPeople} ${supPeople === 1 ? 'person' : 'people'} &middot; ${r1(supHours)}h${sup.names && sup.names.length ? ' &middot; ' + esc((sup.names as string[]).slice(0, 4).join(', ')) : ''}`) +
      tile('Turns they covered', String(supCleans), supCleans ? 'counted as cleans; fees sit with housekeeping' : 'no cleans by supervisors') +
      tile('HK profit after supervision', `<span style="${hkAfterSup < 0 ? RED : GREEN}">${money(hkAfterSup)}</span>`, revenue > 0 ? `${Math.round(hkAfterSup / revenue * 100)}% of cleaning revenue` : '') +
      tile('Loaded cost per clean', loadedPerClean != null ? rate(loadedPerClean) : '&mdash;', costPerClean != null ? `${rate(costPerClean)} cleaners + ${revCleans > 0 ? rate(supPayroll / revCleans) : '&mdash;'} supervision` : '') +
      `</tr></table>` +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Supervisors are a fixed cost of running the cleaning line, so they are shown against it &mdash; not inside it. Salaried people carry their salary for the day, never punches.</p>`
    )

    // ── 3. MAINTENANCE — separate ──────────────────────────────────────────────────────────────
    const mt = KT.maintenance || {}
    const mtRev = Number(mt.revenue) || 0, mtPayroll = Number(mt.payroll) || 0, mtHours = Number(mt.hours) || 0
    const mtProfit = Math.round((mtRev - mtPayroll) * 100) / 100
    const mtDept = ((ecT.departments || []) as any[]).find((d: any) => d.key === 'maintenance') || {}
    const mtCard = card(
      secTitle('Maintenance', 'separate line &middot; its own revenue, its own crew') +
      `<table cellspacing="0" cellpadding="0" style="width:100%"><tr>` +
      tile('Billed to owners', money(mtRev), `${Number(mt.tasksBilled) || 0} job${Number(mt.tasksBilled) === 1 ? '' : 's'} with a charge`) +
      tile('Hours', `${r1(mtHours)}h`, `${money(mtPayroll)} payroll &middot; ${Number(mtDept.people) || 0} ${Number(mtDept.people) === 1 ? 'person' : 'people'}`) +
      tile('Maintenance profit', `<span style="${mtProfit < 0 ? RED : GREEN}">${money(mtProfit)}</span>`, mtHours > 0 ? `${rate(mtRev / mtHours)} billed per hour` : '') +
      tile('Left blank', String(Number(mt.tasksNoCharge) || 0), Number(mt.tasksNoCharge) ? 'closed with no charge entered' : 'every job priced') +
      `</tr></table>` +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Billed = owner-billable charges on maintenance tasks finished today (17WEST excluded). A day with hours and no billing is either unbillable upkeep or a charge nobody typed &mdash; the blank count says which.</p>`
    )

    // ── 5. PRIORITIES — did the day's promises get kept ───────────────────────────────────────
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

    // ── 4. CLEANS COMPLETED — the breakdown ───────────────────────────────────────────────────
    const KIND_RE: [string, RegExp][] = [
      ['Departure cleans', /departure clean|turnover clean|check-?out clean|move-?out clean|limpieza de salida/i],
      ['Mid-stay / refresh', /mid-?stay|refresh|touch-?up|linen (change|swap)|towel (change|swap)/i],
      ['Deep cleans', /deep clean/i],
      ['Strips', /strip/i],
    ]
    const hkTasks = doneToday.filter(t => /housekeep|clean/i.test(str(t.type_department)) || kindOfTask(t) === 'clean')
    const typeCounts: Record<string, number> = {}
    let cleanMinutes = 0, cleanTimed = 0
    for (const t of hkTasks) {
      const nm = str(t.name)
      const k = (KIND_RE.find(([, re]) => re.test(nm)) || ['Other housekeeping'])[0] as string
      typeCounts[k] = (typeCounts[k] || 0) + 1
      if (k === 'Departure cleans' && Number(t.total_minutes) > 0) { cleanMinutes += Number(t.total_minutes); cleanTimed++ }
    }
    const typeLine = Object.keys(typeCounts).sort((x, y) => typeCounts[y] - typeCounts[x]).map(k => `<b>${typeCounts[k]}</b> ${k.toLowerCase()}`).join(' &middot; ')
    // By building — from the day sheet, which knows every checkout, cleaned or not.
    const byBuilding: Record<string, { market: string; done: number; open: number; none: number; sameDay: number }> = {}
    for (const d of allDep) {
      const b = str(d.building) || str(d.market) || 'Other'
      const row = byBuilding[b] ||= { market: str(d.market), done: 0, open: 0, none: 0, sameDay: 0 }
      if (d.clean && d.clean.status === 'done') row.done++; else if (d.clean) row.open++; else row.none++
      if (d.sameDayTurn) row.sameDay++
    }
    const bRows = Object.keys(byBuilding).sort((x, y) => (byBuilding[y].done + byBuilding[y].open + byBuilding[y].none) - (byBuilding[x].done + byBuilding[x].open + byBuilding[x].none))
    // By person — the staffing view: cleans, hours on the clock, cleans per hour, wages per clean.
    const people: any[] = ((ecT.people || []) as any[]).filter(p => (p.hours || 0) > 0 || (p.depCleans || 0) > 0 || (p.cleans || 0) > 0)
    const hkPeople = people.filter(p => p.dept === 'housekeeping').sort((x, y) => (y.depCleans || 0) - (x.depCleans || 0) || (y.hours || 0) - (x.hours || 0))
    const coverPeople = people.filter(p => p.dept !== 'housekeeping' && (p.depCleans || 0) > 0)
    const idle = hkPeople.filter(p => (p.hours || 0) >= 2 && !(p.depCleans || 0) && !(p.cleans || 0))
    const pRow = (p: any) => {
      const cleans = Number(p.depCleans) || 0, hrs = Number(p.hours) || 0, wages = Number(p.payroll) || 0
      const cph = hrs > 0 && cleans > 0 ? cleans / hrs : null
      const wpc = cleans > 0 ? wages / cleans : null
      const extra = (Number(p.cleans) || 0) - cleans
      return `<tr><td style="${td}">${esc(p.name)}${p.dept !== 'housekeeping' ? ` <span style="${MUTED};font-size:11px">${esc(p.dept)}</span>` : ''}${p.market ? ` <span style="${MUTED};font-size:11px">${esc(p.market)}</span>` : ''}</td>` +
        `<td style="${td};text-align:right"><b>${cleans || '<span style="' + MUTED + '">&mdash;</span>'}</b>${extra > 0 ? ` <span style="${MUTED}">+${extra} other</span>` : ''}</td>` +
        `<td style="${td};text-align:right">${hrs ? r1(hrs) + 'h' : '<span style="' + MUTED + '">&mdash;</span>'}</td>` +
        `<td style="${td};text-align:right">${cph != null ? r1(cph * 8) : '<span style="' + MUTED + '">&mdash;</span>'}</td>` +
        `<td style="${td};text-align:right">${wpc != null ? `<span style="${costPerClean != null && wpc > costPerClean * 1.25 ? AMBER : ''}">${rate(wpc)}</span>` : (hrs > 0 ? `<span style="${AMBER}">${money(wages)} for 0 cleans</span>` : '<span style="' + MUTED + '">&mdash;</span>')}</td></tr>`
    }
    const cleansCard = card(
      secTitle('Cleans completed', `${hkTasks.length} housekeeping task${hkTasks.length === 1 ? '' : 's'} closed today`) +
      (typeLine ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.8">${typeLine}` + (cleanTimed ? ` <span style="${MUTED}">&middot; ${Math.round(cleanMinutes / cleanTimed)} min average on the clock per departure clean (${cleanTimed} timed)</span>` : '') + `</p>` : '') +
      `<p style="margin:0 0 8px;font-size:13px">${sameDay.length ? `<b>${sameDayDone.length} of ${sameDay.length}</b> same-day turns done &middot; ` : ''}<b>${allDepDone.length} of ${allDep.length}</b> checkouts cleaned${stillOpen.length ? ` &middot; <span style="${RED}">${stillOpen.length} still open</span>` : ''}${noClean.length ? ` &middot; <span style="${AMBER}">${noClean.length} with no clean on the board</span>` : ''}</p>` +
      (bRows.length ? `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${th}">Building</th><th style="${th};text-align:right">Checkouts</th><th style="${th};text-align:right">Cleaned</th><th style="${th};text-align:right">Open</th><th style="${th};text-align:right">Same-day</th></tr>` +
        bRows.slice(0, 14).map(b => { const r = byBuilding[b]; const all = r.done + r.open + r.none; return `<tr><td style="${td}">${esc(b)}${r.market ? ` <span style="${MUTED};font-size:11px">${esc(r.market)}</span>` : ''}</td><td style="${td};text-align:right">${all}</td><td style="${td};text-align:right"><span style="${r.done === all ? GREEN : ''}">${r.done}</span></td><td style="${td};text-align:right">${r.open + r.none ? `<span style="${r.none ? AMBER : RED}">${r.open + r.none}${r.none ? ' <span style="font-weight:400;font-size:11px">(' + r.none + ' no task)</span>' : ''}</span>` : '<span style="' + MUTED + '">&mdash;</span>'}</td><td style="${td};text-align:right">${r.sameDay || '<span style="' + MUTED + '">&mdash;</span>'}</td></tr>` }).join('') +
        (bRows.length > 14 ? `<tr><td colspan="5" style="${td};color:#6b7280">+${bRows.length - 14} more buildings</td></tr>` : '') + '</table>' : '') +
      (hkPeople.length || coverPeople.length ? `<p style="margin:12px 0 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:600">By person &middot; the staffing view</p>` +
        `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${th}">Person</th><th style="${th};text-align:right">Cleans</th><th style="${th};text-align:right">On the clock</th><th style="${th};text-align:right">Cleans / 8h</th><th style="${th};text-align:right">Wages / clean</th></tr>` +
        hkPeople.slice(0, 14).map(pRow).join('') + coverPeople.map(pRow).join('') + '</table>' : '') +
      (idle.length ? `<p style="margin:8px 0 0;font-size:12.5px"><span style="${AMBER}">On the clock with no cleans:</span> ${esc(idle.map(p => `${p.name} (${r1(p.hours)}h)`).join(', '))} <span style="${MUTED}">&mdash; strips, inspections or projects; worth knowing which.</span></p>` : '') +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">Cleans per 8h is the person's departure cleans over their hours on the clock, scaled to a full shift. Wages per clean is amber when it runs 25% above today's crew average. Other kinds of housekeeping (strips, refreshes) show as "+N other".</p>`
    )

    // ── 6. LAST 7 DAYS — the same three lines over the week ────────────────────────────────
    const sup7 = K7.supervision || {}, mt7k = K7.maintenance || {}
    const hkProfit7 = Math.round((rev7 - hkPay7) * 100) / 100
    const supPay7 = Number(sup7.payroll) || 0
    const mt7 = Number(mt7k.revenue) || 0, mtPay7 = Number(mt7k.payroll) || 0, mtHours7 = Number(mt7k.hours) || 0
    const cleansByDay: Record<string, number> = {}
    // The engine's per-person day ledger: { d, cleans, fee, … } keyed by name.
    for (const rows of Object.values((ec7.personDays || {}) as Record<string, any[]>)) for (const day of rows) cleansByDay[day.d] = (cleansByDay[day.d] || 0) + (day.cleans || 0)
    const dayChips = Array.from({ length: 7 }, (_, i) => addDays(d7, i)).map(day => {
      const lbl = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(day + 'T12:00:00Z'))
      return `<span style="white-space:nowrap"><span style="${MUTED}">${lbl}</span> <b>${cleansByDay[day] || 0}</b></span>`
    }).join(' &nbsp; ')
    const weekCard = card(
      secTitle('Last 7 days', `${niceDay(d7)} &ndash; ${niceDay(today)}`) +
      `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${th}"></th><th style="${th};text-align:right">Week</th><th style="${th};text-align:right">Per day</th></tr>` +
      `<tr><td style="${td}">Departure cleans</td><td style="${td};text-align:right"><b>${cleans7}</b></td><td style="${td};text-align:right">${r1(cleans7 / 7)}</td></tr>` +
      `<tr><td style="${td}">Cleaning revenue</td><td style="${td};text-align:right">${money(rev7)}</td><td style="${td};text-align:right">${money(rev7 / 7)}</td></tr>` +
      `<tr><td style="${td}">HK hours &middot; payroll</td><td style="${td};text-align:right">${r1(hkHours7)}h &middot; ${money(hkPay7)}</td><td style="${td};text-align:right">${r1(hkHours7 / 7)}h</td></tr>` +
      `<tr><td style="${td}"><b>HK profit</b></td><td style="${td};text-align:right"><b style="${hkProfit7 < 0 ? RED : GREEN}">${money(hkProfit7)}</b>${rev7 > 0 ? ` <span style="${MUTED}">(${Math.round(hkProfit7 / rev7 * 100)}%)</span>` : ''}</td><td style="${td};text-align:right">${money(hkProfit7 / 7)}</td></tr>` +
      `<tr><td style="${td}">Supervision</td><td style="${td};text-align:right">${money(supPay7)}${Number(sup7.hours) ? ` <span style="${MUTED}">&middot; ${r1(sup7.hours)}h</span>` : ''}</td><td style="${td};text-align:right">${money(supPay7 / 7)}</td></tr>` +
      `<tr><td style="${td}"><b>HK profit after supervision</b></td><td style="${td};text-align:right"><b style="${(hkProfit7 - supPay7) < 0 ? RED : GREEN}">${money(hkProfit7 - supPay7)}</b></td><td style="${td};text-align:right">${money((hkProfit7 - supPay7) / 7)}</td></tr>` +
      `<tr><td style="${td}">Maintenance billed &middot; payroll</td><td style="${td};text-align:right">${money(mt7)} &middot; ${money(mtPay7)}${mtHours7 ? ` <span style="${MUTED}">(${r1(mtHours7)}h)</span>` : ''}</td><td style="${td};text-align:right">${money(mt7 / 7)}</td></tr>` +
      `<tr><td style="${td}"><b>Maintenance profit</b></td><td style="${td};text-align:right"><b style="${(mt7 - mtPay7) < 0 ? RED : GREEN}">${money(mt7 - mtPay7)}</b></td><td style="${td};text-align:right">${money((mt7 - mtPay7) / 7)}</td></tr>` +
      `</table>` +
      `<p style="margin:8px 0 0;font-size:12.5px"><span style="${MUTED}">Efficiency this week:</span> ${avgRevPerHour7 != null ? `<b>${rate(avgRevPerHour7)}</b> revenue per HK hour` : ''}${avgCostPerClean7 != null ? ` &middot; <b>${rate(avgCostPerClean7)}</b> labor per clean` : ''}${avgHoursPerClean7 != null ? ` &middot; <b>${r1(avgHoursPerClean7)}h</b> per clean` : ''}</p>` +
      `<p style="margin:6px 0 0;font-size:12.5px"><span style="${MUTED}">Cleans by day:</span> ${dayChips}</p>` +
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
    const verdict = `<b>${revCleans}</b> departure clean${revCleans === 1 ? '' : 's'} &middot; <b>${money(revenue)}</b> cleaning revenue &middot; <b>${r1(hkHours)}h</b> housekeeping` +
      (revPerHour != null ? ` &rarr; <b>${rate(revPerHour)}</b> per HK hour` : '') + (costPerClean != null ? `, <b>${rate(costPerClean)}</b> labor per clean` : '') +
      `. HK profit <b style="${hkProfit < 0 ? RED : GREEN}">${money(hkProfit)}</b>${hkMarginPct != null ? ` (${hkMarginPct}%)` : ''}; after supervision <b style="${hkAfterSup < 0 ? RED : GREEN}">${money(hkAfterSup)}</b>. ` +
      `Maintenance billed <b>${money(mtRev)}</b> on ${r1(mtHours)}h &rarr; <b style="${mtProfit < 0 ? RED : GREEN}">${money(mtProfit)}</b>. ` +
      `${allDepDone.length} of ${allDep.length} checkouts cleaned` + (sameDay.length ? `, ${sameDayDone.length} of ${sameDay.length} same-day turns` : '') + `.`
    const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;${FONT};color:#0b1220">` +
      `<div style="max-width:720px;margin:0 auto;padding:18px">` +
      `<div style="background:#111827;border-radius:12px;padding:16px 18px">` +
      `<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S T A Y &nbsp; H O S P I T A L I T Y</p>` +
      `<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">End of day</p>` +
      `<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">${niceDay(today)}</p></div>` +
      `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:13px 18px;margin:12px 0 0"><p style="margin:0;font-size:14px;line-height:1.6">${verdict}</p></div>` +
      hkCard + supCard + mtCard + cleansCard + prioCard + weekCard + tomorrowCard +
      `<table width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0"><tr><td>` +
      `<a href="${APP_URL}/labor" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">Open the Labor board &rarr;</a></td></tr></table>` +
      `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically every evening. Same engine as the Labor board and the morning briefs.</p>` +
      `</div></body></html>`
    const subject = `EOD ${niceDay(today)}: ${revCleans} cleans · ${money(revenue)} rev · ${r1(hkHours)} HK h · HK profit ${money(hkProfit)}${hkMarginPct != null ? ' (' + hkMarginPct + '%)' : ''} · maint ${mtProfit < 0 ? '-' : '+'}${money(Math.abs(mtProfit))}`

    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

    const cfg = await getSetting<any>('ops_brief', {})
    const fromEmail = String(cfg.fromEmail || OWNER)
    const to: string[] = test ? [me as string] : Array.from(new Set([...(cfg.full || []), OWNER].filter(Boolean)))
    const cc = test ? [] : STANDING_CC.filter(c => !to.includes(c))
    const r = await sendGmail({ fromEmail, to, cc, subject: (test ? '[TEST] ' : '') + subject, html })
    return NextResponse.json({ ok: r.ok, to: to.length, subject, error: r.error, counts: { revCleans, revenue, hkHours, hkPayroll, hkProfit, supPayroll, mtRev, mtPayroll, done: doneToday.length } })
  } catch (e: any) {
    // A recap that did not send looks like a quiet night — say so, to the owner.
    await sendGmail({ fromEmail: OWNER, to: [OWNER], subject: '⚠️ End-of-day recap did not send', html: `<p style="${FONT};font-size:14px">The EOD recap for ${today} failed to build: ${esc(String(e?.message || e)).slice(0, 300)}</p>` }).catch(() => null)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
