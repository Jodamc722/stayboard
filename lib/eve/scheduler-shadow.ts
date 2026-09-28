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
// THE SCORE, PER DAY. A plan WINS when, for the same cleans:
//   - it used no more people than were actually used, and
//   - its travel minutes were no more than 110% of the actual travel, and
//   - it left no clean unassigned that reality found somebody for.
// Fewer people with fuller days is the thing Jon asked for ("I'd rather give somebody 4 cleans
// than bring in another person"); the travel bound stops the plan winning by stacking one person
// across three buildings; the coverage rule stops it winning by leaving work on the floor.
//
// READY when 10 of the last 14 scored days are wins. Until then the ops desk says nothing about
// assignments; once ready, the 7am plan carries her suggested assignments for the unowned cleans
// as a proposal, and the Sunday readout says the number. Nothing here ever writes to Breezeway.
//
// STATE lives in app_settings `eve_scheduler_shadow` — 21 days of {plan, score}, small JSON, no
// migration. A day with no cleans is not scored.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { getOpsPresets } from '@/lib/app-settings'
import { buildSchedule } from '@/lib/schedule-build'
import { buildDayPicture } from '@/lib/capacity-day'
import { suggestSchedule, standardMinutes, loadFor, hubCentres, DEFAULT_CAPACITY_MIN, type SugClean, type SugPerson } from '@/lib/schedule-suggest'
import { matchRoster, personKey } from '@/lib/roster-match'
import { learnHabits, affinityFor } from '@/lib/schedule-habits'
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
  /** clean key → unit / listing / current assignee ids, so a day can be pushed without re-reading. */
  cleansById?: Record<string, { listingId: string; unit: string; currentIds: number[]; sameDayTurn: boolean }>
  why?: Record<string, string>
}
export type ShadowScore = {
  scoredAt: string
  actualPeople: number; actualTravel: number; actualWork: number; actualUnassigned: number
  win: boolean; why: string
}
type State = { days: Record<string, { plan: ShadowPlan; score?: ShadowScore }>; lastReadout?: string | null }

async function state(): Promise<State> {
  const v = await getSetting<any>(SHADOW_KEY, null)
  const days = (v && v.days && typeof v.days === 'object') ? v.days : {}
  // Keep the window small: the last KEEP_DAYS dates only.
  const keys = Object.keys(days).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k]
  return { days, lastReadout: v?.lastReadout || null }
}

/** Build tomorrow's plan from the schedule and who is on shift. Writes nothing to Breezeway. */
export async function projectDay(date: string): Promise<ShadowPlan | null> {
  const [sch, picture, presets] = await Promise.all([
    buildSchedule('day', date),
    buildDayPicture(date).catch(() => null),
    getOpsPresets().catch(() => ({} as any)),
  ])
  if (!sch?.ok) return null
  const day = (sch.days || [])[0]
  const all: any[] = day ? (Object.values(day.markets || {}).flat() as any[]) : []
  const usable = all.filter(c => !c.movedTo && !c.ghost && !c.vendor && !c.guestyOnly && !c.blocked)
  if (!usable.length) return null
  const cleans: SugClean[] = usable.map(c => ({
    key: `${c.listingId}__${c.date}`, listingId: String(c.listingId), unit: String(c.unit), market: String(c.market || ''), hub: c.hub || 'Other',
    lat: c.lat ?? null, lng: c.lng ?? null, bedrooms: c.bedrooms ?? null, sameDayTurn: !!c.sameDayTurn,
    minutes: c.cleanMinutes || standardMinutes(c.bedrooms, c.market), currentIds: Array.isArray(c.assignedIds) ? c.assignedIds : [],
  }))
  const hk: { id: number; name: string; region: string | null }[] = Array.isArray(sch.housekeepers) ? sch.housekeepers : []
  const nc: Record<string, string> = presets?.roster?.nonCleaners || {}
  const roleOf = (name: string): 'cleaner' | 'supervisor' | 'other' => {
    const f = personKey(first(name))
    for (const [k, v] of Object.entries(nc)) if (personKey(k) === f) return /supervis/i.test(String(v)) ? 'supervisor' : 'other'
    return 'cleaner'
  }
  const caps: Record<number, number> = {}
  const on = new Set<number>()
  for (const p of (picture?.people || [])) {
    const m = matchRoster(hk, String(p.person || ''))
    if (!m.ok) continue
    on.add(m.id)
    if (Number(p.capacityMinutes) > 0) caps[m.id] = Math.round(Number(p.capacityMinutes))
  }
  for (const c of cleans) for (const id of c.currentIds) if (hk.some(h => h.id === id)) on.add(id)
  const people: SugPerson[] = Array.from(on).map(id => { const p = hk.find(h => h.id === id); return { id, name: p?.name || String(id), market: marketFromRegion(p?.region || null), capacityMin: caps[id] || DEFAULT_CAPACITY_MIN, role: roleOf(p?.name || '') } })
  if (!people.length) return null
  // From scratch, not "keep current": the point is what SHE would do with the same people — with the
  // last 30 days of habits as a tie-breaker (Jon, 2026-09-28: "go back 30 days to learn how we schedule").
  let affinity: Record<number, Record<string, number>> = {}
  try { affinity = affinityFor(await learnHabits(30), hk) } catch { affinity = {} }
  const sug = suggestSchedule(cleans, people, { keepCurrent: false, targetCleans: 4, overtimeMin: 60, affinity })
  const centres = hubCentres(cleans)
  const byPerson: Record<string, string[]> = {}
  const assign: Record<string, string | null> = {}
  const assignIds: Record<string, number | null> = {}
  const cleansById: NonNullable<ShadowPlan['cleansById']> = {}
  const mine: Record<number, SugClean[]> = {}
  let unassigned = 0
  for (const c of cleans) {
    cleansById[c.key] = { listingId: c.listingId, unit: String(c.unit), currentIds: c.currentIds, sameDayTurn: c.sameDayTurn }
    const pid = sug.assign[c.key]
    assignIds[c.key] = pid == null ? null : pid
    if (pid == null) { unassigned++; assign[c.key] = null; continue }
    const p = people.find(x => x.id === pid)
    assign[c.key] = p?.name || null
    ;(byPerson[p?.name || String(pid)] = byPerson[p?.name || String(pid)] || []).push(String(c.unit).split(' - ')[0])
    ;(mine[pid] = mine[pid] || []).push(c)
  }
  let work = 0, travel = 0, maxLoad = 0
  for (const pid of Object.keys(mine)) { const l = loadFor(mine[Number(pid)], centres); work += l.work; travel += l.travel; maxLoad = Math.max(maxLoad, l.minutes) }
  return { date, builtAt: new Date().toISOString(), cleans: cleans.length, peopleOnShift: people.length, peopleUsed: Object.keys(mine).length, unassigned, workMinutes: Math.round(work), travelMinutes: Math.round(travel), maxLoadMinutes: Math.round(maxLoad), byPerson, assign, assignIds, cleansById, why: sug.why }
}

/** Score a plan against the day as it actually ran (from the capacity picture, after the day). */
export async function scoreDay(plan: ShadowPlan): Promise<ShadowScore | null> {
  const picture = await buildDayPicture(plan.date).catch(() => null)
  if (!picture) return null
  const did = picture.people.filter(p => (p.cleans || 0) > 0)
  const actualPeople = did.length
  const actualTravel = Math.round(did.reduce((a, p) => a + (p.travelMinutes || 0), 0))
  const actualWork = Math.round(did.reduce((a, p) => a + (p.workMinutes || 0), 0))
  const actualUnassigned = picture.unassigned.length
  if (!actualPeople && !actualUnassigned) return null   // nothing happened that day (or the mirror is behind)
  const fewer = plan.peopleUsed <= actualPeople
  const travelOk = plan.travelMinutes <= actualTravel * 1.1 + 15
  const covered = plan.unassigned <= actualUnassigned
  const win = fewer && travelOk && covered
  const why = [
    `people ${plan.peopleUsed} vs ${actualPeople}${fewer ? ' ✓' : ' ✗'}`,
    `travel ${plan.travelMinutes}m vs ${actualTravel}m${travelOk ? ' ✓' : ' ✗'}`,
    `unassigned ${plan.unassigned} vs ${actualUnassigned}${covered ? ' ✓' : ' ✗'}`,
  ].join(' · ')
  return { scoredAt: new Date().toISOString(), actualPeople, actualTravel, actualWork, actualUnassigned, win, why }
}

export type Readiness = { scored: number; wins: number; ready: boolean; window: number; needed: number; lastPlan: ShadowPlan | null }
export async function shadowReadiness(): Promise<Readiness> {
  const st = await state()
  const scored = Object.values(st.days).filter(d => d.score).sort((a, b) => (a.plan.date < b.plan.date ? 1 : -1)).slice(0, READY_WINDOW)
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
      const s = await scoreDay(todayRec.plan)
      if (s) { todayRec.score = s; out.scored = `${today}: ${s.win ? 'WIN' : 'loss'} — ${s.why}` }
      else out.notes.push(`${today}: nothing to score yet`)
    }
    if (!st.days[tomorrow] || opts.force) {
      const plan = await projectDay(tomorrow)
      if (plan) { const { cleansById: _c, why: _w, ...slim } = plan; st.days[tomorrow] = { plan: slim as ShadowPlan }; out.projected = `${tomorrow}: ${plan.cleans} cleans → ${plan.peopleUsed} of ${plan.peopleOnShift} people, ${plan.unassigned} unassigned, travel ${plan.travelMinutes}m` }
      else out.notes.push(`${tomorrow}: no cleans or nobody on shift — no plan`)
    }
    // Sunday readout in #vr-eve.
    const dow = new Date(today + 'T12:00:00Z').getUTCDay()
    if ((dow === 0 || opts.force) && st.lastReadout !== today && !opts.preview) {
      const r = await shadowReadiness()
      const recent = Object.values(st.days).filter(d => d.score).sort((a, b) => (a.plan.date < b.plan.date ? 1 : -1)).slice(0, 7)
      const text = `*Shadow scheduler — week's scorecard*\nMy plan beat the real schedule on ${recent.filter(d => d.score!.win).length} of ${recent.length} days this week (${r.wins} of the last ${r.scored} overall; ${r.needed} of ${r.window} makes me ready to propose).\n` +
        recent.map(d => `• ${d.plan.date}: ${d.score!.win ? '✓' : '✗'} ${d.score!.why}`).join('\n') +
        (r.ready ? `\n*Ready.* From tomorrow the 7am plan carries my suggested assignments for the unowned cleans; nothing is assigned without a ✅.` : `\nStill learning — no assignments proposed yet.`)
      const gate = await agentAllowed('slack_post')
      const rr = await stepDown(gate, { action: 'slack_post', summary: `shadow scheduler weekly readout (${r.wins}/${r.scored})`, exec: { channel: EVE_CHANNELS.approvals, channel_name: 'vr-eve', text }, by: 'cron:scheduler-shadow' },
        async () => { const p = await postToChannel(EVE_CHANNELS.approvals, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
      if (rr.ok && rr.mode !== 'observe') { st.lastReadout = today; out.readout = rr.mode }
      else out.notes.push(`readout: ${rr.error || gate.reason}`)
    }
  } catch (e: any) { out.ok = false; out.notes.push(String(e?.message || e).slice(0, 160)) }
  if (!opts.preview) await setSetting(SHADOW_KEY, st, 'scheduler-shadow').catch(() => {})
  return out
}
