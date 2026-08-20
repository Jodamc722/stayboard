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
import { buildTodayProjection, type TodayProjection } from '@/lib/labor-today'
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

function render(r: LaborReport, t: TodayProjection | null): { subject: string; html: string } {
  const reds = r.flags.filter(f => f.level === 'red').length
  const bandTone = r.band === 'over' ? '#dc2626' : r.band === 'watch' ? '#d97706' : '#047857'

  // ── THE ONE-LINE VERDICT ────────────────────────────────────────────────────────────────────
  // Jon, 2026-08-20: "make it simple to look at". Whatever else gets skimmed, this sentence is
  // read — so it carries the whole day: what yesterday cost, and what today is about to cost.
  const verdict = reds
    ? `<b style="color:#dc2626">${reds} thing${reds === 1 ? '' : 's'} to action</b> from ${esc(r.label)}.`
    : r.flags.length
      ? `<b style="color:#d97706">${r.flags.length} to watch</b> from ${esc(r.label)}, nothing urgent.`
      : `<b style="color:#047857">Yesterday came in clean.</b>`

  // ── TODAY — the only part still in your hands ───────────────────────────────────────────────
  const todayCard = !t ? '' : (() => {
    const perClean = t.projectedCostPerClean != null ? money(t.projectedCostPerClean) : '&mdash;'
    const vsYesterday = (t.projectedCostPerClean != null && r.costPerClean != null)
      ? (t.projectedCostPerClean > r.costPerClean
          ? `<span style="color:#d97706">${money(t.projectedCostPerClean - r.costPerClean)} above yesterday</span>`
          : `<span style="color:#047857">${money(r.costPerClean - t.projectedCostPerClean)} below yesterday</span>`)
      : 'vs yesterday &mdash;'
    const rows = t.people.map(p => `
      <tr><td style="${S.td}"><b>${esc(p.name)}</b>${p.role ? `<div style="font-size:10.5px;color:#9ca3af">${esc(p.role)}</div>` : ''}</td>
        <td style="${S.td};text-align:right">${p.hours}h</td>
        <td style="${S.td};color:#6b7280">${esc(p.label)}</td>
        <td style="${S.td};text-align:right">${p.cost == null ? '<span style="color:#d1d5db">&mdash;</span>' : money(p.cost)}</td></tr>`).join('')
    return card('Today &middot; what is booked',
      `<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px"><tr>
        ${tile('Scheduled', t.scheduledHours + 'h', t.people.length + ' on &middot; ' + t.checkoutsDue + ' cleans due')}
        ${tile('Projected payroll', t.scheduledCost == null ? '&mdash;' : money(t.scheduledCost), t.arrivals + ' arrivals today')}
        ${tile('Projected / clean', perClean, vsYesterday, t.projectedCostPerClean != null && r.costPerClean != null && t.projectedCostPerClean > r.costPerClean ? '#d97706' : undefined)}
      </tr></table>
      ${t.openShifts ? `<p style="margin:0 0 10px;font-size:12.5px;color:#b45309"><b>${t.openShifts} open shift${t.openShifts === 1 ? '' : 's'}</b> still unfilled on today's schedule.</p>` : ''}
      ${rows ? table(['On today', 'Hours', 'Shift', 'Cost'], rows) : '<p style="margin:0;font-size:13px;color:#6b7280">Nobody is on the Homebase schedule for today.</p>'}
      ${t.note ? `<p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">${esc(t.note)}</p>` : ''}`,
      '#0f766e',
      'The day you can still change — staffing against the cleans actually on the board.')
  })()

  // ── WHAT TO LOOK FOR ────────────────────────────────────────────────────────────────────────
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

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="background:#111827;border-radius:12px;padding:18px 20px;margin-bottom:10px">
    <p style="margin:0;color:#9ca3af;font-size:10px;letter-spacing:.18em;font-weight:700">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Daily labor</p>
    <p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">${esc(r.label)} actual &middot; ${t ? esc(t.date) : 'today'} scheduled</p>
  </div>

  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;margin-bottom:14px">
    <p style="margin:0;font-size:14px;line-height:1.6;color:#0b1220">${verdict}
      Yesterday cost <b>${money(r.totals.payroll)}</b> across ${r.totals.hours}h${r.costPerClean != null ? ` &mdash; <b>${money(r.costPerClean)}</b> per clean` : ''}.${t && t.scheduledCost != null ? ` Today is booked at <b>${money(t.scheduledCost)}</b> for ${t.checkoutsDue} cleans.` : ''}</p>
  </div>

  ${todayCard}

  ${r.flags.length
    ? card(`What to look for &middot; ${r.flags.length}`, flagRows, reds ? '#dc2626' : '#d97706')
    : card('What to look for', `<p style="margin:0;font-size:13px;color:#047857"><b>Nothing.</b> <span style="${S.muted}">Schedule, hours and closures all line up for ${esc(r.label)}.</span></p>`, '#059669')}

  ${card('Yesterday &middot; what it cost',
    `<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px"><tr>
      ${tile('Payroll', money(r.totals.payroll), r.totals.hours + 'h &middot; ' + r.totals.people + ' people')}
      ${tile('Cost / clean', money(r.costPerClean), r.checkouts + ' checkouts')}
      ${tile('Labor % of rev', r.laborPctOfRevenue != null ? r.laborPctOfRevenue + '%' : '&mdash;', 'goal &le; ' + r.settings.pct_good + '%', bandTone)}
    </tr></table>
    ${table(['Department', 'Hours', 'Payroll'], deptRows)}
    <p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Cleaning fees brought in ${money(r.cleaningRevenue)}${r.cleaningMargin != null ? `, leaving <b style="color:${r.cleaningMargin < 0 ? '#dc2626' : '#047857'}">${money(r.cleaningMargin)}</b> after the cleaning payroll` : ''}. Every name, task and billable sits on the dashboard and in the 30-day true-up.</p>`,
    '#4338ca')}

  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr><td>
    <a href="${APP_URL}/labor/dashboard" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">
      Open the live labor dashboard &rarr;
      <span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Every person, task and billable &middot; day, week or month</span>
    </a>
  </td></tr></table>

  <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically by Lighthouse every morning. The 30-day true-up comes separately.</p>
  </div></body></html>`

  const subject = 'Labor ' + r.from + ': ' + money(r.totals.payroll) + ' yesterday'
    + (t && t.scheduledCost != null ? ', ' + money(t.scheduledCost) + ' booked today' : '')
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
    // The forward look is for the day AFTER the one being reported — normally today. Never let a
    // Homebase hiccup cost the whole email: the projection degrades to null and the rest still sends.
    const todayProj = await buildTodayProjection(shiftDay(day, 1)).catch(() => null)
    const { subject, html } = render(report, todayProj)

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
