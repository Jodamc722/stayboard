// lib/maint-brief.ts — THE MAINTENANCE BRIEF, one per market (Jon, 2026-08-20: "vacant units,
// recurring issues, open glitches, billable labor day before / last 7 / last 30 — one for
// Broward, one for Miami. Goal is KPI, task completion, labor cost, open tasks not completed
// day before, also revenue").
//
// 17WEST IS DELIBERATELY EXCLUDED from both market briefs — Jon: "17west should be separate,
// as I will explain later." Its units appear in neither Miami nor Broward here, so the future
// 17WEST brief owns them cleanly with no double counting.
//
// MONEY RULES MATCH THE ENGINE EXACTLY. Billable per task = the charge entered on the task
// (rate via laborAmount + owner-billable cost items, guest-billed lines excluded, adjustments
// overlay honoured) — the same arithmetic lib/labor-econ.ts and the owner invoice use, so this
// brief, the Labor board and the statements can never disagree. Maintenance WAGES come from
// Homebase timecards for the declared maintenance crew; Homebase is one location with no market
// on a timecard, so wages are shown portfolio-wide and labelled as such — billable is per
// market because a task knows its unit.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { marketOf } from './segments'
import { kindOfTask, SEVENTEEN_WEST_PAIR, seventeenWestCoverage } from './labor-econ'
import { nameMatches } from './homebase'
import { laborAmount } from './billing'
import { buildDaySheet } from './daysheet'
import { getCrew } from './crew'
import { getTimecards } from './homebase-labor'
import { quoteBanner } from './ops-brief'

export type MaintMarket = 'Miami' | 'Broward'
const SEVENTEEN_RE = /17\s*west/i

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const esc = (s: any) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = (n: number | null | undefined) =>
  n == null ? '&mdash;' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const niceDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })

/** Owner-billable total of a Breezeway line-item array — same rule as the engine and invoices. */
function ownerTotal(arr: any, kind: 'cost' | 'supply'): number {
  return (Array.isArray(arr) ? arr : []).reduce((a: number, x: any) => {
    if (x && x.bill_to && String(x.bill_to) === 'guest') return a
    if (kind === 'supply' && x && x.billable === false) return a
    const v = Number(kind === 'cost' ? x?.cost : (x?.total_price != null ? x.total_price : x?.unit_cost))
    return a + (Number.isFinite(v) ? v : 0)
  }, 0)
}

const S = {
  td: 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left;vertical-align:top;line-height:1.5',
  th: 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280',
  red: 'color:#dc2626;font-weight:600', amber: 'color:#b45309;font-weight:600', green: 'color:#047857;font-weight:600',
  muted: 'color:#6b7280',
}
const cardStyle = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:12px 0'
const secTitle = (t: string, sub: string) =>
  '<p style="margin:0 0 8px;font-size:13px;font-weight:700">' + t +
  (sub ? ' <span style="color:#9ca3af;font-weight:400;font-size:12px">' + sub + '</span>' : '') + '</p>'
const tile = (big: string, label: string, sub: string, color?: string) =>
  '<td style="padding:10px 8px;text-align:center;vertical-align:top">' +
  '<div style="font-size:22px;font-weight:800;color:' + (color || '#111827') + '">' + big + '</div>' +
  '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:700;margin-top:2px">' + label + '</div>' +
  (sub ? '<div style="font-size:11px;color:#9ca3af;margin-top:1px">' + sub + '</div>' : '') + '</td>'

export async function buildMaintBrief(market: MaintMarket): Promise<{ subject: string; html: string; counts: { carryover: number; glitches: number; vacantIdle: number; doneYesterday: number } }> {
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const yd = shift(today, -1)
  const d7 = shift(yd, -6)
  const d30 = shift(yd, -29)
  const mk = market.toLowerCase()

  const presets = await getOpsPresets()
  const VENDOR = vendorRegex(presets.vendorBuildings)

  // Listings → which units belong on THIS brief. Vendor buildings and 17WEST are out.
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(5000)
  const meta: Record<string, { name: string; ours: boolean }> = {}
  for (const l of (lRows || []) as any[]) {
    const name = l.nickname || l.title || 'Unit'
    const building = str(l.building)
    const isVendor = VENDOR.test(building) || VENDOR.test(name)
    const is17 = SEVENTEEN_RE.test(building) || SEVENTEEN_RE.test(name)
    const m = String(marketOf(building, l.address_city, name) || '').toLowerCase()
    meta[String(l.id)] = { name, ours: m === mk && !isVendor && !is17 }
  }
  const unitOf = (lid: any) => meta[String(lid)]?.name || 'Unknown unit'
  const ours = (lid: any) => !!meta[String(lid)]?.ours

  // ── Maintenance tasks, last 30 days + anything still open ──────────────────────────────────
  const tRows: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,assignees,reference_property_id,finished_at,scheduled_date,rate_paid,total_minutes')
      .gte('scheduled_date', d30).lte('scheduled_date', today)
      .order('id', { ascending: true })
      .range(off, off + 999)
    if (!data || !data.length) break
    tRows.push(...data)
    if (data.length < 1000) break
  }
  const maint = tRows.filter(t => {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) return false
    return kindOfTask(t) === 'maintenance' && ours(t.reference_property_id)
  })

  // Billing detail + adjustments — the SAME per-task charge the engine and invoices compute.
  const details: Record<string, any> = {}
  const adjs: Record<string, any> = {}
  const ids = maint.map(t => String(t.id))
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    try {
      const { data } = await db.from('breezeway_billing_details').select('task_id,costs,supplies,rate_type').in('task_id', chunk)
      for (const d of (data || []) as any[]) details[String(d.task_id)] = d
    } catch { /* no detail = no charge */ }
    try {
      const { data } = await db.from('billing_adjustments').select('task_id,excluded,override_amount,billed_hours').in('task_id', chunk)
      for (const a of (data || []) as any[]) adjs[String(a.task_id)] = a
    } catch { /* overlay optional */ }
  }
  const chargeOf = (t: any): number => {
    const a = adjs[String(t.id)]
    if (a && a.excluded) return 0
    if (a && a.override_amount != null) return Number(a.override_amount) || 0
    const d = details[String(t.id)]
    const rate = laborAmount(num(t.rate_paid), d && d.rate_type ? String(d.rate_type) : null,
      num(t.total_minutes), a && a.billed_hours != null ? Number(a.billed_hours) : null)
    return round2(rate + (d ? ownerTotal(d.costs, 'cost') : 0))
  }

  const isDone = (t: any) => !!t.finished_at || /complete|finish|close|approv/i.test(str(t.status))
  const finishedDay = (t: any) => (t.finished_at ? str(t.finished_at).slice(0, 10) : null)

  // Billable + completion per window. Billable buckets by the day the task FINISHED (that is
  // when the charge exists); completion rate buckets by the day the task was SCHEDULED.
  const win = (from: string, to: string) => {
    const fin = maint.filter(t => { const f = finishedDay(t); return f != null && f >= from && f <= to })
    const billable = round2(fin.reduce((a, t) => a + chargeOf(t), 0))
    const noCharge = fin.filter(t => chargeOf(t) <= 0).length
    const sched = maint.filter(t => str(t.scheduled_date).slice(0, 10) >= from && str(t.scheduled_date).slice(0, 10) <= to)
    const schedDone = sched.filter(isDone).length
    return { finished: fin.length, billable, noCharge, scheduled: sched.length, schedDone }
  }
  const wYd = win(yd, yd), w7 = win(d7, yd), w30 = win(d30, yd)

  // ── Carryover: scheduled on/before yesterday (last 7 days), still open ──────────────────────
  const carryover = maint
    .filter(t => {
      const sd = str(t.scheduled_date).slice(0, 10)
      return sd >= d7 && sd <= yd && !isDone(t)
    })
    .map(t => ({
      unit: unitOf(t.reference_property_id), task: str(t.name).slice(0, 60),
      sched: str(t.scheduled_date).slice(0, 10),
      ageDays: Math.max(0, Math.round((new Date(today + 'T12:00:00').getTime() - new Date(str(t.scheduled_date).slice(0, 10) + 'T12:00:00').getTime()) / 864e5)),
      who: (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a?.name || a)).filter(Boolean).join(', ') || 'unassigned',
    }))
    .sort((a, b) => b.ageDays - a.ageDays)

  // ── Recurring issues: units that keep needing maintenance (30 days) ─────────────────────────
  const byUnit: Record<string, { n: number; names: string[] }> = {}
  for (const t of maint) {
    const u = unitOf(t.reference_property_id)
    const e = (byUnit[u] = byUnit[u] || { n: 0, names: [] })
    e.n++
    const nm = str(t.name).slice(0, 44)
    if (nm && e.names.indexOf(nm) < 0 && e.names.length < 3) e.names.push(nm)
  }
  const recurring = Object.keys(byUnit).filter(u => byUnit[u].n >= 3)
    .map(u => ({ unit: u, n: byUnit[u].n, names: byUnit[u].names }))
    .sort((a, b) => b.n - a.n).slice(0, 10)

  // ── Maintenance crew wages (Homebase; portfolio-wide — one location, no market on a card) ───
  let wages = { yd: null as number | null, d7: null as number | null, d30: null as number | null, names: [] as string[] }
  try {
    const crew = await getCrew()
    const cards = await getTimecards(d30, yd)
    const mine = cards.filter(c => crew.deptOf(c.name, (c as any).role) === 'maintenance')
    // 17WEST pays $100k/yr toward George Paz + Yoslenis (Jon, 2026-08-20), so the wage line
    // carries only STAY'S share of George — same coverage math as the labor engine, so this
    // brief and the Daily Labor email can never disagree about what maintenance costs.
    const pair = cards.filter(c => SEVENTEEN_WEST_PAIR.some(n => nameMatches(c.name, n)))
    const george = cards.filter(c => nameMatches(c.name, SEVENTEEN_WEST_PAIR[0]))
    const sumOf = (list: typeof cards, from: string, to: string) =>
      round2(list.filter(c => c.date != null && c.date >= from && c.date <= to).reduce((a, c) => a + (c.laborCost ?? 0), 0))
    const stayWage = (from: string, to: string, days: number) => {
      const cov = seventeenWestCoverage(sumOf(pair, from, to), days)
      return round2(Math.max(0, sumOf(mine, from, to) - sumOf(george, from, to) * cov.ratio))
    }
    wages = {
      yd: stayWage(yd, yd, 1), d7: stayWage(d7, yd, 7), d30: stayWage(d30, yd, 30),
      names: Array.from(new Set(mine.map(c => c.name))).slice(0, 8),
    }
  } catch { /* wages line shows a dash rather than a guess */ }

  // ── Vacants + open glitches, straight off the daysheet (same engine as the ops boards) ──────
  let vacIdle: { unit: string }[] = []
  let vacSoon: { unit: string; next: string }[] = []
  let glitches: { unit: string; overview: string; at: string }[] = []
  try {
    const sheet: any = await buildDaySheet(today, market)
    const notOurs = (u: any) => SEVENTEEN_RE.test(str(u.unit)) || VENDOR.test(str(u.unit))
    vacIdle = (sheet.vacants || []).filter((v: any) => !v.nextArrival && !notOurs(v)).map((v: any) => ({ unit: str(v.unit) }))
    vacSoon = (sheet.vacants || []).filter((v: any) => v.arrivingSoon && !notOurs(v)).map((v: any) => ({ unit: str(v.unit), next: str(v.nextArrival).slice(5, 10) }))
    glitches = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)) && !notOurs(g))
      .slice(0, 12).map((g: any) => ({ unit: str(g.unit), overview: str(g.overview).replace(/\s+/g, ' ').slice(0, 110), at: str(g.at || g.created_at).slice(5, 10) }))
  } catch { /* daysheet unavailable — the brief still sends */ }

  // ── Render ──────────────────────────────────────────────────────────────────────────────────
  const pctDone = wYd.scheduled ? Math.round((wYd.schedDone / wYd.scheduled) * 100) : null
  const tiles =
    '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:12px 0">' +
    '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
    tile(wYd.scheduled ? wYd.schedDone + '/' + wYd.scheduled : String(wYd.finished), 'Done yesterday', pctDone != null ? pctDone + '% of scheduled' : 'tasks finished', pctDone != null && pctDone < 80 ? '#dc2626' : '#111827') +
    tile(String(carryover.length), 'Carried over', 'scheduled, still open', carryover.length ? '#b45309' : '#047857') +
    tile(money(wYd.billable), 'Billed yesterday', wYd.noCharge ? wYd.noCharge + ' finished w/ no charge' : 'every task charged', wYd.noCharge ? '#b45309' : '#111827') +
    tile(money(w7.billable), 'Billed · 7 days', w7.finished + ' tasks') +
    tile(money(w30.billable), 'Billed · 30 days', w30.finished + ' tasks' + (w30.noCharge ? ' · ' + w30.noCharge + ' no charge' : ''), w30.noCharge > 10 ? '#b45309' : '#111827') +
    '</tr></table></div>'

  const carryCard = '<div style="' + cardStyle + '">' +
    secTitle('Open tasks carried over', 'scheduled in the last 7 days, not finished — oldest first') +
    (carryover.length
      ? '<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="' + S.th + '">Unit · task</th><th style="' + S.th + ';text-align:right">Scheduled</th><th style="' + S.th + ';text-align:right">Age</th><th style="' + S.th + '">With</th></tr>' +
        carryover.slice(0, 15).map(c => '<tr><td style="' + S.td + '"><b>' + esc(c.unit) + '</b><br><span style="' + S.muted + ';font-size:12px">' + esc(c.task) + '</span></td>' +
          '<td style="' + S.td + ';text-align:right;white-space:nowrap">' + esc(niceDay(c.sched)) + '</td>' +
          '<td style="' + S.td + ';text-align:right"><span style="' + (c.ageDays >= 3 ? S.red : S.amber) + '">' + c.ageDays + 'd</span></td>' +
          '<td style="' + S.td + '">' + esc(c.who) + '</td></tr>').join('') + '</table>' +
        (carryover.length > 15 ? '<p style="margin:6px 0 0;font-size:11px;color:#9ca3af">+' + (carryover.length - 15) + ' more on the board</p>' : '')
      : '<p style="margin:0;font-size:13px"><span style="' + S.green + '">Nothing carried over.</span> <span style="' + S.muted + '">Every scheduled task from the last week is closed.</span></p>') +
    '</div>'

  const glitchCard = '<div style="' + cardStyle + '">' +
    secTitle('Open guest-reported issues', 'live glitches in ' + market) +
    (glitches.length
      ? '<table width="100%" cellspacing="0" cellpadding="0">' +
        glitches.map(g => '<tr><td style="' + S.td + ';white-space:nowrap"><b>' + esc(g.unit) + '</b> <span style="' + S.muted + ';font-size:12px">· ' + esc(g.at) + '</span></td>' +
          '<td style="' + S.td + '"><span style="' + S.muted + '">' + esc(g.overview) + '</span></td></tr>').join('') + '</table>'
      : '<p style="margin:0;font-size:13px"><span style="' + S.green + '">No open guest issues.</span></p>') +
    '</div>'

  const vacCard = '<div style="' + cardStyle + '">' +
    secTitle('Vacant units', 'get into these while nobody is inside') +
    (vacSoon.length ? '<p style="margin:0 0 6px;font-size:12.5px"><span style="' + S.amber + '">Guest arriving within 3 days:</span> ' +
      vacSoon.slice(0, 10).map(v => esc(v.unit) + ' <span style="' + S.muted + '">(' + esc(v.next) + ')</span>').join(' · ') +
      ' — finish any open work in these FIRST.</p>' : '') +
    (vacIdle.length ? '<p style="margin:0;font-size:12.5px"><b>' + vacIdle.length + ' with no future booking</b> — preventive-work window: ' +
      vacIdle.slice(0, 14).map(v => esc(v.unit)).join(', ') + (vacIdle.length > 14 ? ' +' + (vacIdle.length - 14) + ' more' : '') + '</p>'
      : (!vacSoon.length ? '<p style="margin:0;font-size:13px;color:#6b7280">No vacants tonight.</p>' : '')) +
    '</div>'

  const recurCard = '<div style="' + cardStyle + '">' +
    secTitle('Recurring issues', 'units with 3+ maintenance tasks in 30 days — patterns, not bad luck') +
    (recurring.length
      ? '<table width="100%" cellspacing="0" cellpadding="0">' +
        recurring.map(r => '<tr><td style="' + S.td + '"><b>' + esc(r.unit) + '</b> <span style="' + S.red + '">×' + r.n + '</span><br>' +
          '<span style="' + S.muted + ';font-size:12px">' + esc(r.names.join(' · ')) + '</span></td></tr>').join('') + '</table>' +
        '<p style="margin:6px 0 0;font-size:11px;color:#9ca3af">Worth a root-cause visit rather than another patch.</p>'
      : '<p style="margin:0;font-size:13px"><span style="' + S.green + '">No unit needed maintenance 3+ times this month.</span></p>') +
    '</div>'

  const wagesNote = 'Wages are the declared maintenance crew&rsquo;s Homebase timecards, portfolio-wide — Homebase is one location with no market on a timecard, so the SAME wage line appears on both market briefs. Billable is measured per market, because a task knows its unit. 17WEST pays $100k/yr toward George Paz + Yoslenis, so the wage column carries only Stay&rsquo;s share of George.'
  const moneyCard = '<div style="' + cardStyle + '">' +
    secTitle('Billable vs wages', market + ' billable · portfolio wages') +
    '<table width="100%" cellspacing="0" cellpadding="0">' +
    '<tr><th style="' + S.th + '">Window</th><th style="' + S.th + ';text-align:right">Billed (' + market + ')</th>' +
    '<th style="' + S.th + ';text-align:right">Maint wages (all)</th><th style="' + S.th + ';text-align:right">Tasks</th><th style="' + S.th + ';text-align:right">No charge</th></tr>' +
    [['Yesterday', wYd, wages.yd], ['Last 7 days', w7, wages.d7], ['Last 30 days', w30, wages.d30]].map(([label, w, wg]: any) =>
      '<tr><td style="' + S.td + '">' + label + '</td>' +
      '<td style="' + S.td + ';text-align:right"><b>' + money(w.billable) + '</b></td>' +
      '<td style="' + S.td + ';text-align:right;color:#6b7280">' + money(wg) + '</td>' +
      '<td style="' + S.td + ';text-align:right">' + w.finished + '</td>' +
      '<td style="' + S.td + ';text-align:right">' + (w.noCharge ? '<span style="' + S.amber + '">' + w.noCharge + '</span>' : '0') + '</td></tr>').join('') +
    '</table>' +
    '<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">' + wagesNote + ' A finished task with no charge entered bills $0 until someone types the cost in Breezeway.</p>' +
    '</div>'

  const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:720px;margin:0 auto;padding:18px">' +
    quoteBanner(today) +
    '<div style="background:#7c2d12;border-radius:12px;padding:16px 18px">' +
    '<p style="margin:0;color:#fdba74;font-size:11px;letter-spacing:.16em">S T A Y &nbsp; H O S P I T A L I T Y</p>' +
    '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Maintenance Brief &mdash; ' + market + '</p>' +
    '<p style="margin:2px 0 0;color:#fdba74;font-size:12.5px">' + niceDay(today) + ' &middot; 17WEST and vendor buildings excluded &mdash; they get their own brief</p></div>' +
    tiles + carryCard + glitchCard + vacCard + recurCard + moneyCard +
    '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Billable uses the same per-task math as the Labor board and owner invoices. Tasks and glitches are live from Breezeway and the boards.</p>' +
    '</div></body></html>'

  const subject = market + ' Maintenance Brief ' + niceDay(today) + ': ' +
    (wYd.scheduled ? wYd.schedDone + '/' + wYd.scheduled + ' done yest' : wYd.finished + ' done yest') +
    (carryover.length ? ', ' + carryover.length + ' carried over' : '') +
    ', ' + '$' + Math.round(w7.billable).toLocaleString('en-US') + ' billed 7d'

  return { subject, html, counts: { carryover: carryover.length, glitches: glitches.length, vacantIdle: vacIdle.length, doneYesterday: wYd.schedDone } }
}
