// OPEN & CLOSE — the operations team's opening and closing roadmap (Jon, 2026-10-19).
//
//   "A tool used by our operations team to make sure that we are aware of everything that's
//    happening in operations… every clean is assigned… pending glitches… everybody is scheduled
//    for the day and the next day… potential extensions… a roadmap for opening and closing
//    operations each day… one place shop for important things to manage and ensure we don't miss
//    when opening… close out items for the day so we can manage them next day if needed."
//
// THE SHAPE. Two modes (opening, closing), two sections (the field, the guests), and in each
// section a tab per GATE — who's in, every clean has a person, guests who may not leave, flagged
// arrivals, inspections, vendors, glitches, messages, money; at close: cleans still open,
// tomorrow's cleans and team, tomorrow's flags. A gate is not a checkbox with a count beside it:
// it is the actual rows — the Schedule's own cleans, the Breezeway tasks behind the glitches, the
// people on shift — each carrying ONE of three states:
//
//   pending   nobody has dealt with it           (a clean with nobody on it, a task not started)
//   active    somebody is on it                  (staged, in progress, contacted)
//   done      nothing left                       (pushed, finished, paid)
//
// A gate clears ITSELF when nothing is pending or active (the smart-checklist rule, 2026-10-01),
// or a person signs it with their name and time. Whatever is still open at close can be CARRIED
// into tomorrow with a note; carried rows sit on the next morning's opening until somebody
// resolves them. Nothing here is a second copy of anything: cleans come from lib/schedule-build
// (the Schedule), the day's tasks, team and arrivals from lib/command-day (Today), shifts from
// Homebase, the roster from the Turnover Schedule, glitches from the glitch board.
//
// EVERY READ FAILS SOFT. A Homebase 429 costs the overtime column, never the page; a gate whose
// source failed says so and never clears itself on an empty read.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildCommandDay, type CommandDay, type TeamRow, type ArrivalRow, type TaskRow, type CleanRow } from './command-day'
import { buildSchedule } from './schedule-build'
import { getShifts, nameMatches, nameMatchesRoster, type Shift } from './homebase'
import { getTimecards } from './homebase-labor'
import { getSlackRules } from './slack-rules'
import { sunOf, addDays } from './team-schedule'
import { isTaskDone, isTaskRunning, isTaskGone } from './task-categories'
import { isLiveStay } from './stay-status'
import { loadUnpaid } from './unpaid'
import { minutesOf, opsNow, isLate, clockLabel } from './checklist-shared'
import { pageRows } from './db-page'
import { visitState, needsTelling } from './projects-shared'

const TZ = 'America/New_York'
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const first = (s: string | null | undefined) => str(s).split(/[\s@]/)[0]
const hm = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm' }
const hrs = (h: number) => (Math.round(h * 10) / 10) + 'h'
const minOfIso = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const t = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return minutesOf(t)
}
const t12 = (t: string | null | undefined, dflt: string): string => { const s = str(t); if (!s) return dflt; const m = /^(\d{1,2}):(\d{2})/.exec(s); if (!m) return s; return clockLabel(m[1].padStart(2, '0') + ':' + m[2]) || s }
const clock12 = (iso: string | null | undefined): string => { const m = minOfIso(iso); return m == null ? '' : (clockLabel(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')) || '') }

// ── the model ──────────────────────────────────────────────────────────────────────────────────
export type OcMode = 'open' | 'close'
export type OcState = 'pending' | 'active' | 'done'
export type OcTone = 'slate' | 'rose' | 'roseSolid' | 'amber' | 'emerald' | 'violet' | 'sky' | 'brand'
export type OcTag = { label: string; tone: OcTone; title?: string }
export type OcKind = 'team' | 'clean' | 'extension' | 'inspection' | 'vendor' | 'arrival' | 'glitch' | 'message' | 'money' | 'flag'
export type OcTask = { id: string; name: string; status: 'done' | 'running' | 'open'; who: string; date: string | null; priority: string | null }
export type OcRow = {
  key: string
  kind: OcKind
  unit: string
  meta: string
  state: OcState
  tags: OcTag[]
  href?: string | null
  /** The shared task strip (Assign · Done · Nudge · Comments · Breezeway) needs these. */
  taskId?: string | null; dept?: string; who?: string | null; reservationId?: string | null
  late?: boolean; running?: boolean; done?: boolean
  /** Glitch rows: the actual Breezeway task behind the card, when one exists. */
  task?: OcTask | null
  glitchId?: string | null
  /** Clean rows (closing): the Today row, so the page can draw it with the one shared CleanRow. */
  clean?: CleanRow | null
  phone?: string | null
  market?: string | null
}
export type OcGate = {
  key: string; label: string; tab: string; section: 'field' | 'guests'
  due: string | null; late: boolean; inMinutes: number | null
  link: string; hint: string
  counts: { pending: number; active: number; done: number }
  /** Cleared itself: nothing pending or active, and the source read fine. */
  auto: boolean
  signed: { by: string; at: string } | null
  degraded: string | null
  note: string | null
  rows: OcRow[]
}
export type OcCarry = { id: string; key: string; kind: string | null; unit: string | null; title: string; note: string | null; fromDay: string; by: string | null; createdAt: string }
export type OcDayRec = { day: string; openedBy: string | null; openedAt: string | null; closedBy: string | null; closedAt: string | null; note: string | null; snapshot: any }
export type OcDay = {
  ok: true
  mode: OcMode; day: string; tomorrow: string; yesterday: string; clock: string; generatedAt: string
  degraded: string[]
  gates: OcGate[]
  carried: OcCarry[]
  today: OcDayRec | null
  handover: OcDayRec | null
  summary: { cleans: number; cleansDone: number; arrivals: number; onShift: number; gatesClear: number; gatesLate: number; gatesTotal: number }
  eve: string | null
  tables: boolean
}

type GateDef = { key: string; label: string; tab: string; section: 'field' | 'guests'; due: string; link: string; hint: string }
const OPEN_GATES: GateDef[] = [
  { key: 'team', label: "Who's in today", tab: 'Team', section: 'field', due: '08:30', link: '/team', hint: 'Homebase shift, roster and Breezeway load on one line per person — call anyone missing by 9:30' },
  { key: 'cleans', label: 'Every clean has a person', tab: 'Cleans', section: 'field', due: '09:00', link: '/schedule', hint: 'The Schedule, filtered to the cleans that need a person: assign, stage, push' },
  { key: 'inspections', label: 'Inspections due today', tab: 'Inspections', section: 'field', due: '10:00', link: '/plan', hint: 'Bad-review, VIP / big arrival and deep-clean inspections not walked yet' },
  { key: 'vendors', label: 'Vendors on site today', tab: 'Vendors', section: 'field', due: '10:00', link: '/maintenance', hint: 'Who is coming, where, and whether the building has been told' },
  { key: 'extensions', label: 'Guests who may not leave', tab: 'Extensions', section: 'guests', due: '09:30', link: '/schedule', hint: 'Extended in Guesty, still in-house, or a long stay ending with the next night open on the calendar' },
  { key: 'arrivals', label: 'Flagged arrivals', tab: 'Arrivals', section: 'guests', due: '10:00', link: '/reservations', hint: 'VIP, big, long-stay, walk-in and same-day arrivals — inspection and welcome call state' },
  { key: 'glitches', label: 'Walk the glitches', tab: 'Glitches', section: 'guests', due: '10:00', link: '/glitches', hint: 'Every open glitch with the Breezeway task behind it — pending, running, done, or no task yet' },
  { key: 'messages', label: 'Overnight guest messages', tab: 'Messages', section: 'guests', due: '09:30', link: '/inbox', hint: 'Guests waiting on a reply' },
  { key: 'money', label: 'Money due', tab: 'Money', section: 'guests', due: '10:30', link: '/reservations/unpaid', hint: 'Unpaid balances in house or arriving today, and claims near their filing window' },
]
const CLOSE_GATES: GateDef[] = [
  { key: 'cleans_open', label: 'Every clean is closed in Breezeway', tab: 'Cleans open', section: 'field', due: '17:00', link: '/plan', hint: 'Departure cleans still open — finish, mark done, or carry to tomorrow' },
  { key: 'inspections_open', label: 'Inspections closed', tab: 'Inspections', section: 'field', due: '17:30', link: '/plan', hint: "Today's inspections not closed in Breezeway" },
  { key: 'tomorrow_cleans', label: "Tomorrow's cleans have a person", tab: "Tomorrow's cleans", section: 'field', due: '18:00', link: '/schedule', hint: "The Schedule for tomorrow, filtered to the cleans that need a person" },
  { key: 'tomorrow_team', label: 'Tomorrow is staffed', tab: "Tomorrow's team", section: 'field', due: '18:00', link: '/team', hint: 'Homebase shifts and the roster for tomorrow against what Breezeway already has on each person' },
  { key: 'arrivals_in', label: 'Arrivals are in, late ones have a plan', tab: 'Arrivals', section: 'guests', due: '18:00', link: '/welcome-calls', hint: "Today's arrivals without a welcome call, and anything flagged" },
  { key: 'glitches_owned', label: 'Every open glitch has an owner tonight', tab: 'Glitches', section: 'guests', due: '18:00', link: '/glitches', hint: 'Open glitches with nobody assigned, or a task nobody has picked up' },
  { key: 'tomorrow_flags', label: "Tomorrow's flags", tab: "Tomorrow's flags", section: 'guests', due: '18:30', link: '/reservations', hint: 'Possible extensions, VIP / big / long-stay arrivals, same-day turns and bad-review inspections tomorrow' },
  { key: 'money_tomorrow', label: 'Money due tomorrow', tab: 'Money', section: 'guests', due: '18:30', link: '/reservations/unpaid', hint: 'Unpaid balances arriving tomorrow and claims due' },
]

const INSPECT_RE = /inspect|quality|unit check|walk[- ]?through|walkthrough/i
const EXT_RE = /extend|extension|extra night|another night|one more night|stay longer|stay an extra|late check-?out/i

// ── reads, each on its own ─────────────────────────────────────────────────────────────────────
async function safe<T>(label: string, fn: () => Promise<T>, degraded: string[]): Promise<T | null> {
  try { return await fn() } catch (e: any) { degraded.push(label + ': ' + String(e?.message || e).slice(0, 120)); return null }
}

type SchedClean = {
  listingId: string; unit: string; market: string; hub: string; date: string; guestOut: string | null; nights: number | null
  checkOutTime: string | null; checkInTime: string | null; sameDayTurn: boolean; nextArrival: string | null; nextGuest?: string | null
  vendor: string | null; assignedIds: number[]; assignedNames: string[]; reservationId?: string | null
  syncStatus?: string; breezewayTaskId?: string | null; taskStatus?: string; movedTo?: string | null; movedFrom?: string | null
  extended?: boolean; extendedFrom?: string | null; walkInRisk?: boolean; guestyOnly?: boolean; calNote?: string | null
  cleaningFee?: number | null; staged?: boolean; missing?: boolean; rebook?: boolean
}
async function readSchedule(date: string): Promise<SchedClean[]> {
  const j: any = await buildSchedule('day', date)
  const day = j && Array.isArray(j.days) ? j.days[0] : null
  const out: SchedClean[] = []
  const seen: Record<string, boolean> = {}
  if (day && day.markets) {
    for (const mk of Object.keys(day.markets)) {
      for (const c of (day.markets[mk] || []) as any[]) {
        const k = String(c.listingId) + '|' + String(c.date)
        if (seen[k]) continue
        seen[k] = true
        out.push(c as SchedClean)
      }
    }
  }
  return out
}

type Res = { id: string; listing_id: string; listing_name: string | null; guest_name: string | null; guest_email: string | null; check_in: string; check_out: string; nights: number; money_total: number; status: string; created_at: string | null }
async function readReservations(from: string, to: string): Promise<Res[]> {
  const db = supabaseAdmin()
  // Everything touching the window: arriving, departing or in house between from and to.
  const got = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select('id,listing_id,listing_name,guest_name,guest_email,check_in,check_out,nights,money_total,status,created_at')
    .lte('check_in', to).gte('check_out', from).order('id').range(a, b), 6)
  return got.rows.filter(r => isLiveStay(r.status)).map(r => ({
    id: str(r.id), listing_id: str(r.listing_id), listing_name: r.listing_name ?? null, guest_name: r.guest_name ?? null, guest_email: r.guest_email ?? null,
    check_in: str(r.check_in).slice(0, 10), check_out: str(r.check_out).slice(0, 10), nights: num(r.nights), money_total: num(r.money_total), status: str(r.status), created_at: r.created_at ?? null,
  }))
}

async function readVipEmails(): Promise<Set<string>> {
  const out = new Set<string>()
  const { data } = await supabaseAdmin().from('guest_profiles').select('email').eq('vip', true).limit(1000)
  for (const v of (data || []) as any[]) { const e = str(v.email).trim().toLowerCase(); if (e) out.add(e) }
  return out
}

/** Guests who ASKED about staying on, in the last 48 hours — by reservation, from their messages. */
async function readExtensionAsks(reservationIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!reservationIds.length) return out
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 48 * 3600_000).toISOString()
  // A conversation is keyed to a reservation on the conversation row; the message holds the body.
  const { data: convs } = await db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', reservationIds.slice(0, 300)).limit(400)
  const byConv: Record<string, string> = {}
  for (const c of (convs || []) as any[]) byConv[str(c.id)] = str(c.reservation_id)
  const ids = Object.keys(byConv)
  if (!ids.length) return out
  const { data: msgs } = await db.from('guesty_messages').select('conversation_id,sender,body,sent_at').in('conversation_id', ids).eq('sender', 'guest').gte('sent_at', since).limit(800)
  for (const m of (msgs || []) as any[]) if (EXT_RE.test(str(m.body))) { const r = byConv[str(m.conversation_id)]; if (r) out.add(r) }
  return out
}

type RosterCells = { members: Record<string, string[]>; cell: (name: string, date: string) => string }
async function readRoster(weekStarts: string[]): Promise<RosterCells> {
  const { data } = await supabaseAdmin().from('team_schedule').select('week_start,market,doc').in('week_start', weekStarts).limit(30)
  const members: Record<string, string[]> = {}
  const cells: Record<string, string> = {}
  for (const r of (data || []) as any[]) {
    const mk = str(r.market), doc = r.doc || {}
    const ms: string[] = Array.isArray(doc.members) ? doc.members.map(str) : []
    members[mk] = (members[mk] || []).concat(ms)
    const cs = doc.cells && typeof doc.cells === 'object' ? doc.cells : {}
    for (const k of Object.keys(cs)) cells[k] = str(cs[k])
  }
  const all = Object.keys(members).reduce((a, mk) => a.concat(members[mk]), [] as string[])
  return {
    members,
    cell: (name, date) => {
      const hit = all.length ? nameMatchesRoster(name, all) : null
      return (hit ? cells[hit + '__' + date] : '') || cells[name + '__' + date] || ''
    },
  }
}

/** Hours worked this week BEFORE today, per person (Homebase timecards, Sunday to yesterday). */
async function readWeekHours(sunday: string, today: string): Promise<{ hours: (name: string) => number; names: string[] }> {
  if (sunday >= today) return { hours: () => 0, names: [] }
  const cards = await getTimecards(sunday, addDays(today, -1))
  const byName: Record<string, number> = {}
  for (const c of cards) {
    if (!c.name) continue
    const key = Object.keys(byName).find(k => nameMatches(k, c.name)) || c.name
    byName[key] = (byName[key] || 0) + num(c.hours)
  }
  const names = Object.keys(byName)
  return { names, hours: (name: string) => { const k = names.find(n => nameMatches(n, name)); return k ? byName[k] : 0 } }
}

type BzTask = { id: string; name: string; status: string; started_at: string | null; finished_at: string | null; assignees: string[]; listingId: string; dept: string; priority: string | null; scheduled_date: string | null; report_url: string | null }
async function readTasks(date: string): Promise<BzTask[]> {
  const { data, error } = await supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,name,status,started_at,finished_at,assignees,reference_property_id,type_department,prio:raw->>type_priority,scheduled_date,report_url')
    .eq('scheduled_date', date).limit(1500)
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).filter(t => !isTaskGone(t.status)).map(t => ({
    id: str(t.id), name: str(t.name), status: str(t.status), started_at: t.started_at ?? null, finished_at: t.finished_at ?? null,
    assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a && a.name)).filter(Boolean) : [],
    listingId: str(t.reference_property_id), dept: str(t.type_department), priority: t.prio ?? null, scheduled_date: t.scheduled_date ? str(t.scheduled_date).slice(0, 10) : null, report_url: t.report_url ?? null,
  }))
}
async function readTasksById(ids: string[]): Promise<Record<string, BzTask>> {
  const out: Record<string, BzTask> = {}
  if (!ids.length) return out
  const { data } = await supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,name,status,started_at,finished_at,assignees,reference_property_id,type_department,prio:raw->>type_priority,scheduled_date,report_url')
    .in('id', ids.slice(0, 300)).limit(300)
  for (const t of (data || []) as any[]) {
    out[str(t.id)] = {
      id: str(t.id), name: str(t.name), status: str(t.status), started_at: t.started_at ?? null, finished_at: t.finished_at ?? null,
      assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a && a.name)).filter(Boolean) : [],
      listingId: str(t.reference_property_id), dept: str(t.type_department), priority: t.prio ?? null, scheduled_date: t.scheduled_date ? str(t.scheduled_date).slice(0, 10) : null, report_url: t.report_url ?? null,
    }
  }
  return out
}

type Glitch = { id: string; unit: string; guest_name: string | null; overview: string | null; status: string; glitch_type: string | null; category: string | null; created_at: string; assignee: string | null; breezeway_task_id: string | null; task_status: string | null; due_date: string | null; priority: string | null; check_in: string | null; check_out: string | null }
async function readGlitches(): Promise<Glitch[]> {
  const { data, error } = await supabaseAdmin().from('glitches')
    .select('id,unit,guest_name,overview,status,glitch_type,category,created_at,assignee,breezeway_task_id,due_date,priority,check_in,check_out')
    .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: true }).limit(300)
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).map(g => ({
    id: str(g.id), unit: str(g.unit) || 'No unit', guest_name: g.guest_name ?? null, overview: g.overview ?? null, status: str(g.status), glitch_type: g.glitch_type ?? null, category: g.category ?? null,
    created_at: str(g.created_at), assignee: g.assignee ?? null, breezeway_task_id: g.breezeway_task_id ? str(g.breezeway_task_id) : null, task_status: null, due_date: g.due_date ?? null, priority: g.priority ?? null,
    check_in: g.check_in ?? null, check_out: g.check_out ?? null,
  }))
}

type Visit = { id: string; title: string; vendor: string | null; where: string | null; when: string; tone: string; announced: boolean; href: string; done: boolean }
async function readVendorVisits(day: string, viewer: { email: string; superadmin: boolean }): Promise<Visit[]> {
  const sb = supabaseAdmin()
  let visible: Set<string> | null = null
  if (!viewer.superadmin) {
    const mem = await pageRows<any>((a, b) => sb.from('project_members').select('project_id').eq('email', viewer.email).order('id').range(a, b), 4)
    visible = new Set(mem.rows.map(m => String(m.project_id)))
  }
  const out: Visit[] = []
  const { data: rows, error } = await sb.from('project_steps')
    .select('id,project_id,title,status,visit_on,visit_window,vendor_name,team_notified_for,assignee')
    .eq('visit_on', day).limit(200)
  if (!error) {
    const kept = ((rows || []) as any[]).filter(r => !visible || visible.has(String(r.project_id)))
    const pids = Array.from(new Set(kept.map(r => String(r.project_id))))
    const [{ data: projs }, { data: links }] = pids.length ? await Promise.all([
      sb.from('projects').select('id,title,kind,archived').in('id', pids),
      sb.from('project_links').select('task_id,kind,label').in('task_id', kept.map(r => String(r.id))).in('kind', ['listing', 'building']),
    ]) : [{ data: [] }, { data: [] }] as any
    const pmap: Record<string, any> = {}
    for (const p of ((projs || []) as any[])) pmap[String(p.id)] = p
    const where: Record<string, string> = {}
    for (const l of ((links || []) as any[])) { const k = String(l.task_id); if (!where[k] || l.kind === 'listing') where[k] = String(l.label || '') }
    for (const r of kept) {
      const p = pmap[String(r.project_id)]
      if (!p || p.archived || p.kind === 'personal' || p.kind === 'one_on_one') continue
      const st = visitState(r.visit_on, String(r.status), day)
      out.push({ id: 'step:' + r.id, title: str(r.title), vendor: r.vendor_name || null, where: where[String(r.id)] || null, when: (st && st.label) || '', tone: (st && st.tone) || 'today',
        announced: !needsTelling({ visit_on: r.visit_on, team_notified_for: r.team_notified_for, status: String(r.status) }), href: '/projects/' + r.project_id, done: String(r.status) === 'done' })
    }
  }
  try {
    const { data: gl } = await sb.from('glitches').select('id,unit,category,overview,status,vendor_name,vendor_visit_on,vendor_team_told_for').eq('vendor_visit_on', day).limit(100)
    for (const g of ((gl || []) as any[])) {
      if (/^(closed|done|resolved)$/i.test(String(g.status || ''))) continue
      out.push({ id: 'glitch:' + g.id, title: str(g.category || 'Guest issue') + (g.overview ? ' — ' + str(g.overview).replace(/\s+/g, ' ').slice(0, 60) : ''), vendor: g.vendor_name || null, where: g.unit || null,
        when: 'today', tone: 'today', announced: !!g.vendor_team_told_for && String(g.vendor_team_told_for).slice(0, 10) === day, href: '/glitches?id=' + g.id, done: false })
    }
  } catch { /* before migration 110 */ }
  return out
}

type Claim = { id: string; unit: string; property: string; guest: string; stage: string; deadline: string | null; daysLeft: number | null }
async function readClaimsDue(today: string): Promise<Claim[]> {
  const { data } = await supabaseAdmin().from('claims').select('id,stage,unit_no,property,guest_name,deadline_on,deleted_at').neq('stage', 'closed').is('deleted_at', null).limit(300)
  const out: Claim[] = []
  for (const c of (data || []) as any[]) {
    const stage = str(c.stage)
    if (/closed|dropped|decided|settle|submitted/.test(stage)) continue
    const dl = c.deadline_on ? str(c.deadline_on).slice(0, 10) : null
    const left = dl ? Math.round((Date.parse(dl + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null
    if (stage === 'review' || (left != null && left <= 5)) out.push({ id: str(c.id), unit: str(c.unit_no), property: str(c.property), guest: str(c.guest_name), stage, deadline: dl, daysLeft: left })
  }
  return out
}

// ── the remembered part: sign-offs, carried rows, the day record ──────────────────────────────
async function readSignoffs(day: string): Promise<{ rows: Record<string, { by: string; at: string }>; tables: boolean }> {
  const { data, error } = await supabaseAdmin().from('oc_signoffs').select('gate,done_by,done_at').eq('day', day).limit(100)
  if (error) return { rows: {}, tables: false }
  const rows: Record<string, { by: string; at: string }> = {}
  for (const r of (data || []) as any[]) rows[str(r.gate)] = { by: str(r.done_by), at: str(r.done_at) }
  return { rows, tables: true }
}
async function readCarried(): Promise<OcCarry[]> {
  const { data, error } = await supabaseAdmin().from('oc_carry').select('id,key,kind,unit,title,note,from_day,by,created_at').is('resolved_at', null).order('from_day', { ascending: true }).limit(200)
  if (error) return []
  return ((data || []) as any[]).map(r => ({ id: str(r.id), key: str(r.key), kind: r.kind ?? null, unit: r.unit ?? null, title: str(r.title), note: r.note ?? null, fromDay: str(r.from_day).slice(0, 10), by: r.by ?? null, createdAt: str(r.created_at) }))
}
async function readDays(days: string[]): Promise<Record<string, OcDayRec>> {
  const out: Record<string, OcDayRec> = {}
  const { data, error } = await supabaseAdmin().from('oc_days').select('day,opened_by,opened_at,closed_by,closed_at,note,snapshot').in('day', days).limit(10)
  if (error) return out
  for (const r of (data || []) as any[]) out[str(r.day).slice(0, 10)] = { day: str(r.day).slice(0, 10), openedBy: r.opened_by ?? null, openedAt: r.opened_at ?? null, closedBy: r.closed_by ?? null, closedAt: r.closed_at ?? null, note: r.note ?? null, snapshot: r.snapshot ?? null }
  return out
}

// ── row builders ───────────────────────────────────────────────────────────────────────────────
// "Every clean has a person": pending = nobody on it (or no Breezeway task yet), active = a cleaner
// picked but not pushed, done = pushed with a person. A clean in progress has a person by definition.
function cleanState(c: SchedClean): OcState {
  if (c.vendor) return 'done'
  if (c.taskStatus === 'completed') return 'done'
  const nobody = !(c.assignedIds && c.assignedIds.length)
  if (c.syncStatus === 'guesty-only' || c.guestyOnly) return 'pending'
  if (nobody) return 'pending'
  if (c.staged) return 'active'
  return 'done'
}
function cleanRows(list: SchedClean[], asks: Set<string>, nextNightOpen: (listingId: string, date: string) => boolean, long: number): OcRow[] {
  const out: OcRow[] = []
  for (const c of list) {
    if (c.vendor) continue
    const state = cleanState(c)
    const tags: OcTag[] = []
    if (c.sameDayTurn) tags.push({ label: 'same-day', tone: 'amber', title: 'A guest arrives into this unit today' })
    if (c.syncStatus === 'guesty-only' || c.guestyOnly) tags.push({ label: 'Guesty only', tone: 'sky', title: 'No Breezeway task yet — push it, or the cleaner never sees it' })
    if (c.staged) tags.push({ label: 'staged', tone: 'amber', title: 'Cleaner picked, not pushed to Breezeway yet' })
    if (c.walkInRisk) tags.push({ label: 'guest in-house', tone: 'roseSolid', title: 'A confirmed guest is still in the unit — do not clean' })
    if (c.extended) tags.push({ label: 'extended' + (c.extendedFrom ? ' · from ' + c.extendedFrom.slice(5) : ''), tone: 'rose', title: 'The stay runs past the clean' })
    if (c.movedTo) tags.push({ label: 'moved → ' + c.movedTo.slice(5), tone: 'violet' })
    if (num(c.nights) >= long) tags.push({ label: 'long stay out · ' + num(c.nights) + 'n', tone: 'violet' })
    if (c.reservationId && asks.has(c.reservationId)) tags.push({ label: 'asked to extend', tone: 'amber', title: 'The guest messaged about staying on in the last 48 hours' })
    if (state === 'pending' && !c.staged && !(c.syncStatus === 'guesty-only' || c.guestyOnly)) tags.push({ label: 'nobody on it', tone: 'rose' })
    const who = (c.assignedNames || []).join(', ')
    out.push({
      key: 'clean:' + c.listingId + ':' + c.date, kind: 'clean', unit: c.unit, state,
      meta: [c.guestOut ? 'out ' + t12(c.checkOutTime, '11:00 AM') : '', c.nextArrival ? 'guest in ' + t12(c.checkInTime, '4:00 PM') : '', c.cleaningFee ? '$' + Math.round(num(c.cleaningFee)) : '', who, c.market].filter(Boolean).join(' · '),
      tags, href: '/schedule?date=' + c.date, taskId: c.breezewayTaskId || null, dept: 'housekeeping', who: who || null, reservationId: c.reservationId || null,
      running: c.taskStatus === 'in_progress', done: c.taskStatus === 'completed', market: c.market || null,
    })
  }
  return out
}

/** The people on shift, with the roster, the load and the week's hours on one line each. */
function teamRows(opts: { people: TeamRow[]; shifts: Shift[]; roster: RosterCells; week: { hours: (n: string) => number } | null; day: string; nowMin: number; isToday: boolean; tasks: BzTask[] | null; otRisk: number }): OcRow[] {
  const { people, shifts, roster, week, day, nowMin, isToday, tasks, otRisk } = opts
  const out: OcRow[] = []
  const seen: Record<string, boolean> = {}
  const loadOf = (name: string): { cleans: number; other: number } => {
    if (!tasks) return { cleans: 0, other: 0 }
    let cleans = 0, other = 0
    for (const t of tasks) {
      if (!t.assignees.some(a => nameMatches(a, name))) continue
      if (isTaskDone(t.status, t.finished_at)) continue
      if (/clean|housekeep|turn/i.test(t.dept + ' ' + t.name)) cleans++; else other++
    }
    return { cleans, other }
  }
  const push = (name: string, p: TeamRow | null, s: Shift | null) => {
    // Homebase and Breezeway spell people differently ("Mileidis" / "Mileidis gonzalez"): one row each.
    const k = name.toLowerCase()
    if (seen[k] || Object.keys(seen).some(x => nameMatches(x, k))) return
    seen[k] = true
    const ros = roster.cell(name, day)
    const off = /off/i.test(ros)
    const working = /work|on.?call/i.test(ros)
    const load = p ? { cleans: p.cleans, other: p.otherTasks } : loadOf(name)
    const total = load.cleans + load.other
    const startMin = p && p.shiftStartMin != null ? p.shiftStartMin : minOfIso(s && s.startAt)
    const endMin = p && p.shiftEndMin != null ? p.shiftEndMin : minOfIso(s && s.endAt)
    const shiftHrs = startMin != null && endMin != null && endMin > startMin ? (endMin - startMin) / 60 : 0
    const clockedIn = !!(p && p.clock && p.clock.in)
    const weekHrs = week ? week.hours(name) : null
    const projected = weekHrs == null ? null : weekHrs + (shiftHrs || 0)
    const tags: OcTag[] = []
    let state: OcState = 'active'
    if (isToday && startMin != null && !clockedIn && nowMin > startMin + 15) { tags.push({ label: 'not clocked in', tone: 'rose', title: 'On the Homebase schedule, no punch yet — call by 9:30' }); state = 'pending' }
    if (off && total > 0) { tags.push({ label: 'OFF but assigned', tone: 'amber', title: 'The roster says OFF; Breezeway has work on this person' }); state = 'pending' }
    if (working && total === 0 && (isToday ? nowMin > 10 * 60 : true)) { tags.push({ label: 'working, nothing assigned', tone: 'amber', title: 'Rostered to work with no Breezeway task' }); state = 'pending' }
    if (projected != null && projected >= otRisk) { tags.push({ label: 'overtime risk · ' + hrs(projected), tone: 'rose', title: hrs(weekHrs || 0) + ' so far this week + ' + hrs(shiftHrs) + ' shift' }); state = 'pending' }
    // OVER is a flag, not an alarm (first live read, 2026-10-19: 115% marked 14 of 20 people pending).
    // The tag shows from 130% of the shift; it only makes the row PENDING when the day is plainly
    // too big — six cleans, or half again what the shift holds.
    const util = p ? p.utilisationPct : 0
    if (load.cleans >= 6 || (util >= 130 && total > 0)) {
      tags.push({ label: 'over · ' + (load.cleans >= 5 ? load.cleans + ' cleans' : total + ' tasks'), tone: 'amber', title: (p ? util + '% of the shift at the usual pace' : 'More than fits the shift at the usual pace') })
      if (state === 'active' && (load.cleans >= 6 || util >= 150)) state = 'pending'
    }
    else if (p && p.field && /housekeep/i.test(str(p.dept)) && load.cleans <= 1 && clockedIn) tags.push({ label: 'light · ' + load.cleans + ' clean' + (load.cleans === 1 ? '' : 's'), tone: 'emerald', title: 'Room to take a clean from somebody who is over' })
    if (ros && !off && !working) tags.push({ label: ros, tone: 'slate' })
    const deptTxt = str(p && p.dept ? p.dept : (s && s.department) || '').replace(/dept\.?\s*not\s*set/i, '')
    const meta = [deptTxt, s ? s.label : (startMin != null && endMin != null ? clockLabel(String(Math.floor(startMin / 60)).padStart(2, '0') + ':' + String(startMin % 60).padStart(2, '0')) + ' – ' + clockLabel(String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0')) : ''),
      clockedIn ? 'in ' + clock12(p!.clock!.in) : (isToday ? '' : ''), load.cleans + ' clean' + (load.cleans === 1 ? '' : 's') + (load.other ? ' · ' + load.other + ' task' + (load.other === 1 ? '' : 's') : ''),
      weekHrs != null ? hrs(weekHrs) + ' this week' : ''].filter(Boolean).join(' · ')
    out.push({ key: 'team:' + day + ':' + name, kind: 'team', unit: name, meta, state, tags, href: '/team' })
  }
  for (const p of people) if (p.field !== false) push(p.person, p, shifts.find(s => !s.open && nameMatches(s.name, p.person)) || null)
  for (const s of shifts) if (!s.open && s.name) push(s.name, null, s)
  return out.sort((a, b) => (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1) || a.unit.localeCompare(b.unit))
}

function arrivalFlags(r: Res, opts: { today: string; long: number; big: number; vips: Set<string>; departsSameDay: (listingId: string, date: string) => boolean }): OcTag[] {
  const tags: OcTag[] = []
  const e = str(r.guest_email).trim().toLowerCase()
  if (e && opts.vips.has(e)) tags.push({ label: 'VIP', tone: 'brand', title: 'Flagged VIP on the Guests tab' })
  if (r.money_total >= opts.big) tags.push({ label: 'big · $' + Math.round(r.money_total).toLocaleString('en-US'), tone: 'emerald', title: 'A booking over the big-arrival line' })
  if (r.nights >= opts.long) tags.push({ label: 'long stay in · ' + r.nights + 'n', tone: 'violet' })
  if (r.created_at && ymd(new Date(r.created_at)) === opts.today) tags.push({ label: 'booked today', tone: 'amber', title: 'Walk-in: booked and arriving the same day' })
  if (opts.departsSameDay(r.listing_id, r.check_in)) tags.push({ label: 'same-day turn', tone: 'amber', title: 'Somebody checks out of this unit the same day' })
  return tags
}

// ── the build ──────────────────────────────────────────────────────────────────────────────────
export async function buildOpenClose(opts: { mode: OcMode; date?: string | null; viewer: { email: string; superadmin: boolean } }): Promise<OcDay> {
  const { mode } = opts
  const now = new Date()
  const { day: realToday, minutes: nowMin, clock } = opsNow(now)
  const day = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : realToday
  const isToday = day === realToday
  const tomorrow = addDays(day, 1), yesterday = addDays(day, -1)
  const degraded: string[] = []

  const rules = await getSlackRules().catch(() => null)
  const LONG = rules ? rules.longStayNights : 14
  const BIG = rules ? rules.bigBookingUsd : 3000
  const OT_RISK = 40

  const [cd, sched, schedT, shifts, shiftsT, roster, week, res, vips, glitches, tasksToday, tasksT, visits, visitsT, unpaid, claims, signs, carried, days] = await Promise.all([
    safe('today', () => buildCommandDay(), degraded),
    safe('schedule', () => readSchedule(day), degraded),
    mode === 'close' ? safe("tomorrow's schedule", () => readSchedule(tomorrow), degraded) : Promise.resolve(null),
    safe('Homebase shifts', () => getShifts(day), degraded),
    mode === 'close' ? safe("tomorrow's shifts", () => getShifts(tomorrow), degraded) : Promise.resolve(null),
    safe('roster', () => readRoster(Array.from(new Set([sunOf(day), sunOf(tomorrow)]))), degraded),
    safe('week hours', () => readWeekHours(sunOf(day), day), degraded),
    safe('reservations', () => readReservations(addDays(day, -1), addDays(day, 3)), degraded),
    safe('VIP list', () => readVipEmails(), degraded),
    safe('glitches', () => readGlitches(), degraded),
    safe('tasks today', () => readTasks(day), degraded),
    mode === 'close' ? safe('tasks tomorrow', () => readTasks(tomorrow), degraded) : Promise.resolve(null),
    safe('vendor visits', () => readVendorVisits(day, opts.viewer), degraded),
    mode === 'close' ? safe("tomorrow's vendors", () => readVendorVisits(tomorrow, opts.viewer), degraded) : Promise.resolve(null),
    safe('unpaid', () => loadUnpaid({ from: day, to: addDays(day, 1) }), degraded),
    safe('claims', () => readClaimsDue(day), degraded),
    readSignoffs(day),
    readCarried(),
    readDays([day, yesterday]),
  ])
  const glitchTasks = glitches ? await safe('glitch tasks', () => readTasksById(glitches.map(g => g.breezeway_task_id || '').filter(Boolean)), degraded) : null
  const asks = sched ? (await safe('extension asks', () => readExtensionAsks(sched.map(c => str(c.reservationId)).filter(Boolean)), degraded)) || new Set<string>() : new Set<string>()

  // Calendar helpers from the reservations window.
  const resList = res || []
  const arrAt: Record<string, Res[]> = {}, depAt: Record<string, Res[]> = {}
  for (const r of resList) {
    (arrAt[r.listing_id + '|' + r.check_in] = arrAt[r.listing_id + '|' + r.check_in] || []).push(r)
    ;(depAt[r.listing_id + '|' + r.check_out] = depAt[r.listing_id + '|' + r.check_out] || []).push(r)
  }
  const departsSameDay = (lid: string, d: string) => !!(depAt[lid + '|' + d] && depAt[lid + '|' + d].length)
  /** Nobody arrives into the unit tonight or tomorrow night → the guest leaving today COULD stay on. */
  const nextNightOpen = (lid: string, d: string) => !res ? false : !(arrAt[lid + '|' + d] || []).length && !(arrAt[lid + '|' + addDays(d, 1)] || []).length

  const gatesDef = mode === 'open' ? OPEN_GATES : CLOSE_GATES
  const gates: OcGate[] = []
  const mk = (def: GateDef, rows: OcRow[], failed: string | null, note: string | null = null): OcGate => {
    const counts = { pending: rows.filter(r => r.state === 'pending').length, active: rows.filter(r => r.state === 'active').length, done: rows.filter(r => r.state === 'done').length }
    const signed = signs.rows[def.key] || null
    const auto = !failed && counts.pending === 0 && counts.active === 0
    const dueMin = minutesOf(def.due)
    const done = auto || !!signed
    return {
      key: def.key, label: def.label, tab: def.tab, section: def.section, due: def.due, link: def.link, hint: def.hint,
      late: isToday ? isLate(def.due, done, nowMin) : false, inMinutes: dueMin == null || !isToday ? null : dueMin - nowMin,
      counts, auto, signed, degraded: failed, note, rows,
    }
  }

  const teamOf = (people: TeamRow[] | null, sh: Shift[] | null, d: string, tasks: BzTask[] | null, today: boolean) =>
    teamRows({ people: people || [], shifts: sh || [], roster: roster || { members: {}, cell: () => '' }, week, day: d, nowMin, isToday: today, tasks, otRisk: OT_RISK })

  if (mode === 'open') {
    // TEAM
    {
      const failed = !cd && !shifts ? 'Could not read Today or Homebase' : null
      const rows = teamOf(cd ? cd.tiles.team.rows : null, shifts, day, tasksToday, isToday)
      gates.push(mk(OPEN_GATES[0], rows, failed, week ? null : 'Week hours unavailable (Homebase) — overtime not checked'))
    }
    // CLEANS — the Schedule's rows; the page draws the Schedule's own table for them.
    {
      const rows = sched ? cleanRows(sched, asks, nextNightOpen, LONG).filter(r => r.state !== 'done' || r.tags.some(t => /in-house|extended|moved/.test(t.label))) : []
      const total = sched ? sched.filter(c => !c.vendor).length : 0
      const vendor = sched ? sched.filter(c => !!c.vendor).length : 0
      gates.push(mk(OPEN_GATES[1], rows, sched ? null : 'Could not build the schedule', sched ? total + ' cleans today' + (vendor ? ' · ' + vendor + ' vendor-run, never chased' : '') : null))
    }
    // INSPECTIONS
    {
      const rows: OcRow[] = []
      if (cd) for (const t of cd.tiles.tasks.rows) {
        if (!INSPECT_RE.test(t.name) && !/inspect/i.test(t.dept + ' ' + t.type)) continue
        const tags: OcTag[] = []
        if (/review|recovery/i.test(t.name)) tags.push({ label: 'bad review', tone: 'rose', title: 'Filed by the low-review rule' })
        if (/vip|big|arrival|owner/i.test(t.name)) tags.push({ label: 'arrival', tone: 'brand', title: 'Big arrival / VIP / owner stay inspection — before the guest lands' })
        if (/deep/i.test(t.name)) tags.push({ label: 'deep clean', tone: 'violet', title: 'Every deep clean gets a supervisor inspection' })
        if (t.late) tags.push({ label: 'late', tone: 'rose' })
        if (!t.who) tags.push({ label: 'unassigned', tone: 'amber' })
        rows.push({ key: 'task:' + t.taskId, kind: 'inspection', unit: t.unit, meta: [t.name, t.who, t.market].filter(Boolean).join(' · '), state: t.state === 'done' ? 'done' : t.state === 'running' ? 'active' : 'pending', tags, taskId: t.taskId, dept: 'inspection', who: t.who || null, late: t.late, running: t.state === 'running', done: t.state === 'done', href: '/plan', market: t.market || null })
      }
      gates.push(mk(OPEN_GATES[2], rows.filter(r => r.state !== 'done'), cd ? null : 'Could not read Today', cd ? rows.filter(r => r.state === 'done').length + ' walked already' : null))
    }
    // VENDORS
    {
      const rows: OcRow[] = (visits || []).map(v => ({ key: 'visit:' + v.id, kind: 'vendor', unit: v.where || v.vendor || 'Vendor', meta: [v.vendor, v.title, v.when].filter(Boolean).join(' · '), state: v.done ? 'done' : v.announced ? 'active' : 'pending',
        tags: v.announced ? [{ label: 'building told', tone: 'emerald' }] : [{ label: 'building not told', tone: 'amber', title: 'Nobody has told the building or front desk this visit is coming' }], href: v.href }))
      const vendorCleans = sched ? sched.filter(c => !!c.vendor).length : 0
      gates.push(mk(OPEN_GATES[3], rows, visits ? null : 'Could not read vendor visits', vendorCleans ? vendorCleans + ' vendor-run cleans today (Botanica and other vendor buildings)' : null))
    }
    // EXTENSIONS — guests who may not leave
    {
      const rows: OcRow[] = []
      let openNights = 0
      if (sched) for (const c of sched) {
        if (c.vendor || c.taskStatus === 'completed') continue
        const tags: OcTag[] = []
        let why = ''
        if (c.walkInRisk) { tags.push({ label: 'guest in-house', tone: 'roseSolid', title: 'A confirmed guest is still in the unit today — do not send a cleaner' }); why = 'in-house' }
        if (c.extended) { tags.push({ label: 'extended' + (c.extendedFrom ? ' · from ' + c.extendedFrom.slice(5) : ''), tone: 'rose', title: 'Guesty runs past the clean: Breezeway moved or should move the clean' }); why = why || 'extended' }
        if (c.movedTo) { tags.push({ label: 'clean moved → ' + c.movedTo.slice(5), tone: 'violet', title: 'The clean sits on another day now — check that cleaner’s count on both days' }); why = why || 'moved' }
        if (c.rebook) { tags.push({ label: 're-book', tone: 'amber', title: 'Checks out and straight back in — nobody leaves' }); why = why || 'rebook' }
        const open = c.listingId ? nextNightOpen(c.listingId, c.date) : false
        const asked = !!(c.reservationId && asks.has(c.reservationId))
        if (!why && open) {
          openNights++
          if (num(c.nights) >= LONG || asked) {
            if (num(c.nights) >= LONG) tags.push({ label: 'long stay out · ' + num(c.nights) + 'n', tone: 'violet' })
            if (asked) tags.push({ label: 'asked to extend', tone: 'amber', title: 'Messaged about staying on in the last 48 hours' })
            tags.push({ label: 'next night open', tone: 'sky', title: 'Nobody arrives tonight or tomorrow night — the guest could stay on' })
            why = 'may extend'
          }
        } else if (why && open) tags.push({ label: 'next night open', tone: 'sky' })
        if (!why) continue
        const who = (c.assignedNames || []).join(', ')
        rows.push({ key: 'ext:' + c.listingId + ':' + c.date, kind: 'extension', unit: c.unit, state: why === 'may extend' ? 'pending' : (c.movedTo ? 'active' : 'pending'), tags,
          meta: [c.guestOut || '', 'out ' + t12(c.checkOutTime, '11:00 AM'), c.nextArrival ? 'guest in ' + t12(c.checkInTime, '4:00 PM') : 'no arrival after', who ? 'cleaner ' + who : 'nobody assigned', c.market].filter(Boolean).join(' · '),
          href: '/schedule?date=' + c.date, taskId: c.breezewayTaskId || null, dept: 'housekeeping', who: who || null, reservationId: c.reservationId || null, market: c.market || null })
      }
      gates.push(mk(OPEN_GATES[4], rows, sched ? null : 'Could not build the schedule', openNights ? openNights + ' more departure' + (openNights === 1 ? ' has' : 's have') + ' an open night after them — short stays, nothing asked' : null))
    }
    // ARRIVALS — flagged
    {
      const rows: OcRow[] = []
      if (cd && res) {
        const byRes: Record<string, ArrivalRow> = {}
        for (const a of cd.tiles.arrivals.rows) if (a.today) byRes[a.reservationId] = a
        for (const r of resList) {
          if (r.check_in !== day) continue
          const flags = arrivalFlags(r, { today: day, long: LONG, big: BIG, vips: vips || new Set<string>(), departsSameDay })
          const a = byRes[r.id] || null
          if (!flags.length && (!a || (a.welcomeDone && a.inspection !== 'none'))) continue
          const tags = flags.slice()
          let state: OcState = 'done'
          if (a) {
            if (a.inspection === 'none') { tags.push({ label: 'no inspection', tone: 'amber', title: 'Nothing walks this unit before the guest lands' }); state = 'pending' }
            else if (a.inspection === 'open') { tags.push({ label: 'inspection open', tone: 'sky' }); state = 'active' }
            else if (a.inspection === 'auto') tags.push({ label: 'inspection auto', tone: 'violet', title: 'Task automation files it on its next run' })
            else if (a.inspection === 'done') tags.push({ label: 'inspected', tone: 'emerald' })
            if (!a.welcomeDone) { tags.push({ label: 'call owed', tone: 'amber', title: 'Welcome call not logged yet' }); state = state === 'done' ? 'pending' : state }
            else tags.push({ label: 'called', tone: 'emerald' })
          } else state = flags.length ? 'pending' : 'done'
          rows.push({ key: 'arr:' + r.id, kind: 'arrival', unit: a ? a.unit : str(r.listing_name) || 'Unit', meta: [r.guest_name || 'Guest', r.nights + ' night' + (r.nights === 1 ? '' : 's'), a && a.value ? '$' + Math.round(a.value).toLocaleString('en-US') : ''].filter(Boolean).join(' · '), state, tags, reservationId: r.id, href: '/reservations?id=' + r.id })
        }
      }
      gates.push(mk(OPEN_GATES[5], rows, cd && res ? null : 'Could not read arrivals', cd ? cd.tiles.arrivals.today + ' arriving today' : null))
    }
    // GLITCHES — with the actual Breezeway task
    gates.push(glitchGate(OPEN_GATES[6], glitches, glitchTasks, day, 'all'))
    // MESSAGES
    {
      const rows: OcRow[] = cd ? cd.tiles.guestDesk.rows.filter(r => r.kind === 'message').map(r => ({ key: 'msg:' + r.key, kind: 'message' as OcKind, unit: r.unit || r.who, meta: [r.who, r.text].filter(Boolean).join(' · '), state: 'pending' as OcState, tags: [{ label: r.meta || 'waiting', tone: 'amber' as OcTone }], href: r.href })) : []
      gates.push(mk(OPEN_GATES[7], rows, cd ? null : 'Could not read the inbox', cd && cd.tiles.guestDesk.messages > rows.length ? cd.tiles.guestDesk.messages + ' waiting in all' : null))
    }
    // MONEY
    gates.push(moneyGate(OPEN_GATES[8], unpaid, claims, r => r.bucket === 'in_house' || r.bucket === 'today'))
  } else {
    // CLEANS OPEN — the Today rows, drawn with the shared CleanRow
    {
      const rows: OcRow[] = []
      if (cd) for (const c of cd.tiles.cleans.rows) {
        if (c.status === 'done' || c.status === 'vendor' || c.status === 'extended') continue
        const tags: OcTag[] = []
        if (c.status === 'late' || c.behind === 'late') tags.push({ label: 'late', tone: 'rose' })
        if (c.status === 'atRisk' || c.behind === 'atRisk') tags.push({ label: 'at risk', tone: 'amber' })
        if (c.sameDay) tags.push({ label: 'same-day', tone: 'amber' })
        if (!c.who) tags.push({ label: 'nobody on it', tone: 'rose' })
        if (!c.arrivingAt) tags.push({ label: 'no arrival tonight', tone: 'emerald', title: 'Unit is empty tonight — the clean can move to tomorrow' })
        rows.push({ key: 'clean:' + c.taskId, kind: 'clean', unit: c.unit, meta: [c.who, c.arrivingAt ? 'guest in ' + c.arrivingAt : '', c.market].filter(Boolean).join(' · '), state: c.status === 'running' ? 'active' : 'pending', tags, taskId: c.taskId, dept: 'housekeeping', who: c.who || null, late: c.status === 'late', running: c.status === 'running', clean: c, href: '/plan', market: c.market || null })
      }
      gates.push(mk(CLOSE_GATES[0], rows, cd ? null : 'Could not read Today', cd ? cd.tiles.cleans.done + ' of ' + cd.tiles.cleans.total + ' done' + (cd.tiles.cleans.extended ? ' · ' + cd.tiles.cleans.extended + ' extended' : '') : null))
    }
    // INSPECTIONS OPEN
    {
      const rows: OcRow[] = []
      if (cd) for (const t of cd.tiles.tasks.rows) {
        if (!INSPECT_RE.test(t.name) && !/inspect/i.test(t.dept + ' ' + t.type)) continue
        if (t.state === 'done') continue
        const tags: OcTag[] = []
        if (/review|recovery/i.test(t.name)) tags.push({ label: 'bad review', tone: 'rose' })
        if (/vip|big|arrival|owner/i.test(t.name)) tags.push({ label: 'arrival', tone: 'brand' })
        if (/deep/i.test(t.name)) tags.push({ label: 'deep clean', tone: 'violet' })
        if (!t.who) tags.push({ label: 'unassigned', tone: 'amber' })
        rows.push({ key: 'task:' + t.taskId, kind: 'inspection', unit: t.unit, meta: [t.name, t.who, t.market].filter(Boolean).join(' · '), state: t.state === 'running' ? 'active' : 'pending', tags, taskId: t.taskId, dept: 'inspection', who: t.who || null, late: t.late, running: t.state === 'running', href: '/plan', market: t.market || null })
      }
      gates.push(mk(CLOSE_GATES[1], rows, cd ? null : 'Could not read Today', null))
    }
    // TOMORROW'S CLEANS
    {
      const rows = schedT ? cleanRows(schedT, asks, nextNightOpen, LONG).filter(r => r.state !== 'done') : []
      gates.push(mk(CLOSE_GATES[2], rows, schedT ? null : "Could not build tomorrow's schedule", schedT ? schedT.filter(c => !c.vendor).length + ' cleans tomorrow' : null))
    }
    // TOMORROW'S TEAM
    {
      const rows = teamOf(null, shiftsT, tomorrow, tasksT, false)
      gates.push(mk(CLOSE_GATES[3], rows, shiftsT ? null : "Could not read tomorrow's shifts", rows.length ? rows.length + ' on the Homebase schedule tomorrow' : 'Nobody on the Homebase schedule tomorrow yet'))
    }
    // ARRIVALS IN
    {
      const rows: OcRow[] = []
      if (cd && res) {
        for (const a of cd.tiles.arrivals.rows) {
          if (!a.today) continue
          const r = resList.find(x => x.id === a.reservationId)
          const flags = r ? arrivalFlags(r, { today: day, long: LONG, big: BIG, vips: vips || new Set<string>(), departsSameDay }) : []
          const tags = flags.slice()
          let state: OcState = 'done'
          if (!a.welcomeDone) { tags.push({ label: 'call owed', tone: 'amber', title: 'No welcome call logged — is the guest in?' }); state = 'pending' }
          else tags.push({ label: 'called', tone: 'emerald' })
          if (a.inspection === 'none' && flags.length) { tags.push({ label: 'no inspection', tone: 'amber' }); state = 'pending' }
          if (state === 'done' && !flags.length) continue
          rows.push({ key: 'arr:' + a.reservationId, kind: 'arrival', unit: a.unit, meta: [a.guest, a.nights + ' night' + (a.nights === 1 ? '' : 's'), a.value ? '$' + Math.round(a.value).toLocaleString('en-US') : ''].filter(Boolean).join(' · '), state, tags, reservationId: a.reservationId, href: '/welcome-calls' })
        }
      }
      gates.push(mk(CLOSE_GATES[4], rows, cd ? null : 'Could not read arrivals', cd ? cd.tiles.arrivals.today + ' arrived today' : null))
    }
    // GLITCHES OWNED
    gates.push(glitchGate(CLOSE_GATES[5], glitches, glitchTasks, day, 'unowned'))
    // TOMORROW'S FLAGS
    {
      const rows: OcRow[] = []
      if (res) {
        for (const r of resList) {
          if (r.check_in !== tomorrow) continue
          const flags = arrivalFlags(r, { today: day, long: LONG, big: BIG, vips: vips || new Set<string>(), departsSameDay })
          if (!flags.length) continue
          rows.push({ key: 'arrT:' + r.id, kind: 'flag', unit: str(r.listing_name) || 'Unit', meta: [r.guest_name || 'Guest', 'arrives tomorrow', r.nights + ' night' + (r.nights === 1 ? '' : 's')].filter(Boolean).join(' · '), state: 'pending', tags: flags, reservationId: r.id, href: '/reservations?id=' + r.id })
        }
        for (const r of resList) {
          if (r.check_out !== tomorrow) continue
          const open = nextNightOpen(r.listing_id, tomorrow)
          const asked = asks.has(r.id)
          if (!open || (r.nights < LONG && !asked)) continue
          const tags: OcTag[] = [{ label: 'may extend', tone: 'amber', title: 'Leaves tomorrow with the next night open' }]
          if (r.nights >= LONG) tags.push({ label: 'long stay out · ' + r.nights + 'n', tone: 'violet' })
          if (asked) tags.push({ label: 'asked to extend', tone: 'amber' })
          rows.push({ key: 'extT:' + r.id, kind: 'flag', unit: str(r.listing_name) || 'Unit', meta: [r.guest_name || 'Guest', 'leaves tomorrow', 'next night open'].join(' · '), state: 'pending', tags, reservationId: r.id, href: '/schedule?date=' + tomorrow })
        }
      }
      if (tasksT) for (const t of tasksT) {
        if (!INSPECT_RE.test(t.name) || !/review|recovery/i.test(t.name)) continue
        rows.push({ key: 'taskT:' + t.id, kind: 'inspection', unit: t.name.replace(/\s+/g, ' ').slice(0, 60), meta: [t.assignees.join(', ') || 'unassigned', 'tomorrow'].join(' · '), state: 'pending', tags: [{ label: 'bad review', tone: 'rose' }], taskId: t.id, dept: 'inspection', who: t.assignees.join(', ') || null, href: '/plan' })
      }
      if (visitsT) for (const v of visitsT) rows.push({ key: 'visitT:' + v.id, kind: 'vendor', unit: v.where || v.vendor || 'Vendor', meta: [v.vendor, v.title, 'tomorrow'].filter(Boolean).join(' · '), state: v.announced ? 'active' : 'pending', tags: [v.announced ? { label: 'building told', tone: 'emerald' as OcTone } : { label: 'building not told', tone: 'amber' as OcTone }], href: v.href })
      gates.push(mk(CLOSE_GATES[6], rows, res ? null : 'Could not read reservations', null))
    }
    // MONEY TOMORROW
    gates.push(moneyGate(CLOSE_GATES[7], unpaid, claims, r => r.bucket === 'today' || r.bucket === 'week' || r.bucket === 'in_house'))
  }

  // Helpers that need the closure.
  function glitchGate(def: GateDef, gl: Glitch[] | null, tasks: Record<string, BzTask> | null, today: string, which: 'all' | 'unowned'): OcGate {
    const rows: OcRow[] = []
    if (gl) for (const g of gl) {
      const t = g.breezeway_task_id && tasks ? tasks[g.breezeway_task_id] || null : null
      const tDone = t ? isTaskDone(t.status, t.finished_at) : /completed/i.test(str(g.task_status))
      const tRun = t ? isTaskRunning(t.status, t.started_at) : /progress/i.test(str(g.task_status))
      const hasTask = !!g.breezeway_task_id
      const state: OcState = !hasTask ? 'pending' : tDone ? 'done' : tRun ? 'active' : 'pending'
      const owner = g.assignee || (t && t.assignees.length ? t.assignees.join(', ') : '')
      if (which === 'unowned' && owner) continue
      const ageDays = Math.floor((Date.now() - Date.parse(g.created_at)) / 86400000)
      const overdue = !!(g.due_date && str(g.due_date).slice(0, 10) < today)
      const tags: OcTag[] = []
      if (/urgent/i.test(str(g.priority))) tags.push({ label: 'Urgent', tone: 'roseSolid' })
      if (overdue) tags.push({ label: 'overdue', tone: 'rose', title: 'Due ' + str(g.due_date).slice(0, 10) })
      if (g.glitch_type) tags.push({ label: g.glitch_type, tone: 'slate' })
      if (!hasTask) tags.push({ label: 'no task', tone: 'amber', title: 'No Breezeway task yet — nobody in the field can see this' })
      else if (tDone) tags.push({ label: 'task done', tone: 'emerald', title: 'The crew closed the task — tell the guest and close the card' })
      else if (tRun) tags.push({ label: 'task running', tone: 'sky' })
      else tags.push({ label: 'task not started', tone: 'slate' })
      if (!owner) tags.push({ label: 'no owner', tone: 'amber' })
      rows.push({
        key: 'glitch:' + g.id, kind: 'glitch', unit: g.unit, state, tags, glitchId: g.id,
        meta: [g.guest_name, str(g.category || g.overview || '').replace(/\s+/g, ' ').slice(0, 70), owner, ageDays + 'd open'].filter(Boolean).join(' · '),
        href: '/glitches?id=' + g.id,
        taskId: g.breezeway_task_id, dept: 'maintenance', who: t ? t.assignees.join(', ') || null : null, running: tRun, done: tDone,
        task: t ? { id: t.id, name: t.name, status: tDone ? 'done' : tRun ? 'running' : 'open', who: t.assignees.join(', '), date: t.scheduled_date, priority: t.priority } : null,
      })
    }
    rows.sort((a, b) => (a.state === 'pending' ? 0 : a.state === 'active' ? 1 : 2) - (b.state === 'pending' ? 0 : b.state === 'active' ? 1 : 2))
    return mk(def, rows, gl ? null : 'Could not read glitches', gl ? gl.length + ' open in all' : null)
  }
  function moneyGate(def: GateDef, up: any, cl: Claim[] | null, keep: (r: any) => boolean): OcGate {
    const rows: OcRow[] = []
    if (up && Array.isArray(up.rows)) for (const r of up.rows as any[]) {
      if (!keep(r)) continue
      const st = str(r.tracking && r.tracking.status) || 'open'
      if (st === 'waived') continue
      const tags: OcTag[] = [{ label: '$' + Math.round(num(r.balance)).toLocaleString('en-US') + ' owed', tone: 'rose' }, { label: r.bucket === 'in_house' ? 'in house' : r.bucket === 'today' ? 'arriving today' : 'next 7 days', tone: 'slate' }]
      if (st !== 'open') tags.push({ label: st, tone: 'sky' })
      rows.push({ key: 'unpaid:' + r.id, kind: 'money', unit: str(r.unit), meta: [r.guest, r.checkIn ? 'in ' + str(r.checkIn).slice(5) : '', r.source].filter(Boolean).join(' · '), state: st === 'open' ? 'pending' : 'active', tags, href: '/reservations/unpaid', reservationId: str(r.id) })
    }
    if (cl) for (const c of cl) rows.push({ key: 'claim:' + c.id, kind: 'money', unit: [c.property, c.unit].filter(Boolean).join(' '), meta: [c.guest, c.stage.replace(/_/g, ' '), c.deadline ? 'file by ' + c.deadline.slice(5) : ''].filter(Boolean).join(' · '), state: 'pending', tags: [{ label: c.daysLeft != null && c.daysLeft <= 2 ? 'file now' : 'claim due', tone: c.daysLeft != null && c.daysLeft <= 2 ? 'rose' : 'amber' }], href: '/claims' })
    return mk(def, rows, up || cl ? null : 'Could not read unpaid balances', null)
  }

  // THE EVE LINE — the one move the capacity model would make today (Today's "moves"), if any.
  let eve: string | null = null
  if (cd && cd.tiles.team.moves && cd.tiles.team.moves.length) {
    const m = cd.tiles.team.moves[0]
    eve = (m.kind === 'assign' ? `Give ${m.unit} to ${m.toPerson}` : `Move ${m.unit} from ${m.fromPerson || 'its cleaner'} to ${m.toPerson}`) + ` — ${m.why}` + (m.toAfterPct ? ` (${m.toPerson} ${m.toBeforePct}% → ${m.toAfterPct}%)` : '') + (cd.tiles.team.moves.length > 1 ? ` · ${cd.tiles.team.moves.length - 1} more on Today` : '')
  }

  const gatesClear = gates.filter(g => g.auto || g.signed).length
  return {
    ok: true, mode, day, tomorrow, yesterday, clock, generatedAt: now.toISOString(), degraded, gates, carried,
    today: days[day] || null, handover: days[yesterday] || null,
    summary: {
      cleans: cd ? cd.tiles.cleans.total : (sched ? sched.length : 0), cleansDone: cd ? cd.tiles.cleans.done : 0,
      arrivals: cd ? cd.tiles.arrivals.today : 0, onShift: cd ? cd.tiles.team.onShift : (shifts ? shifts.filter(s => !s.open).length : 0),
      gatesClear, gatesLate: gates.filter(g => g.late).length, gatesTotal: gates.length,
    },
    eve, tables: signs.tables,
  }
}

// ── writes ─────────────────────────────────────────────────────────────────────────────────────
const needs157 = (e: any) => /relation|does not exist|schema cache/i.test(str(e && e.message))
const NEED = 'This needs migration 157 — run it in Supabase and this will work.'

export async function signGate(day: string, gate: string, mode: OcMode, who: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin()
  if (!on) { const { error } = await sb.from('oc_signoffs').delete().eq('day', day).eq('gate', gate); return error ? { ok: false, error: needs157(error) ? NEED : error.message } : { ok: true } }
  const { error } = await sb.from('oc_signoffs').upsert({ day, gate, mode, done_by: who, done_at: new Date().toISOString() }, { onConflict: 'day,gate' })
  return error ? { ok: false, error: needs157(error) ? NEED : error.message } : { ok: true }
}
export async function carryRow(day: string, who: string, row: { key: string; kind?: string | null; unit?: string | null; title: string; note?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = supabaseAdmin()
  // Carrying the same row twice keeps one open copy.
  const { data: dup } = await sb.from('oc_carry').select('id').eq('key', row.key).is('resolved_at', null).limit(1)
  if (dup && dup.length) {
    const { error } = await sb.from('oc_carry').update({ note: row.note || null, from_day: day, by: who }).eq('id', dup[0].id)
    return error ? { ok: false, error: error.message } : { ok: true, id: str(dup[0].id) }
  }
  const { data, error } = await sb.from('oc_carry').insert({ key: row.key, kind: row.kind || null, unit: row.unit || null, title: row.title.slice(0, 200), note: row.note ? row.note.slice(0, 600) : null, from_day: day, by: who }).select('id').single()
  return error ? { ok: false, error: needs157(error) ? NEED : error.message } : { ok: true, id: str(data && data.id) }
}
export async function resolveCarry(id: string, who: string, how: 'done' | 'dropped'): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin().from('oc_carry').update({ resolved_at: new Date().toISOString(), resolved_by: who, resolved_how: how }).eq('id', id)
  return error ? { ok: false, error: needs157(error) ? NEED : error.message } : { ok: true }
}
export async function markDay(day: string, who: string, what: 'open' | 'close', note?: string | null, snapshot?: any): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin()
  const now = new Date().toISOString()
  const patch: any = what === 'open' ? { day, opened_by: who, opened_at: now } : { day, closed_by: who, closed_at: now, note: note ? note.slice(0, 2000) : null, snapshot: snapshot ?? null }
  const { error } = await sb.from('oc_days').upsert(patch, { onConflict: 'day' })
  return error ? { ok: false, error: needs157(error) ? NEED : error.message } : { ok: true }
}
export function firstName(s: string | null | undefined): string { return first(s) }
export function agoMinutes(min: number): string { return hm(min) }
