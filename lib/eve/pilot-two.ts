// PILOT TWO — THE SCHEDULER (Jon, 2026-10-10: "an agent that knows how to schedule cleaners and
// tasks based on importance and team member — pilot 2 — and create a sandbox").
//
// Twice a day she builds the whole day's plan — every departure clean and every open field task,
// who should hold each one and why — and either writes it down (sandbox) or, inside the pilot
// buildings, assigns it in Breezeway (live, through the same fence as everything else: budgets,
// quiet hours, never-assign, undo). The plan is kept for a week next to what actually happened, so
// the card can say how often a person agreed with her.
//
// CLEANS come from the shadow scheduler (lib/eve/scheduler-shadow projectDay): fewer people, fuller
// days, one building per person, same-day turns first, the last 30 days of habits as the tie-break.
// That machine has its own scorecard; live assignment of cleans needs it READY (10 of 14 days won)
// as well as the switch, because a wrong clean assignment costs a late check-in.
//
// TASKS are ranked by IMPORTANCE first, then matched to a TEAM MEMBER:
//   importance  100 safety / security, or a guest in the unit right now (glitch-linked)
//                80 a guest lands in that unit today (pre-arrival work)
//                60 guest-reported, guest arriving tomorrow; urgent / high priority
//                40 ordinary maintenance, inspections, housekeeping extras
//                20 preventive upkeep, low priority
//   team member  must: on shift today (Homebase, the roster, or already working), not on the
//                never-assign list, the right department (maintenance → maintenance; inspections →
//                supervisors / inspectors; housekeeping extras → cleaners; "other" → anyone in the
//                building). Then: already in that building today (+50), home market (+20),
//                did work on this unit or building in the last 60 days (+15), the least loaded (−1 per
//                10% utilisation). Ties go to whoever did the earlier task on the same unit.
// Nothing here moves anything that already has a person on it.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildDayPicture } from '@/lib/capacity-day'
import { getStaff } from '@/lib/staffing'
import { nameMatches } from '@/lib/person-name'
import { shortUnit } from '@/lib/team-where'
import { marketOf, buildingOf } from '@/lib/segments'
import { readOpsDay, type OpsTask } from './ops-desk'
import { projectDay, shadowReadiness, type ShadowPlan } from './scheduler-shadow'
import { agentAllowed, stepDown, getAgentSettings, pilotBuildingOf, recordSandbox, type AgentSettings } from './agent-mode'

export const PILOT_TWO_KEY = 'eve_pilot_two'
const KEEP_DAYS = 7
const ET = 'America/New_York'
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(d)
const etHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false }).format(d)) % 24
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).split(/\s+/)[0]

export type PlannedTask = {
  taskId: string; unit: string; building: string; title: string; dept: OpsTask['dept']
  importance: number; because: string
  assignee: string | null; reason: string
  /** live: what the fence did; sandbox: 'sandbox'; otherwise 'planned' */
  did?: 'assigned' | 'proposed' | 'held' | 'sandbox' | 'planned' | 'skipped' | 'failed'
  ref?: string | null
}
export type PlannedPerson = { name: string; dept: string | null; onShift: boolean; cleans: string[]; tasks: string[]; utilisationPct: number | null }
export type PilotTwoPlan = {
  date: string; builtAt: string; pass: 'today' | 'tomorrow'
  cleans: { assign: Record<string, string | null>; byPerson: Record<string, string[]>; unassigned: number; total: number; peopleUsed: number; shadowReady: boolean } | null
  tasks: PlannedTask[]
  people: PlannedPerson[]
  unplaced: { taskId: string; unit: string; title: string; why: string }[]
  notes: string[]
}
export type PilotTwoScore = { scoredAt: string; tasksPlanned: number; tasksAgreed: number; tasksAssignedByPeople: number; detail: { unit: string; title: string; planned: string | null; actual: string | null }[] }
type State = { days: Record<string, { plan: PilotTwoPlan; score?: PilotTwoScore }> }

async function state(): Promise<State> {
  const v = await getSetting<any>(PILOT_TWO_KEY, null)
  const days = v && v.days && typeof v.days === 'object' ? v.days : {}
  const keys = Object.keys(days).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k]
  return { days }
}

const DEPT_WORDS: Record<string, RegExp> = {
  maintenance: /maint|tech|repair|handy|engineer/i,
  inspection: /superv|inspect|lead|manager|quality/i,
  housekeeping: /house|clean|hk|room attendant/i,
}
function personDept(d: any): 'maintenance' | 'inspection' | 'housekeeping' | null {
  const s = str(d)
  if (!s) return null
  for (const [k, re] of Object.entries(DEPT_WORDS)) if (re.test(s)) return k as any
  return null
}
function deptFits(task: OpsTask['dept'], person: string | null): boolean {
  if (task === 'other') return true
  if (!person) return false
  if (task === 'maintenance') return person === 'maintenance'
  if (task === 'inspection') return person === 'inspection' || person === 'housekeeping'
  return person === 'housekeeping' || person === 'inspection'
}

/** Importance of a task today, with the reason in words. */
function importanceOf(t: OpsTask, ctx: { guestIn: Set<string>; arrivals: Record<string, any>; arrivalsTomorrow: Record<string, any>; glitchCat: Record<string, string>; name: string }): { n: number; why: string } {
  const n = str(t.name).toLowerCase()
  const cat = str(ctx.glitchCat[t.listing] || '')
  if (/safety|security|fire|gas|flood|lock ?out|no power|sewage/i.test(n + ' ' + cat)) return { n: 100, why: 'safety / security' }
  if (ctx.guestIn.has(t.listing)) return { n: 100, why: 'guest in the unit now' }
  if (ctx.arrivals[t.listing]) return { n: 80, why: 'guest lands in the unit today' }
  if (/urgent|asap|emergency|high/i.test(n) || /guest reported|guest:|glitch:/i.test(n)) return { n: 60, why: 'guest-reported / high priority' }
  if (ctx.arrivalsTomorrow[t.listing]) return { n: 60, why: 'guest lands tomorrow' }
  if (/preventive|preventative|pm\b|filter|battery|deep clean|quarterly|monthly|walkthrough|exterior/i.test(n) || /low/i.test(n)) return { n: 20, why: 'upkeep, no guest waiting' }
  return { n: 40, why: t.dept === 'inspection' ? 'inspection' : 'routine work' }
}

/** Build the plan for a date. Pure read; nothing is assigned here. */
export async function planDay(date: string, pass: 'today' | 'tomorrow'): Promise<PilotTwoPlan> {
  const notes: string[] = []
  const db = supabaseAdmin()
  const [picture, staff, day, ready] = await Promise.all([
    buildDayPicture(date).catch(() => null),
    getStaff().catch(() => [] as any[]),
    readOpsDay(date),
    shadowReadiness().catch(() => ({ ready: false } as any)),
  ])
  // Cleans — the shadow's plan for the day (built fresh; the shadow's own stored copy is its scorecard).
  let cleans: PilotTwoPlan['cleans'] = null
  try {
    const sp: ShadowPlan | null = await projectDay(date)
    if (sp) cleans = { assign: sp.assign, byPerson: sp.byPerson, unassigned: sp.unassigned, total: sp.cleans, peopleUsed: sp.peopleUsed, shadowReady: !!ready.ready }
    else notes.push('no cleans or nobody on shift — no clean plan')
  } catch (e: any) { notes.push('clean plan: ' + str(e?.message || e).slice(0, 120)) }

  // Who is on today: Homebase picture (shift, capacity, load, crew dept) + the staff roster (dept/area).
  const roster = (staff as any[]).filter(r => r && r.active !== false)
  const deptOfName = (name: string): string | null => {
    const p = (picture?.people || []).find(x => nameMatches(str(x.person), name))
    const crew = p?.crewDept ? personDept(p.crewDept) : null
    if (crew) return crew
    const r = roster.find(x => nameMatches(str(x.name), name))
    return personDept(r?.dept || r?.role) || null
  }
  const areaOf = (name: string): string | null => { const r = roster.find(x => nameMatches(str(x.name), name)); return r?.area ? str(r.area) : null }
  const onShift = new Map<string, { util: number; cap: number }>()
  for (const p of (picture?.people || [])) if (Number(p.capacityMinutes) > 0 && p.verdict !== 'implausible') onShift.set(str(p.person), { util: Number(p.utilisationPct) || 0, cap: Number(p.capacityMinutes) })
  // Already working: anyone holding a task or a clean today is "on", shift or not.
  const workingIn: Record<string, Set<string>> = {}
  const todaysLoad: Record<string, number> = {}
  for (const t of day.tasks) for (const p of t.people) { (workingIn[p] = workingIn[p] || new Set()).add(t.building); todaysLoad[p] = (todaysLoad[p] || 0) + 1; if (!onShift.has(p)) onShift.set(p, { util: 0, cap: 0 }) }
  if (cleans) for (const [person, units] of Object.entries(cleans.byPerson)) { for (const u of units) (workingIn[person] = workingIn[person] || new Set()).add(buildingOf(u) || u.split(' ')[0]); todaysLoad[person] = (todaysLoad[person] || 0) + units.length; if (!onShift.has(person)) onShift.set(person, { util: 0, cap: 0 }) }

  // Context for importance: guests in the unit (glitch-linked), arrivals, glitch categories.
  const { data: gl } = await db.from('glitches').select('listing_id,category,status,check_in,check_out,breezeway_task_id').not('status', 'in', '("done","resolved","closed")').gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()).limit(300)
  const guestIn = new Set<string>(); const glitchCat: Record<string, string> = {}
  for (const g of ((gl as any[]) || [])) {
    const ci = str(g.check_in).slice(0, 10), co = str(g.check_out).slice(0, 10)
    if (ci && co && ci <= date && co > date) guestIn.add(str(g.listing_id))
    if (g.category) glitchCat[str(g.listing_id)] = str(g.category)
  }
  // Familiarity: who worked on which building in the last 60 days.
  const familiar: Record<string, Set<string>> = {}
  try {
    const since = shift(date, -60)
    const { data: hist } = await db.from('breezeway_tasks_sync').select('assignees,reference_property_id').gte('scheduled_date', since).lt('scheduled_date', date).not('finished_at', 'is', null).order('id').limit(3000)
    const bOf: Record<string, string> = {}
    for (const t of day.tasks) bOf[t.listing] = t.building
    for (const r of ((hist as any[]) || [])) {
      const b = bOf[str(r.reference_property_id)]
      if (!b) continue
      for (const a of (Array.isArray(r.assignees) ? r.assignees : [])) { const nm = str(a?.name || a); if (nm) (familiar[nm] = familiar[nm] || new Set()).add(b) }
    }
  } catch { /* familiarity is a tie-break */ }

  let blocked: (n: string) => boolean = () => false
  try { const { neverAssignGuard } = await import('@/lib/never-assign'); const g = await neverAssignGuard(); if (g.active) blocked = (n: string) => g.blocks(n) } catch { /* the executor refuses them anyway */ }

  // Rank the open, unowned, non-clean tasks by importance.
  const open = day.tasks.filter(t => !t.done && !t.clean && !t.people.length)
  const ranked = open.map(t => ({ t, imp: importanceOf(t, { guestIn, arrivals: day.arrivals, arrivalsTomorrow: day.arrivalsTomorrow, glitchCat, name: t.name }) })).sort((a, b) => b.imp.n - a.imp.n)
  const extra: Record<string, number> = {}   // tasks this plan adds per person
  const tasks: PlannedTask[] = []
  const unplaced: PilotTwoPlan['unplaced'] = []
  const candidates = Array.from(onShift.keys()).filter(n => !blocked(n))
  for (const { t, imp } of ranked) {
    const mk = str(marketOf(t.building || null, null, t.unit) || '')
    let best: { name: string; score: number; why: string[] } | null = null
    for (const name of candidates) {
      const pd = deptOfName(name)
      if (!deptFits(t.dept, pd) && !(workingIn[name]?.has(t.building))) continue
      if (t.dept !== 'other' && !deptFits(t.dept, pd)) continue
      const sh = onShift.get(name)!
      let score = 0; const why: string[] = []
      if (workingIn[name]?.has(t.building)) { score += 50; why.push(`already in ${t.building || 'that building'} today`) }
      const area = areaOf(name)
      if (mk && area && area.toLowerCase().includes(mk.toLowerCase())) { score += 20; why.push(`${mk} is their market`) }
      else if (mk && area && !area.toLowerCase().includes(mk.toLowerCase())) { score -= 40; why.push(`usually ${area}`) }
      if (familiar[name]?.has(t.building)) { score += 15; why.push('knows the building') }
      if (pd && deptFits(t.dept, pd)) { score += 10 }
      const load = (sh.util || 0) + (extra[name] || 0) * 8 + (todaysLoad[name] || 0) * 2
      score -= Math.round(load / 10)
      if (!best || score > best.score) best = { name, score, why: why.length ? why : [pd ? `${pd} on shift` : 'on shift'] }
    }
    if (!best || best.score < -20) { unplaced.push({ taskId: t.id, unit: shortUnit(t.unit), title: t.name.slice(0, 80), why: candidates.length ? `nobody fitting (${t.dept}) is on in ${mk || 'that market'} today` : 'nobody on shift' }); continue }
    extra[best.name] = (extra[best.name] || 0) + 1
    ;(workingIn[best.name] = workingIn[best.name] || new Set()).add(t.building)
    tasks.push({ taskId: t.id, unit: shortUnit(t.unit), building: t.building, title: t.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 80), dept: t.dept, importance: imp.n, because: imp.why, assignee: best.name, reason: best.why.join(', '), did: 'planned' })
  }
  const people: PlannedPerson[] = Array.from(onShift.keys()).map(name => ({
    name, dept: deptOfName(name), onShift: (onShift.get(name)?.cap || 0) > 0,
    cleans: cleans?.byPerson[name] || [],
    tasks: tasks.filter(x => x.assignee === name).map(x => `${x.unit} · ${x.title.slice(0, 40)}`),
    utilisationPct: onShift.get(name)?.cap ? onShift.get(name)!.util : null,
  })).filter(p => p.cleans.length || p.tasks.length || p.onShift).sort((a, b) => (b.cleans.length + b.tasks.length) - (a.cleans.length + a.tasks.length))
  if (!picture) notes.push('no Homebase picture for the day — on-shift read from work already assigned')
  return { date, builtAt: new Date().toISOString(), pass, cleans, tasks, people, unplaced, notes }
}

/** The day after: how often a person made the same call. Tasks only (cleans are the shadow's score). */
export async function scoreDay(plan: PilotTwoPlan): Promise<PilotTwoScore | null> {
  if (!plan.tasks.length) return null
  const day = await readOpsDay(plan.date)
  const detail: PilotTwoScore['detail'] = []
  let agreed = 0, byPeople = 0
  for (const t of plan.tasks) {
    const now = day.tasks.find(x => x.id === t.taskId)
    const actual = now && now.people.length ? now.people[0] : null
    if (actual) { byPeople++; if (t.assignee && nameMatches(actual, t.assignee)) agreed++ }
    detail.push({ unit: t.unit, title: t.title.slice(0, 50), planned: t.assignee, actual })
  }
  return { scoredAt: new Date().toISOString(), tasksPlanned: plan.tasks.length, tasksAgreed: agreed, tasksAssignedByPeople: byPeople, detail: detail.slice(0, 40) }
}

export type PilotTwoRun = { ok: boolean; skipped?: string; date?: string; pass?: string; planned?: number; acted?: number; sandboxed?: number; notes: string[] }

/** The pass: 7 / 11 / 15 ET plan today; 18 ET plan tomorrow. Off → nothing; sandbox → written down; live → assigned in pilot buildings. */
export async function runPilotTwo(opts: { force?: boolean; date?: string; preview?: boolean } = {}): Promise<PilotTwoRun> {
  const out: PilotTwoRun = { ok: true, notes: [] }
  const s: AgentSettings = await getAgentSettings()
  const cfg = s.pilotTwo
  if (cfg.mode === 'off' && !opts.force && !opts.preview) return { ...out, skipped: `${cfg.name} is off` }
  const now = new Date(), h = etHour(now), today = ymdET(now)
  const passHours = [7, 11, 15]
  const pass: 'today' | 'tomorrow' = opts.date ? (opts.date > today ? 'tomorrow' : 'today') : h >= 18 ? 'tomorrow' : 'today'
  if (!opts.force && !opts.preview && !passHours.includes(h) && h !== 18) return { ...out, skipped: `passes run at 7, 11, 15 and 18 ET (now ${h}:00)` }
  const date = opts.date || (pass === 'tomorrow' ? shift(today, 1) : today)
  const st = await state()
  // Score yesterday's plan once people have had the day.
  const y = shift(today, -1)
  if (st.days[y] && !st.days[y].score && !opts.preview) { try { const sc = await scoreDay(st.days[y].plan); if (sc) st.days[y].score = sc } catch { /* next pass */ } }
  const plan = await planDay(date, pass)
  out.date = date; out.pass = pass; out.planned = plan.tasks.length
  if (opts.preview) return { ...out, notes: plan.notes }
  const prev = st.days[date]?.plan
  let acted = 0, sandboxed = 0
  for (const t of plan.tasks) {
    if (!t.assignee) continue
    // Said once a day per task: a task already planned (and acted or written) on an earlier pass is left alone.
    const earlier = prev?.tasks.find(x => x.taskId === t.taskId && x.assignee === t.assignee && x.did && x.did !== 'planned' && x.did !== 'skipped')
    if (earlier) { t.did = earlier.did; t.ref = earlier.ref; continue }
    const inPilot = pilotBuildingOf(s, t.building || t.unit, 'task_assign')
    if (!inPilot && cfg.mode === 'live') { t.did = 'skipped'; continue }
    const proposal = { action: 'task_assign' as const, summary: `assign "${t.title.slice(0, 50)}" on ${t.unit} to ${t.assignee}`, exec: { taskId: t.taskId, person: t.assignee, unit: t.unit }, why: `${t.because} (${t.importance}); ${t.assignee}: ${t.reason}`, by: 'cron:pilot-two', subject: `task:${t.taskId}`, watchKey: 'pilot_two' }
    if (cfg.mode === 'sandbox') {
      await recordSandbox(`${cfg.name} sandbox (${inPilot || 'all'})`, proposal, 4).catch(() => {})
      t.did = 'sandbox'; sandboxed++
      continue
    }
    const gate = await agentAllowed('task_assign', { ask: true, unit: t.building || t.unit })
    const r = await stepDown(gate, proposal)
    t.did = r.mode === 'act' ? (r.ok ? 'assigned' : 'failed') : r.mode === 'propose' ? 'proposed' : r.mode === 'deferred' ? 'held' : 'skipped'
    t.ref = r.ref || null
    if (r.mode === 'act' && r.ok) acted++
  }
  // Cleans: live only when the shadow is ready and the switch for cleans is on; sandbox writes them down.
  if (plan.cleans && cfg.assignCleans) {
    const planned = Object.entries(plan.cleans.assign).filter(([, who]) => !!who)
    if (cfg.mode === 'sandbox') {
      for (const [key, who] of planned.slice(0, 60)) {
        const unit = key.split('__')[0]
        const label = Object.entries(plan.cleans.byPerson).find(([p]) => p === who)?.[1]?.[0] || unit
        await recordSandbox(`${cfg.name} sandbox (${pilotBuildingOf(s, label, 'task_assign') || 'all'})`, { action: 'task_assign', summary: `give the ${label} clean to ${who}`, exec: { unit: label }, why: 'the shadow scheduler\'s plan for the day', by: 'cron:pilot-two', subject: `clean:${key}` }, 4).catch(() => {})
        sandboxed++
      }
    } else if (!plan.cleans.shadowReady) out.notes.push('cleans not assigned live: the shadow scheduler is not ready yet (10 of 14 days)')
    else out.notes.push('live clean assignment is wired through the Schedule page push; not done from this pass')
  }
  st.days[date] = { plan, score: st.days[date]?.score }
  await setSetting(PILOT_TWO_KEY, { days: st.days }, 'pilot-two').catch(() => {})
  out.acted = acted; out.sandboxed = sandboxed; out.notes.push(...plan.notes)
  return out
}

/** For the card: the last plans and scores. */
export async function pilotTwoReport(): Promise<{ days: { date: string; plan: PilotTwoPlan; score?: PilotTwoScore }[]; shadow: { ready: boolean; wins: number; scored: number } }> {
  const st = await state()
  const r = await shadowReadiness().catch(() => ({ ready: false, wins: 0, scored: 0 } as any))
  const days = Object.keys(st.days).sort().reverse().slice(0, 3).map(date => ({ date, plan: st.days[date].plan, score: st.days[date].score }))
  return { days, shadow: { ready: !!r.ready, wins: Number(r.wins) || 0, scored: Number(r.scored) || 0 } }
}
