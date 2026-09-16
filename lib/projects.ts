// PROJECTS — the reads, the writes and the one place that decides what "late" means.
//
// A project is the work that does not fit a task: it runs for weeks, has a lead, usually has money
// attached, and often needs an owner to approve it before anyone moves. Tasks stay in Breezeway;
// this never writes there. A project can POINT AT tasks, units and reservations (project_links),
// which is what lets the board say "34 units, 21 done" without owning any of them.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
export * from './projects-shared'
import {
  type Project, type ProjectFull, type Member, type Person, type Task, type Viewer, type EventType,
  progressOf, healthOf, nestTasks, TASK_STATUSES, money, todayISO, canSee, canEdit, toPerson,
  type Invoice, INVOICE_STATUSES, INVOICE_COUNTS, nextOccurrence, doneSectionName, isDoneSection, settingsOf, viewPrefsOf,
} from './projects-shared'

export async function getCategories(): Promise<{ key: string; label: string; color: string; sort: number }[]> {
  try {
    const { data } = await supabaseAdmin().from('project_categories').select('*').eq('active', true).order('sort')
    return (data || []) as any
  } catch { return [] }
}

export async function listProjects(opts: { archived?: boolean; category?: string; market?: string; lead?: string; viewer?: Viewer } = {}) {
  try {
    const sb = supabaseAdmin()
    let q = sb.from('projects').select('*').eq('archived', !!opts.archived)
    if (opts.category && opts.category !== 'all') q = q.eq('category', opts.category)
    if (opts.market && opts.market !== 'all') q = q.eq('market', opts.market)
    if (opts.lead && opts.lead !== 'all') q = q.eq('lead_email', opts.lead)
    const { data } = await q.order('sort', { nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
    let rows = (data || []) as any as Project[]
    if (!rows.length) return []
    // PRIVACY IS APPLIED HERE, NOT IN THE UI. When a viewer is given, the board only ever receives
    // the projects that viewer is a member of. A non-member does not get a greyed-out card; they
    // get nothing, and cannot tell the project exists.
    if (opts.viewer) {
      const e = String(opts.viewer.email || '').trim().toLowerCase()
      const { data: mine } = e ? await sb.from('project_members').select('project_id').eq('email', e).limit(2000) : { data: [] as any[] }
      const ok = new Set(((mine || []) as any[]).map(m => String(m.project_id)))
      // A personal board is its owner's alone — the superadmin's all-access stops at the kind.
      rows = rows.filter(r => canSee(ok.has(String(r.id)) ? [{ email: e }] : [], opts.viewer!, (r as any).kind))
      if (!rows.length) return []
    }
    const ids = rows.map(r => r.id)
    // Two round trips for the whole board rather than N+1 per card.
    const [{ data: links }, { data: steps }] = await Promise.all([
      sb.from('project_links').select('project_id,kind,ref_id,label,done').in('project_id', ids),
      sb.from('project_steps').select('project_id,done').in('project_id', ids),
    ])
    const byL: Record<string, any[]> = {}, byS: Record<string, any[]> = {}
    for (const l of (links || []) as any[]) (byL[l.project_id] = byL[l.project_id] || []).push(l)
    for (const s of (steps || []) as any[]) (byS[s.project_id] = byS[s.project_id] || []).push(s)
    return rows.map(p => ({
      ...p,
      links: byL[p.id] || [], steps: byS[p.id] || [],
      progress: progressOf(byL[p.id] || [], byS[p.id] || []),
      health: healthOf(p, byS[p.id] || []),
    }))
  } catch { return [] }
}

/**
 * One person's display choices for one board. Missing is normal and means "never customised" —
 * the caller falls back to the board's own settings so nothing looks reset on the first load.
 */
export async function getViewPrefs(projectId: string, email: string | null | undefined): Promise<any> {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return null
  try {
    const { data } = await supabaseAdmin().from('project_view_prefs')
      .select('prefs').eq('project_id', projectId).eq('email', e).maybeSingle()
    return (data as any)?.prefs ?? null
  } catch {
    // The table is new. A board that renders with shared defaults is a far better failure than a
    // board that does not render, so this never throws.
    return null
  }
}

export async function saveViewPrefs(projectId: string, email: string | null | undefined, patch: any): Promise<{ ok: boolean; prefs?: any; error?: string }> {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return { ok: false, error: 'no email on session' }
  try {
    const sb = supabaseAdmin()
    const cur = await getViewPrefs(projectId, e)
    // Merge, so a page that only knows about `view` cannot wipe which panels I hid.
    const next = viewPrefsOf({ ...(cur || {}), ...(patch || {}) })
    const { error } = await sb.from('project_view_prefs')
      .upsert({ project_id: projectId, email: e, prefs: next, updated_at: new Date().toISOString() }, { onConflict: 'project_id,email' })
    if (error) return { ok: false, error: error.message }
    return { ok: true, prefs: next }
  } catch (err: any) { return { ok: false, error: String(err?.message || err).slice(0, 200) } }
}

export async function getProject(id: string): Promise<ProjectFull | null> {
  const sb = supabaseAdmin()
  const { data: p, error } = await sb.from('projects').select('*').eq('id', id).maybeSingle()
  // A failed read is not a missing project. The old version returned null for both, and the page
  // rendered "not found" for a database blip — the false all-clear the audit was about.
  if (error) throw new Error('project read failed: ' + error.message)
  if (!p) return null
  const [links, steps, photos, notes, members, asg] = await Promise.all([
    sb.from('project_links').select('*').eq('project_id', id).order('created_at'),
    sb.from('project_steps').select('*').eq('project_id', id).order('sort', { nullsFirst: false }).order('created_at'),
    sb.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(500),
    sb.from('project_notes').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(1000),
    sb.from('project_members').select('*').eq('project_id', id).order('created_at'),
    // `role` arrives with migration 087. Selecting it before the migration runs would make the
    // whole project 500 on a column that does not exist yet, so it is read separately and a
    // missing column simply means every row is what it always was: an assignee.
    sb.from('project_task_assignees').select('task_id,person_key,display,email,role').eq('project_id', id),
  ])
  for (const r of [links, steps, photos, notes, members]) if (r.error) throw new Error('project read failed: ' + r.error.message)
  let asgRows = (asg.data || []) as any[]
  if (asg.error) {
    if (!/column|schema/i.test(asg.error.message)) throw new Error('project read failed: ' + asg.error.message)
    const retry = await sb.from('project_task_assignees').select('task_id,person_key,display,email').eq('project_id', id)
    if (retry.error) throw new Error('project read failed: ' + retry.error.message)
    asgRows = (retry.data || []) as any[]
  }
  const L = (links.data || []) as any[]
  const homed = await homedTasks(id)
  const S = [...((steps.data || []) as any[]), ...homed.rows]
  const byTask: Record<string, Person[]> = {}
  const collabByTask: Record<string, Person[]> = {}
  for (const a of [...asgRows, ...homed.asg]) {
    const who = { person_key: a.person_key, display: a.display, email: a.email }
    const bucket = String(a.role || 'assignee') === 'collaborator' ? collabByTask : byTask
    ;(bucket[a.task_id] = bucket[a.task_id] || []).push(who)
  }
  const [, , invoices] = await Promise.all([enrichLinks(L), syncBreezeway(S), getInvoices(id)])
  const files = await signFiles(photos.data || [])
  // The invoice carries its own paperwork so the panel never has to hunt the files list for it.
  const byFile: Record<string, any> = {}
  for (const f of files) byFile[String(f.id)] = f
  for (const inv of invoices) {
    const f = inv.photo_id ? byFile[String(inv.photo_id)] : null
    inv.file = f ? { id: f.id, name: f.name, url: f.url, mime: f.mime } : null
  }
  return {
    ...(p as any),
    links: L, steps: S, photos: files, notes: notes.data || [],
    members: (members.data || []) as Member[],
    tasks: nestTasks(S, byTask, collabByTask),
    invoices,
    progress: progressOf(L.filter(l => !l.task_id), S), health: healthOf(p as any, S),
  }
}

// ---------------------------------------------------------------- invoices
// FAIL-OPEN, like every other table that arrived after the page did: until migration 087 runs the
// project simply has no invoices. It must not take the project page down, because the page is how
// people would find out anything is wrong.
export async function getInvoices(projectId: string): Promise<Invoice[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('project_invoices').select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(500)
    if (error) return []
    return ((data || []) as any[]).map(r => ({
      ...r,
      amount_cents: Number(r.amount_cents) || 0,
      needs_approval: !!r.needs_approval,
      status: INVOICE_STATUSES.includes(r.status) ? r.status : 'received',
    })) as Invoice[]
  } catch { return [] }
}

/** Keep projects.invoiced_cents honest after any invoice write. Approved and paid only — a quote
 *  is not money out. Never touches spent_cents: that number was typed by a person. */
export async function recountInvoiced(projectId: string): Promise<void> {
  try {
    const sb = supabaseAdmin()
    const { data, error } = await sb.from('project_invoices').select('amount_cents,status').eq('project_id', projectId).limit(1000)
    if (error) return
    const total = ((data || []) as any[])
      .filter(r => INVOICE_COUNTS.includes(String(r.status) as any))
      .reduce((n, r) => n + (Number(r.amount_cents) || 0), 0)
    await sb.from('projects').update({ invoiced_cents: total }).eq('id', projectId)
  } catch { /* the number is recomputed on the next write */ }
}

// ---------------------------------------------------------------- finished work moves aside
/**
 * Completing a task files it under the board's finished section; reopening puts it back.
 *
 * Jon, 2026-09-15: "have a default: when a task is completed, it moves to a completed section in
 * the project."
 *
 * Three decisions worth stating, because each has an obvious wrong version:
 *
 *   • IT REMEMBERS WHERE THE TASK CAME FROM (section_before_done). Ticking a task by accident and
 *     unticking it must not strand it. On a vendor board the section IS the lifecycle stage, so
 *     forgetting means the job silently changes state.
 *   • SUBTASKS DO NOT MOVE. A checklist item belongs under its parent; filing it somewhere else
 *     would tear the checklist in half the moment somebody ticked one line of it.
 *   • A TASK ALREADY IN THE FINISHED SECTION IS LEFT ALONE, so nothing is recorded as having come
 *     from "Completed" and reopening returns it to no section rather than back to the pile.
 *
 * Returns the section it moved to (or restored to), or null when nothing moved. Best-effort: the
 * tidy-up must never fail the completion that caused it — a task that is done and in the wrong
 * column is a far smaller problem than a tick that would not save.
 */
export async function fileCompletedTask(
  taskId: string, projectId: string, nowDone: boolean,
): Promise<{ section: string | null; moved: boolean }> {
  try {
    const sb = supabaseAdmin()
    const { data: t } = await sb.from('project_steps').select('id,section,parent_id,section_before_done').eq('id', taskId).maybeSingle()
    if (!t) return { section: null, moved: false }
    if ((t as any).parent_id) return { section: null, moved: false }          // checklist items stay put

    const { data: p } = await sb.from('projects').select('settings').eq('id', projectId).maybeSingle()
    const settings = settingsOf((p as any)?.settings)
    if (!settings.moveDone) return { section: null, moved: false }

    if (nowDone) {
      const from = (t as any).section ?? null
      if (isDoneSection(from)) return { section: from, moved: false }
      // Every section the board currently knows about, so an existing "Done" column wins over
      // creating a second one beside it.
      const { data: rows } = await sb.from('project_steps').select('section').eq('project_id', projectId).limit(1000)
      const known = Array.from(new Set([
        ...settings.sectionOrder,
        ...((rows || []) as any[]).map(r => r.section).filter(Boolean),
      ].map(String)))
      const target = doneSectionName(known, settings)
      const { error } = await sb.from('project_steps').update({ section: target, section_before_done: from }).eq('id', taskId)
      if (error) return { section: null, moved: false }
      await ensureSectionLast(projectId, target, settings)
      return { section: target, moved: true }
    }

    // Reopening. Back where it was; null is a real answer and means "no section", which is
    // different from "we do not know".
    const back = (t as any).section_before_done ?? null
    if (!isDoneSection((t as any).section)) return { section: null, moved: false }
    const { error } = await sb.from('project_steps').update({ section: back, section_before_done: null }).eq('id', taskId)
    if (error) return { section: null, moved: false }
    return { section: back, moved: true }
  } catch { return { section: null, moved: false } }
}

/** Keep the finished section in the board order, and keep it LAST — it is where work goes to rest. */
async function ensureSectionLast(projectId: string, name: string, settings: { sectionOrder: string[] }) {
  try {
    const sb = supabaseAdmin()
    const order = (settings.sectionOrder || []).map(String)
    const next = [...order.filter(x => x !== name), name]
    if (order.length === next.length && order[order.length - 1] === name) return
    const { data: p } = await sb.from('projects').select('settings').eq('id', projectId).maybeSingle()
    await sb.from('projects').update({ settings: { ...((p as any)?.settings || {}), sectionOrder: next } }).eq('id', projectId)
  } catch { /* the section still renders; only its position is unsaved */ }
}

// ---------------------------------------------------------------- recurring vendor work
/**
 * Finish a repeating vendor job and the next visit books itself.
 *
 * Jon, 2026-09-15: vendor work "could be reoccurring things like pest control that we can build
 * into the system." This is that, and the design choice worth defending is WHEN it runs: on
 * completion, not on a nightly clock.
 *
 * A clock would mean pest control appearing on the first of every month whether or not last
 * month's visit ever happened, and by March the board carries three open pest jobs and nobody
 * trusts any of them. Rolling on completion means exactly one open visit at a time, and a job
 * sitting unfinished is itself the signal that the vendor has not been.
 *
 * The new job carries the vendor, the unit and the description forward, and nothing about the last
 * visit: no invoice, no photos, no notification stamp. Those belong to the visit that happened.
 */
export async function rollRecurringVendorJob(taskId: string, projectId: string, by: string): Promise<{ id: string; visit_on: string } | null> {
  try {
    const sb = supabaseAdmin()
    const { data: t, error } = await sb.from('project_steps').select('*').eq('id', taskId).maybeSingle()
    if (error || !t) return null
    const r = (t as any).recurs
    if (!r || !r.every) return null

    // Count from the visit that just happened, so a visit done three days late does not drag the
    // whole cadence three days later for ever.
    const from = String((t as any).visit_on || todayISO()).slice(0, 10)
    const next = nextOccurrence(r, from)

    const { data: made, error: e2 } = await sb.from('project_steps').insert({
      project_id: (t as any).project_id, title: (t as any).title, description: (t as any).description,
      status: 'todo', section: (t as any).section, parent_id: null,
      priority: (t as any).priority || 'normal',
      // due_on trails the visit by the same gap the last one had, so a job that was always "finish
      // within a week of the visit" keeps that shape instead of losing its deadline.
      due_on: dueOffsetFrom(t as any, next),
      vendor_key: (t as any).vendor_key, vendor_name: (t as any).vendor_name,
      visit_on: next, visit_window: (t as any).visit_window, est_minutes: (t as any).est_minutes,
      recurs: { ...r, next_on: next },
      recurred_from: taskId,
      created_by: by, sort: (t as any).sort,
    }).select('id').single()
    if (e2 || !made) return null

    // The unit comes with it. A pest visit that forgot which building it was for would be worse
    // than no visit on the board at all.
    const { data: links } = await sb.from('project_links').select('kind,ref_id,label').eq('task_id', taskId)
    if (links && links.length) {
      await sb.from('project_links').insert(((links || []) as any[]).map(l => ({
        project_id: projectId, task_id: made.id, kind: l.kind, ref_id: l.ref_id, label: l.label,
      }))).then(() => {}, () => {})
    }
    // The same people, so the next visit is not unowned.
    const { data: asg } = await sb.from('project_task_assignees').select('*').eq('task_id', taskId)
    if (asg && asg.length) {
      await sb.from('project_task_assignees').insert(((asg || []) as any[]).map(a => ({
        task_id: made.id, project_id: projectId, person_key: a.person_key, display: a.display, email: a.email,
        ...(a.role !== undefined ? { role: a.role } : {}),
      }))).then(() => {}, () => {})
    }
    // The finished one stops repeating — the schedule moved to its successor. Without this, editing
    // an old visit back to open and closing it again would book a second next visit.
    await sb.from('project_steps').update({ recurs: null }).eq('id', taskId)
    return { id: String(made.id), visit_on: next }
  } catch { return null }
}

/** Keep the gap between the visit and the deadline that the last one had; null if it had none. */
function dueOffsetFrom(t: { visit_on?: string | null; due_on?: string | null }, nextVisit: string): string | null {
  const v = String(t.visit_on || '').slice(0, 10)
  const d = String(t.due_on || '').slice(0, 10)
  if (!v || !d) return null
  const gap = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(v + 'T12:00:00Z')) / 86400000)
  if (!Number.isFinite(gap) || gap < 0) return null
  return new Date(Date.parse(nextVisit + 'T12:00:00Z') + gap * 86400000).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- approval in writing
/**
 * The email that asks the owner or GM to approve a vendor cost.
 *
 * Jon, 2026-09-15: "If it's over 300, it must be approved by the owner/general manager, and we can
 * put that in writing." The writing is the point. It names the amount, the vendor, the unit and
 * what the money is for, because an approval that just says "$480, ok?" is not something anybody
 * can stand behind later when the owner asks what they agreed to.
 */
export function vendorApprovalEmail(o: {
  amountCents: number; vendor?: string | null; jobTitle?: string | null; unit?: string | null
  number?: string | null; note?: string | null; ceiling: number; board: string; fromName?: string
}) {
  const fmt = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const where = o.unit ? ` at ${o.unit}` : ''
  const subject = `Approval needed — ${fmt(o.amountCents)}${o.vendor ? ' to ' + o.vendor : ''}${where}`
  const lines: string[] = []
  lines.push('Hi,')
  lines.push('')
  lines.push(`We need a vendor for ${o.jobTitle ? '“' + o.jobTitle + '”' : 'work'}${where}, and the cost is above the ${fmt(o.ceiling)} limit, so it needs your approval before we book it.`)
  lines.push('')
  lines.push(`  Amount:  ${fmt(o.amountCents)}`)
  if (o.vendor) lines.push(`  Vendor:  ${o.vendor}`)
  if (o.unit) lines.push(`  Where:   ${o.unit}`)
  if (o.number) lines.push(`  Ref:     ${o.number}`)
  if (o.note) { lines.push(''); lines.push(`  For: ${o.note}`) }
  lines.push('')
  lines.push('This is work our own team cannot complete. Reply to approve and we will schedule it; happy to talk it through or get a second quote if you would rather.')
  lines.push('')
  lines.push('Thank you,')
  lines.push(o.fromName || 'Stay Hospitality')
  return { subject, body: lines.join('\n') }
}

// ---------------------------------------------------------------- my board
// EVERY USER HAS ONE (Jon, 2026-09-09: "Every user has a default my board — where all tasks
// assigned to you live — call it My Tasks"). It is a personal project, made the first time it is
// needed, and it is where a task typed straight into My Tasks goes. Tasks assigned to you from
// other projects are shown on My Tasks alongside, not copied here.
export const MY_BOARD_KEY = 'my_tasks'
export async function ensureMyBoard(email: string, displayName?: string | null): Promise<{ id: string; title: string }> {
  const sb = supabaseAdmin()
  const e = String(email || '').trim().toLowerCase()
  if (!e) throw new Error('no email')
  const { data: mine } = await sb.from('project_members').select('project_id').eq('email', e).limit(2000)
  const ids = ((mine || []) as any[]).map(m => String(m.project_id))
  if (ids.length) {
    const { data: found } = await sb.from('projects').select('id,title').in('id', ids).eq('kind', 'personal').eq('template_key', MY_BOARD_KEY).eq('archived', false).limit(1)
    if (found && found[0]) return { id: String(found[0].id), title: String(found[0].title) }
  }
  const { data: p, error } = await sb.from('projects').insert({
    title: 'My Tasks', summary: null, category: 'internal', stage: 'in_progress', kind: 'personal', private: true,
    template_key: MY_BOARD_KEY, created_by: e, settings: { icon: '✅', accent: 'emerald', view: 'list', sectionOrder: ['To do', 'Doing', 'Done'] },
  }).select('id,title').single()
  if (error) throw new Error('my board: ' + error.message)
  const who = toPerson(displayName && !/@/.test(displayName) ? displayName : e)
  await sb.from('project_members').insert({ project_id: p.id, person_key: e, display: who.display, email: e, role: 'owner', added_by: 'system' })
  return { id: String(p.id), title: String(p.title) }
}

// ---------------------------------------------------------------- homed tasks (read side)
// A task that lives in another project but appears here too (project_task_homes). It is loaded as
// a top-level row with THIS project's section and sort, and marked with where it came from.
async function homedTasks(projectId: string): Promise<{ rows: any[]; asg: any[] }> {
  const sb = supabaseAdmin()
  const homes = await soft(sb.from('project_task_homes').select('task_id,section,sort').eq('project_id', projectId).limit(500))
  if (!homes?.length) return { rows: [], asg: [] }
  const ids = homes.map((h: any) => String(h.task_id))
  const [tasks, asg] = await Promise.all([
    soft(sb.from('project_steps').select('*').in('id', ids)),
    // select('*') rather than naming `role`: a homed task must keep working before 087 runs,
    // and a star select cannot fail on a column that is not there yet.
    soft(sb.from('project_task_assignees').select('*').in('task_id', ids)),
  ])
  const by = Object.fromEntries(homes.map((h: any) => [String(h.task_id), h]))
  const rows = ((tasks || []) as any[]).map(t => ({ ...t, section: by[t.id]?.section ?? null, sort: by[t.id]?.sort ?? null, parent_id: null, home_project_id: t.project_id, homed: true }))
  const pids = Array.from(new Set(rows.map(r => String(r.project_id))))
  if (pids.length) {
    const ps = await soft(sb.from('projects').select('id,title').in('id', pids))
    const title = Object.fromEntries(((ps || []) as any[]).map(p => [String(p.id), p.title]))
    for (const r of rows) r.home_project_title = title[String(r.project_id)] || 'another project'
  }
  return { rows, asg: (asg || []) as any[] }
}

/** Every project a task appears in: its own, plus each home. */
export async function taskProjects(taskId: string): Promise<{ id: string; title: string; home: boolean }[]> {
  const sb = supabaseAdmin()
  const t = (await soft(sb.from('project_steps').select('project_id').eq('id', taskId).maybeSingle())) as any
  const homes = await soft(sb.from('project_task_homes').select('project_id').eq('task_id', taskId))
  const ids = Array.from(new Set([t?.project_id, ...((homes || []) as any[]).map(h => h.project_id)].filter(Boolean).map(String)))
  if (!ids.length) return []
  const ps = await soft(sb.from('projects').select('id,title').in('id', ids))
  return ((ps || []) as any[]).map(p => ({ id: String(p.id), title: String(p.title), home: String(p.id) !== String(t?.project_id) }))
}

// ---------------------------------------------------------------- integrations (read side)
// "ALL SYNCED" (Jon, 2026-09-09) means the board never shows a stale copy of something another
// system owns. A linked claim shows the claim's stage NOW; a linked glitch its status NOW; a linked
// or sent Breezeway task its field status NOW — all read live at page load and stamped onto the
// row as `state`, never stored. Every lookup is soft: a missing table blanks the state, not the page.
const soft = async <T,>(pr: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> => { try { const r = await pr; return r.error ? null : r.data } catch { return null } }
const BZ_DONE = /finish|complet|closed|done/i
const BZ_GONE = /cancel/i

async function enrichLinks(L: any[]) {
  const sb = supabaseAdmin()
  const ids = (k: string) => L.filter(l => l.kind === k).map(l => String(l.ref_id))
  const [claims, glitches, tasks, stays] = await Promise.all([
    ids('claim').length ? soft(sb.from('claims').select('id,stage,outcome,amount_sought,amount_paid,guest_name,unit_no').in('id', ids('claim'))) : null,
    ids('glitch').length ? soft(sb.from('glitches').select('id,status,category,unit,breezeway_task_id,guest_name').in('id', ids('glitch'))) : null,
    ids('task').length ? soft(sb.from('breezeway_tasks_sync').select('id,status,name,scheduled_date,assignee_name,report_url,finished_at').in('id', ids('task'))) : null,
    ids('reservation').length ? soft(sb.from('guesty_reservations').select('id,status,check_in,check_out,guest_name').in('id', ids('reservation'))) : null,
  ])
  const by = (rows: any[] | null) => Object.fromEntries(((rows || []) as any[]).map(r => [String(r.id), r]))
  const C = by(claims), G = by(glitches), T = by(tasks), R = by(stays)
  for (const l of L) {
    const r = l.kind === 'claim' ? C[l.ref_id] : l.kind === 'glitch' ? G[l.ref_id] : l.kind === 'task' ? T[l.ref_id] : l.kind === 'reservation' ? R[l.ref_id] : null
    if (!r) continue
    if (l.kind === 'claim') l.state = { label: String(r.stage || ''), tone: r.stage === 'closed' ? 'done' : r.outcome === 'denied' ? 'bad' : r.stage === 'submitted' ? 'wait' : 'open', detail: r.amount_paid ? `$${Number(r.amount_paid).toLocaleString('en-US', { maximumFractionDigits: 0 })} paid` : r.amount_sought ? `$${Number(r.amount_sought).toLocaleString('en-US', { maximumFractionDigits: 0 })} sought` : null, href: `/claims?open=${l.ref_id}` }
    if (l.kind === 'glitch') l.state = { label: String(r.status || 'open'), tone: /done|resolved|closed/i.test(String(r.status)) ? 'done' : 'open', detail: [r.category, r.guest_name].filter(Boolean).join(' · ') || null, href: `/glitches?open=${l.ref_id}`, bz: r.breezeway_task_id || null }
    if (l.kind === 'task') l.state = { label: String(r.status || ''), tone: BZ_DONE.test(String(r.status)) ? 'done' : BZ_GONE.test(String(r.status)) ? 'bad' : 'open', detail: [r.assignee_name, r.scheduled_date ? String(r.scheduled_date).slice(0, 10) : null].filter(Boolean).join(' · ') || null, href: r.report_url || null }
    if (l.kind === 'reservation') l.state = { label: String(r.status || ''), tone: /cancel/i.test(String(r.status)) ? 'bad' : 'open', detail: `${String(r.check_in).slice(0, 10)} → ${String(r.check_out).slice(0, 10)}`, href: `/reservations?open=${l.ref_id}` }
  }
}

/** Tasks sent to Breezeway follow the field: status stamped on, and completed here when finished there. */
async function syncBreezeway(S: any[]) {
  const sent = S.filter(t => t.breezeway_task_id)
  if (!sent.length) return
  const sb = supabaseAdmin()
  const rows = await soft(sb.from('breezeway_tasks_sync').select('id,status,scheduled_date,assignee_name,report_url,finished_at').in('id', sent.map(t => String(t.breezeway_task_id))))
  const by = Object.fromEntries(((rows || []) as any[]).map(r => [String(r.id), r]))
  const finish: string[] = []
  for (const t of sent) {
    const r = by[String(t.breezeway_task_id)]
    if (!r) { t.breezeway = { status: 'unknown', tone: 'open' }; continue }
    const done = BZ_DONE.test(String(r.status))
    t.breezeway = { status: String(r.status || ''), tone: done ? 'done' : BZ_GONE.test(String(r.status)) ? 'bad' : 'open', assignee: r.assignee_name || null, date: r.scheduled_date ? String(r.scheduled_date).slice(0, 10) : null, reportUrl: r.report_url || null }
    if (done && t.status !== 'done') { t.status = 'done'; t.done = true; t.done_by = 'breezeway'; finish.push(t.id) }
  }
  // The board follows the field. done_by 'breezeway' makes the feed honest about who did it.
  if (finish.length) await sb.from('project_steps').update({ status: 'done', done_by: 'breezeway' }).in('id', finish)
}

/** Resolve a vendor share link. Returns null for unknown, revoked or expired tokens. */
export async function getProjectByToken(token: string): Promise<ProjectFull | null> {
  const t = String(token || '').trim()
  if (t.length < 12) return null
  try {
    const { data } = await supabaseAdmin().from('projects').select('id,share_expires').eq('share_token', t).maybeSingle()
    if (!data) return null
    if (data.share_expires && new Date(data.share_expires).getTime() < Date.now()) return null
    return await getProject(data.id)
  } catch { return null }
}

// ---------------------------------------------------------------- files
// Wave 2 uploads live in a PRIVATE bucket. The row stores the storage key; the URL people open is
// minted here, per read, and dies in six hours. Old rows from the public bucket have no key and
// keep their permanent URL — nothing about them changed.
export const FILES_BUCKET = 'project-files'
const SIGN_TTL = 6 * 3600

export async function ensureFilesBucket(sb = supabaseAdmin()) {
  const { data } = await sb.storage.getBucket(FILES_BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(FILES_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

async function signFiles(rows: any[]): Promise<any[]> {
  const keyed = rows.filter(r => r.storage_path)
  if (!keyed.length) return rows
  try {
    const { data, error } = await supabaseAdmin().storage.from(FILES_BUCKET).createSignedUrls(keyed.map(r => r.storage_path), SIGN_TTL)
    if (error || !data) throw error || new Error('no urls')
    const byPath: Record<string, string> = {}
    for (const d of data) if (d.signedUrl && d.path) byPath[d.path] = d.signedUrl
    return rows.map(r => (r.storage_path && byPath[r.storage_path]) ? { ...r, url: byPath[r.storage_path] } : r)
  } catch {
    // A signing failure must not hide the row. The name still shows; the click fails honestly.
    return rows
  }
}

// ---------------------------------------------------------------- access gate
// The one membership check every write path uses. 404 for a non-member (the project must not be
// confirmed to exist), 403 for a member who can look but not touch.
export async function gateProject(id: string, viewer: Viewer, need: 'view' | 'edit'):
  Promise<{ ok: true; members: Member[] } | { ok: false; status: number; error: string }> {
  const sb = supabaseAdmin()
  const { data: memRows, error: memErr } = await sb.from('project_members').select('*').eq('project_id', id)
  if (memErr) return { ok: false, status: 500, error: 'Could not check access: ' + memErr.message }
  const members = (memRows || []) as Member[]
  const { data: exists, error: exErr } = await sb.from('projects').select('id,kind').eq('id', id).maybeSingle()
  if (exErr) return { ok: false, status: 500, error: 'Could not check access: ' + exErr.message }
  if (!exists || !canSee(members, viewer, exists.kind)) return { ok: false, status: 404, error: 'No such project.' }
  if (need === 'edit' && !canEdit(members, viewer, exists.kind)) return { ok: false, status: 403, error: 'You can view this project but not change it.' }
  return { ok: true, members }
}

// ---------------------------------------------------------------- writes
export async function addNote(projectId: string, body: string, author: string | null, kind: 'comment' | 'event' = 'comment', viaShare = false,
  extra: { taskId?: string | null; meta?: any } = {}) {
  try {
    await supabaseAdmin().from('project_notes').insert({
      project_id: projectId, body: String(body).slice(0, 4000), author, kind, via_share: viaShare,
      task_id: extra.taskId || null, meta: extra.meta || null,
    })
  } catch {}
}

/** An activity event: what somebody did, with enough structure for the feed to link the task. */
export async function logEvent(projectId: string, who: string | null, type: EventType, body: string,
  meta: { task_id?: string; task_title?: string; from?: string | null; to?: string | null; who?: string[]; name?: string
        /** Which kind of person changed, when the event is about assignees. */
        role?: string
        /** The invoice an event is about, so the feed can link straight to it. */
        invoice_id?: string } = {}) {
  await addNote(projectId, body, who, 'event', false, { taskId: meta.task_id || null, meta: { type, ...meta } })
}

/** 32 hex chars from the crypto RNG — long enough that a link cannot be guessed. */
export function newShareToken(): string {
  const b = new Uint8Array(16)
  ;(globalThis.crypto as Crypto).getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- owner approval email
// The team should never have to write this from scratch, and the numbers in it must come from the
// project rather than from someone's memory — that is the whole point of drafting it here.
export function ownerApprovalEmail(p: Project, steps: { title: string; done: boolean }[] = [], opts: { unitLabel?: string | null; fromName?: string } = {}) {
  const unit = opts.unitLabel || p.building || p.market || 'your property'
  const budget = money(p.budget_cents)
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const scope = steps.filter(s => s.title).slice(0, 12)
  const subject = `Approval requested — ${p.title}${budget != null ? ` (${fmt(budget)})` : ''} at ${unit}`
  const lines: string[] = []
  lines.push(`Hi${p.owner_name ? ' ' + String(p.owner_name).split(' ')[0] : ''},`)
  lines.push('')
  lines.push(`We would like your approval for ${p.title.toLowerCase()} at ${unit}.`)
  if (p.summary) { lines.push(''); lines.push(p.summary) }
  if (scope.length) {
    lines.push(''); lines.push('What this covers:')
    for (const s of scope) lines.push(`  • ${s.title}`)
  }
  if (budget != null) {
    lines.push('')
    lines.push(`Estimated cost: ${fmt(budget)}${p.billable ? ', billed to the property.' : '.'}`)
  }
  if (p.due_on) { lines.push(''); lines.push(`We are aiming to complete this by ${new Date(p.due_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`) }
  lines.push('')
  lines.push('Reply to this email to approve and we will schedule it. Happy to talk it through first if you would rather.')
  lines.push('')
  lines.push(`Thank you,`)
  lines.push(opts.fromName || 'Stay Hospitality')
  return { subject, body: lines.join('\n') }
}
