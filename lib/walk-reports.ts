// WALK REPORTS — what a finished property-program task tells the owners (Jon, 2026-11-02, the Eden
// exterior walk: "create it as a Breezeway task; once it's done it sends a report to the owners").
//
// A program on the Upkeep page (lib/site-programs) can carry report settings. When one of its
// tasks is finished in Breezeway — the webhook hears it, and the cron sweeps for anything the
// webhook missed — this file:
//   1. reads the task's checklist answers (GET /task/{id}/requirements), its comments and photos;
//   2. files a report with its own unguessable link (/walks/<code>): every line pass / issue /
//      not done, each issue with its photo and note, and what is still open from earlier walks;
//   3. raises one maintenance task per issue, the photo and note in its description — through
//      createBreezewayTask, so the same open issue tomorrow moves the task rather than duplicating it;
//   4. emails the owners of the place (guesty_owners) and the program's extra addresses, on every
//      walk or only when something failed, as the program says; Monday brings the week's roll-up.
//
// STORAGE: the walk_reports table (migration 168). Until that migration has been run the same
// rows live in app_settings (walk_report:<code> + walk_reports_index), so nothing waits on SQL.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { bzApi, breezewayConfigured, createBreezewayTask, listBreezewayComments, retrieveBreezewayTask } from './breezeway'
import { loadPrograms, programForTask, reportOf, buildingKey, onDays, ymdET, type Program, type Place } from './site-programs'
import { isTaskDone, isTaskGone } from './task-categories'
import { sendGmail } from './gmail-send'
import { sendResendEmail } from './resend-send'
import { recordRun } from './automation-runs'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const APP = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const SETTINGS_KEY = 'walk_reports'          // { fromEmail?, cc?: string[], weeklySent?: { [programId]: 'YYYY-MM-DD' } }
const INDEX_KEY = 'walk_reports_index'       // fallback store: { rows: IndexRow[] }
const DEFAULT_FROM = 'jon@stay-hospitality.com'
const CARRY_DAYS = 45

export type WalkItem = {
  section: string; action: string; type: string; response: string; note: string; photos: string[]; photoRequired: boolean
  state: 'pass' | 'issue' | 'open'
}
export type FixTask = { taskId: string; name: string; action: string; note: string; photos: string[]; raisedOn: string }
export type WalkReport = {
  code: string; programId: string; programName: string; place: string; placeId: string | null
  taskId: string; taskName: string; homeId: number | null
  scheduledDate: string; startedAt: string | null; finishedAt: string | null; finishedBy: string; minutes: number | null
  items: WalkItem[]; passed: number; issues: number; open: number
  comments: { body: string; at: string }[]; photos: string[]; reportUrl: string
  fixTasks: FixTask[]
  carried: (FixTask & { code: string; date: string })[]
  emailedAt: string | null; emailedTo: string[]; emailError: string | null
  createdAt: string
}
export type IndexRow = { code: string; programId: string; taskId: string; date: string; finishedAt: string | null; finishedBy: string; passed: number; issues: number; open: number; place: string }

const toIndex = (r: WalkReport): IndexRow => ({ code: r.code, programId: r.programId, taskId: r.taskId, date: r.scheduledDate, finishedAt: r.finishedAt, finishedBy: r.finishedBy, passed: r.passed, issues: r.issues, open: r.open, place: r.place })

// ── storage ──────────────────────────────────────────────────────────────────────────────────────

const noTable = (e: any) => /relation .* does not exist|42P01|schema cache|could not find the table/i.test(str(e?.message || e?.details || e))

export async function saveReport(r: WalkReport): Promise<void> {
  const row = {
    code: r.code, program_id: r.programId, program_name: r.programName, place: r.place, task_id: r.taskId, home_id: r.homeId,
    scheduled_date: r.scheduledDate || null, finished_at: r.finishedAt, finished_by: r.finishedBy || null,
    passed: r.passed, issues: r.issues, open_items: r.open, emailed_at: r.emailedAt, report: r, updated_at: new Date().toISOString(),
  }
  try {
    const { error } = await supabaseAdmin().from('walk_reports').upsert(row, { onConflict: 'code' })
    if (!error) return
    if (!noTable(error)) throw new Error(error.message)
  } catch (e: any) { if (!noTable(e)) throw e }
  // No table yet: app_settings.
  await setSetting('walk_report:' + r.code, r, 'walk-reports')
  const idx = await getSetting<{ rows: IndexRow[] }>(INDEX_KEY, { rows: [] })
  const rows = (Array.isArray(idx?.rows) ? idx.rows : []).filter(x => x.code !== r.code).concat([toIndex(r)])
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 400)
  await setSetting(INDEX_KEY, { rows }, 'walk-reports')
}

export async function getReport(code: string): Promise<WalkReport | null> {
  const c = str(code).trim()
  if (!/^[0-9a-f]{12,32}$/i.test(c)) return null
  try {
    const { data, error } = await supabaseAdmin().from('walk_reports').select('report').eq('code', c).limit(1)
    if (!error && data && data[0] && (data[0] as any).report) return (data[0] as any).report as WalkReport
    if (error && !noTable(error)) return null
  } catch { /* fall through */ }
  return getSetting<WalkReport | null>('walk_report:' + c, null)
}

/** Newest first. `since` is a YYYY-MM-DD scheduled date. */
export async function listReports(opts: { programId?: string; since?: string; limit?: number } = {}): Promise<IndexRow[]> {
  const limit = Math.max(1, Math.min(opts.limit || 30, 400))
  try {
    let q = supabaseAdmin().from('walk_reports').select('code, program_id, task_id, scheduled_date, finished_at, finished_by, passed, issues, open_items, place')
    if (opts.programId) q = q.eq('program_id', opts.programId)
    if (opts.since) q = q.gte('scheduled_date', opts.since)
    const { data, error } = await q.order('scheduled_date', { ascending: false }).order('finished_at', { ascending: false }).limit(limit)
    if (!error) return ((data || []) as any[]).map(x => ({ code: str(x.code), programId: str(x.program_id), taskId: str(x.task_id), date: str(x.scheduled_date), finishedAt: x.finished_at || null, finishedBy: str(x.finished_by), passed: Number(x.passed) || 0, issues: Number(x.issues) || 0, open: Number(x.open_items) || 0, place: str(x.place) }))
    if (!noTable(error)) return []
  } catch { /* fall through */ }
  const idx = await getSetting<{ rows: IndexRow[] }>(INDEX_KEY, { rows: [] })
  return (Array.isArray(idx?.rows) ? idx.rows : []).filter(x => (!opts.programId || x.programId === opts.programId) && (!opts.since || x.date >= opts.since)).slice(0, limit)
}

export async function reportForTask(taskId: string): Promise<IndexRow | null> {
  const id = str(taskId)
  try {
    const { data, error } = await supabaseAdmin().from('walk_reports').select('code, program_id, task_id, scheduled_date, finished_at, finished_by, passed, issues, open_items, place').eq('task_id', id).limit(1)
    if (!error) { const x: any = (data || [])[0]; return x ? { code: str(x.code), programId: str(x.program_id), taskId: id, date: str(x.scheduled_date), finishedAt: x.finished_at || null, finishedBy: str(x.finished_by), passed: Number(x.passed) || 0, issues: Number(x.issues) || 0, open: Number(x.open_items) || 0, place: str(x.place) } : null }
    if (!noTable(error)) return null
  } catch { /* fall through */ }
  const idx = await getSetting<{ rows: IndexRow[] }>(INDEX_KEY, { rows: [] })
  return (Array.isArray(idx?.rows) ? idx.rows : []).find(x => x.taskId === id) || null
}

// ── reading the task ─────────────────────────────────────────────────────────────────────────────

function photoUrls(v: any): string[] {
  const arr = Array.isArray(v) ? v : v ? [v] : []
  return arr.map((x: any) => (typeof x === 'string' ? x : str(x?.url || x?.file_url || x?.image_url || x?.photo_url || x?.src || x?.path))).filter(u => /^https?:\/\//i.test(u)).slice(0, 12)
}

const YES = /^(yes|y|true|pass|passed|ok|good|done|complete|completed|si|sí|1)$/i
const NO = /^(no|n|false|fail|failed|issue|bad|problem|0)$/i

/** One checklist line, judged: a "no" is an issue; a photo line with a photo passed; nothing answered is open. */
export function judgeItem(q: any): WalkItem {
  const action = (Array.isArray(q?.action) ? q.action.join(' ') : str(q?.action)).replace(/\s+/g, ' ').trim()
  const type = str(q?.type_requirement || q?.type).toLowerCase()
  const response = str(q?.response ?? q?.value ?? q?.answer).trim()
  const note = str(q?.note || q?.comment).trim()
  const photos = photoUrls(q?.photos)
  let state: WalkItem['state'] = 'open'
  if (NO.test(response)) state = 'issue'
  else if (YES.test(response)) state = 'pass'
  else if (/photo|image|picture/.test(type)) state = photos.length ? 'pass' : 'open'
  else if (/rating|score|number/.test(type) && /^\d+(\.\d+)?$/.test(response)) state = Number(response) <= 2 ? 'issue' : 'pass'
  else if (response) state = /\b(issue|problem|broken|leak|damage|missing|not working|fail)/i.test(response) ? 'issue' : 'pass'
  else if (note && !photos.length) state = 'open'
  return { section: str(q?.section_name || q?.section).replace(/\s+/g, ' ').trim(), action, type, response, note, photos, photoRequired: !!q?.photo_required, state }
}

async function requirements(taskId: string): Promise<WalkItem[]> {
  const r = await bzApi('/task/' + encodeURIComponent(taskId) + '/requirements')
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data?.data) ? r.data.data : []
  return r.ok ? (rows as any[]).map(judgeItem).filter(x => x.action || x.photos.length) : []
}

/** The owners of a place's units, by email — the building's listings, then guesty_owners over them. */
export async function ownerEmailsFor(place: Place | null): Promise<string[]> {
  if (!place) return []
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building,active:raw->>active').limit(3000)
  const key = place.ref.toLowerCase()
  const ids = ((ls || []) as any[]).filter(l => String(l.active) !== 'false')
    .filter(l => place.kind === 'unit' ? str(l.id) === place.ref : buildingKey(str(l.building), str(l.nickname || l.title)).toLowerCase() === key)
    .map(l => str(l.id))
  if (!ids.length) return []
  const { data: owners } = await db.from('guesty_owners').select('email, listing_ids').overlaps('listing_ids', ids).limit(200)
  const out = new Set<string>()
  for (const o of (owners || []) as any[]) { const e = str(o.email).trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e) }
  return Array.from(out)
}

const fmtDate = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
const fmtTime = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) }
const esc = (s: any) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── building one report ──────────────────────────────────────────────────────────────────────────

/**
 * Turn a finished Breezeway task into a report, file it, raise the fix tasks and email the owners.
 * Idempotent per task: a task that already has a report is left alone. `task` is the raw Breezeway
 * task object (the webhook's re-fetched copy, or a breezeway_tasks_sync row's `raw`).
 */
export async function walkReportForTask(task: any, opts: { force?: boolean; programs?: Program[] } = {}): Promise<{ ok: boolean; code?: string; skipped?: string; error?: string }> {
  try {
    const id = str(task?.id)
    if (!id) return { ok: false, skipped: 'no task id' }
    const status = str(task?.type_task_status?.code || task?.status?.code || task?.status)
    if (!isTaskDone(status, task?.finished_at) || isTaskGone(status)) return { ok: false, skipped: 'not finished' }
    const programs = opts.programs || await loadPrograms()
    const hit = programForTask(task?.name, programs)
    if (!hit) return { ok: false, skipped: 'not a program task' }
    const { program, place } = hit
    const rep = reportOf(program)
    if (rep.mode === 'off' && !rep.weekly) return { ok: false, skipped: 'program has no report' }
    if (!opts.force) { const had = await reportForTask(id); if (had) return { ok: true, code: had.code, skipped: 'already filed' } }
    if (!breezewayConfigured()) return { ok: false, error: 'Breezeway not configured' }

    // The task as Breezeway has it now — finished_by, times, photos — then its answers and comments.
    const cur = await retrieveBreezewayTask(id).catch(() => null)
    const t: any = cur && cur.ok && cur.data && (cur.data.task || cur.data).id != null ? (cur.data.task || cur.data) : task
    const [items, cmts] = await Promise.all([requirements(id).catch(() => [] as WalkItem[]), listBreezewayComments(id).catch(() => ({ ok: false, comments: [] as { body: string; at: string }[] }))])
    const passed = items.filter(x => x.state === 'pass').length, issues = items.filter(x => x.state === 'issue').length, open = items.filter(x => x.state === 'open').length
    const mins = (() => { const p = str(t?.total_time).split(':').map(Number); return p.length === 3 && p.every(n => Number.isFinite(n)) ? Math.round(p[0] * 60 + p[1] + p[2] / 60) : null })()
    const scheduled = str(t?.scheduled_date).slice(0, 10) || (t?.finished_at ? ymdET(new Date(t.finished_at)) : ymdET(new Date()))
    const report: WalkReport = {
      code: randomBytes(8).toString('hex'), programId: program.id, programName: program.name, place: place ? place.label : str(t?.home?.name || ''), placeId: place ? place.id : null,
      taskId: id, taskName: str(t?.name), homeId: Number(t?.home_id ?? t?.home?.id) || null,
      scheduledDate: scheduled, startedAt: t?.started_at || null, finishedAt: t?.finished_at || new Date().toISOString(),
      finishedBy: str(t?.finished_by?.name || t?.finished_by?.full_name || (Array.isArray(t?.assignments) && t.assignments[0] && (t.assignments[0].name || t.assignments[0].full_name)) || ''),
      minutes: mins, items, passed, issues, open,
      comments: (cmts.comments || []).map(c => ({ body: c.body, at: c.at })).slice(0, 20), photos: photoUrls(t?.photos), reportUrl: str(t?.report_url || t?.task_report_url),
      fixTasks: [], carried: [], emailedAt: null, emailedTo: [], emailError: null, createdAt: new Date().toISOString(),
    }
    report.fixTasks = await raiseFixTasks(report, program).catch(() => [])
    report.carried = await carriedIssues(program, report).catch(() => [])
    await saveReport(report)
    const wantMail = rep.mode === 'always' || (rep.mode === 'issues' && issues > 0)
    if (wantMail) {
      const to = (rep.owners ? await ownerEmailsFor(place).catch(() => [] as string[]) : []).concat(rep.to)
      const sent = await emailReport(report, Array.from(new Set(to)))
      report.emailedAt = sent.ok ? new Date().toISOString() : null; report.emailedTo = sent.ok ? sent.to : []; report.emailError = sent.ok ? null : sent.error || 'not sent'
      await saveReport(report)
    }
    recordRun({ name: 'walk-reports', ok: true, itemCount: issues, detail: { code: report.code, program: program.name, passed, issues, open, emailed: report.emailedTo.length, fixTasks: report.fixTasks.length } })
    return { ok: true, code: report.code }
  } catch (e: any) {
    const error = str(e?.message || e).slice(0, 300)
    recordRun({ name: 'walk-reports', ok: false, error })
    return { ok: false, error }
  }
}

/** One maintenance task per issue, at the same Breezeway home, photo and note in the description. */
async function raiseFixTasks(r: WalkReport, program: Program): Promise<FixTask[]> {
  const out: FixTask[] = []
  if (!r.homeId) return out
  const today = ymdET(new Date())
  for (const it of r.items.filter(x => x.state === 'issue').slice(0, 20)) {
    const name = (program.name + ' fix: ' + it.action).slice(0, 110)
    const description = [
      'Found on the ' + program.name + ' walk of ' + fmtDate(r.scheduledDate) + (r.finishedBy ? ' by ' + r.finishedBy : '') + (it.section ? ' — ' + it.section : '') + '.',
      it.note ? 'Note: ' + it.note : '',
      it.photos.length ? 'Photos: ' + it.photos.join(' ') : '',
      'Walk report: ' + APP() + '/walks/' + r.code,
      'Photograph the fix and finish this task; ownership sees it closed on the next report.',
    ].filter(Boolean).join('\n')
    const res = await createBreezewayTask({
      home_id: r.homeId, name, type_department: 'maintenance', type_priority: /gate|rail|stair|wir|electric|hazard|leak/i.test(it.action + ' ' + it.note) ? 'high' : 'normal',
      scheduled_date: today, description, template_id: null, ...(program.people.length ? { assignments: program.people.map(p => p.id) } : {}),
    }).catch(() => null)
    const taskId = res && res.ok && res.data ? str(res.data.id) : ''
    if (taskId) out.push({ taskId, name, action: it.action, note: it.note, photos: it.photos, raisedOn: today })
  }
  return out
}

/** Issues from the program's earlier reports whose fix task is still open in Breezeway. */
async function carriedIssues(program: Program, current: WalkReport): Promise<WalkReport['carried']> {
  const since = new Date(Date.now() - CARRY_DAYS * 86400000).toISOString().slice(0, 10)
  const rows = (await listReports({ programId: program.id, since, limit: 120 })).filter(x => x.code !== current.code && x.issues > 0)
  const reports = (await Promise.all(rows.slice(0, 40).map(x => getReport(x.code)))).filter(Boolean) as WalkReport[]
  const all = reports.flatMap(rp => rp.fixTasks.map(f => ({ ...f, code: rp.code, date: rp.scheduledDate })))
  const ids = Array.from(new Set(all.map(f => f.taskId).filter(Boolean)))
  if (!ids.length) return []
  const { data } = await supabaseAdmin().from('breezeway_tasks_sync').select('id,status,finished_at').in('id', ids).limit(500)
  const openIds = new Set(((data || []) as any[]).filter(t => !isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status)).map(t => str(t.id)))
  const mine = new Set(current.fixTasks.map(f => f.taskId))
  const seen = new Set<string>()
  return all.filter(f => openIds.has(f.taskId) && !mine.has(f.taskId) && !seen.has(f.taskId) && seen.add(f.taskId)).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 25)
}

// ── email ────────────────────────────────────────────────────────────────────────────────────────

async function mailSettings() {
  const s = await getSetting<any>(SETTINGS_KEY, {})
  return { fromEmail: str(s?.fromEmail) || DEFAULT_FROM, cc: (Array.isArray(s?.cc) ? s.cc : []).map((x: any) => str(x).trim()).filter(Boolean) as string[], weeklySent: (s && typeof s.weeklySent === 'object' && s.weeklySent) || {} as Record<string, string> }
}

async function send(to: string[], subject: string, html: string): Promise<{ ok: boolean; to: string[]; error?: string }> {
  const cfg = await mailSettings()
  const list = Array.from(new Set(to.map(x => str(x).trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))))
  if (!list.length) return { ok: false, to: [], error: 'no recipients — no owner email on the place\'s units and no extra addresses on the program' }
  const g = await sendGmail({ fromEmail: cfg.fromEmail, to: list, cc: cfg.cc, subject, html })
  if (g.ok) return { ok: true, to: list }
  const r = await sendResendEmail({ to: list.concat(cfg.cc), subject, html })
  return r.ok ? { ok: true, to: list } : { ok: false, to: [], error: g.error || r.error }
}

const FONT = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a'
const chip = (txt: string, bg: string, fg: string) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600">${esc(txt)}</span>`

function itemHtml(it: { action: string; note?: string; photos?: string[]; section?: string }, extra = '') {
  const imgs = (it.photos || []).slice(0, 3).map(u => `<a href="${esc(u)}"><img src="${esc(u)}" alt="" style="width:120px;height:90px;object-fit:cover;border-radius:8px;margin:6px 6px 0 0;border:1px solid #e6e4df"></a>`).join('')
  return `<div style="padding:10px 0;border-top:1px solid #ebe9e4">
    <div style="font-size:14px;font-weight:600">${esc(it.action)}${it.section ? ` <span style="font-weight:400;color:#6b6a66">· ${esc(it.section)}</span>` : ''}</div>
    ${it.note ? `<div style="font-size:13px;color:#4a4946;margin-top:2px">${esc(it.note)}</div>` : ''}
    ${extra}${imgs ? `<div>${imgs}</div>` : ''}</div>`
}

export function reportEmailHtml(r: WalkReport): { subject: string; html: string } {
  const when = fmtDate(r.scheduledDate)
  const subject = `${r.programName} — ${when}: ${r.issues ? r.issues + ' issue' + (r.issues === 1 ? '' : 's') : 'all clear'}`
  const link = APP() + '/walks/' + r.code
  const fixes = new Map(r.fixTasks.map(f => [f.action, f]))
  const issues = r.items.filter(x => x.state === 'issue').map(it => {
    const f = fixes.get(it.action)
    return itemHtml(it, f ? `<div style="font-size:12.5px;color:#0f6e56;margin-top:2px">Fix task raised for maintenance (${esc(fmtDate(f.raisedOn))})</div>` : '')
  }).join('')
  const carried = r.carried.map(c => itemHtml({ action: c.action, note: c.note, photos: c.photos }, `<div style="font-size:12.5px;color:#854f0b;margin-top:2px">Open since the walk of ${esc(fmtDate(c.date))}</div>`)).join('')
  const sample = r.programId.indexOf('sample:') === 0
  const html = `<div style="${FONT};max-width:620px;margin:0 auto;font-size:14px;line-height:1.5">
    ${sample ? `<p style="margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#f9eeda;color:#633806;font-size:13px"><b>SAMPLE.</b> This is what ownership receives after a finished walk. The answers below are illustrative — the real ones come from the walk in the field app.</p>` : ''}
    <p style="font-size:12px;color:#6b6a66;margin:0 0 4px">${esc(r.place || r.programName)}</p>
    <h1 style="font-size:20px;margin:0 0 6px">${esc(r.programName)} — ${esc(when)}</h1>
    <p style="margin:0 0 14px;color:#4a4946">${r.finishedBy ? 'Walked by ' + esc(r.finishedBy) : 'Walked'}${r.startedAt ? ', ' + esc(fmtTime(r.startedAt)) + (r.finishedAt ? ' to ' + esc(fmtTime(r.finishedAt)) : '') : r.finishedAt ? ' at ' + esc(fmtTime(r.finishedAt)) : ''}${r.minutes ? ' (' + r.minutes + ' min)' : ''}.</p>
    <p style="margin:0 0 16px">${chip(r.passed + ' passed', '#e5f4e4', '#27500a')} &nbsp;${chip(r.issues + (r.issues === 1 ? ' issue' : ' issues'), r.issues ? '#fbebeb' : '#f0efec', r.issues ? '#791f1f' : '#444441')} &nbsp;${chip(r.open + ' not done', r.open ? '#f9eeda' : '#f0efec', r.open ? '#633806' : '#444441')}</p>
    ${r.issues ? `<h2 style="font-size:15px;margin:18px 0 4px">Issues on this walk</h2>${issues}` : '<p style="margin:0 0 12px">Nothing failed on this walk.</p>'}
    ${carried ? `<h2 style="font-size:15px;margin:18px 0 4px">Still open from earlier walks</h2>${carried}` : ''}
    <p style="margin:18px 0 6px"><a href="${esc(link)}" style="color:#185fa5">Full report — every line, with photos</a>${r.reportUrl ? ` &nbsp;·&nbsp; <a href="${esc(r.reportUrl)}" style="color:#185fa5">Breezeway task report</a>` : ''}</p>
    <p style="font-size:12px;color:#8a8984;margin:16px 0 0">Sent by Lighthouse, Stay Hospitality's operations system, when the walk was finished in Breezeway.</p>
  </div>`
  return { subject, html }
}

async function emailReport(r: WalkReport, to: string[]) {
  const { subject, html } = reportEmailHtml(r)
  return send(to, subject, html)
}

/**
 * A SAMPLE of the owner email, from a real task's own checklist (Jon, 2026-11-02: "complete one as a
 * test and draft and send me the email"). Breezeway takes checklist answers only from the field app,
 * so a task nobody has walked has no answers; the sample fills them in — every line passed, two
 * lines flagged with an illustrative note — so the person sees the email as ownership will get it.
 * A task that HAS answers is shown as it is. Filed under program "sample:<id>" so it never counts
 * as a walk (lists, roll-ups and carried issues all key on the program id), raises no fix task,
 * and goes only to the addresses given. The subject and the page say SAMPLE.
 */
export async function sampleReportForTask(taskId: string, to: string[]): Promise<{ ok: boolean; code?: string; to: string[]; error?: string }> {
  const id = str(taskId).trim()
  if (!/^\d+$/.test(id)) return { ok: false, to: [], error: 'taskId must be a Breezeway task id' }
  if (!breezewayConfigured()) return { ok: false, to: [], error: 'Breezeway not configured' }
  const cur = await retrieveBreezewayTask(id).catch(() => null)
  const t: any = cur && cur.ok && cur.data ? (cur.data.task || cur.data) : null
  if (!t || t.id == null) return { ok: false, to: [], error: 'Breezeway did not return task ' + id }
  const programs = await loadPrograms()
  const hit = programForTask(t.name, programs)
  if (!hit) return { ok: false, to: [], error: 'That task is not a program task (its title does not start with a program name).' }
  const { program, place } = hit
  let items = await requirements(id).catch(() => [] as WalkItem[])
  const answered = items.some(x => x.response || x.photos.length)
  const SAMPLE_ISSUES: [RegExp, string][] = [
    [/gate self-closes|self-latches/i, 'Latch does not catch unless the gate is pushed shut. Pool closed and signed until the latch is adjusted.'],
    [/^Exterior stair/i, 'Light at the bottom landing is out; treads and railing are sound.'],
  ]
  if (!answered) {
    const used = new Set<number>()
    items = items.map(it => {
      const k = SAMPLE_ISSUES.findIndex((s, i) => !used.has(i) && s[0].test(it.action))
      if (k >= 0) { used.add(k); return { ...it, response: 'No', note: SAMPLE_ISSUES[k][1], state: 'issue' as const } }
      return { ...it, response: 'Yes', state: 'pass' as const }
    })
  }
  const passed = items.filter(x => x.state === 'pass').length, issues = items.filter(x => x.state === 'issue').length, open = items.filter(x => x.state === 'open').length
  const now = Date.now()
  const today = ymdET(new Date())
  const report: WalkReport = {
    code: randomBytes(8).toString('hex'), programId: 'sample:' + program.id, programName: program.name, place: place ? place.label : str(t?.home?.name || ''), placeId: place ? place.id : null,
    taskId: 'sample-' + id, taskName: str(t?.name), homeId: Number(t?.home_id ?? t?.home?.id) || null,
    scheduledDate: str(t?.scheduled_date).slice(0, 10) || today, startedAt: new Date(now - 23 * 60_000).toISOString(), finishedAt: new Date(now).toISOString(),
    finishedBy: str(t?.finished_by?.name || (Array.isArray(t?.assignments) && t.assignments[0] && (t.assignments[0].name || t.assignments[0].full_name)) || 'the walker'),
    minutes: 23, items, passed, issues, open, comments: [], photos: photoUrls(t?.photos), reportUrl: str(t?.report_url || t?.task_report_url),
    fixTasks: answered ? [] : items.filter(x => x.state === 'issue').map(x => ({ taskId: 'sample', name: program.name + ' fix: ' + x.action, action: x.action, note: x.note, photos: [], raisedOn: today })),
    carried: [], emailedAt: null, emailedTo: [], emailError: null, createdAt: new Date(now).toISOString(),
  }
  await saveReport(report)
  const { subject, html } = reportEmailHtml(report)
  const sent = await send(to, '[SAMPLE] ' + subject, html)
  if (sent.ok) { report.emailedAt = new Date().toISOString(); report.emailedTo = sent.to; await saveReport(report).catch(() => null) }
  return sent.ok ? { ok: true, code: report.code, to: sent.to } : { ok: false, code: report.code, to: [], error: sent.error }
}

export const isSample = (r: Pick<WalkReport, 'programId'>) => r.programId.indexOf('sample:') === 0

/** Re-send a filed report to its owners (or to a tester). */
export async function resendReport(code: string, to?: string[]): Promise<{ ok: boolean; to: string[]; error?: string }> {
  const r = await getReport(code)
  if (!r) return { ok: false, to: [], error: 'no such report' }
  const programs = await loadPrograms()
  const program = programs.find(p => p.id === r.programId)
  const place = program ? program.places.find(pl => pl.id === r.placeId) || null : null
  const rep = reportOf(program)
  const list = to && to.length ? to : (rep.owners ? await ownerEmailsFor(place) : []).concat(rep.to)
  const sent = await emailReport(r, list)
  if (sent.ok && !(to && to.length)) { r.emailedAt = new Date().toISOString(); r.emailedTo = sent.to; r.emailError = null; await saveReport(r) }
  return sent
}

// ── the Monday roll-up ───────────────────────────────────────────────────────────────────────────

const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export function weeklyDigestHtml(program: Program, from: string, to: string, reports: WalkReport[], scheduled: number, openIssues: (FixTask & { code: string; date: string })[]): { subject: string; html: string } {
  const walks = new Set(reports.map(r => r.scheduledDate)).size
  const issues = reports.reduce((n, r) => n + r.issues, 0)
  const missed = Math.max(0, scheduled - walks)
  const subject = `${program.name} — week of ${fmtDate(from)}: ${walks} walk${walks === 1 ? '' : 's'}, ${issues} issue${issues === 1 ? '' : 's'}${openIssues.length ? ', ' + openIssues.length + ' still open' : ''}`
  const rows = reports.slice().sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1)).map(r =>
    `<tr><td style="padding:6px 8px;border-top:1px solid #ebe9e4">${esc(fmtDate(r.scheduledDate))}</td><td style="padding:6px 8px;border-top:1px solid #ebe9e4">${esc(r.finishedBy || '')}</td><td style="padding:6px 8px;border-top:1px solid #ebe9e4;text-align:right">${r.passed}</td><td style="padding:6px 8px;border-top:1px solid #ebe9e4;text-align:right;${r.issues ? 'color:#a32d2d;font-weight:600' : ''}">${r.issues}</td><td style="padding:6px 8px;border-top:1px solid #ebe9e4"><a href="${esc(APP() + '/walks/' + r.code)}" style="color:#185fa5">report</a></td></tr>`).join('')
  const fixed = reports.flatMap(r => r.fixTasks.map(f => ({ ...f, code: r.code, date: r.scheduledDate }))).filter(f => !openIssues.some(o => o.taskId === f.taskId))
  const html = `<div style="${FONT};max-width:620px;margin:0 auto;font-size:14px;line-height:1.5">
    <h1 style="font-size:20px;margin:0 0 6px">${esc(program.name)} — week of ${esc(fmtDate(from))}</h1>
    <p style="margin:0 0 14px;color:#4a4946">${esc(fmtDate(from))} to ${esc(fmtDate(to))}.</p>
    <p style="margin:0 0 16px">${chip(walks + ' of ' + scheduled + ' walks done', missed ? '#f9eeda' : '#e5f4e4', missed ? '#633806' : '#27500a')} &nbsp;${chip(issues + (issues === 1 ? ' issue found' : ' issues found'), issues ? '#fbebeb' : '#f0efec', issues ? '#791f1f' : '#444441')} &nbsp;${chip(openIssues.length + ' still open', openIssues.length ? '#f9eeda' : '#f0efec', openIssues.length ? '#633806' : '#444441')}</p>
    ${missed ? `<p style="margin:0 0 12px;color:#854f0b">${missed} scheduled walk${missed === 1 ? ' was' : 's were'} not completed this week.</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="text-align:left;padding:6px 8px;font-size:12px;color:#6b6a66">Walk</th><th style="text-align:left;padding:6px 8px;font-size:12px;color:#6b6a66">By</th><th style="text-align:right;padding:6px 8px;font-size:12px;color:#6b6a66">Passed</th><th style="text-align:right;padding:6px 8px;font-size:12px;color:#6b6a66">Issues</th><th></th></tr>${rows || '<tr><td colspan="5" style="padding:8px;color:#6b6a66">No walks were filed this week.</td></tr>'}</table>
    ${openIssues.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Still open</h2>${openIssues.map(o => itemHtml({ action: o.action, note: o.note, photos: o.photos }, `<div style="font-size:12.5px;color:#854f0b;margin-top:2px">Found ${esc(fmtDate(o.date))}</div>`)).join('')}` : ''}
    ${fixed.length ? `<h2 style="font-size:15px;margin:18px 0 4px">Fixed this week</h2>${fixed.map(f => itemHtml({ action: f.action, note: f.note }, `<div style="font-size:12.5px;color:#0f6e56;margin-top:2px">Found ${esc(fmtDate(f.date))}, closed</div>`)).join('')}` : ''}
    <p style="font-size:12px;color:#8a8984;margin:16px 0 0">Sent by Lighthouse, Stay Hospitality's operations system.</p>
  </div>`
  return { subject, html }
}

/**
 * The week's roll-up for every program that asks for one — once per program per Monday (the
 * settings remember the last week sent). `today` is the ET date the run is for.
 */
export async function sendWeeklyDigests(opts: { force?: boolean; onlyProgram?: string; today?: string; dryRun?: boolean } = {}): Promise<{ ok: boolean; sent: { program: string; to: string[]; subject: string }[]; skipped: string[]; errors: string[] }> {
  const today = opts.today || ymdET(new Date())
  const out = { ok: true, sent: [] as { program: string; to: string[]; subject: string }[], skipped: [] as string[], errors: [] as string[] }
  const programs = (await loadPrograms()).filter(p => (opts.onlyProgram ? p.id === opts.onlyProgram : true))
  const cfg = await mailSettings()
  const weeklySent: Record<string, string> = { ...cfg.weeklySent }
  const to7 = shift(today, -1), from7 = shift(today, -7)
  for (const p of programs) {
    const rep = reportOf(p)
    if (!rep.weekly || !p.active) { out.skipped.push(p.name + ': no weekly report'); continue }
    if (!opts.force && weeklySent[p.id] === today) { out.skipped.push(p.name + ': already sent today'); continue }
    try {
      const rows = await listReports({ programId: p.id, since: from7, limit: 120 })
      const reports = ((await Promise.all(rows.filter(r => r.date <= to7).map(r => getReport(r.code)))).filter(Boolean) as WalkReport[])
      // A program that has never filed a walk has nothing to roll up — the first Monday after it
      // starts would otherwise mail the owners "0 walks, 0 issues" for a week it did not exist.
      // Once a walk has been filed, a week with none IS the finding, and the roll-up still goes.
      if (!reports.length && !(await listReports({ programId: p.id, limit: 1 })).length) { out.skipped.push(p.name + ': no walk filed yet'); continue }
      let scheduled = 0
      for (let d = from7; d <= to7; d = shift(d, 1)) for (const pl of p.places) if (onDays(pl, d)) scheduled++
      const probe: WalkReport = { ...(reports[0] || {} as any), code: '', fixTasks: [] }
      const openIssues = await carriedIssues(p, probe).catch(() => [])
      const { subject, html } = weeklyDigestHtml(p, from7, to7, reports, scheduled, openIssues)
      const place = p.places[0] || null
      const to = (rep.owners ? await ownerEmailsFor(place).catch(() => [] as string[]) : []).concat(rep.to)
      if (opts.dryRun) { out.sent.push({ program: p.name, to, subject }); continue }
      const s = await send(to, subject, html)
      if (!s.ok) { out.errors.push(p.name + ': ' + (s.error || 'not sent')); continue }
      weeklySent[p.id] = today
      out.sent.push({ program: p.name, to: s.to, subject })
    } catch (e: any) { out.errors.push(p.name + ': ' + str(e?.message || e).slice(0, 200)) }
  }
  if (!opts.dryRun) { const s = await getSetting<any>(SETTINGS_KEY, {}); await setSetting(SETTINGS_KEY, { ...(s || {}), weeklySent }, 'walk-reports').catch(() => null) }
  out.ok = !out.errors.length
  return out
}

/**
 * The webhook's safety net: finished program tasks from the last few days that have no report yet.
 * Reads the mirror (breezeway_tasks_sync), which the half-hourly sync keeps current.
 */
export async function sweepFinishedWalks(days = 3): Promise<{ checked: number; filed: string[]; errors: string[] }> {
  const out = { checked: 0, filed: [] as string[], errors: [] as string[] }
  const programs = (await loadPrograms()).filter(p => { const r = reportOf(p); return r.mode !== 'off' || r.weekly })
  if (!programs.length) return out
  const since = shift(ymdET(new Date()), -days)
  const db = supabaseAdmin()
  for (const p of programs) {
    const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at,scheduled_date,home_id,raw')
      .ilike('name', p.name.trim().replace(/[%_]/g, '') + ':%').gte('scheduled_date', since).not('finished_at', 'is', null).limit(100)
    for (const t of (data || []) as any[]) {
      if (!isTaskDone(t.status, t.finished_at) || isTaskGone(t.status)) continue
      out.checked++
      const r = await walkReportForTask({ ...(t.raw || {}), id: t.id, name: t.name, finished_at: t.finished_at, scheduled_date: t.scheduled_date, home_id: t.home_id, type_task_status: t.raw?.type_task_status || { code: t.status } }, { programs })
      if (r.ok && r.code && !r.skipped) out.filed.push(r.code)
      else if (r.error) out.errors.push(str(t.id) + ': ' + r.error)
    }
  }
  return out
}
