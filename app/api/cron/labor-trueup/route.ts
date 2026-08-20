// LAST 30 DAYS — THE TRUE-UP (Jon, 2026-08-20: "we also need the last 30 days true up as well").
//
// Deliberately a SEPARATE email from the daily. The daily answers "what is happening today"; this
// answers "what did the month actually cost once the paperwork settled" — a different question
// asked at a different tempo, and the reason billing numbers belong here rather than in a morning
// operational note. Owner billing, task closures and timecard edits all land days late, so a
// rolling 30-day window re-read from scratch is the only honest way to state a month.
//
//   GET                       cron send to the configured list
//   GET ?preview=1            signed in: the HTML, no send
//   GET ?test=1               signed in: send to YOU only
//   GET ?days=N               window length (7-90), default 30
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/app-settings'
import { sendGmail } from '@/lib/gmail-send'
import { buildLaborReport, ymdET, shiftDay, type LaborReport, type Dept } from '@/lib/labor-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const LABOR_TRUEUP_KEY = 'labor_trueup'
type Cfg = { enabled?: boolean; fromEmail?: string; to?: string[] }
const DEFAULT_FROM = 'jon@stay-hospitality.com'
const DEFAULT_TO = 'jon@stay-hospitality.com'
const STANDING_CC = ['roberto@stay-hospitality.com']
const ccFor = (to: string[]) => {
  const has = new Set(to.map(t => String(t || '').trim().toLowerCase()))
  return STANDING_CC.filter(c => !has.has(c.toLowerCase()))
}
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://stayboard-three.vercel.app').replace(/\/+$/, '')

async function me(): Promise<string | null> {
  try {
    const s = createClient()
    const { data: { user } } = await s.auth.getUser()
    return user?.email ? String(user.email).toLowerCase() : null
  } catch { return null }
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const DEPT_LABEL: Record<Dept, string> = {
  housekeeping: 'Housekeeping', maintenance: 'Maintenance', inspection: 'Inspections', other: 'Other roles',
}

const S = {
  body: 'margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220',
  wrap: 'max-width:760px;margin:0 auto;padding:20px',
  td: 'padding:7px 9px;border-bottom:1px solid #eef0f3;font-size:13px',
  th: 'padding:6px 9px;border-bottom:2px solid #111827;font-size:10px;text-transform:uppercase;letter-spacing:.06em;text-align:left;color:#6b7280;font-weight:700',
  muted: 'color:#9ca3af',
}
const card = (title: string, inner: string, accent = '#111827', note?: string) =>
  `<div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:12px;padding:16px 18px;margin-bottom:14px">
    <p style="margin:0 0 ${note ? '2px' : '10px'};font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700">${title}</p>
    ${note ? `<p style="margin:0 0 10px;font-size:11px;color:#9ca3af">${note}</p>` : ''}
    ${inner}</div>`
const tile = (label: string, value: string, sub: string, tone?: string) =>
  `<td width="33%" style="padding:10px 12px;vertical-align:top">
    <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;font-weight:700">${label}</p>
    <p style="margin:3px 0 1px;font-size:21px;font-weight:800;color:${tone || '#0b1220'}">${value}</p>
    <p style="margin:0;font-size:11px;color:#9ca3af">${sub}</p></td>`
const table = (heads: string[], rows: string) =>
  `<table width="100%" cellspacing="0" cellpadding="0"><tr>${heads.map(h => `<th style="${S.th}">${h}</th>`).join('')}</tr>${rows}</table>`

/** Movement between the two windows, stated the way a person would say it out loud. */
function delta(now: number | null, before: number | null, unit = '', goodIsDown = true): string {
  if (now == null || before == null || !before) return '<span style="color:#d1d5db">no prior window</span>'
  const d = now - before
  const pct = Math.round((d / Math.abs(before)) * 1000) / 10
  if (Math.abs(pct) < 1) return '<span style="color:#6b7280">flat vs prior 30</span>'
  const worse = goodIsDown ? d > 0 : d < 0
  const tone = worse ? '#dc2626' : '#047857'
  const arrow = d > 0 ? '&uarr;' : '&darr;'
  return `<span style="color:${tone}">${arrow} ${Math.abs(pct)}% vs prior 30</span>`
}

function render(r: LaborReport, prev: LaborReport | null, days: number): { subject: string; html: string } {
  const deptRows = (Object.keys(r.byDept) as Dept[]).filter(d => r.byDept[d].hours > 0).map(d => `
    <tr><td style="${S.td}"><b>${DEPT_LABEL[d]}</b> <span style="${S.muted}">${r.byDept[d].people} ${r.byDept[d].people === 1 ? 'person' : 'people'}</span></td>
      <td style="${S.td};text-align:right">${Math.round(r.byDept[d].hours)}h</td>
      <td style="${S.td};text-align:right"><b>${money(r.byDept[d].payroll)}</b></td>
      <td style="${S.td};text-align:right">${prev && prev.byDept[d] && prev.byDept[d].payroll ? delta(r.byDept[d].payroll, prev.byDept[d].payroll) : '<span style="color:#d1d5db">&mdash;</span>'}</td></tr>`).join('')
    + `<tr><td style="${S.td};border-top:2px solid #111827"><b>Total</b></td>
        <td style="${S.td};text-align:right;border-top:2px solid #111827"><b>${Math.round(r.totals.hours)}h</b></td>
        <td style="${S.td};text-align:right;border-top:2px solid #111827"><b>${money(r.totals.payroll)}</b></td>
        <td style="${S.td};text-align:right;border-top:2px solid #111827">${delta(r.totals.payroll, prev?.totals.payroll ?? null)}</td></tr>`

  // Everyone, ranked by what they cost — this is the payroll reconciliation, so nobody is cut.
  const peopleRows = r.people.slice().sort((a, b) => b.payroll - a.payroll).map(p => `
    <tr><td style="${S.td}"><b>${esc(p.name)}</b>${p.role ? `<div style="font-size:10.5px;color:#9ca3af">${esc(p.role)}</div>` : ''}</td>
      <td style="${S.td};text-align:right">${Math.round(p.hours)}h${p.overtime ? ` <span style="color:#d97706">+${Math.round(p.overtime)} OT</span>` : ''}</td>
      <td style="${S.td};text-align:right">${p.days}</td>
      <td style="${S.td};text-align:right"><b>${money(p.payroll)}</b></td>
      <td style="${S.td};text-align:right">${p.cleans || '<span style="color:#d1d5db">&mdash;</span>'}</td>
      <td style="${S.td};text-align:right">${money(p.costPerClean)}</td></tr>`).join('')

  const otTotal = Math.round(r.totals.overtime)
  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="background:#111827;border-radius:12px;padding:18px 20px;margin-bottom:10px">
    <p style="margin:0;color:#9ca3af;font-size:10px;letter-spacing:.18em;font-weight:700">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Labor true-up &middot; last ${days} days</p>
    <p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">${esc(r.from)} to ${esc(r.to)} &middot; re-read from scratch, edits and late billing included</p>
  </div>

  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;margin-bottom:14px">
    <p style="margin:0;font-size:14px;line-height:1.6;color:#0b1220">
      <b>${money(r.totals.payroll)}</b> of payroll over ${days} days across ${r.totals.people} people${r.costPerClean != null ? `, <b>${money(r.costPerClean)}</b> per clean` : ''}.
      ${r.laborPctOfRevenue != null ? `Labor ran <b>${r.laborPctOfRevenue}%</b> of revenue against a ${r.settings.pct_good}% goal.` : ''}
      ${prev ? `Payroll is ${delta(r.totals.payroll, prev.totals.payroll)}.` : ''}</p>
  </div>

  <table width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin:0 0 14px"><tr>
    ${tile('Payroll', money(r.totals.payroll), Math.round(r.totals.hours) + 'h &middot; ' + r.totals.people + ' people')}
    ${tile('Cost / clean', money(r.costPerClean), r.checkouts + ' checkouts')}
    ${tile('Labor % of rev', r.laborPctOfRevenue != null ? r.laborPctOfRevenue + '%' : '&mdash;', 'goal &le; ' + r.settings.pct_good + '%',
      r.band === 'over' ? '#dc2626' : r.band === 'watch' ? '#d97706' : '#047857')}
  </tr><tr>
    ${tile('Cleaning revenue', money(r.cleaningRevenue), r.feePerClean != null ? money(r.feePerClean) + ' per turn' : 'guest fees')}
    ${tile('Cleaning margin', money(r.cleaningMargin), r.cleaningMarginPct != null ? r.cleaningMarginPct + '% of fees' : '',
      (r.cleaningMargin ?? 0) < 0 ? '#dc2626' : '#047857')}
    ${tile('Overtime', otTotal ? otTotal + 'h' : 'none', otTotal ? 'paid at premium' : 'clean window', otTotal ? '#d97706' : '#047857')}
  </tr></table>

  ${card('Owner billing &middot; the true-up that matters',
    `<table width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="${S.td}">Billed to owners <span style="${S.muted}">entered on the task</span></td><td style="${S.td};text-align:right"><b>${money(r.billable.billed)}</b></td></tr>
      <tr><td style="${S.td}">Tasks carrying a cost</td><td style="${S.td};text-align:right"><b>${r.billable.tasksWithBilling}</b> <span style="${S.muted}">of ${r.billable.tasks}</span></td></tr>
      <tr><td style="${S.td}">Maintenance payroll <span style="${S.muted}">clocked wages</span></td><td style="${S.td};text-align:right">${money(r.billable.maintenancePayroll)}</td></tr>
      <tr><td style="${S.td};border-top:2px solid #111827"><b>Margin</b></td><td style="${S.td};text-align:right;border-top:2px solid #111827"><b style="color:${r.billable.margin < 0 ? '#dc2626' : '#047857'}">${money(r.billable.margin)}</b></td></tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#6b7280">${r.billable.tasks - r.billable.tasksWithBilling > 0
      ? `<b style="color:#b45309">${r.billable.tasks - r.billable.tasksWithBilling} task${r.billable.tasks - r.billable.tasksWithBilling === 1 ? '' : 's'} closed with no amount entered.</b> Until those carry a cost the margin above is a floor — the single biggest lever on this number is entering them in Breezeway.`
      : 'Every billable task in the window carries an amount, so this margin is real rather than a floor.'}${r.billable.tasksMissingDetail ? ` ${r.billable.tasksMissingDetail} still have no billing detail pulled from Breezeway at all.` : ''}</p>`,
    '#7c3aed',
    `Re-read across ${r.billable.days} days (${r.billable.from} to ${r.billable.to}) because owner billing gets edited long after the task closes.`)}

  ${card('Payroll by department', table(['Department', 'Hours', 'Payroll', 'Movement'], deptRows), '#4338ca')}

  ${card('Everyone, by what they cost', table(['Person', 'Hours', 'Days', 'Payroll', 'Cleans', 'Cost/clean'], peopleRows)
    + `<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Cost per clean is that person's wages over the departure cleans they closed — a fair read for housekeepers, and meaningless for anyone who does not clean, so treat blanks as blanks rather than zeros.</p>`, '#0891b2')}

  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr><td>
    <a href="${APP_URL}/labor/dashboard" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">
      Open the live labor dashboard &rarr;
      <span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Same numbers, any window you choose</span>
    </a>
  </td></tr></table>

  <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Sent by Lighthouse. The operational read arrives each morning as the daily labor email.</p>
  </div></body></html>`

  const subject = `Labor true-up · last ${days} days: ${money(r.totals.payroll)} payroll`
    + (r.costPerClean != null ? `, ${money(r.costPerClean)}/clean` : '')
    + (r.billable.tasks - r.billable.tasksWithBilling > 0 ? ` — ${r.billable.tasks - r.billable.tasksWithBilling} unbilled tasks` : '')

  return { subject, html }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron') || auth === ''
  const sp = new URL(req.url).searchParams
  const who = await me()
  const test = !!sp.get('test'), preview = !!sp.get('preview')
  if ((test || preview) && !who) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!isCron && !who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const cfg = await getSetting<Cfg>(LABOR_TRUEUP_KEY, {})
    const fromEmail = String(cfg.fromEmail || DEFAULT_FROM)
    const nDays = Math.min(90, Math.max(7, Number(sp.get('days')) || 30))
    const today = ymdET(new Date())
    const to = shiftDay(today, -1)                 // through yesterday; today is still moving
    const from = shiftDay(to, -(nDays - 1))

    const report = await buildLaborReport(from, to)
    // The prior window of the same length, for movement. Never let it cost the email if it fails.
    const prevTo = shiftDay(from, -1)
    const prev = await buildLaborReport(shiftDay(prevTo, -(nDays - 1)), prevTo).catch(() => null)

    const { subject, html } = render(report, prev, nDays)
    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (test) {
      const r = await sendGmail({ fromEmail, to: [who as string], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, test: true, to: who, subject, error: r.error })
    }
    if (cfg.enabled === false) return NextResponse.json({ ok: true, skipped: 'disabled in settings' })

    const configured = (cfg.to || []).filter(Boolean)
    const list = configured.length ? configured : [DEFAULT_TO]
    const r = await sendGmail({ fromEmail, to: list, cc: ccFor(list), subject, html })
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
    return NextResponse.json({ ok: true, to: list.length, days: nDays, subject })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
