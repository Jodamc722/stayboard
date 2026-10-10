// THE SCHEDULER, IN SHADOW.
//
// Jon, 2026-09-28 (roadmap goals 1, 2 and 6: learn our schedule, find ways to optimize it,
// implement them): every evening Eve builds tomorrow's departure-clean assignments with the same
// suggester the Schedule page's popup uses (lib/schedule-suggest — fewer people, fuller days, one
// building per person, same-day turns first), and the evening after she scores that plan against
// what actually happened. Nobody is assigned anything. It is a projection, and it keeps its own
// scorecard, because the only credential worth having before she proposes real assignments is
// "my plan beat reality N days out of the last 14".
//
// THE SCORE, PER DAY — ON THE SAME CLEANS (audit 2026-09-28). The plan is built the evening before;
// cleans get added and cancelled after it. So the score only looks at the clean keys that are in
// BOTH the plan and what actually ran, and prices both assignments of those cleans with the same
// minutes and the same (assumed) travel model — two answers to one question. A plan WINS when:
//   - it used no more people than reality did for those cleans, and
//   - its travel was no more than 110% of reality's (+15 min), and
//   - it left no clean unassigned that reality found somebody for, and
//   - EVERY same-day turn in it lands before its check-in, on a timeline that starts at each
//     person's shift (Homebase) or 9:00 AM — the lands-at walk. "Fewer people" alone is the
//     suggester's own objective; a plan that gets there by landing a turn at 5pm has not won.
// Fewer people with fuller days is the thing Jon asked for ("I'd rather give somebody 4 cleans
// than bring in another person"); the travel bound stops the plan winning by stacking one person
// across three buildings; the coverage rule stops it winning by leaving work on the floor.
//
// READY when 10 of the last 14 scored days are wins. Until then the ops desk says nothing about
// assignments; once ready, the 7am plan carries her suggested assignments for the unowned cleans
// as a proposal, and the Sunday readout says the number. Nothing here ever writes to Breezeway.
//
// STATE lives in app_settings `eve_scheduler_shadow` — 21 days of {plan, score}, small JSON, no
// migration. A day with no cleans is not scored. An unscored plan keeps its per-clean detail (hub,
// position, minutes, check-in) so it can be scored fairly; the detail is dropped once it is.
import { shortUnit } from '@/lib/team-where'
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { getOpsPresets } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildSchedule } from '@/lib/schedule-build'
import { buildDayPicture } from '@/lib/capacity-day'
import { hopMinutes, PERFORMED_FLOOR_MIN, UNIT_OVERHEAD } from '@/lib/capacity'
import { projectLandings, clockOf } from '@/lib/lands-at'
import { isDepartureCleanName } from '@/lib/breezeway'
import { suggestSchedule, standardMinutes, loadFor, hubCentres, DEFAULT_CAPACITY_MIN, type SugClean, type SugPerson } from '@/lib/schedule-suggest'
import { matchRoster, personKey } from '@/lib/roster-match'
import { nameMatchesRoster } from '@/lib/person-name'
import { learnHabits, affinityFor, homeMarketFor, type Habits } from '@/lib/schedule-habits'
import { postToChannel } from '@/lib/slack'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { agentAllowed, stepDown } from './agent-mode'

export const SHADOW_KEY = 'eve_scheduler_shadow'
const KEEP_DAYS = 21
const READY_WINS = 10
const READY_WINDOW = 14
const ET = 'America/New_York'

const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(d)
const etHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false }).format(d)) % 24
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
const first = (n: string) => String(n || '').split(/\s+/)[0]
function marketFromRegion(r: string | null): string | null {
  const s = String(r || '').toLowerCase()
  if (/miami|17\s*west|arya|elser/.test(s)) return 'Miami'
  if (/broward|lauderdale|hollywood/.test(s)) return 'Broward'
  if (/north|palm|lake\s*worth|capri|lucerne/.test(s)) return 'North'
  return null
}

export type ShadowPlan = {
  date: string; builtAt: string
  cleans: number; peopleOnShift: number; peopleUsed: number; unassigned: number
  workMinutes: number; travelMinutes: number; maxLoadMinutes: number
  /** person name → the units, for the readout and the 7am suggestion. */
  byPerson: Record<string, string[]>
  /** clean key → person name (the plan itself), for the ops desk to propose. */
  assign: Record<string, string | null>
  /** clean key → Breezeway person id, for the weekly planner's Approve. */
  assignIds?: Record<string, number | null>
  /** clean key → unit / listing / current assignee ids, so a day can be pushed without re-reading —
      plus the detail the fair score needs, which is dropped once the day is scored. */
  cleansById?: Record<string, PlanClean>
  /** Person name → shift start from Homebase, ET minutes past midnight. Absent = 9:00 AM assumed. */
  startMin?: Record<string, number>
  /** People on the plan only because the roster has them Working / On Call (no Homebase shift). */
  rosterSeeded?: number
  /** The plan's own timeline: same-day turns it assigns, and any landing after check-in. */
  timeline?: { turns: number; late: { unit: string; person: string; lands: string; due: string }[] }
  why?: Record<string, string>
}
/** What the fair score needs to know about one planned clean. */
export type PlanClean = {
  listingId: string; unit: string; currentIds: number[]; sameDayTurn: boolean
  hub?: string; market?: string; lat?: number | null; lng?: number | null
  /** The minutes the suggester priced the clean at. */
  minutes?: number
  /** Same-day turn: when the arriving guest checks in, ET minutes past midnight. */
  due?: number | null
}
export type ShadowScore = {
  scoredAt: string
  actualPeople: number; actualTravel: number; actualWork: number; actualUnassigned: number
  win: boolean; why: string
  /** Cleans in both the plan and the day as it ran — the only ones scored. */
  common?: number
  /** Same-day turns the plan would have landed after check-in. */
  lateTurns?: number
}
type State = { days: Record<string, { plan: ShadowPlan; score?: ShadowScore }>; lastReadout?: string | null }

async function state(): Promise<State> {
  const v = await getSetting<any>(SHADOW_KEY, null)
  const days = (v && v.days && typeof v.days === 'object') ? v.days : {}
  // Keep the window small: the last KEEP_DAYS dates only.
  const keys = Object.keys(days).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k]
  // Only today's and tomorrow's plans can still be scored; a past plan's per-clean detail is dead weight.
  const todayKey = ymdET()
  for (const k of Object.keys(days)) if (k < todayKey && days[k] && days[k].plan) { delete days[k].plan.cleansById; delete days[k].plan.startMin }
  return { days, lastReadout: v?.lastReadout || null }
}

const sunOf = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10) }
/** "16:00" or "4:00 PM" → ET minutes past midnight; null when it cannot be read. */
function minutesOfClock(t: any): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(t || '').trim())
  if (!m) return null
  let h = Number(m[1]); const mi = Number(m[2]); const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h < 24 && mi < 60 ? h * 60 + mi : null
}
const sugOf = (key: string, c: PlanClean): SugClean => ({
  key, listingId: c.listingId, unit: c.unit, market: String(c.market || ''), hub: String(c.hub || 'Other'),
  lat: c.lat ?? null, lng: c.lng ?? null, bedrooms: null, sameDayTurn: !!c.sameDayTurn,
  minutes: Number(c.minutes) || 0, currentIds: c.currentIds || [],
})

/**
 * WHO THE ROSTER HAS ON, per date (audit 2026-09-28). `team_schedule` holds the human calls —
 * Working / On Call / OFF / REQ OFF — per Sunday week and market; Homebase shifts arrive through
 * the day picture. A week Homebase has not published used to come back "nobody rostered", because
 * only Homebase and the current assignees counted. Same reading of a cell as lib/team-roster.
 * Returns date → the names Working or On Call.
 */
export async function rosterOnDates(dates: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const d of dates) out[d] = []
  const weeks = Array.from(new Set(dates.map(sunOf)))
  if (!weeks.length) return out
  const { data, error } = await supabaseAdmin().from('team_schedule').select('week_start,market,doc').in('week_start', weeks).limit(60)
  if (error) return out
  for (const row of ((data || []) as any[])) {
    const cells = row && row.doc && row.doc.cells && typeof row.doc.cells === 'object' ? row.doc.cells : {}
    for (const k of Object.keys(cells)) {
      const cut = k.lastIndexOf('__')
      if (cut < 0) continue
      const name = k.slice(0, cut).trim(), date = k.slice(cut + 2)
      if (!name || !out[date]) continue
      const v = String(cells[k] || '').trim()
      const onCall = /on.?call/i.test(v)
      if (!v || (!onCall && (/req/i.test(v) || /off/i.test(v)))) continue
      if (out[date].indexOf(name) < 0) out[date].push(name)
    }
  }
  return out
}

/**
 * DOES EVERY SAME-DAY TURN LAND BEFORE ITS GUEST? (audit 2026-09-28.) Each person's cleans are
 * walked the way lib/lands-at walks the live board — from their shift start (9:00 AM when Homebase
 * has none), same-day turns first in check-in order, then the rest — each stop priced as the
 * capacity model prices it on the board: the clean, prep and wrap, the day's load-up on the first
 * stop, and the hop between buildings after it. "Lands late" here means what it means on the board.
 */
function planTimeline(keys: string[], assign: Record<string, string | null>, detail: Record<string, PlanClean>, startMin: Record<string, number>): NonNullable<ShadowPlan['timeline']> {
  const byPerson: Record<string, string[]> = {}
  for (const k of keys) { const who = assign[k]; if (who && detail[k]) (byPerson[who] = byPerson[who] || []).push(k) }
  const centres = hubCentres(keys.filter(k => detail[k]).map(k => sugOf(k, detail[k])))
  const people: any[] = []
  for (const who of Object.keys(byPerson)) {
    const mine = byPerson[who].slice().sort((a, b) => {
      const A = detail[a], B = detail[b]
      const ta = A.sameDayTurn ? 0 : 1, tb = B.sameDayTurn ? 0 : 1
      if (ta !== tb) return ta - tb
      return ta === 0 ? (A.due ?? 960) - (B.due ?? 960) : String(A.hub || '').localeCompare(String(B.hub || ''))
    })
    let prev: string | null = null
    const units = mine.map(k => {
      const c = detail[k], hub = String(c.hub || 'Other')
      const travel = prev == null ? UNIT_OVERHEAD.dayStartMin : hopMinutes({ building: prev, ...(centres[prev] || {}) }, { building: hub, ...(centres[hub] || {}) })
      prev = hub
      return { id: k, totalMin: Math.round(travel + UNIT_OVERHEAD.prepMin + (Number(c.minutes) || 0) + UNIT_OVERHEAD.wrapMin) }
    })
    people.push({ person: who, units, shiftStartMin: startMin[who] ?? null, verdict: 'balanced' })
  }
  const landings = projectLandings(people, { nowMin: 0 })
  let turns = 0
  const late: NonNullable<ShadowPlan['timeline']>['late'] = []
  for (const k of keys) {
    const c = detail[k]
    if (!c || !c.sameDayTurn || !assign[k]) continue
    turns++
    const L = landings[k], due = c.due ?? 960
    if (L && L.endMin > due) late.push({ unit: shortUnit(String(c.unit)), person: L.person, lands: clockOf(L.endMin), due: clockOf(due) })
  }
  return { turns, late }
}

export type ProjectOpts = {
  /** The last 30 days of habits, learned ONCE by a caller planning several days. */
  habits?: Habits | null
  /** The roster's Working / On Call names for this date, when the caller already read them. */
  rosterOn?: string[] | null
}

/** Build tomorrow's plan from the schedule and who is on shift. Writes nothing to Breezeway. */
export async function projectDay(date: string, opts: ProjectOpts = {}): Promise<ShadowPlan | null> {
  const [sch, picture, presets, rosterOn] = await Promise.all([
    buildSchedule('day', date),
    buildDayPicture(date).catch(() => null),
    getOpsPresets().catch(() => ({} as any)),
    opts.rosterOn ? Promise.resolve(opts.rosterOn) : rosterOnDates([date]).then(r => r[date] || []).catch(() => [] as string[]),
  ])
  if (!sch?.ok) return null
  const day = (sch.days || [])[0]
  const all: any[] = day ? (Object.values(day.markets || {}).flat() as any[]) : []
  const usable = all.filter(c => !c.movedTo && !c.ghost && !c.vendor && !c.guestyOnly && !c.blocked)
  if (!usable.length) return null
  const cleans: SugClean[] = usable.map(c => ({
    key: `${c.listingId}__${c.date}`, listingId: String(c.listingId), unit: String(c.unit), market: String(c.market || ''), hub: c.hub || 'Other',
    lat: c.lat ?? null, lng: c.lng ?? null, bedrooms: c.bedrooms ?? null, sameDayTurn: !!c.sameDayTurn,
    // A recorded time under an hour was a close-out, not a clean (lib/capacity's floor) — standard instead.
    minutes: Number(c.cleanMinutes) >= PERFORMED_FLOOR_MIN ? Number(c.cleanMinutes) : standardMinutes(c.bedrooms, c.market),
    currentIds: Array.isArray(c.assignedIds) ? c.assignedIds : [],
  }))
  // When each same-day turn's guest arrives: the unit's own check-in time, else the board's deadline.
  const deadline = Number(presets?.timing?.deadlineMin) > 0 ? Number(presets.timing.deadlineMin) : 960
  const dueOf: Record<string, number> = {}
  for (const c of usable) if (c.sameDayTurn) dueOf[`${c.listingId}__${c.date}`] = minutesOfClock(c.checkInTime) ?? deadline
  const hk: { id: number; name: string; region: string | null }[] = Array.isArray(sch.housekeepers) ? sch.housekeepers : []
  const nc: Record<string, string> = presets?.roster?.nonCleaners || {}
  const roleOf = (name: string): 'cleaner' | 'supervisor' | 'other' => {
    const f = personKey(first(name))
    for (const [k, v] of Object.entries(nc)) if (personKey(k) === f) return /supervis/i.test(String(v)) ? 'supervisor' : 'other'
    return 'cleaner'
  }
  const caps: Record<number, number> = {}
  const starts: Record<number, number> = {}
  const on = new Set<number>()
  for (const p of (picture?.people || [])) {
    const m = matchRoster(hk, String(p.person || ''))
    if (!m.ok) continue
    on.add(m.id)
    if (Number(p.capacityMinutes) > 0) caps[m.id] = Math.round(Number(p.capacityMinutes))
    if (Number(p.shiftStartMin) > 0) starts[m.id] = Number(p.shiftStartMin)
  }
  for (const c of cleans) for (const id of c.currentIds) if (hk.some(h => h.id === id)) on.add(id)
  // THE ROSTER, WHERE HOMEBASE HAS NO SHIFT (audit 2026-09-28). Somebody the Turnover Schedule roster
  // has Working or On Call that day joins at a standard day's capacity. Homebase wins where present:
  // anyone it has on shift is already in, with their real hours.
  let rosterSeeded = 0
  if (rosterOn.length) {
    for (const h of hk) {
      if (on.has(h.id) || !nameMatchesRoster(h.name, rosterOn)) continue
      on.add(h.id); rosterSeeded++
    }
  }
  if (!on.size) return null
  // From scratch, not "keep current": the point is what SHE would do with the same people — with the
  // last 30 days of habits as a tie-breaker (Jon, 2026-09-28: "go back 30 days to learn how we schedule").
  // A caller planning a week passes the habits in, learned once — not relearned for every day.
  // The same 30 days say which market each person belongs to (Jon, 2026-10-05: "putting Broward
  // staff in Miami"); the Breezeway region only stands in for someone with no history.
  let affinity: Record<number, Record<string, number>> = {}
  let home: Record<number, string> = {}
  try {
    const habits = opts.habits !== undefined ? opts.habits : await learnHabits(30)
    affinity = habits ? affinityFor(habits, hk) : {}
    home = habits ? homeMarketFor(habits, hk) : {}
  } catch { affinity = {}; home = {} }
  const people: SugPerson[] = Array.from(on).map(id => { const p = hk.find(h => h.id === id); return { id, name: p?.name || String(id), market: home[id] || marketFromRegion(p?.region || null), capacityMin: caps[id] || DEFAULT_CAPACITY_MIN, role: roleOf(p?.name || '') } })
  const sug = suggestSchedule(cleans, people, { keepCurrent: false, targetCleans: 4, overtimeMin: 60, affinity })
  const centres = hubCentres(cleans)
  const byPerson: Record<string, string[]> = {}
  const assign: Record<string, string | null> = {}
  const assignIds: Record<string, number | null> = {}
  const cleansById: NonNullable<ShadowPlan['cleansById']> = {}
  const startMin: Record<string, number> = {}
  for (const p of people) if (starts[p.id]) startMin[p.name] = starts[p.id]
  const mine: Record<number, SugClean[]> = {}
  let unassigned = 0
  for (const c of cleans) {
    cleansById[c.key] = {
      listingId: c.listingId, unit: String(c.unit), currentIds: c.currentIds, sameDayTurn: c.sameDayTurn,
      hub: c.hub, market: c.market, lat: c.lat, lng: c.lng, minutes: Math.round(c.minutes), due: c.sameDayTurn ? (dueOf[c.key] ?? deadline) : null,
    }
    const pid = sug.assign[c.key]
    assignIds[c.key] = pid == null ? null : pid
    if (pid == null) { unassigned++; assign[c.key] = null; continue }
    const p = people.find(x => x.id === pid)
    assign[c.key] = p?.name || null
    ;(byPerson[p?.name || String(pid)] = byPerson[p?.name || String(pid)] || []).push(shortUnit(String(c.unit)))
    ;(mine[pid] = mine[pid] || []).push(c)
  }
  let work = 0, travel = 0, maxLoad = 0
  for (const pid of Object.keys(mine)) { const l = loadFor(mine[Number(pid)], centres); work += l.work; travel += l.travel; maxLoad = Math.max(maxLoad, l.minutes) }
  const timeline = planTimeline(cleans.map(c => c.key), assign, cleansById, startMin)
  return { date, builtAt: new Date().toISOString(), cleans: cleans.length, peopleOnShift: people.length, peopleUsed: Object.keys(mine).length, unassigned, workMinutes: Math.round(work), travelMinutes: Math.round(travel), maxLoadMinutes: Math.round(maxLoad), byPerson, assign, assignIds, cleansById, startMin, rosterSeeded, timeline, why: sug.why }
}

/**
 * Score a plan against the day as it actually ran — on the SAME cleans (audit 2026-09-28). Reads the
 * day's departure cleans and who held each; keeps only the keys in both the plan and the day; prices
 * both assignments of those cleans with the same minutes and the same travel model; and walks the
 * plan's same-day turns against their check-ins. Null when there is nothing fair to score (a plan
 * saved before it carried per-clean detail, or no planned clean ran).
 */
export async function scoreDay(plan: ShadowPlan): Promise<ShadowScore | null> {
  const detail = plan.cleansById || {}
  const planKeys = Object.keys(plan.assign || {}).filter(k => detail[k] && detail[k].minutes != null)
  if (!planKeys.length) return null
  const { data, error } = await supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,assignees').eq('scheduled_date', plan.date).order('id').limit(1000) // deliberate cap: one day's Breezeway tasks (~90 a day portfolio-wide)
  if (error) return null
  // WHAT RAN: every departure clean on the day (not cancelled) and the names on it.
  const ran: Record<string, string[]> = {}
  for (const t of ((data || []) as any[])) {
    if (!isDepartureCleanName(t.name) || /delete|cancel/i.test(String(t.status || ''))) continue
    const key = `${t.reference_property_id}__${plan.date}`
    const names = (Array.isArray(t.assignees) ? t.assignees : [])
      .map((a: any) => String(a && typeof a === 'object' ? (a.name || '') : (a || '')).replace(/\s+/g, ' ').trim()).filter(Boolean)
    const had = ran[key] || []
    for (const n of names) if (had.indexOf(n) < 0) had.push(n)
    ran[key] = had
  }
  const common = planKeys.filter(k => ran[k] !== undefined)
  if (!common.length) return null
  const centres = hubCentres(common.map(k => sugOf(k, detail[k])))
  // The plan's assignment of those cleans…
  const planBy: Record<string, SugClean[]> = {}
  let planUnassigned = 0
  for (const k of common) {
    const who = plan.assign[k]
    if (!who) { planUnassigned++; continue }
    (planBy[who] = planBy[who] || []).push(sugOf(k, detail[k]))
  }
  // …and reality's. Everyone on a clean was out that day; a shared clean is priced on its first name.
  const actBy: Record<string, SugClean[]> = {}
  const actPeople = new Set<string>()
  let actualUnassigned = 0
  for (const k of common) {
    const names = ran[k]
    if (!names.length) { actualUnassigned++; continue }
    for (const n of names) actPeople.add(personKey(n))
    const lead = personKey(names[0])
    ;(actBy[lead] = actBy[lead] || []).push(sugOf(k, detail[k]))
  }
  let planTravel = 0, actTravel = 0
  for (const who of Object.keys(planBy)) planTravel += loadFor(planBy[who], centres).travel
  for (const who of Object.keys(actBy)) actTravel += loadFor(actBy[who], centres).travel
  const planPeople = Object.keys(planBy).length, actualPeople = actPeople.size
  const actualTravel = Math.round(actTravel), planTravelR = Math.round(planTravel)
  const actualWork = Math.round(common.reduce((a, k) => a + (Number(detail[k].minutes) || 0), 0))
  const tl = planTimeline(common, plan.assign, detail, plan.startMin || {})
  const fewer = planPeople <= actualPeople
  const travelOk = planTravelR <= actualTravel * 1.1 + 15
  const covered = planUnassigned <= actualUnassigned
  const onTime = tl.late.length === 0
  const win = fewer && travelOk && covered && onTime
  const why = [
    `people ${planPeople} vs ${actualPeople}${fewer ? ' ✓' : ' ✗'}`,
    `travel ${planTravelR}m vs ${actualTravel}m${travelOk ? ' ✓' : ' ✗'}`,
    `unassigned ${planUnassigned} vs ${actualUnassigned}${covered ? ' ✓' : ' ✗'}`,
    tl.turns ? `same-day turns on time ${tl.turns - tl.late.length}/${tl.turns}${onTime ? ' ✓' : ' ✗'}` : 'no same-day turns',
    `scored on ${common.length} of ${planKeys.length} planned cleans`,
  ].join(' · ')
  return { scoredAt: new Date().toISOString(), actualPeople, actualTravel, actualWork, actualUnassigned, win, why, common: common.length, lateTurns: tl.late.length }
}

export type Readiness = { scored: number; wins: number; ready: boolean; window: number; needed: number; lastPlan: ShadowPlan | null }
export async function shadowReadiness(): Promise<Readiness> {
  const st = await state()
  // Only days scored on the fair terms count (a score carries `common` since 2026-09-28): the earlier
  // score judged the plan by its own objective and must not be what makes her "ready".
  const scored = Object.values(st.days).filter(d => d.score && d.score.common != null).sort((a, b) => (a.plan.date < b.plan.date ? 1 : -1)).slice(0, READY_WINDOW)
  const wins = scored.filter(d => d.score!.win).length
  const today = ymdET()
  const lastPlan = st.days[today]?.plan || null
  return { scored: scored.length, wins, ready: scored.length >= READY_WINDOW && wins >= READY_WINS, window: READY_WINDOW, needed: READY_WINS, lastPlan }
}

export type ShadowRun = { ok: boolean; skipped?: string; scored?: string; projected?: string; readout?: string; notes: string[] }

/** Evening pass: score today, project tomorrow; Sunday, the readout. Idempotent per day. */
export async function runSchedulerShadow(opts: { force?: boolean; preview?: boolean } = {}): Promise<ShadowRun> {
  const out: ShadowRun = { ok: true, notes: [] }
  const now = new Date(), h = etHour(now), today = ymdET(now), tomorrow = shift(today, 1)
  if (!opts.force && (h < 20 || h > 23)) return { ...out, skipped: `evening pass runs 8–11pm ET (now ${h}:00)` }
  const st = await state()
  try {
    const todayRec = st.days[today]
    if (todayRec && !todayRec.score) {
      // A plan saved before it carried per-clean detail cannot be scored fairly — it is left out
      // of the scorecard rather than scored on the old, self-referential terms.
      const s = todayRec.plan.cleansById ? await scoreDay(todayRec.plan) : null
      if (s) {
        todayRec.score = s; out.scored = `${today}: ${s.win ? 'WIN' : 'loss'} — ${s.why}`
        // Scored: the per-clean detail has done its job — keep the state small.
        delete todayRec.plan.cleansById; delete todayRec.plan.startMin
      }
      else out.notes.push(todayRec.plan.cleansById ? `${today}: nothing to score yet` : `${today}: plan predates the fair score — not counted`)
    }
    if (!st.days[tomorrow] || opts.force) {
      const plan = await projectDay(tomorrow)
      if (plan) {
        // Kept WITH its per-clean detail until it is scored tomorrow evening; only the popup's
        // per-clean reasons are dropped.
        const { why: _w, ...keep } = plan
        st.days[tomorrow] = { plan: keep as ShadowPlan }
        out.projected = `${tomorrow}: ${plan.cleans} cleans → ${plan.peopleUsed} of ${plan.peopleOnShift} people, ${plan.unassigned} unassigned, travel ${plan.travelMinutes}m` +
          (plan.timeline && plan.timeline.late.length ? `, ${plan.timeline.late.length} same-day turn${plan.timeline.late.length === 1 ? '' : 's'} would land late` : '') +
          (plan.rosterSeeded ? `, ${plan.rosterSeeded} from the roster (no Homebase shift)` : '')
      }
      else out.notes.push(`${tomorrow}: no cleans or nobody on shift — no plan`)
    }
    // Sunday readout in #vr-eve.
    const dow = new Date(today + 'T12:00:00Z').getUTCDay()
    if ((dow === 0 || opts.force) && st.lastReadout !== today && !opts.preview) {
      const r = await shadowReadiness()
      const recent = Object.values(st.days).filter(d => d.score && d.score.common != null).sort((a, b) => (a.plan.date < b.plan.date ? 1 : -1)).slice(0, 7)
      const text = `*Shadow scheduler — week's scorecard*\nMy plan beat the real schedule on ${recent.filter(d => d.score!.win).length} of ${recent.length} days this week (${r.wins} of the last ${r.scored} overall; ${r.needed} of ${r.window} makes me ready to propose).\n` +
        recent.map(d => `• ${d.plan.date}: ${d.score!.win ? '✓' : '✗'} ${d.score!.why}`).join('\n') +
        (r.ready ? `\n*Ready.* From tomorrow the 7am plan carries my suggested assignments for the unowned cleans; nothing is assigned without a ✅.` : `\nStill learning — no assignments proposed yet.`)
      const gate = await agentAllowed('slack_post', { ask: true })
      const rr = await stepDown(gate, { action: 'slack_post', summary: `shadow scheduler weekly readout (${r.wins}/${r.scored})`, exec: { channel: EVE_CHANNELS.approvals, channel_name: 'vr-eve', text }, by: 'cron:scheduler-shadow' },
        async () => { const p = await postToChannel(EVE_CHANNELS.approvals, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
      if (rr.ok && rr.mode !== 'observe') { st.lastReadout = today; out.readout = rr.mode }
      else out.notes.push(`readout: ${rr.error || gate.reason}`)
    }
  } catch (e: any) { out.ok = false; out.notes.push(String(e?.message || e).slice(0, 160)) }
  if (!opts.preview) await setSetting(SHADOW_KEY, st, 'scheduler-shadow').catch(() => {})
  return out
}
