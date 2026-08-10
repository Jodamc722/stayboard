// DAILY LABOR REPORT — standalone morning email covering YESTERDAY (Jon, 2026-08-10:
// "send daily labor report to me every morning from the day before... should be stand alone,
// flag anything that's off, should be detailed, easy to read").
//
// Standalone on purpose. The GM brief answers "how is the business", this answers "what did we pay
// for yesterday and what looks wrong with it" — different question, different cadence of attention,
// and burying it inside another email guarantees it gets skimmed.
//
// Every number here comes from lib/labor-report, the same function behind /labor/dashboard, so the
// email and the screen it links to can never drift apart.
//
//   GET                       cron send to the configured list
//   GET ?preview=1            signed in: the HTML, no send
//   GET ?test=1               signed in: send to YOU only
//   GET ?date=YYYY-MM-DD      any day, for preview/test
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/app-settings'
import { sendGmail } from '@/lib/gmail-send'
import { buildLaborReport, ymdET, shiftDay, type LaborReport, type Dept } from '@/lib/labor-report'
import { quoteBanner } from '@/lib/ops-brief'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export const LABOR_DAILY_KEY = 'labor_daily'
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
const MIX_LABEL: Record<string, string> = {
  departure: 'Departure cleans', otherClean: 'Other housekeeping',
  inspection: 'Inspections', maintenance: 'Maintenance', other: 'Everything else',
}

// ── email chrome ──────────────────────────────────────────────────────────────────────────────
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

function render(r: LaborReport): { subject: string; html: string } {
  const reds = r.flags.filter(f => f.level === 'red').length
  const bandTone = r.band === 'over' ? '#dc2626' : r.band === 'watch' ? '#d97706' : '#047857'

  // WHAT LOOKS OFF LEADS. A daily report that opens with totals gets read once and skimmed after.
  const flagRows = r.flags.map(f => `
    <div style="border-left:3px solid ${f.level === 'red' ? '#dc2626' : '#d97706'};background:${f.level === 'red' ? '#fef2f2' : '#fffbeb'};border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px">
      <p style="margin:0;font-size:13.5px;font-weight:700;color:#0b1220">${esc(f.title)}</p>
      <p style="margin:3px 0 0;font-size:12px;color:#4b5563;line-height:1.5">${esc(f.detail)}</p>
      ${f.people && f.people.length ? `<p style="margin:5px 0 0;font-size:11.5px;color:#374151">${esc(f.people.join(' · '))}</p>` : ''}
    </div>`).join('')

  const deptRows = (Object.keys(r.byDept) as Dept[]).filter(d => r.byDept[d].hours > 0).map(d => `
    <tr><td style="${S.td}"><b>${DEPT_LABEL[d]}</b> <span style="${S.muted}">${r.byDept[d].people} ${r.byDept[d].people === 1 ? 'person' : 'people'}</span></td>
      <td style="${S.td};text-align:right">${r.byDept[d].hours}h</td>
      <td style="${S.td};text-align:right"><b>${money(r.byDept[d].payroll)}</b></td></tr>`).join('')
    + `<tr><td style="${S.td};border-top:2px solid #111827"><b>Total</b></td>
        <td style="${S.td};text-align:right;border-top:2px solid #111827"><b>${r.totals.hours}h</b></td>
        <td style="${S.td};text-align:right;border-top:2px solid #111827"><b>${money(r.totals.payroll)}</b></td></tr>`

  const mixRows = Object.keys(MIX_LABEL).filter(k => r.mix[k] && r.mix[k].tasks > 0).map(k => `
    <tr><td style="${S.td}"><b>${MIX_LABEL[k]}</b></td>
      <td style="${S.td};text-align:right">${r.mix[k].tasks}</td>
      <td style="${S.td};text-align:right">${r.mix[k].hours}h</td>
      <td style="${S.td};text-align:right">${r.mix[k].materials ? money(r.mix[k].materials) : '<span style="color:#d1d5db">&mdash;</span>'}</td></tr>`).join('')

  // Everyone who was on the clock. This is a payroll report — a name missing from it is the
  // whole point, so nobody is truncated away.
  const peopleRows = r.people.map(p => `
    <tr><td style="${S.td}"><b>${esc(p.name)}</b>${p.role ? `<div style="font-size:10.5px;color:#9ca3af">${esc(p.role)}</div>` : ''}</td>
      <td style="${S.td};text-align:right">${p.hours}h${p.overtime ? ` <span style="color:#d97706">+${p.overtime} OT</span>` : ''}</td>
      <td style="${S.td};text-align:right">${money(p.payroll)}</td>
      <td style="${S.td};text-align:right">${p.cleans || '<span style="color:#d1d5db">&mdash;</span>'}</td>
      <td style="${S.td};text-align:right">${p.tasks || '<span style="color:#d1d5db">&mdash;</span>'}</td>
      <td style="${S.td};text-align:right">${p.coveragePct != null ? p.coveragePct + '%' : '<span style="color:#d1d5db">&mdash;</span>'}</td>
      <td style="${S.td};text-align:right">${money(p.costPerClean)}</td></tr>`).join('')

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="background:#111827;border-radius:12px;padding:18px 20px;margin-bottom:10px">
    <p style="margin:0;color:#9ca3af;font-size:10px;letter-spacing:.18em;font-weight:700">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Daily labor report</p>
    <p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">${esc(r.label)} &middot; Homebase payroll, Breezeway work, Guesty checkouts</p>
  </div>
  ${quoteBanner(r.to)}

  <table width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin:10px 0 14px"><tr>
    ${tile('Payroll', money(r.totals.payroll), r.totals.hours + 'h &middot; ' + r.totals.people + ' people')}
    ${tile('Cost / clean', money(r.costPerClean), r.checkouts + ' checkouts')}
    ${tile('Time / clean', r.hoursPerClean != null ? r.hoursPerClean + 'h' : '&mdash;', 'housekeeping hours')}
  </tr><tr>
    ${tile('Cleaning revenue', money(r.cleaningRevenue), r.feePerClean != null ? money(r.feePerClean) + ' per turn' : 'guest fees')}
    ${tile('Cleaning margin', money(r.cleaningMargin), r.cleaningMarginPct != null ? r.cleaningMarginPct + '% of fees' : '',
      (r.cleaningMargin ?? 0) < 0 ? '#dc2626' : '#047857')}
    ${tile('Labor % of rev', r.laborPctOfRevenue != null ? r.laborPctOfRevenue + '%' : '&mdash;',
      'goal &le; ' + r.settings.pct_good + '%', bandTone)}
  </tr></table>

  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr><td>
    <a href="${APP_URL}/labor/dashboard" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">
      Open the live labor dashboard &rarr;
      <span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Day, week or month &middot; per person &middot; updates on its own</span>
    </a>
  </td></tr></table>

  ${r.flags.length
    ? card(`What looks off &middot; ${r.flags.length}`, flagRows, reds ? '#dc2626' : '#d97706')
    : card('What looks off', `<p style="margin:0;font-size:13px;color:#047857"><b>Nothing.</b> <span style="${S.muted}">Schedule, hours and closures all line up for ${esc(r.label)}.</span></p>`, '#059669')}

  ${card('Payroll by department', table(['Department', 'Hours', 'Payroll'], deptRows), '#4338ca')}

  ${card('Work completed', table(['Kind of work', 'Tasks', 'Hours', 'Billed'], mixRows)
    + `<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">${r.checkouts} in-house checkouts owed a clean and ${r.departureClosed} departure cleans were closed in Breezeway.
      ${r.departureClosed < r.checkouts
        ? 'Cost per clean counts the checkouts, not the closed tasks — a guest leaving is proof the unit needed cleaning, whether or not the paperwork followed.'
        : 'Closures are keeping up with checkouts.'}
      ${r.vendorCheckouts ? ' A further ' + r.vendorCheckouts + ' checkouts belong to vendor-cleaned buildings and carry none of our payroll.' : ''}</p>`, '#0891b2')}

  ${card('Billable work', `<table width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="${S.td}">Billed to owners <span style="${S.muted}">the cost entered on each task</span></td><td style="${S.td};text-align:right"><b>${money(r.billable.billed)}</b></td></tr>
      <tr><td style="${S.td}">Tasks carrying a cost</td><td style="${S.td};text-align:right"><b>${r.billable.tasksWithBilling}</b> <span style="${S.muted}">of ${r.billable.tasks}</span></td></tr>
      <tr><td style="${S.td}">Maintenance payroll <span style="${S.muted}">clocked wages</span></td><td style="${S.td};text-align:right">${money(r.billable.maintenancePayroll)}</td></tr>
      <tr><td style="${S.td};border-top:2px solid #111827"><b>Margin</b></td><td style="${S.td};text-align:right;border-top:2px solid #111827"><b style="color:${r.billable.margin < 0 ? '#dc2626' : '#047857'}">${money(r.billable.margin)}</b></td></tr>
    </table>
    <p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Only <b>${r.billable.tasksWithBilling}</b> of ${r.billable.tasks} maintenance and inspection tasks have an amount entered against them, so the margin above is a floor, not a verdict.${r.billable.tasksMissingDetail ? ` <b>${r.billable.tasksMissingDetail}</b> still have no billing detail pulled from Breezeway at all.` : ''}</p>`,
    '#7c3aed',
    `The amount actually entered on the task in Breezeway &mdash; nothing priced or estimated. Rolling ${r.billable.days} days (${r.billable.from} to ${r.billable.to}), not just yesterday, because owner billing gets edited after the fact and this re-reads the whole window every morning.`)}

  ${card('Everyone on the clock', table(['Person', 'Hours', 'Payroll', 'Cleans', 'Tasks', 'On task', 'Cost/clean'], peopleRows)
    + `<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">&ldquo;On task&rdquo; is time logged against Breezeway tasks as a share of clocked time &mdash; a low number means work happening off the task list, not someone idle. Cleans credit both the assignee and whoever closed the task.</p>`)}

  <div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:14px;text-align:center">
    <p style="margin:0;font-size:12.5px;color:#374151"><b>Thank you for everything you do.</b></p>
  </div>
  <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically by Lighthouse every morning. Live view: ${APP_URL}/labor/dashboard</p>
  </div></body></html>`

  const subject = 'Labor ' + r.from + ': ' + money(r.totals.payroll) + ' payroll, '
    + (r.costPerClean != null ? money(r.costPerClean) + '/clean' : r.checkouts + ' cleans')
    + (reds ? ' — ' + reds + ' to action' : r.flags.length ? ' — ' + r.flags.length + ' to watch' : ' — all clear')

  return { subject, html }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron') || auth === ''
  const who = await me()
  const sp = req.nextUrl.searchParams
  const test = !!sp.get('test'), preview = !!sp.get('preview')
  if ((test || preview) && !who) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!isCron && !who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const cfg = await getSetting<Cfg>(LABOR_DAILY_KEY, {})
    const fromEmail = String(cfg.fromEmail || DEFAULT_FROM)
    const dateQ = String(sp.get('date') || '')
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dateQ) ? dateQ : shiftDay(ymdET(new Date()), -1)

    const report = await buildLaborReport(day, day)
    const { subject, html } = render(report)

    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (test) {
      const r = await sendGmail({ fromEmail, to: [who as string], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, test: true, to: who, subject, flags: report.flags.length, error: r.error })
    }
    // DEFAULTS ON, TO THE OWNER ALONE. The team-wide briefs are safe-by-default because they reach
    // crews; this one was asked for by name ("send daily labor report to me every morning") and
    // carries payroll figures, so its default audience is exactly one person. Saving a recipient
    // list replaces that default; setting enabled:false turns it off.
    if (cfg.enabled === false) {
      return NextResponse.json({ ok: true, skipped: 'labor_daily switched off in settings' })
    }
    const configured = (cfg.to || []).filter(Boolean)
    const to = configured.length ? configured : [DEFAULT_TO]
    if (!to.length) return NextResponse.json({ ok: true, skipped: 'no recipients' })
    const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject, html })
    return NextResponse.json({ ok: r.ok, to: to.length, subject, flags: report.flags.length, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
