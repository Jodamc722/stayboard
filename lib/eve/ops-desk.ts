// THE OPS DESK — Eve owns the day's task list.
//
// Jon, 2026-09-28: improve Eve to support the ops team and manage tasks. Three moments a day, all
// read from the Breezeway mirror and the booking calendar, no model call:
//
//   7am  THE PLAN, BY PERSON. Who has what today — cleans, maintenance, inspections — with the
//        arrivals that set each unit's deadline, and the work nobody has yet. One message in
//        #vr-eve; one line per person; the unassigned block at the bottom.
//   hourly (11am–6pm) THE CHASE. A task due today with nobody on it gets a proposed assignment:
//        the person from the right department already working in that building today. Never a
//        departure clean — those belong to the scheduler and the late-clean reminders. Each task is
//        proposed once. Under "act" it is assigned; under "propose" a ✅ assigns it.
//   6pm  THE RECAP. What is still open from today, by person, and what it is holding up (a guest
//        arriving tomorrow). Nothing is moved or closed here — that is a person's call, and the
//        list is the ask.
//
// SHORT (Jon, 2026-09-23: "when you send a super long brief, that's not really helpful"). Names and
// counts; the units only where they matter. The full list is one question away (person_tasks).
// Every post goes through the slack_post rung; the assignment through task_assign.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { postToChannel } from '@/lib/slack'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { agentAllowed, stepDown } from './agent-mode'
import { deptOf } from '@/lib/pending-work'
import { isDepartureCleanName } from '@/lib/breezeway'
import { buildingOf } from '@/lib/segments'

export const OPS_DESK_KEY = 'eve_ops_desk'
const STATE_KEY = 'eve_ops_desk_state'
const ET = 'America/New_York'

export type OpsDeskCfg = { enabled: boolean; planHour: number; recapHour: number; chaseFrom: number; chaseTo: number; room: string }
export const OPS_DESK_DEFAULTS: OpsDeskCfg = { enabled: true, planHour: 7, recapHour: 18, chaseFrom: 11, chaseTo: 18, room: EVE_CHANNELS.approvals }
export async function getOpsDesk(): Promise<OpsDeskCfg> {
  const s = await getSetting<any>(OPS_DESK_KEY, null)
  const d = OPS_DESK_DEFAULTS
  if (!s || typeof s !== 'object') return d
  const h = (v: any, fb: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : fb)
  return { enabled: s.enabled !== false, planHour: h(s.planHour, d.planHour), recapHour: h(s.recapHour, d.recapHour), chaseFrom: h(s.chaseFrom, d.chaseFrom), chaseTo: h(s.chaseTo, d.chaseTo), room: typeof s.room === 'string' && s.room.trim() ? s.room.trim() : d.room }
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const etHour = (now = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false }).format(now)) % 24
const etDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(now)
const shift = (ymd: string, d: number) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(Date.parse(ymd + 'T12:00:00Z') + d * 86400000))
const clock = (ts: any) => { const d = new Date(String(ts)); return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase() }
const shortUnit = (u: any) => str(u).split(' - ')[0].trim() || 'a unit'
const isDone = (t: any) => !!t.finished_at || /complet|finish|close|approv/i.test(str(t.status))
const isGone = (t: any) => /cancel|delet|void/i.test(str(t.status))
const isRunning = (t: any) => !!t.started_at || /progress|started|running/i.test(str(t.status))
const names = (t: any): string[] => (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a && typeof a === 'object' ? a.name : a).trim()).filter(Boolean)

type Task = { id: string; name: string; dept: 'maintenance' | 'housekeeping' | 'inspection' | 'other'; listing: string; unit: string; building: string; people: string[]; done: boolean; running: boolean; clean: boolean; finished_at: string | null }
type Day = { today: string; tasks: Task[]; arrivals: Record<string, { guest: string; at: string | null }>; arrivalsTomorrow: Record<string, string> }

async function readDay(today: string): Promise<Day> {
  const db = supabaseAdmin()
  const [{ data: ts }, { data: ls }, { data: arr }] = await Promise.all([
    db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,finished_at,started_at,type_department,assignees,reference_property_id').eq('scheduled_date', today).limit(2000),
    db.from('guesty_listings').select('id,nickname,title,building').limit(3000),
    db.from('guesty_reservations').select('listing_id,guest_name,check_in,status').in('check_in', [today, shift(today, 1)]).in('status', ['confirmed', 'reserved', 'checked_in']).limit(2000),
  ])
  const meta: Record<string, { unit: string; building: string }> = {}
  for (const l of ((ls || []) as any[])) { const nm = str(l.nickname || l.title) || 'Unit'; meta[str(l.id)] = { unit: nm, building: str(l.building) || buildingOf(nm) || nm } }
  const tasks: Task[] = ((ts || []) as any[]).filter(t => !isGone(t)).map(t => {
    const m = meta[str(t.reference_property_id)] || { unit: 'a unit', building: '' }
    return { id: str(t.id), name: str(t.name), dept: deptOf(t.type_department), listing: str(t.reference_property_id), unit: m.unit, building: m.building, people: names(t), done: isDone(t), running: isRunning(t), clean: isDepartureCleanName(str(t.name)), finished_at: t.finished_at || null }
  })
  const arrivals: Day['arrivals'] = {}, arrivalsTomorrow: Day['arrivalsTomorrow'] = {}
  for (const r of ((arr || []) as any[])) {
    if (str(r.check_in).slice(0, 10) === today) arrivals[str(r.listing_id)] = { guest: str(r.guest_name) || 'Guest', at: null }
    else arrivalsTomorrow[str(r.listing_id)] = str(r.guest_name) || 'Guest'
  }
  return { today, tasks, arrivals, arrivalsTomorrow }
}

// ── 7am: the plan, by person ────────────────────────────────────────────────────────────────────
export function planText(day: Day): string {
  const byPerson: Record<string, Task[]> = {}
  const unassigned: Task[] = []
  for (const t of day.tasks) {
    if (t.done) continue
    if (!t.people.length) { unassigned.push(t); continue }
    for (const p of t.people) (byPerson[p] = byPerson[p] || []).push(t)
  }
  const people = Object.keys(byPerson).sort((a, b) => byPerson[b].length - byPerson[a].length)
  const parts: string[] = [`*Today's plan — ${day.today}* · ${day.tasks.filter(t => !t.done).length} open across ${people.length} people${Object.keys(day.arrivals).length ? ` · ${Object.keys(day.arrivals).length} arrival${Object.keys(day.arrivals).length === 1 ? '' : 's'}` : ''}`]
  const cnt = (ts: Task[]) => {
    const c = ts.filter(t => t.clean).length, m = ts.filter(t => t.dept === 'maintenance').length, i = ts.filter(t => t.dept === 'inspection').length, o = ts.length - c - m - i
    return [c ? `${c} clean${c === 1 ? '' : 's'}` : '', m ? `${m} maint` : '', i ? `${i} insp` : '', o ? `${o} other` : ''].filter(Boolean).join(' · ')
  }
  for (const p of people.slice(0, 14)) {
    const ts = byPerson[p]
    const arriving = ts.filter(t => day.arrivals[t.listing]).map(t => `${shortUnit(t.unit)}${day.arrivals[t.listing].at ? ' ' + day.arrivals[t.listing].at : ''}`)
    const bld = Array.from(new Set(ts.map(t => t.building).filter(Boolean))).slice(0, 3).join(', ')
    parts.push(`• *${p}* — ${cnt(ts)}${bld ? ` · ${bld}` : ''}${arriving.length ? ` · arrivals: ${Array.from(new Set(arriving)).slice(0, 4).join(', ')}` : ''}`)
  }
  if (people.length > 14) parts.push(`…and ${people.length - 14} more people`)
  if (unassigned.length) {
    const lines = unassigned.slice(0, 8).map(t => `  – ${shortUnit(t.unit)} · ${t.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 50)}${day.arrivals[t.listing] ? ` · *guest lands today*` : ''}`)
    parts.push(`*Nobody on it yet (${unassigned.length})*\n${lines.join('\n')}${unassigned.length > 8 ? `\n  …and ${unassigned.length - 8} more` : ''}\nI'll propose people for these through the day.`)
  }
  return parts.join('\n')
}

// ── hourly: the chase ───────────────────────────────────────────────────────────────────────────
/** For an unassigned task: the person from the same department already working in that building today. */
export function candidateFor(t: Task, day: Day): string | null {
  const same = day.tasks.filter(x => x.id !== t.id && x.people.length && x.building && x.building === t.building && (x.dept === t.dept || (t.dept === 'other')))
  const load: Record<string, number> = {}
  for (const x of same) for (const p of x.people) load[p] = (load[p] || 0) + 1
  const ranked = Object.keys(load).sort((a, b) => load[a] - load[b])   // the least loaded person already there
  return ranked[0] || null
}

// ── 6pm: the recap ──────────────────────────────────────────────────────────────────────────────
export function recapText(day: Day): string {
  const open = day.tasks.filter(t => !t.done)
  const done = day.tasks.filter(t => t.done).length
  const byPerson: Record<string, Task[]> = {}
  const nobody: Task[] = []
  for (const t of open) { if (!t.people.length) nobody.push(t); else for (const p of t.people) (byPerson[p] = byPerson[p] || []).push(t) }
  const parts: string[] = [`*End of day — ${day.today}* · ${done} done, ${open.length} still open`]
  if (!open.length) { parts.push('Everything scheduled today is closed. 👏'); return parts.join('\n') }
  const people = Object.keys(byPerson).sort((a, b) => byPerson[b].length - byPerson[a].length)
  for (const p of people.slice(0, 12)) {
    const ts = byPerson[p]
    const hot = ts.filter(t => day.arrivalsTomorrow[t.listing] || day.arrivals[t.listing])
    parts.push(`• *${p}* — ${ts.length} open${ts.some(t => t.running) ? ` (${ts.filter(t => t.running).length} in progress)` : ''}: ${ts.slice(0, 3).map(t => shortUnit(t.unit) + (hot.includes(t) ? '⚠️' : '')).join(', ')}${ts.length > 3 ? ` +${ts.length - 3}` : ''}`)
  }
  if (nobody.length) parts.push(`• *Nobody* — ${nobody.length}: ${nobody.slice(0, 4).map(t => shortUnit(t.unit)).join(', ')}${nobody.length > 4 ? ` +${nobody.length - 4}` : ''}`)
  const hot = open.filter(t => day.arrivalsTomorrow[t.listing])
  if (hot.length) parts.push(`⚠️ ${hot.length} of these ${hot.length === 1 ? 'is' : 'are'} in a unit with a guest landing tomorrow: ${Array.from(new Set(hot.map(t => shortUnit(t.unit)))).slice(0, 6).join(', ')}.`)
  parts.push(`These stay on today's date until someone finishes or moves them — tell me "move X to tomorrow" and I'll do it.`)
  return parts.join('\n')
}

export type OpsDeskRun = { ok: boolean; skipped?: string; plan?: string; recap?: string; proposedAssign: number; notes: string[] }

export async function runOpsDesk(opts: { force?: 'plan' | 'recap' | 'chase'; preview?: boolean } = {}): Promise<OpsDeskRun> {
  const out: OpsDeskRun = { ok: true, proposedAssign: 0, notes: [] }
  const cfg = await getOpsDesk()
  if (!cfg.enabled && !opts.force) return { ...out, skipped: 'off' }
  const now = new Date(), h = etHour(now), today = etDate(now)
  const st = (await getSetting<any>(STATE_KEY, null)) || { lastPlan: null, lastRecap: null, proposed: {} }
  const proposed: Record<string, string> = st.proposed || {}
  for (const k of Object.keys(proposed)) if (proposed[k] < shift(today, -3)) delete proposed[k]   // three days of memory is plenty

  const wantPlan = opts.force === 'plan' || (st.lastPlan !== today && h >= cfg.planHour && h < cfg.planHour + 3)
  const wantRecap = opts.force === 'recap' || (st.lastRecap !== today && h >= cfg.recapHour && h < cfg.recapHour + 3)
  const wantChase = opts.force === 'chase' || (h >= cfg.chaseFrom && h < cfg.chaseTo)
  if (!wantPlan && !wantRecap && !wantChase) return { ...out, skipped: `nothing due at ${h}:00 ET` }

  const day = await readDay(today)
  const post = async (text: string, summary: string) => {
    const gate = await agentAllowed('slack_post')
    const r = await stepDown(gate, { action: 'slack_post', summary, exec: { channel: cfg.room, channel_name: 'vr-eve', text }, by: 'cron:ops-desk' },
      async () => { const p = await postToChannel(cfg.room, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    if (r.mode !== 'act') out.notes.push(`${summary}: ${r.mode} — ${gate.reason}`)
    return r.ok && r.mode !== 'observe'
  }

  if (wantPlan) {
    const text = planText(day)
    out.plan = text
    if (!opts.preview && await post(text, `ops desk: today's plan by person (${day.tasks.length} tasks)`)) st.lastPlan = today
  }
  if (wantChase && !opts.preview) {
    const targets = day.tasks.filter(t => !t.done && !t.people.length && !t.clean && !proposed[t.id]).slice(0, 8)
    for (const t of targets) {
      const who = candidateFor(t, day)
      if (!who) continue
      const gate = await agentAllowed('task_assign')
      const r = await stepDown(gate, {
        action: 'task_assign', summary: `assign "${t.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 60)}" on ${shortUnit(t.unit)} to ${who}`,
        exec: { taskId: t.id, person: who }, why: `${who} is already working in ${t.building || 'that building'} today and this ${t.dept} task has nobody on it${day.arrivals[t.listing] ? '; a guest lands in the unit today' : ''}.`,
        by: 'cron:ops-desk', watchKey: 'ops_desk', subject: `task:${t.id}`, metric: 'cleans_unassigned', thoughtCooldownHours: 72,
      })
      if (r.ok && r.mode !== 'observe') { proposed[t.id] = today; out.proposedAssign++ }
      if (r.mode !== 'act') out.notes.push(`assign ${shortUnit(t.unit)} → ${who}: ${r.mode}`)
    }
  }
  if (wantRecap) {
    const text = recapText(day)
    out.recap = text
    if (!opts.preview && await post(text, `ops desk: end-of-day recap (${day.tasks.filter(t => !t.done).length} open)`)) st.lastRecap = today
  }
  if (!opts.preview) await setSetting(STATE_KEY, { lastPlan: st.lastPlan, lastRecap: st.lastRecap, proposed }, 'ops-desk').catch(() => {})
  return out
}
