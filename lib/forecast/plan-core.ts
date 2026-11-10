// THE NEXT-WEEK PLAN — the arithmetic, with no imports (owner, 2026-11-10: "start building preemptive
// scheduling … gather the info and break it down in a way that's useful and directional and
// manageable").
//
// lib/forecast/plan.ts reads the data (the staffing forecast, the clean rates, the how-we-schedule
// profile, deferrable Breezeway work); this file only turns those numbers into a plan, so it can be
// tested with plain node (lib/forecast/__tests__/schedule-plan.test.mjs) and so the Scheduler panel, Eve's
// schedule_plan tool, the Sunday shadow readout and the ledger all compute ONE plan.
//
// THE KPI BASIS IS THE SCHEDULER RAIL'S, WORD FOR WORD (components/ScheduleBoard.tsx staffingFor):
//   KPI hours   = each booked clean's expected labor cost ÷ pay per hour, summed
//   Projected   = cleans still likely to book (likely − booked) × the market's hours per clean
//   Target      = KPI hours + projected + the growth buffer (% of those two)
//   Needed      = Target ÷ one shift, rounded up once, a quarter-hour of slack
//   Scheduled   = cleaners Working that day × one shift (on-call shown, not counted)
//   Gap         = Scheduled − Target (negative = short)
// The one difference: "likely" for a future day is the larger of the learned pickup (booked × the
// pickup factor for that lead time) and the weekday's own history, where the rail uses history alone.

export type PlanVerdict = 'short' | 'ok' | 'over' | 'unknown' | 'none'

export type PlanDayInput = {
  date: string
  /** "Sat Nov 15" */
  label: string
  /** "Sat" */
  dow: string
  lead: number
  market: string
  /** Confirmed checkouts on the books now (vendor buildings out). */
  booked: number
  /** booked × the learned pickup factor. */
  expected: number
  /** Average in-house departure cleans on this weekday over the history window; null when not learned. */
  history: number | null
  /** KPI hours of the booked cleans, each priced at its expected labor cost ÷ pay per hour. */
  kpiHoursBooked: number
  /** The market's KPI hours per clean, for pricing cleans not booked yet. */
  hoursPerClean: number
  working: number
  onCall: number
  /** False past the last day Homebase has published. */
  rosterKnown: boolean
  /** Housekeeping work on the day that is not a turnover and could move (deep cleans and the like). */
  deferrable?: number
  /** Same-day turns booked (a checkout and an arrival in the same unit that day). */
  sameDay?: number
}

export type PlanSettings = { shiftHours: number; growthPct: number }

export type PlanDay = PlanDayInput & {
  likely: number
  projCleans: number
  kpiH: number
  projH: number
  bufferH: number
  targetH: number
  schedH: number
  need: number
  /** need − working, when the roster is known; 0 otherwise. Positive = people short. */
  short: number
  /** schedH − targetH (negative = short), hours. */
  gapH: number
  verdict: PlanVerdict
}

export type PlanMoveKind = 'call_in' | 'move' | 'add' | 'publish' | 'release'
export type PlanMove = { kind: PlanMoveKind; market: string; date: string | null; text: string; why: string }

const r60 = (h: number) => Math.round(h * 60) / 60
const r1 = (n: number) => Math.round(n * 10) / 10

/** One market-day on the rail's KPI basis. */
export function planDay(i: PlanDayInput, s: PlanSettings): PlanDay {
  const shiftH = s.shiftHours > 0 ? s.shiftHours : 8
  const hist = i.history != null && Number.isFinite(i.history) ? Math.round(i.history) : 0
  // Today is what is booked; a later day can still pick up — the larger of the two readings.
  const likely = i.lead <= 0 ? i.booked : Math.max(i.booked, Math.round(i.expected), hist)
  const projCleans = Math.max(0, likely - i.booked)
  const kpiH = r60(i.kpiHoursBooked)
  const projH = r60(projCleans * (i.hoursPerClean > 0 ? i.hoursPerClean : 0))
  const hours = kpiH + projH
  const bufferH = r60(hours * (Number(s.growthPct) || 0) / 100)
  const targetH = hours + bufferH
  const need = targetH > 0 ? Math.max(1, Math.ceil((targetH - 0.25) / shiftH)) : 0
  const schedH = i.working * shiftH
  const verdict: PlanVerdict = likely === 0 ? 'none'
    : !i.rosterKnown ? 'unknown'
      : need > i.working ? 'short'
        : schedH - targetH >= shiftH ? 'over' : 'ok'
  return {
    ...i, likely, projCleans, kpiH, projH, bufferH, targetH: r60(targetH), schedH, need,
    short: i.rosterKnown ? Math.max(0, need - i.working) : 0,
    gapH: r60(schedH - targetH), verdict,
  }
}

const fmtH = (h: number) => { const m = Math.round(Math.abs(h) * 60); const hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + 'h' : '') + (mm ? (hh ? ' ' : '') + mm + 'm' : (hh ? '' : '0h')) }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * One to three moves, soonest and biggest first. Each is something a person can do on the Scheduler
 * or in Homebase today; nothing is done for them.
 *   short day   → call in the on-call people first; move deferrable work to the day with the most
 *                 spare hours in the same market; whatever is still short is "add N cleaners"
 *   no roster   → publish Homebase for those days, with how many each needs
 *   over a shift → release one or pull work forward (said only when nothing is short)
 */
export function planMoves(days: PlanDay[], max = 3): PlanMove[] {
  const out: PlanMove[] = []
  const short = days.filter(d => d.verdict === 'short').sort((a, b) => a.date.localeCompare(b.date) || b.short - a.short)
  for (const d of short) {
    let left = d.short
    if (d.onCall > 0 && left > 0) {
      const n = Math.min(d.onCall, left)
      out.push({ kind: 'call_in', market: d.market, date: d.date, text: `Confirm ${plural(n, 'on-call cleaner')} for ${d.dow} in ${d.market}`, why: `${d.dow} needs ${d.need} on the KPI and ${d.working} are working; ${d.onCall} on call.` })
      left -= n
    }
    if (left > 0 && (d.deferrable || 0) > 0) {
      const spare = days.filter(x => x.market === d.market && x.date !== d.date && x.rosterKnown && x.gapH > 0 && x.verdict !== 'short')
        .sort((a, b) => b.gapH - a.gapH)[0]
      if (spare) {
        const n = Math.min(d.deferrable || 0, Math.max(1, Math.floor(spare.gapH / Math.max(1, d.hoursPerClean || 2))))
        out.push({ kind: 'move', market: d.market, date: d.date, text: `Move ${plural(n, 'deep clean')} in ${d.market} from ${d.dow} to ${spare.dow}`, why: `${d.dow} is short ${fmtH(-d.gapH)} on the KPI; ${spare.dow} has ${fmtH(spare.gapH)} spare.` })
      }
    }
    if (left > 0) out.push({ kind: 'add', market: d.market, date: d.date, text: `Add ${plural(left, 'cleaner')} ${d.dow} in ${d.market}`, why: `${d.likely} cleans likely (${d.booked} booked) = ${fmtH(d.targetH)} on the KPI; ${d.working} working = ${fmtH(d.schedH)}.` })
  }
  const unknown = days.filter(d => d.verdict === 'unknown' && d.need > 0)
  if (unknown.length) {
    const byMarket: Record<string, PlanDay[]> = {}
    for (const d of unknown) (byMarket[d.market] = byMarket[d.market] || []).push(d)
    for (const mk of Object.keys(byMarket)) {
      const ds = byMarket[mk].sort((a, b) => a.date.localeCompare(b.date))
      out.push({ kind: 'publish', market: mk, date: ds[0].date, text: `Publish Homebase for ${mk} ${ds[0].dow}${ds.length > 1 ? '–' + ds[ds.length - 1].dow : ''}: needs ${ds.map(d => d.need).join(', ')}`, why: `No shifts are published for ${ds.length === 1 ? 'that day' : 'those days'} yet, so nobody can tell whether ${ds.length === 1 ? 'it is' : 'they are'} staffed.` })
    }
  }
  if (!short.length) {
    const over = days.filter(d => d.verdict === 'over').sort((a, b) => a.gapH - b.gapH).reverse()
    for (const d of over.slice(0, 1)) {
      const n = Math.floor(d.gapH / (d.schedH && d.working ? d.schedH / d.working : 8))
      if (n > 0) out.push({ kind: 'release', market: d.market, date: d.date, text: `${d.dow} in ${d.market} is over by ${plural(n, 'cleaner')} — release ${n === 1 ? 'one' : n} or pull deep cleans forward`, why: `${d.working} working = ${fmtH(d.schedH)} against ${fmtH(d.targetH)} on the KPI.` })
    }
  }
  return out.slice(0, Math.max(1, max))
}

export type PlanSummary = {
  days: number
  shortDays: number
  peopleShort: number
  unknownDays: number
  kpiH: number
  schedH: number
  /** The one line: "2 short days next week: Broward Sat (−1), Miami Sun (−2)" or "Staffed to the KPI for the next 7 days". */
  headline: string
}

export function summarize(days: PlanDay[]): PlanSummary {
  const short = days.filter(d => d.verdict === 'short')
  const unknown = days.filter(d => d.verdict === 'unknown' && d.need > 0)
  const dates = Array.from(new Set(days.map(d => d.date)))
  const known = days.filter(d => d.rosterKnown)
  const kpiH = r1(known.reduce((a, d) => a + d.targetH, 0))
  const schedH = r1(known.reduce((a, d) => a + d.schedH, 0))
  const headline = short.length
    ? `${plural(short.length, 'short day')} in the next ${dates.length}: ${short.slice(0, 4).map(d => `${d.market} ${d.dow} (−${d.short})`).join(', ')}${short.length > 4 ? '…' : ''}`
    : unknown.length
      ? `Nothing short where the roster is out; ${plural(new Set(unknown.map(d => d.date)).size, 'day')} still need${new Set(unknown.map(d => d.date)).size === 1 ? 's' : ''} a published roster`
      : `Staffed to the KPI for the next ${dates.length} days`
  return { days: dates.length, shortDays: short.length, peopleShort: short.reduce((a, d) => a + d.short, 0), unknownDays: new Set(unknown.map(d => d.date)).size, kpiH, schedH, headline }
}

/** The plan as a few lines — for Slack readouts, Reports and Eve. Under ~120 words. */
export function planText(days: PlanDay[], moves: PlanMove[], basis: string): string {
  const s = summarize(days)
  const lines: string[] = [s.headline + '.']
  if (moves.length) lines.push(moves.map((m, i) => `${i + 1}. ${m.text}`).join('\n'))
  lines.push(`KPI basis: ${s.kpiH}h expected labor vs ${s.schedH}h scheduled on the days Homebase has published.${basis ? ' ' + basis : ''}`)
  return lines.join('\n')
}
