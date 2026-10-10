// THE OPS DESK — Eve owns the day's task list.
//
// Jon, 2026-09-28: improve Eve to support the ops team and manage tasks. Three moments a day, all
// read from the Breezeway mirror and the booking calendar, no model call:
//
//   7am  THE PLAN. One summary line (open, people, arrivals, unowned → /plan), then the work
//        nobody has yet with the check-in time that sets each deadline, and the shadow
//        scheduler's suggestions once she has earned them. One message in #vr-eve.
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
import { isTaskDone } from '@/lib/task-categories'

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
// THE ROOM NUMBER STAYS (Eve audit 2026-10-10: "17WEST · hot water" named a building of 40 doors). "Eden
// 2104 - Studio" → "Eden 2104"; "17WEST - 516 - 3BR" → "17WEST 516"; "Arya 1002/1 - Studio" → "Arya 1002/1".
const shortUnit = (u: any) => { const s = String(u || '').trim(); if (!s) return 'a unit'; const parts = s.split(/\s+-\s+/).filter(Boolean); if (parts.length >= 2 && /^\d+[A-Za-z]?(?:\/\d+)?$/.test(parts[1]) && !/\d/.test(parts[0])) return parts[0] + ' ' + parts[1]; return parts[0] || s }
const isDone = (t: any) => isTaskDone(t.status, t.finished_at)
const isGone = (t: any) => /cancel|delet|void/i.test(str(t.status))
const isRunning = (t: any) => !!t.started_at || /progress|started|running/i.test(str(t.status))
const names = (t: any): string[] => (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a && typeof a === 'object' ? a.name : a).trim()).filter(Boolean)

type Task = { id: string; name: string; dept: 'maintenance' | 'housekeeping' | 'inspection' | 'other'; listing: string; unit: string; building: string; people: string[]; done: boolean; running: boolean; clean: boolean; finished_at: string | null }
type Day = { today: string; tasks: Task[]; arrivals: Record<string, { guest: string; at: string | null }>; arrivalsTomorrow: Record<string, string> }

// "15:00" or "3:00 PM" → "3pm"; "15:30" → "3:30pm". The listing's default check-in time is the
// same basis the day sheets use; unset means 4pm there too.
const hm12 = (v: any): string | null => {
  const m = str(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!m) return null
  let h = Number(m[1]) % 24
  if (m[3]) h = (Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m[2] === '00' ? '' : ':' + m[2]}${suffix}`
}

async function readDay(today: string): Promise<Day> {
  const db = supabaseAdmin()
  // ORDERED (2026-09-28 audit, F32 — ctx.ts rule 2): an unordered read on PostgREST can repeat and
  // skip rows. The listing read also brings each unit's check-in time (one JSON path, not raw), so
  // the plan can say when a guest lands (F31).
  const [{ data: ts }, { data: ls }, { data: arr }] = await Promise.all([
    db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,finished_at,started_at,type_department,assignees,reference_property_id').eq('scheduled_date', today).order('id').limit(1000), // deliberate cap: one day's Breezeway tasks (~90 a day portfolio-wide)
    db.from('guesty_listings').select('id,nickname,title,building,checkIn:raw->>defaultCheckInTime').order('id').limit(1000), // deliberate cap: one row per listing, ~290
    db.from('guesty_reservations').select('listing_id,guest_name,check_in,status').in('check_in', [today, shift(today, 1)]).in('status', ['confirmed', 'reserved', 'checked_in']).order('check_in').order('listing_id').limit(1000), // deliberate cap: live arrivals today and tomorrow, at most one per unit a day (~290 units)
  ])
  const meta: Record<string, { unit: string; building: string; checkIn: string | null }> = {}
  for (const l of ((ls || []) as any[])) { const nm = str(l.nickname || l.title) || 'Unit'; meta[str(l.id)] = { unit: nm, building: str(l.building) || buildingOf(nm) || nm, checkIn: hm12(l.checkIn) } }
  const tasks: Task[] = ((ts || []) as any[]).filter(t => !isGone(t)).map(t => {
    const m = meta[str(t.reference_property_id)] || { unit: 'a unit', building: '' }
    return { id: str(t.id), name: str(t.name), dept: deptOf(t.type_department), listing: str(t.reference_property_id), unit: m.unit, building: m.building, people: names(t), done: isDone(t), running: isRunning(t), clean: isDepartureCleanName(str(t.name)), finished_at: t.finished_at || null }
  })
  const arrivals: Day['arrivals'] = {}, arrivalsTomorrow: Day['arrivalsTomorrow'] = {}
  for (const r of ((arr || []) as any[])) {
    if (str(r.check_in).slice(0, 10) === today) arrivals[str(r.listing_id)] = { guest: str(r.guest_name) || 'Guest', at: meta[str(r.listing_id)]?.checkIn || '4pm' }
    else arrivalsTomorrow[str(r.listing_id)] = str(r.guest_name) || 'Guest'
  }
  return { today, tasks, arrivals, arrivalsTomorrow }
}

// ── 7am: the plan ────────────────────────────────────────────────────────────────────────────────
// ONE LINE, THEN WHAT NEEDS A NAME (2026-09-28 audits: 06 F-28, 04 F31). The plan used to be a roll
// call — up to fourteen person lines repeating the day sheets in Slack, against Jon's "Slack short;
// lists live in the app". It is now one summary line with the link to /plan, then the work nobody
// has, soonest guest first, each with the check-in time that sets its deadline.
export function planText(day: Day): string {
  const open = day.tasks.filter(t => !t.done)
  const people: Record<string, true> = {}
  for (const t of open) for (const p of t.people) people[p] = true
  const unassigned = open.filter(t => !t.people.length)
  const nArr = Object.keys(day.arrivals).length
  const sameDayUnowned = unassigned.filter(t => t.clean && day.arrivals[t.listing]).length
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const parts: string[] = [`*Today — ${day.today}* · ${open.length} open · ${Object.keys(people).length} people · ${nArr} arrival${nArr === 1 ? '' : 's'} · ${unassigned.length} unowned${sameDayUnowned ? ` · ${sameDayUnowned} same-day turn${sameDayUnowned === 1 ? '' : 's'} unowned` : ''} → <${base}/plan|the plan>`]
  if (unassigned.length) {
    // Units with a guest landing today first, earliest check-in first; the rest after.
    const lands = (t: Task) => { const a = day.arrivals[t.listing]; if (!a) return 99 * 60; const m = str(a.at).match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/); return m ? ((Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + Number(m[2] || 0) : 16 * 60 }
    const ranked = unassigned.slice().sort((a, b) => lands(a) - lands(b))
    const lines = ranked.slice(0, 8).map(t => `  – ${shortUnit(t.unit)} · ${t.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 50)}${day.arrivals[t.listing] ? ` · *guest lands ${day.arrivals[t.listing].at || 'today'}*` : ''}`)
    parts.push(`*Nobody on it yet (${unassigned.length})*\n${lines.join('\n')}${unassigned.length > 8 ? `\n  …and ${unassigned.length - 8} more` : ''}\nI'll propose people for these through the day.`)
  }
  return parts.join('\n')
}

// ── hourly: the chase ───────────────────────────────────────────────────────────────────────────
/**
 * For an unassigned task: the person from the same department already working in that building today.
 * `blocked` is the never-assign list (lib/never-assign) — such a person is never the one proposed.
 */
export function candidateFor(t: Task, day: Day, blocked: (name: string) => boolean = () => false): string | null {
  const same = day.tasks.filter(x => x.id !== t.id && x.people.length && x.building && x.building === t.building && (x.dept === t.dept || (t.dept === 'other')))
  const load: Record<string, number> = {}
  for (const x of same) for (const p of x.people) if (!blocked(p)) load[p] = (load[p] || 0) + 1
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

  // ONE MORNING POST (Eve audit 2026-10-07, Jon: "consolidate Eve's engagement"). The 7am plan and the
  // 6pm recap were two of the ~61 posts a week in #vr-eve that nobody answered. The plan is now part
  // of the single Ops Command post (lib/eve/morning.ts); the recap lives on the Today board. Both still
  // build on demand (?desk=plan|recap) for the preview. Switch eve_morning off to bring them back.
  const { morningOn } = await import('./morning')
  const consolidated = await morningOn()
  const wantPlan = opts.force === 'plan' || (!consolidated && st.lastPlan !== today && h >= cfg.planHour && h < cfg.planHour + 3)
  const wantRecap = opts.force === 'recap' || (!consolidated && st.lastRecap !== today && h >= cfg.recapHour && h < cfg.recapHour + 3)
  const wantChase = opts.force === 'chase' || (h >= cfg.chaseFrom && h < cfg.chaseTo)
  if (!wantPlan && !wantRecap && !wantChase) return { ...out, skipped: `nothing due at ${h}:00 ET` }

  const day = await readDay(today)
  const post = async (text: string, summary: string) => {
    const gate = await agentAllowed('slack_post', { ask: true })
    const r = await stepDown(gate, { action: 'slack_post', summary, exec: { channel: cfg.room, channel_name: 'vr-eve', text }, by: 'cron:ops-desk' },
      async () => { const p = await postToChannel(cfg.room, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    if (r.mode !== 'act') out.notes.push(`${summary}: ${r.mode} — ${gate.reason}`)
    return r.ok && r.mode !== 'observe'
  }

  if (wantPlan) {
    let text = planText(day)
    // THE SHADOW SCHEDULER'S SUGGESTION rides the plan once she has earned it (10 of 14 days).
    try {
      const { shadowReadiness } = await import('./scheduler-shadow')
      const r = await shadowReadiness()
      const plan = r.lastPlan
      if (r.ready && plan && plan.date === today) {
        const unowned = day.tasks.filter(t => t.clean && !t.done && !t.people.length)
        // A plan stored before someone joined the never-assign list must not propose them either.
        let never: (name: string) => boolean = () => false
        try { const { neverAssignGuard } = await import('@/lib/never-assign'); const g = await neverAssignGuard(); if (g.active) never = (n: string) => g.blocks(n) } catch { /* the executor still refuses them */ }
        const lines = unowned.map(t => { const who = plan.assign[`${t.listing}__${today}`]; return who && !never(who) ? `  – ${shortUnit(t.unit)} → ${who}` : null }).filter(Boolean) as string[]
        if (lines.length) text += `\n*My suggested assignments for the unowned cleans* (shadow scorecard ${r.wins}/${r.scored} — nothing is assigned without a ✅)\n${lines.slice(0, 10).join('\n')}`
      }
    } catch { /* the plan stands on its own */ }
    out.plan = text
    if (!opts.preview && await post(text, `ops desk: today's plan (${day.tasks.length} tasks)`)) st.lastPlan = today
  }
  if (wantChase && !opts.preview) {
    const targets = day.tasks.filter(t => !t.done && !t.people.length && !t.clean && !proposed[t.id]).slice(0, 8)
    // ONE ASK PER RUN (2026-09-28 audit, F22). Each unowned task used to be its own proposal — up to
    // eight Telegram asks an hour, none counted against the daily asks budget. The run's assignments
    // are now ONE proposal (one line each; one yes carries them all out, one undo puts them all back),
    // and it counts as one ask.
    const picks: { t: Task; who: string }[] = []
    let blocked: (name: string) => boolean = () => false
    try { const { neverAssignGuard } = await import('@/lib/never-assign'); const g = await neverAssignGuard(); if (g.active) blocked = (n: string) => g.blocks(n) } catch { /* the executor still refuses them */ }
    for (const t of targets) { const who = candidateFor(t, day, blocked); if (who) picks.push({ t, who }) }
    if (picks.length) {
      const one = picks.length === 1
      const lines = picks.map(p => `"${p.t.name.replace(/^\[[^\]]*\]\s*/, '').slice(0, 60)}" on ${shortUnit(p.t.unit)} to ${p.who}`)
      const gate = await agentAllowed('task_assign', { ask: true })
      const r = await stepDown(gate, {
        action: 'task_assign',
        summary: one ? `assign ${lines[0]}` : `assign ${picks.length} unowned tasks: ${lines.join('; ')}`.slice(0, 600),
        exec: one ? { taskId: picks[0].t.id, person: picks[0].who } : { batch: picks.map(p => ({ taskId: p.t.id, person: p.who })) },
        why: one
          ? `${picks[0].who} is already working in ${picks[0].t.building || 'that building'} today and this ${picks[0].t.dept} task has nobody on it${day.arrivals[picks[0].t.listing] ? '; a guest lands in the unit today' : ''}.`
          : `Each person is already working in that building today and each task has nobody on it${picks.some(p => day.arrivals[p.t.listing]) ? '; a guest lands in at least one of these units today' : ''}.`,
        by: 'cron:ops-desk', watchKey: 'ops_desk', subject: one ? `task:${picks[0].t.id}` : `tasks:${picks.map(p => p.t.id).sort().join(',')}`, metric: 'cleans_unassigned', thoughtCooldownHours: 72,
      })
      if (r.ok && r.mode !== 'observe') { for (const p of picks) proposed[p.t.id] = today; out.proposedAssign += picks.length }
      if (r.mode !== 'act') out.notes.push(`assign ${picks.length} unowned: ${r.mode}`)
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
