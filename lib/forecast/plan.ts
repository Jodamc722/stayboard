// THE NEXT-WEEK PLAN — preemptive scheduling (owner, 2026-11-10: "start figuring that out so that we
// can manage our KPIs and start building preemptive scheduling … encourage, lead and help us create
// plans").
//
// Per in-house market per day for the next seven days: cleans expected (on the books + likely
// pickup), the KPI hours they carry, the people that needs, the people Homebase has Working so far,
// the gap — and one to three concrete moves. ONE plan, read by:
//   • the Scheduler page's "Next 7 days" panel (components/ScheduleNextWeek.tsx via /api/schedule/plan)
//   • Eve's schedule_plan tool ("are we staffed next week?")
//   • the Sunday shadow-scheduler readout (lib/eve/scheduler-shadow.ts)
//   • the forecast ledger: snapshotForecasts records each day's KPI need as kind 'kpi_need' and
//     gradeForecasts grades it against the people who actually worked (lib/forecast/ledger.ts).
//
// INPUTS, ALL EXISTING: the 14-day staffing forecast (bookings, the learned pickup, the Homebase
// roster, and now each day's KPI hours — lib/forecast/staffing.ts); the growth buffer (Ops presets);
// the shift length (clean rates); the how-we-schedule profile's in-house weekday history (the cached
// eve_schedule_knowledge — never rebuilt from here, it is a 90-day read); and the deep cleans already
// in Breezeway, which are the work that can move. The arithmetic is lib/forecast/plan-core.ts.
//
// READ-ONLY. Nothing is assigned, posted or written to Breezeway or Homebase from here.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '../supabase-admin'
import { getOpsPresets, getSetting } from '../app-settings'
import { vendorRegex } from '../ops-presets'
import { marketOf } from '../segments'
import { isDepartureCleanName } from '../breezeway'
import { isTaskDone, isTaskGone } from '../task-categories'
import { CLEAN_RATES_KEY, resolveCleanRates } from '../clean-rates'
import { buildStaffingForecast, FORECAST_MARKETS, type StaffingForecast, type StaffDay } from './staffing'
import { planDay, planMoves, summarize, planText, type PlanDay, type PlanDayInput, type PlanMove, type PlanSettings, type PlanSummary } from './plan-core'
import { trackRecord } from './ledger'
import type { ScheduleKnowledge } from '../eve/schedule-knowledge'

export type { PlanDay, PlanMove, PlanSummary } from './plan-core'

/** app_settings key of the how-we-schedule picture (lib/eve/schedule-knowledge KNOWLEDGE_KEY). */
const KNOWLEDGE_KEY = 'eve_schedule_knowledge'
const TZ = 'America/New_York'
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
const dowIndex = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay()
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
/** Work that is not a turnover and can be done on another day. */
const DEFERRABLE = /deep\s*clean|oven|fridge|refrigerator|carpet|upholster|window|grout|mattress|refresh/i

export type NextWeekPlan = {
  ok: true
  generatedAt: string
  from: string
  to: string
  markets: string[]
  settings: PlanSettings
  /** Market × day, date order. */
  days: PlanDay[]
  summary: PlanSummary
  moves: PlanMove[]
  /** The KPI basis in one paragraph — the same model as the Scheduler rail. */
  basis: string
  /** Short text for Slack readouts, Reports and Eve. */
  text: string
  rosterPublishedThrough: string | null
  pickupLearning: boolean
  /** How the KPI-need forecast has done against the people who actually worked (null = not graded yet). */
  track: { n: number; mae: number | null; bias: number | null; withinPct: number | null } | null
  notes: string[]
}

export function planBasis(s: PlanSettings): string {
  return `KPI hours = each booked clean's expected labor cost ÷ pay per hour (Scheduler → Rates), plus cleans still likely to book (the larger of the learned pickup and the weekday's in-house history) × the market's hours per clean, plus the ${s.growthPct}% buffer; needed = that ÷ a ${s.shiftHours}h shift, rounded up once. Scheduled = cleaners Working in Homebase or set by hand on the roster × ${s.shiftHours}h; on-call is shown, not counted. Vendor buildings and North are out.`
}

async function settings(): Promise<PlanSettings> {
  const [presets, rates] = await Promise.all([
    getOpsPresets().catch(() => null),
    getSetting<any>(CLEAN_RATES_KEY, null).catch(() => null).then(v => resolveCleanRates(v)),
  ])
  return { shiftHours: rates.shiftHours || 8, growthPct: Number(presets?.roster?.growth ?? 10) || 0 }
}

/** The in-house weekday history from the cached how-we-schedule picture; null when it has not been learned. */
async function weekdayHistory(): Promise<Record<string, Record<number, number>> | null> {
  try {
    const k = await getSetting<ScheduleKnowledge | null>(KNOWLEDGE_KEY, null)
    return k && k.week && k.week.demandInHouse ? k.week.demandInHouse : null
  } catch { return null }
}

/** Deep cleans and the like already in Breezeway for these days, per market|date, not done and not gone. */
async function deferrableWork(from: string, to: string): Promise<Record<string, number>> {
  const db = supabaseAdmin()
  const [tasks, listings, presets] = await Promise.all([
    db.from('breezeway_tasks_sync').select('reference_property_id,name,status,scheduled_date,finished_at')
      .eq('type_department', 'housekeeping').gte('scheduled_date', from).lte('scheduled_date', to).order('scheduled_date').order('id').limit(1000),
    db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(1000), // deliberate cap: one row per listing, ~290
    getOpsPresets().catch(() => null),
  ])
  if (tasks.error || listings.error) return {}
  const VENDOR = vendorRegex(presets?.vendorBuildings || [])
  const meta: Record<string, { market: string; vendor: boolean }> = {}
  for (const l of (listings.data || []) as any[]) {
    const name = str(l.nickname || l.title) || 'Unit'
    const building = str(l.building)
    meta[str(l.id)] = { market: String(marketOf(building, l.address_city, name) || 'Miami'), vendor: VENDOR.test(building) || VENDOR.test(name) }
  }
  const out: Record<string, number> = {}
  for (const t of (tasks.data || []) as any[]) {
    const nm = str(t.name)
    if (isDepartureCleanName(nm) || !DEFERRABLE.test(nm) || isTaskGone(t.status) || isTaskDone(t.status, t.finished_at)) continue
    const m = meta[str(t.reference_property_id)]
    if (!m || m.vendor) continue
    const k = m.market + '|' + str(t.scheduled_date).slice(0, 10)
    out[k] = (out[k] || 0) + 1
  }
  return out
}

/** A forecast day → the plan's input. */
function inputOf(d: StaffDay, hist: Record<string, Record<number, number>> | null, deferrable: Record<string, number>): PlanDayInput {
  const h = hist && hist[d.market] ? hist[d.market][dowIndex(d.date)] : undefined
  return {
    date: d.date, label: d.label, dow: d.dow, lead: d.lead, market: d.market,
    booked: d.booked, expected: d.expected, history: h == null ? null : Number(h),
    kpiHoursBooked: Number(d.kpiHours) || 0, hoursPerClean: Number(d.hoursPerClean) || 0,
    working: d.working, onCall: d.onCall, rosterKnown: d.rosterKnown,
    deferrable: deferrable[d.market + '|' + d.date] || 0,
  }
}

/** The plan days for a forecast already built — the ledger snapshot uses this so it records the same plan. */
export async function planDaysFromForecast(fc: StaffingForecast, s?: PlanSettings): Promise<{ days: PlanDay[]; settings: PlanSettings }> {
  const st = s || await settings()
  const hist = await weekdayHistory()
  return { days: fc.days.map(d => planDay(inputOf(d, hist, {}), st)), settings: st }
}

async function compute(from: string, days: number): Promise<NextWeekPlan> {
  const to = shift(from, days - 1)
  const notes: string[] = []
  const [fc, st, hist, deferrable, track] = await Promise.all([
    buildStaffingForecast({ from, days }),
    settings(),
    weekdayHistory(),
    deferrableWork(from, to).catch(() => { notes.push('deep cleans could not be read — no move suggestions'); return {} as Record<string, number> }),
    trackRecord('kpi_need', { days: 30 }).catch(() => null),
  ])
  if (!hist) notes.push('the how-we-schedule history is not learned yet — likely cleans use the pickup alone')
  const planDays = fc.days.map(d => planDay(inputOf(d, hist, deferrable), st))
  const moves = planMoves(planDays, 3)
  const basis = planBasis(st)
  return {
    ok: true, generatedAt: new Date().toISOString(), from, to, markets: FORECAST_MARKETS.slice(), settings: st,
    days: planDays, summary: summarize(planDays), moves, basis,
    text: planText(planDays, moves, ''),
    rosterPublishedThrough: fc.rosterPublishedThrough, pickupLearning: fc.pickup.learning,
    track: track && track.n ? { n: track.n, mae: track.mae, bias: track.bias, withinPct: track.withinPct } : null,
    notes: fc.notes.concat(notes),
  }
}

const cached = unstable_cache(compute, ['schedule-plan-v1'], { revalidate: 600, tags: ['forecast'] })

/**
 * The plan for `days` days (default 7, at most 14) starting `from` (default tomorrow, ET), cached ten
 * minutes. `market` narrows the days and the moves to one in-house market after the fact.
 */
export async function buildNextWeekPlan(opts: { from?: string; days?: number; market?: string | null } = {}): Promise<NextWeekPlan> {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.from)) ? str(opts.from) : shift(ymdET(), 1)
  const days = Math.max(1, Math.min(14, Math.round(Number(opts.days) || 7)))
  const plan = await cached(from, days)
  const mk = (FORECAST_MARKETS as readonly string[]).find(m => m.toLowerCase() === str(opts.market).trim().toLowerCase())
  if (!mk) return plan
  const mine = plan.days.filter(d => d.market === mk)
  const moves = planMoves(mine, 3)
  return { ...plan, markets: [mk], days: mine, summary: summarize(mine), moves, text: planText(mine, moves, '') }
}
