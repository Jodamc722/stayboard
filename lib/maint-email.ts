// THE MAINTENANCE BRIEF — one per market (Jon, 2026-08-25: "we should have maintenance brief for
// broward and Miami").
//
// HISTORY, so nobody re-litigates it: two standalone maintenance emails existed until 2026-08-22,
// when the Morning System consolidation folded them into Ops Command. Jon has now asked for them
// back — and both audiences confirmed: the MAINTENANCE CREW and their SUPERVISORS. Ops Command
// keeps its two-market summary card for the ops manager (Jon: "keep both"); that card is the
// altitude, this email is the worklist. Same relationship as Field Day Sheets to Ops Command.
//
// WHAT IT CARRIES, AND WHAT IT DOES NOT.
//   • Today's board by person, with a GUEST IN HOUSE flag — a job in an occupied unit is a phone
//     call before it is a work order — and the arrival deadline where there is one.
//   • What carried over, oldest first. That list is the morning's assignment conversation.
//   • Units that keep coming back (3+ in 30 days) — a pattern is a root cause, not bad luck.
//   • Finished / billed / NO CHARGE ENTERED and hours clocked, for yesterday, 7 and 30 days.
//   • NO PAYROLL. The crew reads this email; wages live in the Daily Labor email and Ops Command,
//     both of which go to management only. Hours are shown because completed-vs-actual is the
//     doctrine and hours are the crew's own number, not their pay.
import 'server-only'
import { maintData, type MaintMarket } from './maint-brief'
import { quoteBanner, accessNotice } from './ops-brief'

const TZ = 'America/New_York'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const niceDay = (ymd: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })
      .format(new Date(ymd + 'T12:00:00Z'))
  } catch { return ymd }
}

// Same email-safe design system as the other briefs: inline styles, tables for layout, colour
// never carrying meaning on its own — every pill says its word.
const S = {
  body: 'margin:0;padding:0;background:#eef0f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220',
  wrap: 'max-width:680px;margin:0 auto;padding:20px 14px',
  bandOuter: 'background:#0b1220;border-radius:14px 14px 0 0;padding:20px 24px 16px',
  bandBrand: 'font-size:11px;font-weight:700;letter-spacing:.22em;color:#a5b4fc;margin:0 0 6px',
  bandTitle: 'font-size:21px;font-weight:700;color:#ffffff;margin:0',
  bandSub: 'font-size:12px;color:#94a3b8;margin:6px 0 0',
  tilesOuter: 'background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:6px 10px 14px;margin-bottom:14px',
  tileLabel: 'font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;padding:10px 8px 0;text-align:center',
  tileValue: 'font-size:22px;font-weight:600;color:#0b1220;padding:2px 8px 0;text-align:center',
  tileNote: 'font-size:10px;color:#9ca3af;padding:0 8px;text-align:center',
  card: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden',
  cardHead: 'padding:12px 20px 10px;border-bottom:1px solid #f3f4f6',
  cardBody: 'padding:6px 20px 14px',
  h2: 'font-size:13px;font-weight:700;margin:0;color:#0b1220',
  h2n: 'font-weight:400;color:#9ca3af',
  td: 'padding:8px 8px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top;line-height:1.5',
  th: 'padding:8px 8px 4px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;text-align:left;font-weight:600',
  red: 'color:#b91c1c;font-weight:600', green: 'color:#047857;font-weight:600', amber: 'color:#b45309;font-weight:600',
  muted: 'color:#6b7280',
  pill: 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.03em;padding:1px 7px;border-radius:999px;vertical-align:middle',
  foot: 'font-size:11px;color:#9ca3af;margin:14px 4px 0;text-align:center',
}
const pillRed = (t: string) => `<span style="${S.pill};background:#fee2e2;color:#b91c1c">${t}</span>`
const pillAmber = (t: string) => `<span style="${S.pill};background:#fef3c7;color:#b45309">${t}</span>`
const eyebrow = (t: string) =>
  `<table width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 10px"><tr>
    <td style="font-size:10px;font-weight:700;letter-spacing:.16em;color:#6b7280;text-transform:uppercase;white-space:nowrap;padding:0 10px 0 4px">${t}</td>
    <td width="100%" style="border-top:2px solid #e5e7eb;line-height:1px;font-size:1px">&nbsp;</td>
  </tr></table>`
function card(title: string, count: number | null, inner: string, accent = '#7c2d12', when?: string): string {
  return `<div style="${S.card}">
    <div style="${S.cardHead};border-left:3px solid ${accent}">
      <p style="${S.h2}">${title}${count != null ? ` <span style="${S.h2n}">· ${count}</span>` : ''}</p>
      ${when ? `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af;letter-spacing:.02em">${when}</p>` : ''}
    </div>
    <div style="${S.cardBody}">${inner}</div>
  </div>`
}
type Tile = { label: string; value: string; note?: string; tone?: 'red' | 'amber' | 'green' }
function tileRow(tiles: Tile[]): string {
  const toneCss = (t?: string) => t === 'red' ? ';color:#b91c1c' : t === 'amber' ? ';color:#b45309' : t === 'green' ? ';color:#047857' : ''
  return `<table width="100%" cellspacing="0" cellpadding="0"><tr>` +
    tiles.map((t, i) => `<td style="width:${Math.round(100 / tiles.length)}%;padding-bottom:8px${i ? ';border-left:1px solid #f3f4f6' : ''}">
      <div style="${S.tileLabel}">${t.label}</div>
      <div style="${S.tileValue}${toneCss(t.tone)}">${t.value}</div>
      ${t.note ? `<div style="${S.tileNote}">${t.note}</div>` : ''}
    </td>`).join('') + `</tr></table>`
}

export async function buildMaintBrief(market: MaintMarket): Promise<{ subject: string; html: string; counts: { today: number; carryover: number; openToday: number } }> {
  const d = await maintData(market)
  const today = ymdET(new Date())
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())

  const jobs = d.todayJobs || []
  const openJobs = jobs.filter(j => j.state !== 'done')
  const unassigned = openJobs.filter(j => j.who === 'unassigned')
  const inHouse = openJobs.filter(j => j.occupied)
  const carry = d.carryover || []

  // ── TODAY'S BOARD, BY PERSON. The row order is the instruction: unassigned first (nobody owns
  // them), then each person's list. A guest inside the unit is the loudest thing on the row.
  const jobRow = (j: any) => `
    <tr><td style="${S.td}"><b>${esc(j.unit)}</b>${j.occupied ? ' ' + pillRed('GUEST IN HOUSE') : ''}${j.arriving ? ' ' + pillAmber('ARRIVES TODAY') : ''}
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(j.task)}</div>
      ${j.occupied ? `<div style="font-size:11.5px;color:#b91c1c;margin-top:2px">Call or message the guest before anyone enters.</div>` : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap">${j.state === 'done' ? `<span style="${S.green}">done</span>` : j.state === 'running' ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.muted}">open</span>`}</td></tr>`
  const byPerson: Record<string, any[]> = {}
  for (const j of jobs) if (j.who !== 'unassigned') (byPerson[j.who] = byPerson[j.who] || []).push(j)
  const personOrder = Object.keys(byPerson).sort((a, b) => byPerson[b].length - byPerson[a].length || a.localeCompare(b))
  const groupHead = (label: string, note: string, tone?: string) => `
    <tr><td colspan="2" style="padding:8px 10px;background:${tone === 'red' ? '#fef2f2' : '#f8fafc'};border-top:1px solid #e5e7eb;font-size:12.5px${tone === 'red' ? ';color:#b91c1c' : ''}"><b>${esc(label)}</b> <span style="${tone === 'red' ? 'color:#b91c1c;opacity:.75' : S.muted}">${note}</span></td></tr>`
  const boardRows =
    (unassigned.length ? groupHead('NOBODY ASSIGNED', `· ${unassigned.length} job${unassigned.length === 1 ? '' : 's'} — give these a name first`, 'red') + unassigned.map(jobRow).join('') : '') +
    personOrder.map(p => {
      const mine = byPerson[p]
      const doneN = mine.filter(j => j.state === 'done').length
      return groupHead(p, `· ${mine.length} job${mine.length === 1 ? '' : 's'}${doneN ? ` · ${doneN} done` : ''}`) + mine.map(jobRow).join('')
    }).join('')

  const carryRows = carry.slice(0, 12).map(c => `
    <tr><td style="${S.td}"><b>${esc(c.unit)}</b>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(c.task)}</div></td>
    <td style="${S.td};text-align:right;white-space:nowrap"><span style="${c.ageDays >= 3 ? S.red : S.amber}">${c.ageDays}d</span><br><span style="${S.muted};font-size:11.5px">${esc(c.who)}</span></td></tr>`).join('')

  const numRow = (label: string, sub: string, f: (w: any) => string) =>
    `<tr><td style="${S.td}"><b>${label}</b>${sub ? `<br><span style="${S.muted};font-size:11.5px">${sub}</span>` : ''}</td>` +
    [d.yd, d.d7, d.d30].map(w => `<td style="${S.td};text-align:right;white-space:nowrap">${f(w)}</td>`).join('') + '</tr>'
  const hoursRow = `<tr><td style="${S.td}"><b>Hours clocked</b><br><span style="${S.muted};font-size:11.5px">maintenance crew, portfolio-wide</span></td>` +
    [d.hours?.yd, d.hours?.d7, d.hours?.d30].map(h => `<td style="${S.td};text-align:right;white-space:nowrap">${h == null ? '&mdash;' : '<b>' + Math.round(h * 10) / 10 + 'h</b>'}</td>`).join('') + '</tr>'
  const numbers =
    `<table width="100%" cellspacing="0" cellpadding="0">
      <tr><th style="${S.th}"></th><th style="${S.th};text-align:right">Yesterday</th><th style="${S.th};text-align:right">Last 7 days</th><th style="${S.th};text-align:right">Last 30 days</th></tr>` +
    numRow('Jobs finished', 'closed in Breezeway', w => `<b>${w.finished}</b>`) +
    numRow('Billed', 'charges entered on the task', w => money(w.billable)) +
    numRow('No charge entered', 'these bill $0 until somebody types the cost', w =>
      w.noCharge ? `<b style="${S.amber}">${w.noCharge}</b>` : `<span style="${S.green}">0</span>`) +
    hoursRow +
    `</table>`

  const recurringLine = (d.recurring || []).length
    ? `<p style="margin:0;font-size:13px;line-height:1.7">${d.recurring.slice(0, 6).map(r => `<b>${esc(r.unit)}</b> <span style="${S.red}">×${r.n}</span>`).join(' &nbsp;·&nbsp; ')}</p>
       <p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">Three or more jobs in 30 days is a pattern. Worth one visit that fixes the cause instead of five that fix the symptom.</p>`
    : ''

  const verdict =
    `<b>${openJobs.length} job${openJobs.length === 1 ? '' : 's'} on today's board${carry.length ? ` · ${carry.length} carried over (oldest ${carry[0].ageDays}d)` : ''}.</b> ` +
    (unassigned.length ? `<span style="${S.red}">${unassigned.length} with nobody assigned — start there.</span>` :
      inHouse.length ? `${inHouse.length} in occupied units — call the guest before you knock.` :
        carry.length ? 'Clear the carryover first, then work the board.' : 'Board is current — work it in order.')

  const subject = `${market} maintenance ${dateNice}: ${openJobs.length} job${openJobs.length === 1 ? '' : 's'}` +
    (carry.length ? ` · ${carry.length} carried over` : '') +
    (unassigned.length ? ` · ${unassigned.length} UNASSIGNED` : '') +
    (d.yd.noCharge ? ` · ${d.yd.noCharge} no charge` : '')

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">${market} — Maintenance</p>
    <p style="${S.bandSub}">${dateNice} · today's board, carryover and the week's numbers</p>
  </div>
  ${quoteBanner(today)}
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid #7c2d12;border-radius:12px;padding:12px 18px;margin-bottom:10px">
    <p style="margin:0;font-size:14px;line-height:1.65">${verdict}</p>
  </div>
  <div style="${S.tilesOuter}">${tileRow([
    { label: 'On the board', value: String(openJobs.length), note: 'today', tone: openJobs.length ? undefined : 'green' },
    { label: 'Unassigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
    { label: 'Carried over', value: String(carry.length), note: carry.length ? `oldest ${carry[0].ageDays}d` : 'nothing open', tone: carry.length ? 'amber' : 'green' },
    { label: 'Billed · 7d', value: money(d.d7.billable), note: d.d7.noCharge ? `${d.d7.noCharge} no charge` : 'all charged', tone: d.d7.noCharge ? 'amber' : 'green' },
  ])}</div>
  ${accessNotice()}

  ${eyebrow('Today')}
  ${jobs.length
    ? card("Today's board — by person", jobs.length, `<table width="100%" cellspacing="0" cellpadding="0">${boardRows}</table>`, unassigned.length ? '#dc2626' : '#7c2d12', `${niceDay(today)} · ${market}`)
    : card("Today's board", null, `<p style="font-size:13px;margin:8px 0 2px;color:#6b7280">Nothing scheduled for ${esc(market)} maintenance today. The carryover below is the day's work.</p>`, '#7c2d12')}
  ${carry.length
    ? card('Carried over — oldest first', carry.length, `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${S.th}">Unit · job</th><th style="${S.th};text-align:right">Age · with</th></tr>${carryRows}</table>` +
        (carry.length > 12 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${carry.length - 12} more on the board</p>` : ''), '#dc2626', 'Scheduled in the last 7 days and still open')
    : card('Carried over', null, `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing carried over.</span> <span style="${S.muted}">Every job scheduled this past week is closed.</span></p>`, '#059669')}

  ${eyebrow('The numbers')}
  ${card('Finished, billed and clocked', null, numbers +
    `<p style="margin:10px 0 0;font-size:11.5px;color:#9ca3af">A finished job with no charge entered invoices nothing — the cost goes in on the task in Breezeway, and the owner statement picks it up from there. Hours are the whole maintenance crew (Homebase is one location and a timecard carries no market).</p>`,
    '#047857', `${market} tasks · 17WEST and vendor buildings excluded`)}
  ${(d.recurring || []).length ? card('Units that keep coming back', d.recurring.length, recurringLine, '#b45309', 'Three or more jobs in the last 30 days') : ''}

  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px"><tr><td>
  <a href="${APP_URL}/maintenance" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">Open the maintenance board &rarr;
  <span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Live jobs, photos and comments — this email is a 7:46am snapshot</span></a>
  </td></tr></table>
  <div style="border-top:1px solid #e5e7eb;margin-top:16px;padding-top:14px;text-align:center">
    <p style="margin:0;font-size:12.5px;color:#374151"><b>Thank you for everything you do.</b></p>
  </div>
  <p style="${S.foot}">${market} maintenance · sent automatically every morning · questions: reply to this email.</p>
  </div></body></html>`

  return { subject, html, counts: { today: jobs.length, carryover: carry.length, openToday: openJobs.length } }
}
