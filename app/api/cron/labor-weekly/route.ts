// WEEKLY PAYROLL BRIEF - manager email, Mondays. Includes dollar amounts.
//
// Jon, 2026-08-10: "count all billable labor completed for that week. It should show cost per
// clean, margins, time per clean etc. Number of cleans / non-clean tasks, like inspections,
// other, maintenance." So the week is broken into the work that was actually done - departure
// cleans, other cleans, inspections, maintenance, everything else - with the cost, the time and
// the money each one carries, instead of a single undifferentiated payroll number.
//
// The three rules this brief obeys, learned the hard way on the other boards:
//   1. COST PER CLEAN USES DEPARTURE CLEANS ONLY. Common-area sweeps, pool, trash and linen runs
//      are housekeeping work but they are not turns, and counting them halves the apparent cost.
//   2. CLEANS ARE COUNTED FROM CHECKOUTS, not from closed Breezeway tasks - newer staff do not
//      always close a task, and a guest leaving is proof the unit needed cleaning.
//   3. BILLABLE LABOR IS HOURS x THE OWNER CHARGE RATE. Breezeway carries a pay rate on zero
//      tasks, so anything built on rate_paid computes to $0. Materials are shown separately
//      because they are a pass-through, not labor.
// Covers the last FULL workweek (Sunday-Saturday by default, labor_settings.week_start).
// Recipients live in app_settings key 'labor_weekly': { enabled, fromEmail, to: string[] }.
// GET ?preview=1 (signed in) returns the HTML. GET ?test=1 sends to YOU only.
// Safe by default: nothing sends to the list until enabled + recipients are set.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { getShifts, nameMatches, nameMatchesRoster, type Shift } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { sendGmail } from '@/lib/gmail-send'
import { billingMonth } from '@/lib/billing'
import { isDepartureCleanName } from '@/lib/breezeway'
import { quoteBanner } from '@/lib/ops-brief'
import { getSetting as getSetting2 } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const r1 = (n: number) => Math.round(n * 10) / 10
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

type Cfg = { enabled?: boolean; fromEmail?: string; to?: string[] }
const DEFAULT_FROM = 'jon@stay-hospitality.com'
// STANDING CC (Jon, 2026-08-09): the operations manager sees every brief that goes out.
const STANDING_CC = ['roberto@stay-hospitality.com']
const ccFor = (to: string[]): string[] => {
  const already = new Set(to.map(t => String(t || '').trim().toLowerCase()))
  return STANDING_CC.filter(c => !already.has(c.toLowerCase()))
}

async function me(): Promise<string | null> {
  try {
    const s = createClient()
    const { data: { user } } = await s.auth.getUser()
    return user?.email ? String(user.email).toLowerCase() : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron') || auth === ''
  const who = await me()
  const sp = new URL(req.url).searchParams
  const test = !!sp.get('test'), preview = !!sp.get('preview')
  if ((test || preview) && !who) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!isCron && !who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const cfg = await getSetting<Cfg>('labor_weekly', {})
    const fromEmail = String(cfg.fromEmail || DEFAULT_FROM)
    const settings = await getLaborSettings('default')
    const weekStart = (settings as any).week_start === 'monday' ? 'monday' : 'sunday'
    const now = new Date()
    const localDow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay()
    const offset = weekStart === 'sunday' ? localDow : (localDow + 6) % 7
    const thisWeekStart = addDays(now, -offset)
    const start = dISO(addDays(thisWeekStart, -7))
    const end = dISO(addDays(thisWeekStart, -1))

    const timecards = await getTimecards(start, end)
    const dates: string[] = []
    for (let d = new Date(start + 'T12:00:00Z'); dISO(d) <= end; d = addDays(d, 1)) dates.push(dISO(d))
    const perDay = await Promise.all(dates.map(async date => {
      try { return await getShifts(date, TZ) } catch { return [] as Shift[] }
    }))
    let schedCost = 0
    for (const day of perDay) for (const s of day as any[]) schedCost += (s as any).scheduledCost ?? 0

    const db = supabaseAdmin()
    const [lr, rr, tr] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      db.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
        .gte('check_out', start).lte('check_out', end)
        .not('status', 'in', '("canceled","cancelled","declined")').limit(4000),
      db.from('breezeway_tasks_sync').select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid')
        .gte('finished_at', start).lte('finished_at', end + 'T23:59:59').limit(5000),
    ])
    const presets = await getOpsPresets()
    const VEN = vendorRegex(presets.vendorBuildings)
    const lmap: Record<string, { vendor: boolean }> = {}
    for (const l of (lr.data || []) as any[]) {
      const nm = String(l.nickname || l.title || '')
      lmap[String(l.id)] = { vendor: VEN.test(String(l.building || '')) || VEN.test(nm) }
    }

    const cleanTasks = ((tr.data || []) as any[]).filter(t => {
      const s = (String(t.type_department || '') + ' ' + String(t.name || '')).toLowerCase()
      // Strips/walkthroughs and delivery errands are NOT departure cleans.
      if (/strip|walkthrough|walk-through|deliver|mattress/.test(s)) return false
      return /clean|housekeep|turn/.test(s)
    })
    // Canonicalize Breezeway doers to Homebase names (fuzzy + unique-first-name).
    const aliasCache: Record<string, string | null> = {}
    const roster: string[] = []
    for (const t of timecards) if (roster.indexOf(t.name) < 0) roster.push(t.name)
    const doer = (t: any): string | null => {
      const raw = t.assignee_name || t.finished_by_name || null
      if (!raw) return null
      if (!(raw in aliasCache)) aliasCache[raw] = nameMatchesRoster(String(raw), roster)
      return aliasCache[raw] || String(raw)
    }
    const used: Record<string, boolean> = {}
    const atts: { fee: number | null; who: string | null; vendor: boolean }[] = []
    for (const r of (rr.data || []) as any[]) {
      const co = String(r.check_out).slice(0, 10)
      const coN = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
      const m = cleanTasks.find(t => !used[String(t.id)] &&
        String(t.reference_property_id) === String(r.listing_id) &&
        [co, coN].indexOf(String(t.finished_at).slice(0, 10)) >= 0)
      if (m) used[String(m.id)] = true
      const fee = Number((r as any).cleaning)
      atts.push({ fee: Number.isFinite(fee) ? fee : null, who: m ? doer(m) : null, vendor: !!lmap[String(r.listing_id)]?.vendor })
    }
    let inhouseFees = 0, vendorFees = 0
    for (const a of atts) { if (a.fee == null) continue; if (a.vendor) vendorFees += a.fee; else inhouseFees += a.fee }

    const payroll = timecards.reduce((a, t) => a + (t.laborCost ?? 0), 0)
    const hours = timecards.reduce((a, t) => a + (t.hours ?? 0), 0)
    const ot = timecards.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)
    // LABOR % OF CLEANING REVENUE MUST USE CLEANING LABOR. This divided TOTAL payroll — which
    // includes maintenance techs and inspectors — into cleaning revenue alone, so it read 48.3%
    // and tripped "over target" on a week that was actually 34%. hkPayroll is computed below;
    // the value is filled in there so the two can never drift apart again.

    // ── WHAT THE WEEK ACTUALLY CONSISTED OF ──────────────────────────────────────────────────
    // Every task finished inside the week, sorted into the five kinds of work Jon asked for, with
    // the time each one took. Sourced from the billing pull rather than a raw task query so the
    // line items (materials) come with it and the numbers agree with the Billable Hours board.
    const monthsInWeek = Array.from(new Set([start.slice(0, 7), end.slice(0, 7)]))
    let bTasks: any[] = []
    for (const mk of monthsInWeek) {
      try { const bm = await billingMonth(mk); bTasks = bTasks.concat(bm.tasks as any[]) } catch { /* week still renders */ }
    }
    const inWeek = (t: any) => {
      const d = String(t.finishedAt || t.scheduledDate || '').slice(0, 10)
      return !!d && d >= start && d <= end
    }
    const weekTasks = bTasks.filter(inWeek)
    type Kind = 'departure' | 'otherClean' | 'inspection' | 'maintenance' | 'other'
    const kindOf = (t: any): Kind => {
      const dep = String(t.department || '').toLowerCase()
      const nm = String(t.name || '')
      if (/inspect|audit|quality/.test(dep + ' ' + nm.toLowerCase())) return 'inspection'
      if (/maint|repair|handy/.test(dep)) return 'maintenance'
      if (isDepartureCleanName(nm)) return 'departure'
      if (/clean|housekeep|turn/.test(dep + ' ' + nm.toLowerCase())) return 'otherClean'
      return 'other'
    }
    const KINDS: { k: Kind; label: string; note: string }[] = [
      { k: 'departure', label: 'Departure cleans', note: 'the turns \u2014 the cost-per-clean denominator' },
      { k: 'otherClean', label: 'Other housekeeping', note: 'common areas, pool, trash, linen, mid-stay' },
      { k: 'inspection', label: 'Inspections', note: 'quality walks and audits' },
      { k: 'maintenance', label: 'Maintenance', note: 'owner-billable repair work' },
      { k: 'other', label: 'Everything else', note: 'errands, deliveries, admin tasks' },
    ]
    const mix: Record<Kind, { n: number; mins: number; materials: number }> =
      { departure: { n: 0, mins: 0, materials: 0 }, otherClean: { n: 0, mins: 0, materials: 0 },
        inspection: { n: 0, mins: 0, materials: 0 }, maintenance: { n: 0, mins: 0, materials: 0 },
        other: { n: 0, mins: 0, materials: 0 } }
    for (const t of weekTasks) {
      const e = mix[kindOf(t)]
      e.n += 1
      e.mins += Number(t.actualMinutes) || 0
      e.materials += ((t.items || []) as any[])
        .reduce((a, i) => a + (String(i.bill_to || 'owner') === 'guest' ? 0 : (Number(i.amount) || 0)), 0)
    }

    // ── BILLABLE LABOR COMPLETED THIS WEEK ───────────────────────────────────────────────────
    // Owner-billable work is maintenance and inspection time. Priced at the owner charge rate,
    // because the rate field on a Breezeway task is empty on every task in the system.
    const rateCfg = await getSetting2<{ rate: number }>('billing_default_rate', { rate: 40 })
    const chargeRate = Number(rateCfg?.rate) > 0 ? Number(rateCfg.rate) : 40
    const billableMins = mix.maintenance.mins + mix.inspection.mins
    const billableHours = billableMins / 60
    const billableLabor = billableHours * chargeRate
    const materialsBilled = KINDS.reduce((a, k) => a + mix[k.k].materials, 0)

    // ── COST AND TIME PER CLEAN ──────────────────────────────────────────────────────────────
    // Denominator is CHECKOUTS on in-house units (rule 2), not the departure-clean task count -
    // both are shown so the gap between them is visible rather than hidden.
    const inhouseCheckouts = atts.filter(a => !a.vendor).length
    const deptOfRole = (r: any) => {
      const x = String(r || '').toLowerCase()
      if (/inspect|audit|quality/.test(x)) return 'inspection'
      if (/clean|housekeep|turn/.test(x)) return 'housekeeping'
      if (/maint|tech|repair|handy/.test(x)) return 'maintenance'
      return 'other'
    }
    const hkCards = timecards.filter(t => deptOfRole(t.role) === 'housekeeping')
    const hkPayroll = hkCards.reduce((a, t) => a + (t.laborCost ?? 0), 0)
    const hkHours = hkCards.reduce((a, t) => a + (t.hours ?? 0), 0)
    const maintCards = timecards.filter(t => deptOfRole(t.role) === 'maintenance')
    const maintPayroll = maintCards.reduce((a, t) => a + (t.laborCost ?? 0), 0)
    const costPerClean = inhouseCheckouts > 0 && hkPayroll > 0 ? hkPayroll / inhouseCheckouts : null
    const hoursPerClean = inhouseCheckouts > 0 && hkHours > 0 ? hkHours / inhouseCheckouts : null
    const feePerClean = inhouseCheckouts > 0 && inhouseFees > 0 ? inhouseFees / inhouseCheckouts : null
    // Margins, each against the cost that actually belongs to it.
    const pct = inhouseFees > 0 && hkPayroll > 0 ? Math.round((hkPayroll / inhouseFees) * 1000) / 10 : null
    const band = pct == null ? 'no data' : pct <= Number(settings.pct_good) ? 'on target' : pct <= Number(settings.pct_bad) ? 'watch' : 'over target'
    const cleanMargin = hkPayroll > 0 ? inhouseFees - hkPayroll : null
    const cleanMarginPct = (cleanMargin != null && inhouseFees > 0) ? Math.round((cleanMargin / inhouseFees) * 1000) / 10 : null
    const maintMargin = maintPayroll > 0 ? (billableLabor + materialsBilled) - maintPayroll : null
    const totalRev = inhouseFees + billableLabor + materialsBilled
    const totalMargin = payroll > 0 ? totalRev - payroll : null
    const totalMarginPct = (totalMargin != null && totalRev > 0) ? Math.round((totalMargin / totalRev) * 1000) / 10 : null

    const names: string[] = []
    for (const t of timecards) if (names.indexOf(t.name) < 0) names.push(t.name)
    const people = names.map(name => {
      const mine = timecards.filter(t => t.name === name)
      const h = mine.reduce((a, t) => a + (t.hours ?? 0), 0)
      const o = mine.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)
      const p = mine.reduce((a, t) => a + (t.laborCost ?? 0), 0)
      const cleans = cleanTasks.filter(t => { const d = doer(t); return !!d && nameMatches(d, name) }).length
      let rev = 0
      for (const a of atts) if (!a.vendor && a.fee != null && a.who && nameMatches(a.who, name)) rev += a.fee
      return { name, h: r1(h), o: r1(o), p, cleans, rev, per: p > 0 ? Math.round((rev / p) * 100) / 100 : null }
    }).sort((a, b) => b.rev - a.rev)

    const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left'
    const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
    const rows = people.map(x =>
      '<tr><td style="' + td + '"><b>' + x.name + '</b></td>' +
      '<td style="' + td + '">' + x.h + 'h' + (x.o ? ' <span style="color:#d97706">(+' + x.o + ' OT)</span>' : '') + '</td>' +
      '<td style="' + td + '">' + money(x.p) + '</td>' +
      '<td style="' + td + '">' + (x.cleans || '-') + '</td>' +
      '<td style="' + td + '">' + (x.rev ? money(x.rev) : '-') + '</td>' +
      '</tr>').join('')

    const bandColor = band === 'over target' ? '#dc2626' : band === 'watch' ? '#d97706' : '#059669'

    // ── EMAIL ────────────────────────────────────────────────────────────────────────────────
    const card = (title: string, inner: string, accent = '#111827') =>
      '<div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ' + accent + ';border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700">' + title + '</p>' + inner + '</div>'
    const tile = (label: string, value: string, sub: string, tone?: string) =>
      '<td width="33%" style="padding:10px 12px;vertical-align:top">' +
      '<p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;font-weight:700">' + label + '</p>' +
      '<p style="margin:3px 0 1px;font-size:21px;font-weight:800;color:' + (tone || '#0b1220') + '">' + value + '</p>' +
      '<p style="margin:0;font-size:11px;color:#9ca3af">' + sub + '</p></td>'
    const money2 = (n: number | null) => n == null ? '&mdash;' : (n < 0 ? '-$' + Math.abs(Math.round(n)).toLocaleString('en-US') : money(n))
    const hrsOf = (m: number) => (m / 60)

    const mixRows = KINDS.map(k => {
      const e = mix[k.k]
      if (!e.n) return ''
      return '<tr><td style="' + td + '"><b>' + k.label + '</b><div style="font-size:11px;color:#9ca3af">' + k.note + '</div></td>' +
        '<td style="' + td + ';text-align:right"><b>' + e.n + '</b></td>' +
        '<td style="' + td + ';text-align:right">' + r1(hrsOf(e.mins)) + 'h</td>' +
        '<td style="' + td + ';text-align:right">' + (e.n && e.mins ? r1(e.mins / e.n) : '<span style="color:#d1d5db">&mdash;</span>') + '</td>' +
        '<td style="' + td + ';text-align:right">' + (e.materials ? money(e.materials) : '<span style="color:#d1d5db">&mdash;</span>') + '</td></tr>'
    }).join('')

    const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
      '<div style="max-width:760px;margin:0 auto;padding:20px">' +
      '<div style="background:#111827;border-radius:12px;padding:18px 20px;margin-bottom:10px">' +
      '<p style="margin:0;color:#9ca3af;font-size:10px;letter-spacing:.18em;font-weight:700">S T A Y &nbsp; H O S P I T A L I T Y</p>' +
      '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Weekly payroll brief</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">' + start + ' to ' + end + ' &middot; Homebase payroll, Breezeway work, Guesty checkouts</p></div>' +
      quoteBanner(end) +
      '<table width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin:10px 0 14px"><tr>' +
      tile('Payroll', money(payroll), r1(hours) + 'h clocked' + (ot ? ' &middot; ' + r1(ot) + 'h OT' : '')) +
      tile('Cost / clean', costPerClean != null ? money(costPerClean) : '&mdash;', inhouseCheckouts + ' in-house checkouts') +
      tile('Time / clean', hoursPerClean != null ? r1(hoursPerClean) + 'h' : '&mdash;', 'housekeeping hours &divide; checkouts') +
      '</tr><tr>' +
      tile('Cleaning revenue', money(inhouseFees), feePerClean != null ? money(feePerClean) + ' per turn' : 'guest cleaning fees') +
      tile('Billable labor', money(billableLabor), r1(billableHours) + 'h at $' + chargeRate + '/h') +
      tile('Margin', totalMarginPct != null ? totalMarginPct + '%' : '&mdash;', money2(totalMargin) + ' on ' + money(totalRev),
        totalMarginPct == null ? undefined : totalMarginPct < 10 ? '#dc2626' : totalMarginPct < 30 ? '#d97706' : '#047857') +
      '</tr></table>' +

      card('Work completed this week', 
        '<table width="100%" cellspacing="0" cellpadding="0">' +
        '<tr><th style="' + th + '">Kind of work</th><th style="' + th + ';text-align:right">Tasks</th><th style="' + th + ';text-align:right">Hours</th><th style="' + th + ';text-align:right">Min / task</th><th style="' + th + ';text-align:right">Materials</th></tr>' +
        mixRows + '</table>' +
        '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">' + mix.departure.n + ' departure cleans were closed in Breezeway against <b>' + inhouseCheckouts + '</b> in-house checkouts. ' +
        (mix.departure.n < inhouseCheckouts
          ? 'The gap is ' + (inhouseCheckouts - mix.departure.n) + ' turns that were done but never closed as a task \u2014 cost per clean uses the checkout count, so it stays right either way.'
          : 'Task closure is keeping up with checkouts.') + '</p>', '#0891b2') +

      card('The money, by what it pays for',
        '<table width="100%" cellspacing="0" cellpadding="0">' +
        '<tr><td style="' + td + '">Guest cleaning fees <span style="color:#9ca3af">' + inhouseCheckouts + ' in-house checkouts</span></td><td style="' + td + ';text-align:right"><b>' + money(inhouseFees) + '</b></td></tr>' +
        '<tr><td style="' + td + '">Housekeeping payroll <span style="color:#9ca3af">clocked, cleaning roles only</span></td><td style="' + td + ';text-align:right">' + money(hkPayroll) + '</td></tr>' +
        '<tr><td style="' + td + '"><b>Cleaning margin</b></td><td style="' + td + ';text-align:right"><b style="color:' + (cleanMarginPct != null && cleanMarginPct < 10 ? '#dc2626' : '#047857') + '">' + money2(cleanMargin) + (cleanMarginPct != null ? ' &middot; ' + cleanMarginPct + '%' : '') + '</b></td></tr>' +
        '<tr><td style="' + td + ';padding-top:14px">Billable labor <span style="color:#9ca3af">maintenance + inspection hours at $' + chargeRate + '/h</span></td><td style="' + td + ';text-align:right;padding-top:14px"><b>' + money(billableLabor) + '</b></td></tr>' +
        '<tr><td style="' + td + '">Materials billed to owners <span style="color:#9ca3af">parts and supplies, a pass-through</span></td><td style="' + td + ';text-align:right">' + money(materialsBilled) + '</td></tr>' +
        '<tr><td style="' + td + '">Maintenance payroll <span style="color:#9ca3af">clocked, maintenance roles only</span></td><td style="' + td + ';text-align:right">' + money(maintPayroll) + '</td></tr>' +
        '<tr><td style="' + td + '"><b>Maintenance margin</b></td><td style="' + td + ';text-align:right"><b style="color:' + (maintMargin != null && maintMargin < 0 ? '#dc2626' : '#047857') + '">' + money2(maintMargin) + '</b></td></tr>' +
        '<tr><td style="' + td + ';border-top:2px solid #111827"><b>All revenue vs all payroll</b></td><td style="' + td + ';text-align:right;border-top:2px solid #111827"><b>' + money(totalRev) + ' vs ' + money(payroll) + '</b></td></tr>' +
        '</table>' +
        '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Labor is at <b style="color:' + bandColor + '">' + (pct != null ? pct + '%' : '&mdash;') + '</b> of in-house cleaning revenue <span style="color:#9ca3af">(housekeeping wages only)</span> &mdash; <span style="color:' + bandColor + '">' + band + '</span> (goal &le; ' + settings.pct_good + '%). Scheduled cost for the week was ' + money(schedCost) + '.</p>', '#4338ca') +

      card('Per person &mdash; revenue generated vs labor cost',
        '<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="' + th + '">Person</th><th style="' + th + '">Hours</th><th style="' + th + '">Payroll</th><th style="' + th + '">Cleans</th><th style="' + th + '">Revenue</th></tr>' + rows + '</table>' +
        '<p style="margin:8px 0 0;font-size:11.5px;color:#6b7280">Revenue = guest cleaning fees on checkouts matched to that person&#39;s Breezeway cleans (in-house units only). People with hours but no cleans are maintenance, inspections, or a name that does not match between Homebase and Breezeway.</p>') +

      '<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:14px;text-align:center">' +
      '<p style="margin:0;font-size:12.5px;color:#374151"><b>Thank you for everything you do.</b></p></div>' +
      '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Sent automatically by Lighthouse every Monday. Full detail on the Labor and Billable Hours boards.</p>' +
      '</div></body></html>'

    const subject = 'Weekly payroll ' + start + ' to ' + end + ': ' + money(payroll) + ' payroll, ' + (costPerClean != null ? money(costPerClean) + '/clean' : inhouseCheckouts + ' cleans') + ', ' + money(totalRev) + ' revenue' + (totalMarginPct != null ? ' (' + totalMarginPct + '% margin)' : '')

    if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (test) {
      const r = await sendGmail({ fromEmail, to: [who as string], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, test: true, to: who, error: r.error })
    }
    if (cfg.enabled !== true) return NextResponse.json({ ok: true, skipped: 'labor_weekly not enabled - set app_settings labor_weekly { enabled, to } ' })
    const to = (cfg.to || []).filter(Boolean)
    if (!to.length) return NextResponse.json({ ok: true, skipped: 'no recipients' })
    const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject, html })
    return NextResponse.json({ ok: r.ok, to: to.length, subject, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}
