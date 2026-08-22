// lib/maint-brief.ts — MAINTENANCE DATA for the Ops Command brief.
//
// HISTORY: this file used to render two standalone maintenance emails (Jon, 2026-08-20: one per
// market). On 2026-08-22 Jon approved the Morning System consolidation: the maintenance story now
// lives INSIDE the ops manager's single Ops Command email, Miami and Broward side by side, and
// this module became data-only — no HTML, no sending. The retired cron route is a 410 stub.
//
// MONEY RULES MATCH THE ENGINE EXACTLY. Billable per task = the charge entered on the task
// (rate via laborAmount + owner-billable cost items, guest-billed lines excluded, adjustments
// overlay honoured) — the same arithmetic lib/labor-econ.ts and the owner invoice use, so this
// data, the Labor board and the statements can never disagree. Maintenance WAGES come from
// Homebase timecards for the declared maintenance crew; Homebase is one location with no market
// on a timecard, so wages are portfolio-wide and labelled as such — billable is per market
// because a task knows its unit.
//
// 17WEST IS DELIBERATELY EXCLUDED from both markets — Jon: "17west should be separate, as I will
// explain later." Its units appear in neither Miami nor Broward here.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { marketOf } from './segments'
import { kindOfTask, SEVENTEEN_WEST_PAIR, seventeenWestCoverage } from './labor-econ'
import { nameMatches } from './homebase'
import { getTimecardsAudited } from './homebase-labor'
import { laborAmount } from './billing'

export type MaintMarket = 'Miami' | 'Broward'

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const SEVENTEEN_RE = /17\s*west/i

/** Owner-billable total of a Breezeway line-item array — same rule as the engine and invoices. */
function ownerTotal(arr: any, kind: 'cost' | 'supply'): number {
  return (Array.isArray(arr) ? arr : []).reduce((a: number, x: any) => {
    if (x && x.bill_to && String(x.bill_to) === 'guest') return a
    if (kind === 'supply' && x && x.billable === false) return a
    const v = Number(kind === 'cost' ? x?.cost : (x?.total_price != null ? x.total_price : x?.unit_cost))
    return a + (Number.isFinite(v) ? v : 0)
  }, 0)
}

export type MaintWindow = { finished: number; billable: number; noCharge: number; scheduled: number; schedDone: number }
export type MaintData = {
  market: MaintMarket
  yd: MaintWindow; d7: MaintWindow; d30: MaintWindow
  carryover: { unit: string; task: string; sched: string; ageDays: number; who: string }[]
  recurring: { unit: string; n: number; names: string[] }[]
  /** Maintenance crew wages, PORTFOLIO-WIDE (one Homebase location) — null when timecards were
   *  incomplete, so a rate-limited morning never prints an understated wage as truth. */
  wages: { yd: number | null; d7: number | null; d30: number | null }
}

export async function maintData(market: MaintMarket): Promise<MaintData> {
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const yd = shift(today, -1)
  const d7 = shift(yd, -6)
  const d30 = shift(yd, -29)
  const mk = market.toLowerCase()

  const presets = await getOpsPresets()
  const VENDOR = vendorRegex(presets.vendorBuildings)

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

  // Maintenance tasks, last 30 days + anything still open. Stable order so the page cap can
  // never silently drop rows that decide a number.
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

  // Billable buckets by the day the task FINISHED (that is when the charge exists); completion
  // rate buckets by the day the task was SCHEDULED.
  const win = (from: string, to: string): MaintWindow => {
    const fin = maint.filter(t => { const f = finishedDay(t); return f != null && f >= from && f <= to })
    const billable = round2(fin.reduce((a, t) => a + chargeOf(t), 0))
    const noCharge = fin.filter(t => chargeOf(t) <= 0).length
    const sched = maint.filter(t => str(t.scheduled_date).slice(0, 10) >= from && str(t.scheduled_date).slice(0, 10) <= to)
    const schedDone = sched.filter(isDone).length
    return { finished: fin.length, billable, noCharge, scheduled: sched.length, schedDone }
  }

  // Carryover: scheduled on/before yesterday (last 7 days), still open — oldest first.
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

  // Recurring issues: units with 3+ maintenance tasks in 30 days — patterns, not bad luck.
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
    .sort((a, b) => b.n - a.n).slice(0, 8)

  // Maintenance crew wages — AUDITED timecards only (super audit, 2026-08-22): the old bare
  // getTimecards silently under-reported a rate-limited week as real wages. Incomplete ⇒ null.
  let wages: MaintData['wages'] = { yd: null, d7: null, d30: null }
  try {
    const { getCrew } = await import('./crew')
    const crew = await getCrew()
    const audit = await getTimecardsAudited(d30, yd)
    if (audit.complete) {
      const cards = audit.cards
      const mine = cards.filter(c => crew.deptOf(c.name, (c as any).role) === 'maintenance')
      // 17WEST pays $100k/yr toward George Paz + Yoslenis — carry only STAY'S share of George,
      // same coverage math as the labor engine.
      const pair = cards.filter(c => SEVENTEEN_WEST_PAIR.some(n => nameMatches(c.name, n)))
      const george = cards.filter(c => nameMatches(c.name, SEVENTEEN_WEST_PAIR[0]))
      const sumOf = (list: typeof cards, from: string, to: string) =>
        round2(list.filter(c => c.date != null && c.date >= from && c.date <= to).reduce((a, c) => a + (c.laborCost ?? 0), 0))
      const stayWage = (from: string, to: string, days: number) => {
        const cov = seventeenWestCoverage(sumOf(pair, from, to), days)
        return round2(Math.max(0, sumOf(mine, from, to) - sumOf(george, from, to) * cov.ratio))
      }
      wages = { yd: stayWage(yd, yd, 1), d7: stayWage(d7, yd, 7), d30: stayWage(d30, yd, 30) }
    }
  } catch { /* wages stay null rather than a guess */ }

  return { market, yd: win(yd, yd), d7: win(d7, yd), d30: win(d30, yd), carryover, recurring, wages }
}
