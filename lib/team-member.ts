// TEAM ONBOARDING + EVERY PERSON'S OWN PAGE (Jon, 2026-11-25).
//
//   "The goal is simple: get them on apps, get them understanding how we use Breezeway, get them on
//    Homebase, Breezeway, Slack, Lighthouse. Understand red-button issues, and how to change door
//    locks." · "We need to follow that process, and be able to quiz or resend quiz after an issue to
//    make sure they are retrained. We also need to track all they do, keep a profile for them. Where
//    they can see their stats, hours worked, tasks assigned, training and profile. And schedule when
//    pushed." · "Once approved they can also see their inspections from us about cleans, and we can
//    track overall performance." · "They get an email."
//
// ONE PERSON, ONE PAGE, TWO VIEWERS. /learn/<code> (no login — the code is the key, emailed to them)
// and the manager's profile sheet on Training → People read the SAME bundle from `profileFor`. The
// only difference is what the person may see: their inspections appear once a supervisor has SENT
// the report (that is the approval), and the manager also sees the activity log and issues.
//
// THE PROCESS (one fixed order, so everyone is onboarded the same way):
//   1. Invited    the person row exists with a role track and an email; the invite email went out
//   2. Apps       Homebase, Breezeway, Slack, Lighthouse — the person ticks each from their page once
//                 they are in (a manager can tick for them)
//   3. Training   every item on their track watched / read, and every quiz on it passed (100%)
//   4. Handbook   they type their full name to sign the acknowledgment
//   → Onboarded   stamped the moment all four are true, never by hand
//
// RETRAINING (Jon did not pick when it fires; the reading taken, said in the session): a manager
// logs the issue on the person (red-button, inspection, guest, other) and picks the training to
// redo. Those items are re-opened, their quizzes must be passed again, the person is emailed, and
// the issue closes itself once every item is done again. Inspection weak areas already SUGGEST
// training on Training → Inspections; nothing is sent without a person pressing the button.
//
// FAIL-OPEN: before migration 182 runs, every read degrades (no onboarding block, no quizzes) and
// the writes answer "run migration 182".
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { nameMatches } from './person-name'
import { isDepartureCleanName } from './breezeway'
import { getTimecards } from './homebase-labor'
import { weekRoster } from './team-roster'
import { MARKETS } from './segments'
import { sendResendEmail } from './resend-send'
import { sendGmail } from './gmail-send'
import { stayEmail, escHtml } from './email-layout'
import {
  listItems, playableUrls, assignmentsFor, personByKey, ensurePerson, complete as completeItem,
  type Person, type TrainingItem, type Assignment, type Lang,
} from './training'

export const MIGRATION = '182_team_onboarding.sql'
export const HANDBOOK_VERSION = '2026-11'

// ---------------------------------------------------------------- tracks + steps
export type Track = 'housekeeping' | 'maintenance' | 'ops' | 'ccs_admin'
export const TRACKS: { key: Track; label: { en: string; es: string }; audience: string[] }[] = [
  { key: 'housekeeping', label: { en: 'Housekeeping', es: 'Limpieza' }, audience: ['housekeeping'] },
  { key: 'maintenance', label: { en: 'Maintenance', es: 'Mantenimiento' }, audience: ['maintenance'] },
  { key: 'ops', label: { en: 'Supervisors / Ops', es: 'Supervisores / Operaciones' }, audience: ['supervision', 'inspection'] },
  { key: 'ccs_admin', label: { en: 'CCS + Admin', es: 'Atención al cliente + Oficina' }, audience: ['ccs', 'office'] },
]
export const trackOf = (v: any): Track | null => (TRACKS.some(t => t.key === v) ? (v as Track) : null)

export type AppStep = 'homebase' | 'breezeway' | 'slack' | 'lighthouse'
export const APPS: { key: AppStep; label: string; how: { en: string; es: string } }[] = [
  { key: 'homebase', label: 'Homebase', how: { en: 'Your schedule and your hours. Clock in when you start, clock out when you finish.', es: 'Tu horario y tus horas. Marca entrada al empezar y salida al terminar.' } },
  { key: 'breezeway', label: 'Breezeway', how: { en: 'Your tasks: every clean, inspection and job, with the unit and the time.', es: 'Tus tareas: cada limpieza, inspección y trabajo, con la unidad y la hora.' } },
  { key: 'slack', label: 'Slack', how: { en: 'How the team talks. Add your photo, role, email and phone to your profile.', es: 'Cómo se comunica el equipo. Agrega tu foto, puesto, correo y teléfono a tu perfil.' } },
  { key: 'lighthouse', label: 'Lighthouse', how: { en: 'This page: your training, schedule, hours and inspections. Save it to your home screen.', es: 'Esta página: tu capacitación, horario, horas e inspecciones. Guárdala en tu pantalla de inicio.' } },
]
const isApp = (v: any): v is AppStep => APPS.some(a => a.key === v)

// ---------------------------------------------------------------- quizzes
export type QuizQuestion = { q: { en: string; es: string | null }; options: { en: string[]; es: string[] | null }; answer: number }
export type Quiz = { itemId: string; questions: QuizQuestion[] }

const str = (v: any) => (v == null ? '' : String(v))
const clean = (v: any, max: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, max)
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const sunOf = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return addDays(ymd, -d.getUTCDay()) }
export const isMissing = (e: any) => /does not exist|schema cache|could not find the (table|column)|42P01|42703|PGRST20[45]/i.test(str(e?.message || e))
const siteOrigin = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')
export const pageUrl = (code: string) => siteOrigin() + '/learn/' + code

function normQuestions(raw: any): QuizQuestion[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: QuizQuestion[] = []
  for (const r of arr.slice(0, 12)) {
    const qEn = clean(r?.q?.en ?? r?.qEn, 300)
    const optsEn = (Array.isArray(r?.options?.en) ? r.options.en : Array.isArray(r?.optionsEn) ? r.optionsEn : []).map((o: any) => clean(o, 200)).filter(Boolean).slice(0, 5)
    if (!qEn || optsEn.length < 2) continue
    const qEs = clean(r?.q?.es ?? r?.qEs, 300) || null
    const optsEsRaw = (Array.isArray(r?.options?.es) ? r.options.es : Array.isArray(r?.optionsEs) ? r.optionsEs : []).map((o: any) => clean(o, 200))
    const optsEs = optsEsRaw.length === optsEn.length && optsEsRaw.every(Boolean) ? optsEsRaw : null
    const answer = Math.max(0, Math.min(optsEn.length - 1, Math.round(Number(r?.answer) || 0)))
    out.push({ q: { en: qEn, es: qEs }, options: { en: optsEn, es: optsEs }, answer })
  }
  return out
}

export async function quizzesFor(itemIds: string[]): Promise<Record<string, QuizQuestion[]>> {
  const ids = itemIds.filter(Boolean)
  if (!ids.length) return {}
  try {
    const { data, error } = await supabaseAdmin().from('training_quizzes').select('item_id,questions').in('item_id', ids)
    if (error) return {}
    const out: Record<string, QuizQuestion[]> = {}
    for (const r of (data || []) as any[]) { const qs = normQuestions(r.questions); if (qs.length) out[str(r.item_id)] = qs }
    return out
  } catch { return {} }
}
export async function saveQuiz(itemId: string, questions: any, by: string): Promise<{ ok: boolean; error?: string; questions?: QuizQuestion[] }> {
  const qs = normQuestions(questions)
  const db = supabaseAdmin()
  const { error } = qs.length
    ? await db.from('training_quizzes').upsert({ item_id: itemId, questions: qs, updated_by: by, updated_at: new Date().toISOString() })
    : await db.from('training_quizzes').delete().eq('item_id', itemId)
  if (error) return { ok: false, error: isMissing(error) ? `Run migration ${MIGRATION} in Supabase first.` : error.message }
  return { ok: true, questions: qs }
}

// ---------------------------------------------------------------- the activity log
export async function logActivity(personKey: string, kind: string, detail: Record<string, any> = {}, by: string | null = null): Promise<void> {
  try { await supabaseAdmin().from('team_activity').insert({ person_key: personKey, kind, detail, by }) } catch { /* trail only */ }
}

// ---------------------------------------------------------------- the person row (182 columns)
export type Onboarding = {
  track: Track | null; startDate: string | null; phone: string | null; active: boolean
  apps: Record<AppStep, string | null>             // when each app was confirmed
  ack: { name: string; at: string; version: string } | null
  invitedAt: string | null; inviteError: string | null; onboardedAt: string | null
}
async function onboardingRow(key: string): Promise<{ row: any | null; migrated: boolean }> {
  const { data, error } = await supabaseAdmin().from('training_people').select('key,role_track,start_date,onboarding,ack_name,ack_at,ack_version,invited_at,invite_error,onboarded_at,phone,active').eq('key', key).maybeSingle()
  if (error) return { row: null, migrated: !isMissing(error) }
  return { row: data, migrated: true }
}
function onboardingOf(r: any): Onboarding {
  const ob = r?.onboarding && typeof r.onboarding === 'object' ? r.onboarding : {}
  const apps = {} as Record<AppStep, string | null>
  for (const a of APPS) apps[a.key] = ob?.apps?.[a.key] ? str(ob.apps[a.key]) : null
  return {
    track: trackOf(r?.role_track), startDate: r?.start_date ?? null, phone: r?.phone ?? null, active: r?.active !== false,
    apps, ack: r?.ack_at ? { name: str(r.ack_name), at: str(r.ack_at), version: str(r.ack_version) } : null,
    invitedAt: r?.invited_at ?? null, inviteError: r?.invite_error ?? null, onboardedAt: r?.onboarded_at ?? null,
  }
}

/** Items on a track: the track's audience, plus every required item. Ordered as the library is. */
export function trackItems(items: TrainingItem[], track: Track | null): TrainingItem[] {
  const aud = TRACKS.find(t => t.key === track)?.audience || []
  return items.filter(i => i.status === 'active' && (i.required || i.audience.some(a => aud.indexOf(a) >= 0)))
}

// ---------------------------------------------------------------- work, hours, schedule, inspections
type TaskRow = { id: string; date: string; unit: string; name: string; status: 'done' | 'in progress' | 'scheduled'; clean: boolean; finishedAt: string | null }
const taskCache: { at: number; from: string; rows: any[] } = { at: 0, from: '', rows: [] }
async function windowTasks(from: string, to: string): Promise<any[]> {
  if (taskCache.from === from + to && Date.now() - taskCache.at < 5 * 60 * 1000) return taskCache.rows
  const got = await pageRows((a, b) => supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,finished_at')
    .gte('scheduled_date', from).lte('scheduled_date', to).order('scheduled_date').order('id').range(a, b), 15)
  const rows = got.rows.filter((t: any) => str(t.status).toLowerCase() !== 'deleted')
  taskCache.at = Date.now(); taskCache.from = from + to; taskCache.rows = rows
  return rows
}
const assigneesOf = (t: any): string[] => (Array.isArray(t.assignees) ? t.assignees : []).map((x: any) => str(x && typeof x === 'object' ? (x.name || [x.first_name, x.last_name].filter(Boolean).join(' ')) : x).trim()).filter(Boolean)
const statusOf = (t: any): TaskRow['status'] => (/complet|finish|close|approv/i.test(str(t.status)) || t.finished_at ? 'done' : /progress|start/i.test(str(t.status)) ? 'in progress' : 'scheduled')

async function tasksFor(name: string, from: string, to: string): Promise<TaskRow[]> {
  const rows = (await windowTasks(from, to)).filter(t => assigneesOf(t).some(a => nameMatches(a, name)))
  const ids = Array.from(new Set(rows.map(t => str(t.reference_property_id)).filter(Boolean)))
  const names: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title').in('id', ids.slice(i, i + 300))
    for (const l of (data || []) as any[]) names[str(l.id)] = str(l.nickname || l.title)
  }
  return rows.map(t => ({ id: str(t.id), date: str(t.scheduled_date).slice(0, 10), unit: names[str(t.reference_property_id)] || '', name: str(t.name), status: statusOf(t), clean: isDepartureCleanName(t.name), finishedAt: t.finished_at ?? null }))
}

type DayHours = { date: string; hours: number; clockIn: string | null; clockOut: string | null; open: boolean }
async function hoursFor(name: string, from: string, to: string): Promise<{ ok: boolean; days: DayHours[]; error?: string }> {
  try {
    const cards = (await getTimecards(from, to)).filter(c => nameMatches(c.name, name))
    const days = cards.map(c => ({ date: str(c.date), hours: Math.round((c.hours || 0) * 100) / 100, clockIn: c.clockIn, clockOut: c.clockOut, open: c.open }))
      .sort((a, b) => b.date.localeCompare(a.date))
    return { ok: true, days }
  } catch (e: any) { return { ok: false, days: [], error: 'Homebase did not answer: ' + str(e?.message || e).slice(0, 120) } }
}

export type ScheduleDay = { date: string; status: string; shift: string | null }
export type ScheduleWeek = { weekStart: string; market: string; pushedAt: string; days: ScheduleDay[] }
async function scheduleFor(name: string, market: string | null): Promise<ScheduleWeek[]> {
  const today = ymdET()
  const weeks = [sunOf(today), addDays(sunOf(today), 7)]
  let pushes: any[] = []
  try {
    const { data, error } = await supabaseAdmin().from('schedule_pushes').select('week_start,market,pushed_at').in('week_start', weeks)
    if (error) return []
    pushes = (data || []) as any[]
  } catch { return [] }
  const mine = pushes.filter(p => !market || str(p.market).toLowerCase() === market.toLowerCase())
  const out: ScheduleWeek[] = []
  for (const p of mine) {
    const ws = str(p.week_start).slice(0, 10), mk = str(p.market)
    const { data: row } = await supabaseAdmin().from('team_schedule').select('doc').eq('week_start', ws).eq('market', mk).maybeSingle()
    const roster = await weekRoster(ws, mk, (row as any)?.doc ?? null).catch(() => null)
    const person = roster?.people.find(rp => nameMatches(rp.name, name))
    if (!person) continue
    out.push({ weekStart: ws, market: mk, pushedAt: str(p.pushed_at), days: roster!.dates.map(d => ({ date: d, status: person.days[d]?.status || 'OFF', shift: person.days[d]?.shift || null })) })
  }
  return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export type InspectionRow = { taskId: string; date: string | null; unit: string | null; score: number | null; passRate: number | null; misses: number; reportCode: string | null }
async function inspectionsFor(key: string, sentOnly: boolean): Promise<{ reports: { code: string; createdAt: string; sentAt: string | null; avgScore: number | null; avgPassRate: number | null; count: number }[]; rows: InspectionRow[] }> {
  const db = supabaseAdmin()
  let reports: any[] = []
  try {
    let q = db.from('inspection_reports').select('code,task_ids,summary,status,created_at,sent_at').eq('person_key', key).order('created_at', { ascending: false }).limit(20)
    if (sentOnly) q = q.eq('status', 'sent')
    const { data } = await q
    reports = (data || []) as any[]
  } catch { /* 175 not run */ }
  const reportOf: Record<string, string> = {}
  for (const r of reports) for (const t of (Array.isArray(r.task_ids) ? r.task_ids : [])) reportOf[str(t)] = str(r.code)
  let rows: any[] = []
  try {
    const since = new Date(Date.now() - 90 * 864e5).toISOString()
    const { data } = await db.from('inspection_results').select('task_id,unit,finished_at,scheduled_date,score,pass_rate,misses').eq('subject_key', key).gte('finished_at', since).order('finished_at', { ascending: false }).limit(60)
    rows = (data || []) as any[]
  } catch { /* 174 not run */ }
  if (sentOnly) rows = rows.filter(r => reportOf[str(r.task_id)])
  return {
    reports: reports.map(r => ({ code: str(r.code), createdAt: str(r.created_at), sentAt: r.sent_at ?? null, avgScore: r.summary?.avgScore ?? null, avgPassRate: r.summary?.avgPassRate ?? null, count: Number(r.summary?.count) || (Array.isArray(r.task_ids) ? r.task_ids.length : 0) })),
    rows: rows.map(r => ({ taskId: str(r.task_id), date: str(r.finished_at || r.scheduled_date).slice(0, 10) || null, unit: r.unit ?? null, score: r.score == null ? null : Number(r.score), passRate: r.pass_rate == null ? null : Number(r.pass_rate), misses: Array.isArray(r.misses) ? r.misses.length : 0, reportCode: reportOf[str(r.task_id)] || null })),
  }
}

// ---------------------------------------------------------------- the bundle
export type TrainingRow = {
  id: string; kind: TrainingItem['kind']; title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; body: { en: string | null; es: string | null }
  durationSec: number | null; url: { en: string | null; es: string | null }; onTrack: boolean
  assignment: { dueOn: string | null; completedAt: string | null; reason: string | null; round: number } | null
  quiz: { questions: { q: { en: string; es: string | null }; options: { en: string[]; es: string[] | null } }[]; passedAt: string | null; lastScore: string | null; attempts: number } | null
}
export type Issue = { id: string; kind: string; note: string | null; ref: string | null; itemIds: string[]; status: string; createdBy: string | null; createdAt: string; closedAt: string | null }
export type Activity = { kind: string; detail: any; by: string | null; at: string }
export type Profile = {
  ok: true; migrated: boolean; today: string
  person: { key: string; name: string; email: string | null; phone: string | null; lang: Lang; dept: string | null; market: string | null; code: string }
  onboarding: Onboarding & { trackLabel: string | null; steps: { key: 'invited' | 'apps' | 'training' | 'handbook'; done: boolean; label: { en: string; es: string } }[]; percent: number; handbookVersion: string }
  training: TrainingRow[]
  schedule: ScheduleWeek[]
  tasks: { today: TaskRow[]; upcoming: TaskRow[]; recent: TaskRow[] }
  hours: { ok: boolean; error?: string; days: DayHours[]; thisWeek: number; lastWeek: number; last14: number }
  inspections: { reports: { code: string; createdAt: string; sentAt: string | null; avgScore: number | null; avgPassRate: number | null; count: number }[]; rows: InspectionRow[] }
  stats: { cleans30: number; tasks30: number; hours14: number; hoursPerClean: number | null; avgScore: number | null; avgPassRate: number | null; inspections: number; trainingDone: number; trainingTotal: number; quizzesPassed: number; openIssues: number }
  issues: Issue[]
  activity: Activity[]
}

type TrainingPart = { migrated: boolean; ob: Onboarding; training: TrainingRow[]; steps: Profile['onboarding']['steps']; trainingDone: number; trainingTotal: number }
/** The onboarding + training half of a profile — cheap (no Homebase, no task scan), so progress checks can use it. */
async function trainingPart(p: Person): Promise<TrainingPart> {
  const db = supabaseAdmin()
  const [{ row, migrated }, items, assigned] = await Promise.all([onboardingRow(p.key), listItems(false), assignmentsFor(p.key)])
  const ob = onboardingOf(row)
  const byItem: Record<string, Assignment & { reason?: string | null; round?: number }> = {}
  if (migrated) {
    try {
      const { data } = await db.from('training_assignments').select('item_id,reason,round').eq('person_key', p.key)
      const extra: Record<string, any> = {}
      for (const r of (data || []) as any[]) extra[str(r.item_id)] = r
      for (const a of assigned) byItem[a.itemId] = { ...a, reason: extra[a.itemId]?.reason ?? null, round: Number(extra[a.itemId]?.round) || 1 }
    } catch { for (const a of assigned) byItem[a.itemId] = a }
  } else for (const a of assigned) byItem[a.itemId] = a
  const onTrack = trackItems(items, ob.track)
  const onTrackIds = onTrack.map(i => i.id)
  const mine = items.filter(i => byItem[i.id] || onTrackIds.indexOf(i.id) >= 0)
  const [urls, quizzes] = await Promise.all([playableUrls(mine), quizzesFor(mine.map(i => i.id))])

  let attempts: any[] = []
  if (migrated) { try { const { data } = await db.from('training_quiz_attempts').select('item_id,score,total,passed,at').eq('person_key', p.key).order('at', { ascending: false }).limit(200); attempts = (data || []) as any[] } catch {} }

  const training: TrainingRow[] = mine.map(i => {
    const a = byItem[i.id]
    const qs = quizzes[i.id]
    let quiz: TrainingRow['quiz'] = null
    if (qs) {
      // A pass only counts for the CURRENT round: a retraining re-opens the item and its quiz with it.
      const since = a?.completedAt ? null : a?.assignedAt || null
      const mineA = attempts.filter(x => str(x.item_id) === i.id)
      const pass = mineA.find(x => x.passed && (!since || str(x.at) >= str(since)))
      quiz = { questions: qs.map(q => ({ q: q.q, options: q.options })), passedAt: pass ? str(pass.at) : null, lastScore: mineA[0] ? `${mineA[0].score}/${mineA[0].total}` : null, attempts: mineA.length }
    }
    return {
      id: i.id, kind: i.kind, title: i.title, summary: i.summary, body: i.body, durationSec: i.durationSec, url: urls[i.id] || { en: null, es: null },
      onTrack: onTrackIds.indexOf(i.id) >= 0,
      assignment: a ? { dueOn: a.dueOn, completedAt: a.completedAt, reason: (a as any).reason ?? null, round: (a as any).round || 1 } : null,
      quiz,
    }
  }).sort((x, y) => (x.assignment?.completedAt ? 1 : 0) - (y.assignment?.completedAt ? 1 : 0) || (x.assignment?.dueOn || '9999').localeCompare(y.assignment?.dueOn || '9999'))

  const trainingDone = training.filter(t => t.onTrack && t.assignment?.completedAt && (!t.quiz || t.quiz.passedAt)).length
  const trainingTotal = training.filter(t => t.onTrack).length
  const appsDone = APPS.every(a => !!ob.apps[a.key])
  const steps = [
    { key: 'invited' as const, done: !!ob.invitedAt || !!p.email, label: { en: 'Invited', es: 'Invitado' } },
    { key: 'apps' as const, done: appsDone, label: { en: 'Apps set up', es: 'Apps listas' } },
    { key: 'training' as const, done: trainingTotal > 0 && trainingDone === trainingTotal, label: { en: 'Training + quizzes', es: 'Capacitación + pruebas' } },
    { key: 'handbook' as const, done: !!ob.ack, label: { en: 'Handbook signed', es: 'Manual firmado' } },
  ]
  return { migrated, ob, training, steps, trainingDone, trainingTotal }
}

export async function profileFor(p: Person, opts: { manager: boolean }): Promise<Profile> {
  const db = supabaseAdmin()
  const today = ymdET()
  const { migrated, ob, training, steps, trainingDone, trainingTotal } = await trainingPart(p)

  // The person's work, hours, schedule and inspections, read side by side; any one failing leaves a hole, not an error.
  const [tasks, hours, schedule, insp] = await Promise.all([
    tasksFor(p.name, addDays(today, -30), addDays(today, 7)).catch(() => [] as TaskRow[]),
    hoursFor(p.name, addDays(sunOf(today), -7), today),
    scheduleFor(p.name, p.market).catch(() => [] as ScheduleWeek[]),
    inspectionsFor(p.key, !opts.manager),
  ])
  const cleans30 = tasks.filter(t => t.clean && t.status === 'done' && t.date <= today).length
  const tasks30 = tasks.filter(t => t.status === 'done' && t.date <= today).length
  const sumH = (from: string, to: string) => Math.round(hours.days.filter(d => d.date >= from && d.date <= to).reduce((s, d) => s + d.hours, 0) * 10) / 10
  const thisWeek = sumH(sunOf(today), today), lastWeek = sumH(addDays(sunOf(today), -7), addDays(sunOf(today), -1))
  const hours14 = sumH(addDays(today, -13), today)
  const cleans14 = tasks.filter(t => t.clean && t.status === 'done' && t.date >= addDays(today, -13) && t.date <= today).length
  const scored = insp.rows.filter(r => r.score != null), passed = insp.rows.filter(r => r.passRate != null)

  let issues: Issue[] = [], activity: Activity[] = []
  if (migrated) {
    try {
      const { data } = await db.from('team_issues').select('*').eq('person_key', p.key).order('created_at', { ascending: false }).limit(30)
      issues = ((data || []) as any[]).map(r => ({ id: str(r.id), kind: str(r.kind), note: r.note ?? null, ref: r.ref ?? null, itemIds: Array.isArray(r.item_ids) ? r.item_ids.map(str) : [], status: str(r.status), createdBy: r.created_by ?? null, createdAt: str(r.created_at), closedAt: r.closed_at ?? null }))
    } catch {}
    if (opts.manager) {
      try { const { data } = await db.from('team_activity').select('kind,detail,by,at').eq('person_key', p.key).order('at', { ascending: false }).limit(80); activity = (data || []) as any[] } catch {}
    }
  }

  return {
    ok: true, migrated, today,
    person: { key: p.key, name: p.name, email: p.email, phone: ob.phone, lang: p.lang, dept: p.dept, market: p.market, code: p.code },
    onboarding: { ...ob, trackLabel: TRACKS.find(t => t.key === ob.track)?.label.en || null, steps, percent: Math.round(steps.filter(s => s.done).length / steps.length * 100), handbookVersion: HANDBOOK_VERSION },
    training,
    schedule,
    tasks: {
      today: tasks.filter(t => t.date === today),
      upcoming: tasks.filter(t => t.date > today).slice(0, 30),
      recent: tasks.filter(t => t.date < today).reverse().slice(0, 40),
    },
    hours: { ok: hours.ok, error: hours.error, days: hours.days, thisWeek, lastWeek, last14: hours14 },
    inspections: insp,
    stats: {
      cleans30, tasks30, hours14, hoursPerClean: cleans14 && hours14 ? Math.round(hours14 / cleans14 * 10) / 10 : null,
      avgScore: scored.length ? Math.round(scored.reduce((s, r) => s + (r.score || 0), 0) / scored.length * 10) / 10 : null,
      avgPassRate: passed.length ? passed.reduce((s, r) => s + (r.passRate || 0), 0) / passed.length : null,
      inspections: insp.rows.length, trainingDone, trainingTotal,
      quizzesPassed: training.filter(t => t.quiz?.passedAt).length,
      openIssues: issues.filter(i => i.status === 'retraining').length,
    },
    issues,
    activity,
  }
}

// ---------------------------------------------------------------- the person's own actions
/** Grade a quiz. 100% passes; the item is marked done on a pass when it was watched (or is quiz-only). */
export async function submitQuiz(p: Person, itemId: string, answers: number[], lang: Lang): Promise<{ ok: true; passed: boolean; score: number; total: number; wrong: number[] } | { ok: false; error: string }> {
  const qs = (await quizzesFor([itemId]))[itemId]
  if (!qs) return { ok: false, error: 'This item has no quiz.' }
  const wrong: number[] = []
  qs.forEach((q, i) => { if (Number(answers?.[i]) !== q.answer) wrong.push(i) })
  const score = qs.length - wrong.length, passed = wrong.length === 0
  const { error } = await supabaseAdmin().from('training_quiz_attempts').insert({ item_id: itemId, person_key: p.key, score, total: qs.length, passed, answers: (answers || []).slice(0, qs.length), lang })
  if (error) return { ok: false, error: isMissing(error) ? 'Quizzes are not switched on yet.' : error.message }
  await logActivity(p.key, 'quiz', { itemId, score, total: qs.length, passed })
  if (passed) { await completeItem(itemId, p.key, lang, 'link'); await afterProgress(p.key) }
  return { ok: true, passed, score, total: qs.length, wrong }
}
/** Done on an item: an item with a quiz is done only through its quiz. */
export async function markDone(p: Person, itemId: string, lang: Lang): Promise<{ ok: boolean; error?: string; needsQuiz?: boolean }> {
  if ((await quizzesFor([itemId]))[itemId]) return { ok: false, needsQuiz: true, error: 'Take the quiz to finish this one.' }
  const r = await completeItem(itemId, p.key, lang, 'link')
  if (!r.ok) return { ok: false, error: r.error }
  await logActivity(p.key, 'completed', { itemId })
  await afterProgress(p.key)
  return { ok: true }
}
export async function setApp(p: Person, app: string, on: boolean, by: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isApp(app)) return { ok: false, error: 'Unknown app.' }
  const { row, migrated } = await onboardingRow(p.key)
  if (!migrated) return { ok: false, error: `Run migration ${MIGRATION} in Supabase first.` }
  const ob = row?.onboarding && typeof row.onboarding === 'object' ? { ...row.onboarding } : {}
  ob.apps = { ...(ob.apps || {}), [app]: on ? new Date().toISOString() : null }
  const { error } = await supabaseAdmin().from('training_people').update({ onboarding: ob }).eq('key', p.key)
  if (error) return { ok: false, error: error.message }
  await logActivity(p.key, 'step', { app, on }, by)
  await afterProgress(p.key)
  return { ok: true }
}
export async function signHandbook(p: Person, typedName: string): Promise<{ ok: boolean; error?: string }> {
  const name = clean(typedName, 80)
  if (name.length < 4 || name.split(' ').length < 2) return { ok: false, error: 'Type your first and last name.' }
  const { error } = await supabaseAdmin().from('training_people').update({ ack_name: name, ack_at: new Date().toISOString(), ack_version: HANDBOOK_VERSION }).eq('key', p.key)
  if (error) return { ok: false, error: isMissing(error) ? `Run migration ${MIGRATION} in Supabase first.` : error.message }
  await logActivity(p.key, 'signed', { name, version: HANDBOOK_VERSION })
  await afterProgress(p.key)
  return { ok: true }
}

/** After any progress: close retraining issues whose items are all done again, stamp Onboarded once every step is true. */
async function afterProgress(key: string): Promise<void> {
  const db = supabaseAdmin()
  try {
    const p = await personByKey(key)
    if (!p) return
    const [{ data: open }, assigned] = await Promise.all([db.from('team_issues').select('id,item_ids').eq('person_key', key).eq('status', 'retraining'), assignmentsFor(key)])
    const doneIds = assigned.filter(a => a.completedAt).map(a => a.itemId)
    for (const i of (open || []) as any[]) {
      const ids: string[] = Array.isArray(i.item_ids) ? i.item_ids.map(str) : []
      if (ids.length && ids.every(id => doneIds.indexOf(id) >= 0)) {
        await db.from('team_issues').update({ status: 'retrained', closed_at: new Date().toISOString() }).eq('id', i.id)
        await logActivity(key, 'retrained', { issueId: i.id })
      }
    }
    const part = await trainingPart(p)
    if (part.migrated && !part.ob.onboardedAt && part.steps.every(s => s.done)) {
      await db.from('training_people').update({ onboarded_at: new Date().toISOString() }).eq('key', key)
      await logActivity(key, 'onboarded', {})
    }
  } catch { /* the next read catches up */ }
}

// ---------------------------------------------------------------- the manager's actions
/** Onboard someone: their row, track, email, start date; every track item assigned; the invite emailed. */
export async function onboard(inp: { key?: string; name: string; email?: string | null; phone?: string | null; track: string; market?: string | null; lang?: Lang; startDate?: string | null; dept?: string | null }, by: string): Promise<{ ok: true; person: Person; assigned: number; emailed: boolean; emailError?: string } | { ok: false; error: string }> {
  const track = trackOf(inp.track)
  if (!track) return { ok: false, error: 'Pick a role track.' }
  const name = clean(inp.name, 80)
  if (!name) return { ok: false, error: 'Their name is required.' }
  const email = clean(inp.email, 160).toLowerCase() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'That email does not look right.' }
  const key = clean(inp.key, 120).toLowerCase() || ('crew:' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  const person = await ensurePerson({ key, name, email, dept: inp.dept || track, market: inp.market || null, lang: inp.lang })
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(str(inp.startDate)) ? str(inp.startDate) : ymdET()
  const db = supabaseAdmin()
  const patch: Record<string, any> = { role_track: track, start_date: startDate, active: true }
  if (email) patch.email = email
  if (inp.phone != null) patch.phone = clean(inp.phone, 40) || null
  if (inp.market) patch.market = inp.market
  if (inp.lang) patch.lang = inp.lang === 'es' ? 'es' : 'en'
  const { error } = await db.from('training_people').update(patch).eq('key', person.key)
  if (error) return { ok: false, error: isMissing(error) ? `Run migration ${MIGRATION} in Supabase first.` : error.message }
  const items = trackItems(await listItems(false), track)
  let assignedN = 0
  if (items.length) {
    const rows = items.map(i => ({ item_id: i.id, person_key: person.key, assigned_by: by, due_on: addDays(startDate, 7), reason: 'onboarding' }))
    const { data } = await db.from('training_assignments').upsert(rows, { onConflict: 'item_id,person_key', ignoreDuplicates: true }).select('id')
    assignedN = Array.isArray(data) ? data.length : 0
  }
  await logActivity(person.key, 'onboard', { track, startDate, assigned: assignedN }, by)
  const fresh = (await personByKey(person.key)) || person
  let emailed = false, emailError: string | undefined
  if (fresh.email) { const r = await sendInvite(fresh, by); emailed = r.ok; emailError = r.error }
  return { ok: true, person: fresh, assigned: assignedN, emailed, emailError }
}

/** Log an issue against a person and send the retraining: items re-opened, quizzes re-taken, an email. */
export async function retrain(inp: { personKey: string; kind: string; note?: string | null; ref?: string | null; itemIds: string[]; dueOn?: string | null }, by: string): Promise<{ ok: true; issueId: string; reopened: number; emailed: boolean; emailError?: string } | { ok: false; error: string }> {
  const p = await personByKey(inp.personKey)
  if (!p) return { ok: false, error: 'That person is not on file.' }
  const kind = ['red_button', 'inspection', 'guest', 'other'].indexOf(inp.kind) >= 0 ? inp.kind : 'other'
  const itemIds = Array.from(new Set((inp.itemIds || []).map(str).filter(Boolean)))
  const db = supabaseAdmin()
  const { data: issue, error } = await db.from('team_issues').insert({ person_key: p.key, kind, note: clean(inp.note, 600) || null, ref: clean(inp.ref, 120) || null, item_ids: itemIds, status: itemIds.length ? 'retraining' : 'logged', created_by: by }).select('id').single()
  if (error || !issue) return { ok: false, error: isMissing(error) ? `Run migration ${MIGRATION} in Supabase first.` : (error?.message || 'could not log it') }
  const issueId = str((issue as any).id)
  const due = /^\d{4}-\d{2}-\d{2}$/.test(str(inp.dueOn)) ? str(inp.dueOn) : addDays(ymdET(), 3)
  const now = new Date().toISOString()
  let reopened = 0
  for (const id of itemIds) {
    const { data: have } = await db.from('training_assignments').select('id,round').eq('item_id', id).eq('person_key', p.key).maybeSingle()
    const r = have
      ? await db.from('training_assignments').update({ completed_at: null, completed_lang: null, completed_via: null, assigned_at: now, assigned_by: by, due_on: due, reason: 'retraining', issue_id: issueId, round: (Number((have as any).round) || 1) + 1 }).eq('id', (have as any).id)
      : await db.from('training_assignments').insert({ item_id: id, person_key: p.key, assigned_by: by, assigned_at: now, due_on: due, reason: 'retraining', issue_id: issueId })
    if (!r.error) reopened++
  }
  await logActivity(p.key, 'issue', { issueId, kind, items: itemIds.length }, by)
  let emailed = false, emailError: string | undefined
  if (itemIds.length && p.email) {
    const items = (await listItems(true)).filter(i => itemIds.indexOf(i.id) >= 0)
    const r = await sendRetrain(p, items, kind, due)
    emailed = r.ok; emailError = r.error
  } else if (itemIds.length) emailError = 'No email on file — share their page link instead.'
  return { ok: true, issueId, reopened, emailed, emailError }
}

/** Push a market's week: from now on it shows on everyone's page, and each person in it is emailed. */
export async function pushSchedule(weekStart: string, market: string, by: string): Promise<{ ok: true; emailed: number; people: number; missingEmail: string[] } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, error: 'Which week?' }
  if (!(MARKETS as string[]).some(m => m.toLowerCase() === market.toLowerCase())) return { ok: false, error: 'Which market?' }
  const db = supabaseAdmin()
  const ws = sunOf(weekStart)
  const { data: row } = await db.from('team_schedule').select('doc').eq('week_start', ws).eq('market', market).maybeSingle()
  const roster = await weekRoster(ws, market, (row as any)?.doc ?? null)
  const working = roster.people.filter(rp => roster.dates.some(d => rp.days[d]?.status === 'Working' || rp.days[d]?.status === 'On Call'))
  const { data: ppl } = await db.from('training_people').select('*')
  const everyone = ((ppl || []) as any[])
  let emailed = 0
  const missingEmail: string[] = []
  for (const rp of working) {
    const tp = everyone.find(x => nameMatches(str(x.name), rp.name))
    if (!tp?.email) { missingEmail.push(rp.name); continue }
    const lang: Lang = tp.lang === 'es' ? 'es' : 'en'
    const days = roster.dates.map(d => ({ date: d, status: rp.days[d]?.status || 'OFF', shift: rp.days[d]?.shift || null }))
    const r = await sendSchedule({ name: str(tp.name), email: str(tp.email), code: str(tp.code), lang }, ws, market, days)
    if (r.ok) { emailed++; await logActivity(str(tp.key), 'schedule', { weekStart: ws, market }, by) }
  }
  const { error } = await db.from('schedule_pushes').upsert({ week_start: ws, market, pushed_at: new Date().toISOString(), pushed_by: by, emailed })
  if (error) return { ok: false, error: isMissing(error) ? `Run migration ${MIGRATION} in Supabase first.` : error.message }
  return { ok: true, emailed, people: working.length, missingEmail }
}
export async function pushesFor(weekStart: string): Promise<{ market: string; pushedAt: string; pushedBy: string | null; emailed: number }[]> {
  try {
    const { data } = await supabaseAdmin().from('schedule_pushes').select('*').eq('week_start', sunOf(weekStart))
    return ((data || []) as any[]).map(r => ({ market: str(r.market), pushedAt: str(r.pushed_at), pushedBy: r.pushed_by ?? null, emailed: Number(r.emailed) || 0 }))
  } catch { return [] }
}

/** One line per person for the People list: track, onboarding %, open issues. */
export async function onboardingSummary(): Promise<Record<string, { track: Track | null; startDate: string | null; invitedAt: string | null; onboardedAt: string | null; apps: number; ack: boolean; openIssues: number }>> {
  const out: Record<string, any> = {}
  try {
    const db = supabaseAdmin()
    const [{ data, error }, { data: iss }] = await Promise.all([
      db.from('training_people').select('key,role_track,start_date,invited_at,onboarded_at,onboarding,ack_at'),
      db.from('team_issues').select('person_key').eq('status', 'retraining'),
    ])
    if (error) return {}
    const open: Record<string, number> = {}
    for (const i of (iss || []) as any[]) open[str(i.person_key)] = (open[str(i.person_key)] || 0) + 1
    for (const r of (data || []) as any[]) {
      const ob = onboardingOf(r)
      out[str(r.key)] = { track: ob.track, startDate: ob.startDate, invitedAt: ob.invitedAt, onboardedAt: ob.onboardedAt, apps: APPS.filter(a => ob.apps[a.key]).length, ack: !!r.ack_at, openIssues: open[str(r.key)] || 0 }
    }
  } catch {}
  return out
}

// ---------------------------------------------------------------- email
const EM = {
  en: {
    inviteSub: 'Welcome to Stay Hospitality — your onboarding',
    inviteHead: (n: string) => `Welcome to the team, ${n}`,
    inviteP: ['This is your own page at Stay Hospitality. It has your training, your schedule, your hours, your tasks and your inspections, all in one place.', 'Start with your onboarding. It takes about 30 minutes:'],
    inviteList: ['Set up your apps: Homebase, Breezeway, Slack and Lighthouse', 'Watch your training videos and pass each short quiz', 'Read the handbook and sign it'],
    open: 'Open my page', keep: 'Save this email. The link is yours; do not share it.',
    retrainSub: 'Training to redo', retrainHead: (n: string) => `${n}, please redo this training`,
    retrainP: (due: string) => [`After a recent issue, we want to make sure the steps are clear. Please watch these again and pass the quiz by ${due}.`],
    schedSub: (wk: string) => `Your schedule for the week of ${wk}`, schedHead: (n: string) => `${n}, here is your week`,
    schedP: ['Your schedule is posted. It is also on your page any time.'],
    off: 'Off', kinds: { red_button: 'a red-button issue', inspection: 'an inspection', guest: 'a guest issue', other: 'an issue' } as Record<string, string>,
  },
  es: {
    inviteSub: 'Bienvenido a Stay Hospitality — tu incorporación',
    inviteHead: (n: string) => `Bienvenido al equipo, ${n}`,
    inviteP: ['Esta es tu página en Stay Hospitality. Tiene tu capacitación, tu horario, tus horas, tus tareas y tus inspecciones, todo en un lugar.', 'Empieza con tu incorporación. Toma unos 30 minutos:'],
    inviteList: ['Configura tus apps: Homebase, Breezeway, Slack y Lighthouse', 'Mira tus videos de capacitación y aprueba cada prueba corta', 'Lee el manual y fírmalo'],
    open: 'Abrir mi página', keep: 'Guarda este correo. El enlace es tuyo; no lo compartas.',
    retrainSub: 'Capacitación para repetir', retrainHead: (n: string) => `${n}, por favor repite esta capacitación`,
    retrainP: (due: string) => [`Después de un problema reciente, queremos asegurarnos de que los pasos estén claros. Por favor mira esto otra vez y aprueba la prueba antes del ${due}.`],
    schedSub: (wk: string) => `Tu horario para la semana del ${wk}`, schedHead: (n: string) => `${n}, esta es tu semana`,
    schedP: ['Tu horario está publicado. También está en tu página en todo momento.'],
    off: 'Libre', kinds: { red_button: 'un problema de botón rojo', inspection: 'una inspección', guest: 'un problema con un huésped', other: 'un problema' } as Record<string, string>,
  },
}
const dayLabel = (ymd: string, lang: Lang) => new Date(ymd + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const first = (n: string) => escHtml(str(n).split(' ')[0] || n)

// HOW TEAM EMAIL GOES OUT (2026-11-25). The first real approval of a new hire form answered
// "RESEND_API_KEY not set": these three emails were written for Resend alone, and production has no
// Resend key (the same thing owner onboarding found on 2026-11-13). So they go the way the briefs and
// the owner emails go: from a connected Google mailbox first, Resend only if that fails. When both
// fail the reason for each is kept, so the person on Training → People can see why.
const TEAM_SENDER = 'jon@stay-hospitality.com'
async function teamMail(to: string[], subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  let gmail = ''
  try {
    const g: { ok: boolean; error?: string } = await sendGmail({ fromEmail: TEAM_SENDER, to, subject, html, source: 'team-onboarding' })
    if (g.ok) return { ok: true }
    gmail = str(g.error) || 'not sent'
  } catch (e: any) { gmail = str(e?.message || e) }
  const r = await sendResendEmail({ to, subject, html })
  return r.ok ? { ok: true } : { ok: false, error: `Gmail: ${gmail} · Resend: ${r.error || 'not sent'}`.slice(0, 300) }
}

export async function sendInvite(p: Person, by: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!p.email) return { ok: false, error: 'No email on file.' }
  const t = EM[p.lang]
  const html = stayEmail({
    origin: siteOrigin(), preheader: t.inviteP[0], eyebrow: 'Stay Hospitality', heading: t.inviteHead(first(p.name)),
    paragraphs: t.inviteP.map(escHtml), list: t.inviteList.map(escHtml), ordered: true,
    cta: { label: t.open, url: pageUrl(p.code) }, ctaNote: escHtml(t.keep),
  })
  const r = await teamMail([p.email], t.inviteSub, html)
  try { await supabaseAdmin().from('training_people').update({ invited_at: r.ok ? new Date().toISOString() : null, invite_error: r.ok ? null : (r.error || 'send failed') }).eq('key', p.key) } catch {}
  await logActivity(p.key, 'invited', { ok: r.ok, error: r.error || null }, by)
  return r
}
async function sendRetrain(p: Person, items: TrainingItem[], kind: string, due: string): Promise<{ ok: boolean; error?: string }> {
  const t = EM[p.lang]
  const html = stayEmail({
    origin: siteOrigin(), preheader: t.retrainP(dayLabel(due, p.lang))[0], eyebrow: t.kinds[kind] ? escHtml(t.kinds[kind]) : 'Stay Hospitality', heading: t.retrainHead(first(p.name)),
    paragraphs: t.retrainP(dayLabel(due, p.lang)).map(escHtml), list: items.map(i => escHtml(p.lang === 'es' && i.title.es ? i.title.es : i.title.en)),
    cta: { label: t.open, url: pageUrl(p.code) },
  })
  return teamMail([p.email!], t.retrainSub, html)
}
async function sendSchedule(p: { name: string; email: string; code: string; lang: Lang }, weekStart: string, market: string, days: ScheduleDay[]): Promise<{ ok: boolean; error?: string }> {
  const t = EM[p.lang]
  const html = stayEmail({
    origin: siteOrigin(), preheader: t.schedP[0], eyebrow: escHtml(market), heading: t.schedHead(first(p.name)),
    paragraphs: t.schedP.map(escHtml),
    table: { head: [p.lang === 'es' ? 'Día' : 'Day', p.lang === 'es' ? 'Turno' : 'Shift'], rows: days.map(d => [escHtml(dayLabel(d.date, p.lang)), escHtml(d.status === 'OFF' || d.status === 'REQ OFF' ? t.off : (d.shift || d.status))]) },
    cta: { label: t.open, url: pageUrl(p.code) },
  })
  return teamMail([p.email], t.schedSub(dayLabel(weekStart, p.lang)), html)
}

export { personByKey, ymdET }
