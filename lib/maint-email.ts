// THE MAINTENANCE BRIEF — one per market (Jon, 2026-08-25: "we should have maintenance brief for
// broward and Miami").
//
// HISTORY, so nobody re-litigates it: two standalone maintenance emails existed until 2026-08-22,
// when the Morning System consolidation folded them into Ops Command. Jon has now asked for them
// back — and both audiences confirmed: the MAINTENANCE CREW and their SUPERVISORS. Ops Command
// keeps its two-market summary card for the ops manager (Jon: "keep both"); that card is the
// altitude, this email is the worklist. Same relationship as Field Day Sheets to Ops Command.
//
// WHAT IT CARRIES (Jon, 2026-08-25: "not about hours — it should show tasks, vacant units, their
// tasks assigned for the day and for who, organized by unit and by area… Vacant units, PM, etc").
//   • TODAY BY AREA, THEN UNIT — every job on the board under its building, each with the unit,
//     the job and the name against it. A tech works a building, not a spreadsheet, so the area is
//     the heading and the unit is the row. A GUEST IN HOUSE flag rides any occupied unit: that is
//     a phone call before it is a work order.
//   • VACANT UNITS — the empty ones are the PM window. Each shows how many clear days it has,
//     what maintenance is already open on it, and the best use of the window (ranked by
//     lib/vacant-work — the same engine the ops brief uses, so nothing contradicts).
//   • What carried over, oldest first, by area. That list is the morning assignment conversation.
//   • Units that keep coming back (3+ in 30 days) — a pattern has a root cause.
//   • THE STANDING PM LIST (Jon, 2026-08-25: "deep clean AC, AC filter changes for central AC
//     units, pest control projects"). Each empty unit is checked against its own service history
//     in Breezeway: when was the AC last deep-cleaned, the filter last changed, pest control last
//     run. Overdue or never-on-record shows as the job to do while the unit is free. Cadences are
//     South-Florida realistic and live in PM_JOBS below — change them there, once.
//   • A short numbers strip: jobs finished, billed, and NO CHARGE ENTERED. Nothing else.
//   • NO HOURS, NO PAYROLL. The crew reads this email. Labor economics live in the Daily Labor
//     email and Ops Command, both management-only.
import 'server-only'
import { maintData, type MaintMarket } from './maint-brief'
import { quoteBanner, accessNotice } from './ops-brief'
import { buildDaySheet } from './daysheet'
import { vacantWork, type VacantWork } from './vacant-work'
import { supabaseAdmin } from './supabase-admin'
import { ratingToStars } from './optimize-score'

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
const pillBlue = (t: string) => `<span style="${S.pill};background:#e0e7ff;color:#4338ca">${t}</span>`
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

export async function buildMaintBrief(market: MaintMarket): Promise<{ subject: string; html: string; counts: { today: number; carryover: number; openToday: number; vacants: number } }> {
  const today = ymdET(new Date())
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())
  const d = await maintData(market)

  // VACANT UNITS in this market. The day sheet already knows who is empty tonight and when their
  // next guest lands; vacantWork ranks what each empty window is actually good for. Both are
  // best-effort: a maintenance brief without the vacant card is still a working brief.
  let vacRows: VacantWork[] = []
  try {
    const sheet: any = await buildDaySheet(today, market)
    const vac = ((sheet.vacants || []) as any[]).filter(v => !v.vendor && !/17\s*west/i.test(String(v.unit || '')))
    vacRows = await vacantWork(vac as any, today)
  } catch { vacRows = [] }

  // WHY AN EMPTY UNIT NEEDS THE TEAM (Jon, 2026-08-25: "focus on units vacant with bad reviews,
  // PM not completed, etc"). A guest complaint is the loudest reason to walk a unit while it is
  // free — the next guest should not find what the last one wrote about. Scoped to the units that
  // are actually empty, so this is one small read, not a portfolio scan.
  const lowByUnit: Record<string, { stars: number; channel: string; said: string; at: string }> = {}
  try {
    const ids = vacRows.map(v => String(v.listingId)).filter(Boolean)
    if (ids.length) {
      const db = supabaseAdmin()
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data } = await db.from('guesty_reviews')
        .select('listing_id, rating, content, channel, created_at')
        .in('listing_id', ids).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(200)
      for (const r of (data || []) as any[]) {
        const lid = String(r.listing_id)
        if (lowByUnit[lid]) continue                       // keep the most recent only
        const stars = ratingToStars(Number(r.rating))
        if (stars == null || stars > 3) continue
        lowByUnit[lid] = {
          stars, channel: String(r.channel || ''),
          said: String(r.content || '').replace(/\s+/g, ' ').slice(0, 120),
          at: String(r.created_at || '').slice(0, 10),
        }
      }
    }
  } catch { /* the card still works without the review signal */ }

  // ── THE STANDING PM LIST. Matched off task NAMES in Breezeway history, because that is where
  // the work is recorded; a unit with no matching task in the window has no record of that job
  // being done, which for PM purposes is the same as due.
  const PM_JOBS: { key: string; label: string; re: RegExp; everyDays: number; note: string }[] = [
    { key: 'filter', label: 'AC filter change', everyDays: 60, note: 'central AC units — 60-day cadence',
      re: /filter/i },
    { key: 'acdeep', label: 'AC deep clean / service', everyDays: 180, note: 'coils, drain line, service',
      re: /(a\/?c|hvac|air\s*cond)[^,;]*(deep\s*clean|clean|service|coil|drain|maint)|(deep\s*clean|service|coil|drain)[^,;]*(a\/?c|hvac|air\s*cond)/i },
    { key: 'pest', label: 'Pest control', everyDays: 90, note: 'treatment / prevention visit',
      re: /pest|roach|rodent|exterminat|fumigat|termite|ant\s*(control|treatment)/i },
  ]
  const pmByUnit: Record<string, Record<string, string | null>> = {}   // listingId → key → last done
  try {
    const ids = vacRows.map(v => String(v.listingId)).filter(Boolean)
    if (ids.length) {
      const db2 = supabaseAdmin()
      const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
      const rows: any[] = []
      for (let off = 0; off < 6000; off += 1000) {
        const { data } = await db2.from('breezeway_tasks_sync')
          .select('reference_property_id,name,finished_at,status')
          .in('reference_property_id', ids).gte('finished_at', since)
          .order('finished_at', { ascending: false }).range(off, off + 999)
        if (!data || !data.length) break
        rows.push(...data)
        if (data.length < 1000) break
      }
      for (const t of rows) {
        const st = String(t.status || '').toLowerCase()
        if (/delete|cancel/.test(st)) continue
        const lid = String(t.reference_property_id)
        const nm = String(t.name || '')
        const done = String(t.finished_at || '').slice(0, 10)
        if (!done) continue
        const e = (pmByUnit[lid] = pmByUnit[lid] || {})
        for (const j of PM_JOBS) if (j.re.test(nm) && !e[j.key]) e[j.key] = done
      }
    }
  } catch { /* no history read = PM simply shows as due, which is the honest default */ }
  const daysSince = (ymd: string | null | undefined): number | null => {
    if (!ymd) return null
    const t = new Date(ymd + 'T12:00:00').getTime()
    return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 864e5)) : null
  }
  /** The PM job most overdue on this unit, or null when everything is inside its cadence. */
  const pmDue = (lid: string) => {
    const hist = pmByUnit[lid] || {}
    const due = PM_JOBS.map(j => {
      const age = daysSince(hist[j.key])
      const over = age == null ? 9999 : age - j.everyDays
      return { j, age, over }
    }).filter(x => x.over > 0).sort((a, b) => b.over - a.over)[0]
    if (!due) return null
    return {
      label: due.j.label,
      why: due.age == null ? `no record of this in the last year · ${due.j.note}` : `last done ${due.age} days ago · every ${due.j.everyDays} days`,
      never: due.age == null,
    }
  }

  const jobs = d.todayJobs || []
  const openJobs = jobs.filter(j => j.state !== 'done')
  const unassigned = openJobs.filter(j => j.who === 'unassigned')
  const inHouse = openJobs.filter(j => j.occupied)
  const carry = d.carryover || []
  const openByUnit = d.openByUnit || {}

  // ── AREA HEADINGS. One band per building, units listed under it — the shape a tech reads.
  const areaHead = (label: string, note: string, tone?: 'red') => `
    <tr><td colspan="2" style="padding:8px 10px;background:${tone === 'red' ? '#fef2f2' : '#f8fafc'};border-top:1px solid #e5e7eb;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${tone === 'red' ? '#b91c1c' : '#7c2d12'}">${esc(label)} <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#9ca3af">${note}</span></td></tr>`
  const jobRow = (j: any) => `
    <tr><td style="${S.td}"><b>${esc(j.unit)}</b>${j.occupied ? ' ' + pillRed('GUEST IN HOUSE') : ''}${j.arriving ? ' ' + pillAmber('ARRIVES TODAY') : ''}
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(j.task)}</div>
      ${j.occupied ? `<div style="font-size:11.5px;color:#b91c1c;margin-top:2px">Call or message the guest before anyone enters.</div>` : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap"><b style="${j.who === 'unassigned' ? S.red : ''}">${esc(j.who === 'unassigned' ? 'nobody yet' : j.who)}</b><br>
      <span style="font-size:11.5px">${j.state === 'done' ? `<span style="${S.green}">done</span>` : j.state === 'running' ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.muted}">open</span>`}</span></td></tr>`

  // Unassigned first — they are nobody's list — then area by area, busiest first.
  const byArea: Record<string, any[]> = {}
  for (const j of jobs) if (j.who !== 'unassigned' || j.state === 'done') (byArea[j.building] = byArea[j.building] || []).push(j)
  const areaOrder = Object.keys(byArea).sort((a, b) => byArea[b].length - byArea[a].length || a.localeCompare(b))
  const boardRows =
    (unassigned.length ? areaHead('Nobody assigned', `· ${unassigned.length} job${unassigned.length === 1 ? '' : 's'} — give these a name first`, 'red') + unassigned.map(jobRow).join('') : '') +
    areaOrder.map(a => {
      const mine = byArea[a]
      const people = Array.from(new Set(mine.map(j => j.who).filter((w: string) => w !== 'unassigned')))
      return areaHead(a, `· ${mine.length} job${mine.length === 1 ? '' : 's'}${people.length ? ' · ' + people.join(', ') : ''}`) + mine.map(jobRow).join('')
    }).join('')

  // ── VACANT UNITS = THE PM WINDOW, grouped by area as well.
  const windowLabel = (v: VacantWork) =>
    v.daysUntilArrival == null ? 'no future booking'
      : v.daysUntilArrival === 0 ? 'guest arriving today'
        : `${v.daysUntilArrival} clear day${v.daysUntilArrival === 1 ? '' : 's'}`
  const vacByArea: Record<string, VacantWork[]> = {}
  for (const v of vacRows) {
    const open = openByUnit[String(v.listingId)]
    const area = open?.building || 'Other'
    ;(vacByArea[area] = vacByArea[area] || []).push(v)
  }
  // PM = the walk-and-check work: audits, inspections, deep cleans. Open jobs and guest issues are
  // not PM, they are backlog — both belong here, but they are labelled differently so the tech
  // knows whether they are fixing something or checking something.
  const PM_KEYS = ['audit', 'inspection', 'deepclean']
  const reasonOf = (v: VacantWork): { pill: string; what: string; why: string; rank: number } => {
    const low = lowByUnit[String(v.listingId)]
    const open = openByUnit[String(v.listingId)]
    const fix = v.suggestions.find(s => s.key === 'maintenance' || s.key === 'glitch')
    const pm = v.suggestions.find(s => PM_KEYS.indexOf(s.key) >= 0)
    if (low) return {
      pill: pillRed(low.stars.toFixed(1) + '★ REVIEW'),
      what: 'Walk it and fix what the guest named',
      why: low.said ? `"${low.said}…" · ${low.channel || 'review'} ${niceDay(low.at)}` : `${low.channel || 'A guest'} scored it ${low.stars.toFixed(1)}★ on ${niceDay(low.at)}`,
      rank: 0,
    }
    if (open) return {
      pill: pillAmber('JOBS OPEN'),
      what: `Close the ${open.tasks.length} open job${open.tasks.length === 1 ? '' : 's'}`,
      why: open.tasks.join(' · '),
      rank: 1,
    }
    if (fix) return { pill: pillAmber('BACKLOG'), what: fix.label, why: fix.why, rank: 2 }
    const standing = pmDue(String(v.listingId))
    if (standing) return { pill: pillBlue('PM DUE'), what: standing.label, why: standing.why, rank: 3 }
    if (pm) return { pill: pillBlue('PM DUE'), what: pm.label, why: pm.why, rank: 4 }
    if (v.top) return { pill: '', what: v.top.label, why: v.top.why, rank: 5 }
    return { pill: '', what: 'Nothing outstanding', why: 'PM, audits and open work are all current', rank: 6 }
  }
  const vacRow = (v: VacantWork) => {
    const r = reasonOf(v)
    return `
    <tr><td style="${S.td}"><b>${esc(String(v.unit))}</b> ${r.pill}
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(windowLabel(v))}${v.idleDays != null && v.idleDays >= 7 ? ` · empty ${v.idleDays} days` : ''}</div></td>
    <td style="${S.td};text-align:right"><b${r.rank === 0 ? ` style="${S.red}"` : ''}>${esc(r.what)}</b><br><span style="${S.muted};font-size:11.5px">${esc(r.why)}</span></td></tr>`
  }
  // Areas with the loudest reason come first; inside an area, the same. A tech reading top to
  // bottom is reading the right order to drive.
  const urgencyOf = (a: string) => Math.min(...vacByArea[a].map(v => reasonOf(v).rank))
  const vacAreaOrder = Object.keys(vacByArea).sort((a, b) => urgencyOf(a) - urgencyOf(b) || vacByArea[b].length - vacByArea[a].length || a.localeCompare(b))
  const vacantRows = vacAreaOrder.map(a => {
    const mine = vacByArea[a].slice().sort((x, y) => reasonOf(x).rank - reasonOf(y).rank || (x.daysUntilArrival ?? 999) - (y.daysUntilArrival ?? 999))
    const worth = mine.filter(v => reasonOf(v).rank <= 4).length
    return areaHead(a, `· ${mine.length} empty${worth ? ` · ${worth} worth a visit` : ''}`) + mine.slice(0, 8).map(vacRow).join('')
  }).join('')
  const vacWithWork = vacRows.filter(v => reasonOf(v).rank <= 4).length
  const vacReviewed = vacRows.filter(v => lowByUnit[String(v.listingId)]).length

  // ── CARRIED OVER, by area, oldest first inside each.
  const carryByArea: Record<string, typeof carry> = {}
  for (const c of carry) (carryByArea[c.building || 'Other'] = carryByArea[c.building || 'Other'] || []).push(c)
  const carryRows = Object.keys(carryByArea)
    .sort((a, b) => (carryByArea[b][0]?.ageDays || 0) - (carryByArea[a][0]?.ageDays || 0))
    .map(a => areaHead(a, `· ${carryByArea[a].length} open`) + carryByArea[a].slice(0, 8).map(c => `
    <tr><td style="${S.td}"><b>${esc(c.unit)}</b>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(c.task)}</div></td>
    <td style="${S.td};text-align:right;white-space:nowrap"><span style="${c.ageDays >= 3 ? S.red : S.amber}">${c.ageDays}d old</span><br><span style="${S.muted};font-size:11.5px">${esc(c.who)}</span></td></tr>`).join('')).join('')

  // ── THE NUMBERS: tasks and the billing lever. No hours, no wages.
  const numRow = (label: string, sub: string, f: (w: any) => string) =>
    `<tr><td style="${S.td}"><b>${label}</b>${sub ? `<br><span style="${S.muted};font-size:11.5px">${sub}</span>` : ''}</td>` +
    [d.yd, d.d7, d.d30].map(w => `<td style="${S.td};text-align:right;white-space:nowrap">${f(w)}</td>`).join('') + '</tr>'
  const numbers =
    `<table width="100%" cellspacing="0" cellpadding="0">
      <tr><th style="${S.th}"></th><th style="${S.th};text-align:right">Yesterday</th><th style="${S.th};text-align:right">Last 7 days</th><th style="${S.th};text-align:right">Last 30 days</th></tr>` +
    numRow('Jobs finished', 'closed in Breezeway', w => `<b>${w.finished}</b>`) +
    numRow('Billed', 'charges entered on the task', w => money(w.billable)) +
    numRow('No charge entered', 'these bill $0 until somebody types the cost', w =>
      w.noCharge ? `<b style="${S.amber}">${w.noCharge}</b>` : `<span style="${S.green}">0</span>`) +
    `</table>`

  const recurringLine = (d.recurring || []).length
    ? `<p style="margin:0;font-size:13px;line-height:1.7">${d.recurring.slice(0, 6).map(r => `<b>${esc(r.unit)}</b> <span style="${S.red}">×${r.n}</span>`).join(' &nbsp;·&nbsp; ')}</p>
       <p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">Three or more jobs in 30 days is a pattern. Worth one visit that fixes the cause instead of five that fix the symptom.</p>`
    : ''

  const verdict =
    `<b>${openJobs.length} job${openJobs.length === 1 ? '' : 's'} on today's board${carry.length ? ` · ${carry.length} carried over` : ''}${vacRows.length ? ` · ${vacRows.length} unit${vacRows.length === 1 ? '' : 's'} empty` : ''}.</b> ` +
    (unassigned.length ? `<span style="${S.red}">${unassigned.length} with nobody assigned — start there.</span>` :
      vacReviewed ? `<span style="${S.red}">${vacReviewed} empty unit${vacReviewed === 1 ? '' : 's'} a guest just complained about — walk ${vacReviewed === 1 ? 'it' : 'them'} today.</span>` :
        inHouse.length ? `${inHouse.length} in occupied units — call the guest before you knock.` :
          vacWithWork ? `${vacWithWork} empty unit${vacWithWork === 1 ? '' : 's'} with work worth doing while nobody is inside.` :
            'Board is current — work it area by area.')

  const subject = `${market} maintenance ${dateNice}: ${openJobs.length} job${openJobs.length === 1 ? '' : 's'}` +
    (unassigned.length ? ` · ${unassigned.length} UNASSIGNED` : '') +
    (carry.length ? ` · ${carry.length} carried over` : '') +
    (vacRows.length ? ` · ${vacRows.length} empty` : '')

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">${market} — Maintenance</p>
    <p style="${S.bandSub}">${dateNice} · today by area, empty units, what carried over</p>
  </div>
  ${quoteBanner(today)}
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid #7c2d12;border-radius:12px;padding:12px 18px;margin-bottom:10px">
    <p style="margin:0;font-size:14px;line-height:1.65">${verdict}</p>
  </div>
  <div style="${S.tilesOuter}">${tileRow([
    { label: 'Jobs today', value: String(openJobs.length), note: jobs.length !== openJobs.length ? `${jobs.length - openJobs.length} already done` : 'on the board' },
    { label: 'Unassigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
    { label: 'Carried over', value: String(carry.length), note: carry.length ? `oldest ${carry[0].ageDays}d` : 'nothing open', tone: carry.length ? 'amber' : 'green' },
    { label: 'Empty units', value: String(vacRows.length), note: vacReviewed ? `${vacReviewed} with a bad review` : vacWithWork ? `${vacWithWork} worth a visit` : 'PM window',
      tone: vacReviewed ? 'red' : vacWithWork ? 'amber' : undefined },
  ])}</div>
  ${accessNotice()}

  ${eyebrow('Today, by area')}
  ${jobs.length
    ? card("Today's jobs — who has what", jobs.length, `<table width="100%" cellspacing="0" cellpadding="0">${boardRows}</table>`, unassigned.length ? '#dc2626' : '#7c2d12', `${niceDay(today)} · ${market}`)
    : card("Today's jobs", null, `<p style="font-size:13px;margin:8px 0 2px;color:#6b7280">Nothing scheduled for ${esc(market)} maintenance today — the empty units and the carryover below are the day's work.</p>`, '#7c2d12')}

  ${eyebrow('Empty units — the PM window')}
  ${vacRows.length
    ? card('Empty units — walk these while you can', vacRows.length,
        `<p style="margin:0 0 6px;font-size:12px;color:#6b7280">Nobody is inside these — this is the only window some of this work has. Ordered by what needs you most: a guest complaint first, then open jobs, then PM that is due.</p>` +
        `<p style="margin:0 0 8px;font-size:11.5px;color:#9ca3af">PM cadence: AC filters every 60 days · AC deep clean / service every 180 · pest control every 90. Judged off each unit's own Breezeway history, so closing the task is what keeps it off this list.</p>` +
        `<table width="100%" cellspacing="0" cellpadding="0">${vacantRows}</table>`, '#0891b2', `Empty tonight · ${market}`)
    : card('Vacant units', null, `<p style="font-size:13px;margin:8px 0 2px;color:#6b7280">Every unit in ${esc(market)} is occupied tonight — no PM windows today.</p>`, '#0891b2')}

  ${eyebrow('Behind and repeating')}
  ${carry.length
    ? card('Carried over — oldest first', carry.length, `<table width="100%" cellspacing="0" cellpadding="0">${carryRows}</table>` +
        (carry.length > 8 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">Showing the oldest in each area — the board has the rest.</p>` : ''), '#dc2626', 'Scheduled in the last 7 days and still open')
    : card('Carried over', null, `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing carried over.</span> <span style="${S.muted}">Every job scheduled this past week is closed.</span></p>`, '#059669')}
  ${(d.recurring || []).length ? card('Units that keep coming back', d.recurring.length, recurringLine, '#b45309', 'Three or more jobs in the last 30 days') : ''}

  ${eyebrow('The numbers')}
  ${card('Finished and billed', null, numbers +
    `<p style="margin:10px 0 0;font-size:11.5px;color:#9ca3af">A finished job with no charge entered invoices nothing — the cost goes on the task in Breezeway and the owner statement picks it up from there.</p>`,
    '#047857', `${market} tasks · 17WEST and vendor buildings excluded`)}

  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px"><tr><td>
  <a href="${APP_URL}/maintenance" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700">Open the maintenance board &rarr;
  <span style="display:block;font-weight:400;font-size:11.5px;color:#9ca3af;margin-top:2px">Live jobs, photos and comments — this email is a 7:46am snapshot</span></a>
  </td></tr></table>
  <div style="border-top:1px solid #e5e7eb;margin-top:16px;padding-top:14px;text-align:center">
    <p style="margin:0;font-size:12.5px;color:#374151"><b>Thank you for everything you do.</b></p>
  </div>
  <p style="${S.foot}">${market} maintenance · sent automatically every morning · questions: reply to this email.</p>
  </div></body></html>`

  return { subject, html, counts: { today: jobs.length, carryover: carry.length, openToday: openJobs.length, vacants: vacRows.length } }
}
