// ONE PROJECT — the detail read, plus every sub-resource write in a single action-dispatch POST.
//
//   GET  /api/projects/<id>                     → full project (links, steps, photos, notes)
//   POST /api/projects/<id> { action, ... }     → link/unlink, steps, notes, spend, owner email
//
// The actions live together because they all mean "change something about this project" and each
// one is a handful of lines; splitting them into eight route files would spread one idea across
// eight places. The switch is exhaustive and unknown actions are rejected.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getProject, logEvent, gateProject, ownerApprovalEmail, toCents, LINK_KINDS, canSee, canEdit, toPerson,
  TASK_STATUSES, TASK_STATUS_LABEL, MEMBER_ROLES, FILES_BUCKET, prefsOf, settingsOf, describeRecurrence, type Viewer, type Member,
  recountInvoiced, INVOICE_STATUSES, INVOICE_STATUS_LABEL, approvalCeiling, money, rollRecurringVendorJob, fileCompletedTask,
  nextOccurrence, todayISO, estLabel, shortDate, vendorApprovalEmail,
} from '@/lib/projects'
import { saveVendor, slugVendor } from '@/lib/project-vendors'
import { onAssigned, onAdded, onComment } from '@/lib/project-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

/**
 * A repeating vendor job — pest monthly, pool weekly, fire once a year.
 *
 * Null is a real answer and means "stop repeating", so this returns null rather than throwing on
 * anything it does not recognise. next_on is computed here and never taken from the caller: a
 * browser that sent its own next date could put a job on a clock that does not match the rule it
 * claims to follow, and then nobody could explain why it fires when it does.
 */
function normaliseRecurs(v: any): any {
  if (!v || typeof v !== 'object') return null
  const every = String(v.every || '')
  if (!['week', '2weeks', 'month', 'quarter', 'year'].includes(every)) return null
  const r: any = { every }
  if (every === 'week' || every === '2weeks') r.weekday = Math.min(6, Math.max(0, Number(v.weekday ?? 1)))
  else r.day = Math.min(28, Math.max(1, Number(v.day ?? 1)))
  if (every === 'year') r.month = Math.min(12, Math.max(1, Number(v.month ?? 1)))
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(v.from || '')) ? String(v.from) : todayISO()
  r.next_on = nextOccurrence(r, from)
  return r
}

// A NON-MEMBER GETS 404, NOT 403. A 403 says "this exists and you may not see it", which for a
// private one-on-one is itself a leak — it confirms the project is there. The response for "not a
// member" is identical to "no such project", so nothing can be learned by guessing ids.
const viewerOf = (access: any): Viewer => ({ email: access.email, superadmin: isSuperadmin(access.email) })

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  let p
  try { p = await getProject(params.id) } catch (e: any) {
    return NextResponse.json({ error: 'Could not load the project: ' + String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
  if (!p || !canSee(p.members, viewerOf(g.access), p.kind)) return NextResponse.json({ error: 'No such project.' }, { status: 404 })
  return NextResponse.json({ ok: true, project: p, canEdit: canEdit(p.members, viewerOf(g.access), p.kind) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const id = params.id
  const sb = supabaseAdmin()
  try {
    const b = await req.json().catch(() => ({}))
    const action = str(b.action)
    const me = String(g.access.email || "")
    const viewer = viewerOf(g.access)

    // Every write starts by proving the caller may see the project and may edit it. Same 404 as
    // the read for a non-member; a viewer-role member gets an honest 403 because they already
    // know it exists. A comment is the one write a viewer may make — they were put on the project
    // to take part, and taking part means being able to say something.
    const gate = await gateProject(id, viewer, ['comment', 'note', 'memberNotify', 'taskProjects'].includes(action) ? 'view' : 'edit')
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    const members = gate.members as Member[]
    const projectTitle = async () => String((await sb.from('projects').select('title').eq('id', id).maybeSingle()).data?.title || 'a project')
    // Notifications are best-effort: a mail-table hiccup must never fail the edit that caused it.
    const tell = (p: Promise<any>) => p.catch(e => console.error('[projects] notify failed:', String(e?.message || e)))

    // Keep the old single-assignee column honest: FIRST ASSIGNEE, or null. Collaborators never
    // fill it — the legacy column means "who is doing this", and that is not what a collaborator is.
    const syncLegacyAssignee = async (taskId: string) => {
      const { data } = await sb.from('project_task_assignees').select('display,role').eq('task_id', taskId).order('created_at').limit(50)
      const doer = ((data || []) as any[]).find(r => String(r.role || 'assignee') === 'assignee')
      await sb.from('project_steps').update({ assignee: doer ? doer.display : null }).eq('id', taskId)
    }

    // ASSIGNEES AND COLLABORATORS ARE THE SAME TABLE, told apart by `role`. Writing them through
    // one function is what stops the two lists drifting: a person moved from one to the other is
    // one upsert, not a delete here and an insert there that can half-fail.
    //
    // `role` arrives with migration 087. If it is not there yet the write is retried without it,
    // so a collaborator silently becomes an assignee rather than the whole save failing — the
    // person still gets the task on their list, which is the part that matters.
    const writePeople = async (taskId: string, list: any[], role: 'assignee' | 'collaborator') => {
      const people = (Array.isArray(list) ? list : []).map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
      if (!people.length) return { people: [], error: null as string | null }
      const rows = people.map((who: any) => ({ task_id: taskId, project_id: id, ...who, role }))
      const { error } = await sb.from('project_task_assignees').upsert(rows, { onConflict: 'task_id,person_key' })
      if (error) {
        if (!/column|schema/i.test(error.message)) return { people, error: error.message }
        const bare = rows.map(({ role: _r, ...rest }: any) => rest)
        const retry = await sb.from('project_task_assignees').upsert(bare, { onConflict: 'task_id,person_key' })
        if (retry.error) return { people, error: retry.error.message }
      }
      return { people, error: null as string | null }
    }
    const readPeople = async (taskId: string) => {
      const { data } = await sb.from('project_task_assignees').select('*').eq('task_id', taskId)
      const rows = (data || []) as any[]
      return {
        assignees: rows.filter(r => String(r.role || 'assignee') === 'assignee'),
        collaborators: rows.filter(r => String(r.role || 'assignee') === 'collaborator'),
      }
    }
    // Events name the task by title; one small read gives the title and the before-state.
    // A task counts as "in this project" when it lives here OR is homed here from another project
    // (project_task_homes). Editing a homed task edits the one task — that is what multi-homing is.
    const taskRow = async (taskId: string) => {
      const { data } = await sb.from('project_steps').select('id,title,status,due_on,section,project_id').eq('id', taskId).maybeSingle()
      if (!data) return null
      if (String(data.project_id) === id) return data as any as { id: string; title: string; status: string; due_on: string | null; section: string | null; project_id: string; homed?: boolean }
      const { data: home } = await sb.from('project_task_homes').select('section').eq('task_id', taskId).eq('project_id', id).maybeSingle()
      if (!home) return null
      return { ...(data as any), section: home.section ?? null, homed: true } as { id: string; title: string; status: string; due_on: string | null; section: string | null; project_id: string; homed?: boolean }
    }
    const first = (s: string | null | undefined) => String(s || '').split(/[\s@]/)[0]
    const ymd = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null)

    // ---- VENDOR FIELDS (migration 088) -----------------------------------------
    // Built once and applied through applyVendor, so the create path and the edit path can never
    // disagree about what a vendor job is. Only keys the caller actually sent are included: a form
    // that shows the vendor but not the time window must not blank the window.
    const vendorPatch = (b: any): Record<string, any> => {
      const v: Record<string, any> = {}
      if (b.vendorKey !== undefined) v.vendor_key = str(b.vendorKey) || null
      if (b.vendorName !== undefined) v.vendor_name = str(b.vendorName).slice(0, 200) || null
      if (b.visit_on !== undefined) v.visit_on = ymd(b.visit_on)
      if (b.visit_window !== undefined) v.visit_window = str(b.visit_window).slice(0, 60) || null
      if (b.est_minutes !== undefined) {
        const n = Number(b.est_minutes)
        v.est_minutes = Number.isFinite(n) && n > 0 ? Math.min(60 * 24 * 30, Math.round(n)) : null
      }
      if (b.recurs !== undefined) v.recurs = normaliseRecurs(b.recurs)
      return v
    }
    // Until 088 runs these columns are not there. A vendor job saved on the old schema keeps its
    // title, unit and people — it simply has no vendor on it yet — rather than the whole save
    // failing on a column nobody has added. Returns what could not be written, so the caller can say so.
    const applyVendor = async (taskId: string, patch: Record<string, any>): Promise<string | null> => {
      if (!Object.keys(patch).length) return null
      const { error } = await sb.from('project_steps').update(patch).eq('id', taskId)
      if (!error) return null
      if (!/column|schema/i.test(error.message)) return error.message
      return 'the vendor, visit date and estimate (run migration 088 in Supabase and they will save)'
    }

    switch (action) {
      // ---- MEMBERS: who is on this project, and therefore who can see it ---------
      case 'memberAdd': {
        const who = toPerson(str(b.person))
        if (!who.display) return NextResponse.json({ error: 'Who?' }, { status: 400 })
        // A personal board stays personal. Wanting a second person on it means it is a project now.
        const { data: pk } = await sb.from('projects').select('kind').eq('id', id).maybeSingle()
        if (pk?.kind === 'personal') return NextResponse.json({ error: 'This is your personal board — only you can be on it. Start a project to work with somebody.' }, { status: 400 })
        const role = MEMBER_ROLES.includes(str(b.role) as any) ? str(b.role) : 'editor'
        const { error } = await sb.from('project_members').upsert(
          { project_id: id, ...who, role, added_by: me }, { onConflict: 'project_id,person_key' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await logEvent(id, me, 'member_added', `added ${who.display} as ${role}`, { who: [who.display], to: role })
        await tell(onAdded(id, await projectTitle(), who, role, me, members))
        break
      }
      // What I get EMAILED about on this project. Your own row only — nobody sets somebody else's
      // inbox — and the bell in the app is unaffected either way.
      case 'memberNotify': {
        const mine = members.find(m => String(m.email || '').toLowerCase() === String(me || '').toLowerCase())
        if (!mine) return NextResponse.json({ error: 'You are not on this project by email.' }, { status: 400 })
        const notify = prefsOf({ ...prefsOf(mine.notify), ...(b.notify || {}) })
        const { error } = await sb.from('project_members').update({ notify }).eq('id', mine.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }
      case 'memberRole': {
        const role = MEMBER_ROLES.includes(str(b.role) as any) ? str(b.role) : null
        if (!role) return NextResponse.json({ error: 'role must be owner, editor or viewer' }, { status: 400 })
        const target = members.find(m => m.person_key === str(b.personKey))
        const { error } = await sb.from('project_members').update({ role }).eq('project_id', id).eq('person_key', str(b.personKey))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (target && target.role !== role) await logEvent(id, me, 'member_role', `made ${target.display} ${role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : 'a viewer'}`, { who: [target.display], from: target.role, to: role })
        break
      }
      case 'memberRemove': {
        // THE LAST OWNER CANNOT LEAVE. A project with nobody on it is invisible to everyone but
        // the superadmin, which is a way to lose a project rather than a way to tidy one.
        const owners = members.filter(m => m.role === 'owner')
        const target = members.find(m => m.person_key === str(b.personKey))
        if (target?.role === 'owner' && owners.length <= 1) {
          return NextResponse.json({ error: 'Make somebody else an owner before removing the last one.' }, { status: 400 })
        }
        const { error } = await sb.from('project_members').delete().eq('project_id', id).eq('person_key', str(b.personKey))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (target) await logEvent(id, me, 'member_removed', `removed ${target.display}`, { who: [target.display] })
        break
      }
      case 'setPrivate': {
        const { error } = await sb.from('projects').update({ private: !!b.private }).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }

      // ---- TASKS: the atom -----------------------------------------------------------
      // ONE FORM, ONE TASK, ONE CALL (Jon, 2026-09-15: "it should be more of a form builder…
      // create subtasks, create due dates, assign it to team members, have multiple collaborators").
      //
      // Everything the form collects is written here rather than by the browser firing six requests
      // in a row. That matters for more than speed: a form that half-saves — the task exists, the
      // subtasks do not — is worse than one that fails, because nobody can tell by looking. The
      // parent row goes in first and everything after it attaches to a task that certainly exists;
      // if an attachment fails, the task and the failure are BOTH reported, so the person knows
      // exactly what to redo instead of typing it all again.
      case 'taskAdd': {
        const title = str(b.title)
        if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
        const status = TASK_STATUSES.includes(str(b.status) as any) ? str(b.status) : 'todo'
        const { data, error } = await sb.from('project_steps').insert({
          project_id: id, title: title.slice(0, 300), description: str(b.description) || null,
          status, section: str(b.section) || null, parent_id: str(b.parentId) || null,
          priority: ['low', 'normal', 'high', 'urgent'].includes(str(b.priority)) ? str(b.priority) : 'normal',
          due_on: str(b.due_on) || null, created_by: me,
          sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : null,
        }).select('id').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const taskId = String(data.id)
        const partial: string[] = []

        const vErr = await applyVendor(taskId, vendorPatch(b))
        if (vErr) partial.push(vErr)

        const A = await writePeople(taskId, b.assignees, 'assignee')
        if (A.error) partial.push('the people it is assigned to (' + A.error + ')')
        const C = await writePeople(taskId, b.collaborators, 'collaborator')
        if (C.error) partial.push('the collaborators (' + C.error + ')')
        if (A.people.length || C.people.length) await syncLegacyAssignee(taskId)

        // SUBTASKS. Each is a child row with the same section, so a checklist typed into the form
        // is indistinguishable from one built by hand afterwards. They inherit nothing else: a
        // subtask with the parent's due date and assignees would be a lie on every line.
        const subs = (Array.isArray(b.subtasks) ? b.subtasks : [])
          .map((x: any) => (typeof x === 'string' ? { title: x } : x))
          .map((x: any) => ({ title: str(x?.title).slice(0, 300), due_on: /^\d{4}-\d{2}-\d{2}$/.test(str(x?.due_on)) ? str(x.due_on) : null }))
          .filter((x: any) => x.title)
          .slice(0, 50)
        if (subs.length) {
          const { error: eSub } = await sb.from('project_steps').insert(subs.map((x: any, i: number) => ({
            project_id: id, title: x.title, parent_id: taskId, status: 'todo',
            section: str(b.section) || null, priority: 'normal', due_on: x.due_on, created_by: me, sort: i,
          })))
          if (eSub) partial.push(subs.length + ' subtask' + (subs.length === 1 ? '' : 's') + ' (' + eSub.message + ')')
        }

        // CROSS-BOARD (Jon: "projects can be connected to other boards"). The task is homed into
        // each project the creator can also edit — not copied. Somewhere they cannot edit is
        // skipped and named, never silently dropped.
        const homes = (Array.isArray(b.homes) ? b.homes : []).map((x: any) => str(x)).filter(Boolean).filter((x: string) => x !== id).slice(0, 10)
        const homedInto: string[] = []
        for (const target of homes) {
          const g2 = await gateProject(target, viewer, 'edit')
          if (!g2.ok) { partial.push('adding it to another board you are not on'); continue }
          const { error: eH } = await sb.from('project_task_homes').upsert({ task_id: taskId, project_id: target, section: null, added_by: me }, { onConflict: 'task_id,project_id' })
          if (eH) partial.push('adding it to another board (' + eH.message + ')'); else homedInto.push(target)
        }

        const who = [...A.people, ...C.people]
        await logEvent(id, me, 'task_added', `added ${str(b.parentId) ? 'a subtask' : 'a task'}${subs.length ? ` with ${subs.length} subtask${subs.length === 1 ? '' : 's'}` : ''}`,
          { task_id: taskId, task_title: title.slice(0, 300), who: who.map((x: any) => x.display) })
        // Both kinds of person are told. A collaborator who is never notified is a name on a
        // screen nobody looks at, which is not what being on a task means.
        if (who.length) await tell(onAssigned(id, { id: taskId, title: title.slice(0, 300) }, who, me, members))
        return NextResponse.json({
          ok: true, taskId, homedInto,
          partial: partial.length ? 'The task was created, but this did not save: ' + partial.join('; ') + '.' : null,
          project: await getProject(id),
        })
      }
      case 'taskSet': {
        const taskId = str(b.taskId)
        const before = await taskRow(taskId)
        if (!before) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const patch: any = {}
        if (b.title !== undefined) patch.title = str(b.title).slice(0, 300)
        if (b.description !== undefined) patch.description = str(b.description) || null
        if (b.section !== undefined) patch.section = str(b.section) || null
        if (b.due_on !== undefined) patch.due_on = str(b.due_on) || null
        if (b.priority !== undefined && ['low', 'normal', 'high', 'urgent'].includes(str(b.priority))) patch.priority = str(b.priority)
        if (b.sort !== undefined && Number.isFinite(Number(b.sort))) patch.sort = Number(b.sort)
        if (b.status !== undefined) {
          if (!TASK_STATUSES.includes(str(b.status) as any)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
          patch.status = str(b.status)
          if (patch.status === 'done') patch.done_by = me
        }
        if (before.homed && patch.section !== undefined) {
          // Section is per project for a homed task: it moves within THIS board only.
          await sb.from('project_task_homes').update({ section: patch.section }).eq('task_id', taskId).eq('project_id', id)
          delete patch.section
        }
        if (Object.keys(patch).length) {
          const { error } = await sb.from('project_steps').update(patch).eq('id', taskId)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        }
        const vErr = await applyVendor(taskId, vendorPatch(b))
        if (vErr) return NextResponse.json({ error: 'Saved, except ' + vErr + '.' }, { status: 500 })

        // A VISIT DATE THAT MOVES UN-TELLS THE TEAM. They were told Tuesday; it is now Thursday,
        // and everyone who heard the first message still believes Tuesday. Clearing the stamp puts
        // the job back in the "tell the team" state rather than leaving a stale all-clear.
        if (b.visit_on !== undefined) {
          const { data: cur } = await sb.from('project_steps').select('visit_on,team_notified_for').eq('id', taskId).maybeSingle()
          const told = String((cur as any)?.team_notified_for || '').slice(0, 10)
          const now = String((cur as any)?.visit_on || '').slice(0, 10)
          if (told && told !== now) {
            await sb.from('project_steps').update({ team_notified_at: null, team_notified_for: null }).eq('id', taskId).then(() => {}, () => {})
          }
        }

        // FINISHING A REPEATING JOB BOOKS THE NEXT ONE. Deliberately here and not on a nightly
        // cron: work that nobody completed must not quietly breed twelve copies of itself while
        // the first one still sits open. The clock only advances when the last visit actually happened.
        if (patch.status === 'done' && before.status !== 'done') {
          const nxt = await rollRecurringVendorJob(taskId, id, me)
          if (nxt) await logEvent(id, me, 'task_added', `next visit booked for ${shortDate(nxt.visit_on)}`, { task_id: nxt.id, task_title: before.title })
        }

        // FINISHED WORK MOVES OUT OF THE WAY. Skipped when the caller set the section itself in the
        // same request — dragging a card somewhere and ticking it in one action should land where
        // the person dropped it, not where the default would have put it.
        if (patch.status !== undefined && patch.status !== before.status && b.section === undefined && !before.homed) {
          const filed = await fileCompletedTask(taskId, id, patch.status === 'done')
          if (filed.moved && patch.status === 'done') {
            await logEvent(id, me, 'task_moved', `moved to ${filed.section}`, { task_id: taskId, task_title: patch.title || before.title, from: before.section, to: filed.section })
          }
        }
        // Assignees and collaborators are each replaced as a SET, so the client never has to diff.
        // Replacing one must not disturb the other, which is the whole reason this deletes by role
        // rather than clearing the task: the old code deleted every row for the task, so saving the
        // assignee list would have taken the collaborators with it.
        for (const [field, role] of [['assignees', 'assignee'], ['collaborators', 'collaborator']] as const) {
          if (!Array.isArray((b as any)[field])) continue
          const people = (b as any)[field].map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
          const current = await readPeople(taskId)
          const prev = role === 'assignee' ? current.assignees : current.collaborators
          const keep = new Set(people.map((x: any) => x.person_key))
          for (const gone of prev.filter((x: any) => !keep.has(x.person_key))) {
            await sb.from('project_task_assignees').delete().eq('task_id', taskId).eq('person_key', gone.person_key)
          }
          const W = await writePeople(taskId, (b as any)[field], role)
          if (W.error) return NextResponse.json({ error: W.error }, { status: 500 })
          await syncLegacyAssignee(taskId)

          const was = new Set(prev.map((x: any) => x.person_key))
          const added = people.filter((x: any) => !was.has(x.person_key))
          const dropped = prev.filter((x: any) => !keep.has(x.person_key)).map((x: any) => x.display)
          const verb = role === 'assignee' ? 'assigned' : 'added as a collaborator'
          if (added.length) {
            await logEvent(id, me, 'task_assigned', `${verb} ${added.map((x: any) => x.display).join(', ')}`, { task_id: taskId, task_title: before.title, who: added.map((x: any) => x.display), to: 'added', role })
            await tell(onAssigned(id, { id: taskId, title: before.title }, added, me, members))
          }
          if (dropped.length) await logEvent(id, me, 'task_assigned', `removed ${dropped.join(', ')}`, { task_id: taskId, task_title: before.title, who: dropped, to: 'removed', role })
        }
        // The feed records what CHANGED, not what was saved. A blur that saved the same title is
        // not news.
        const T = { task_id: taskId, task_title: patch.title || before.title }
        if (patch.status && patch.status !== before.status) {
          const label = TASK_STATUS_LABEL[patch.status as keyof typeof TASK_STATUS_LABEL] || patch.status
          await logEvent(id, me, 'task_status', patch.status === 'done' ? 'completed' : `moved to ${label}`, { ...T, from: before.status, to: patch.status })
        }
        if (b.due_on !== undefined && (patch.due_on || null) !== (before.due_on || null)) {
          await logEvent(id, me, 'task_due', patch.due_on ? `set the due date to ${patch.due_on}` : 'cleared the due date', { ...T, from: before.due_on, to: patch.due_on })
        }
        if (b.section !== undefined && (patch.section || null) !== (before.section || null)) {
          await logEvent(id, me, 'task_moved', `moved to ${patch.section || 'no section'}`, { ...T, from: before.section, to: patch.section })
        }
        break
      }
      case 'taskDelete': {
        const gone = await taskRow(str(b.taskId))
        if (gone?.homed) {
          await sb.from('project_task_homes').delete().eq('task_id', gone.id).eq('project_id', id)
          await logEvent(id, me, 'task_moved', `removed “${gone.title}” from this project (it still lives in its own)`, { task_title: gone.title })
          break
        }
        const { error } = await sb.from('project_steps').delete().eq('id', str(b.taskId)).eq('project_id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        // No task_id on this one — the task is gone and the row would cascade away with it. The
        // title is kept in meta so the feed can still say what was deleted.
        if (gone) await logEvent(id, me, 'task_deleted', `deleted "${gone.title}"`, { task_title: gone.title })
        break
      }

      // ---- WHAT THE PROJECT TOUCHES ------------------------------------------------
      // Units, reservations and Breezeway tasks all attach the same way, which is what lets a
      // 34-unit rollout and a one-unit remodel share a card design.
      case 'link': {
        const kind = str(b.kind)
        if (!(LINK_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'bad kind' }, { status: 400 })
        const refs: string[] = Array.isArray(b.refIds) ? b.refIds.map(String) : (str(b.refId) ? [str(b.refId)] : [])
        if (!refs.length) return NextResponse.json({ error: 'nothing to link' }, { status: 400 })
        // TASK-LEVEL ATTACHMENTS (Jon, 2026-09-09): with taskId the row belongs to that task — the
        // reservation this task is about, the owner it needs a yes from. Without, it is the project's.
        const taskId = str(b.taskId) || null
        if (taskId && !(await taskRow(taskId))) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const rows: any[] = refs.slice(0, 400).map(ref_id => ({ project_id: id, kind, ref_id, label: str(b.label) || null, task_id: taskId }))
        // A BUILDING IS A COLLECTIVE OF UNITS (Jon, 2026-09-08). Attaching one attaches the building
        // row AND one listing row per unit, so "12 of 34 done" is computed from real links rather
        // than typed, and a unit that joins the building in Guesty later shows up as not-done.
        // An owner attaches the same way when asked — their units come along.
        const expand: string[] = Array.isArray(b.expandUnitIds) ? b.expandUnitIds.map(String).slice(0, 400) : []
        if ((kind === 'building' || kind === 'owner') && expand.length && !taskId) {
          const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title').in('id', expand)
          for (const l of ((ls || []) as any[])) rows.push({ project_id: id, kind: 'listing', ref_id: String(l.id), label: String(l.nickname || l.title || 'Unit'), task_id: null })
        }
        // Uniqueness is (project, kind, ref, task) since 075; insert only what is not there yet.
        let q = sb.from('project_links').select('kind,ref_id').eq('project_id', id)
        q = taskId ? q.eq('task_id', taskId) : q.is('task_id', null)
        const { data: have } = await q
        const seen = new Set(((have || []) as any[]).map(h => h.kind + '|' + h.ref_id))
        const fresh = rows.filter(r => !seen.has(r.kind + '|' + r.ref_id))
        if (fresh.length) {
          const { error } = await sb.from('project_links').insert(fresh)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        }
        const unitsAdded = rows.length - refs.length
        const t = taskId ? await taskRow(taskId) : null
        await logEvent(id, me, 'link', `attached ${str(b.label) || refs.length + ' ' + kind + (refs.length === 1 ? '' : 's')}${unitsAdded ? ` and its ${unitsAdded} unit${unitsAdded === 1 ? '' : 's'}` : ''}${t ? '' : ''}`, { name: str(b.label) || kind, to: kind, task_id: t?.id, task_title: t?.title })
        break
      }
      case 'unlink': {
        const tid = str(b.taskId) || null
        let wq = sb.from('project_links').select('label').eq('project_id', id).eq('kind', str(b.kind)).eq('ref_id', str(b.refId))
        wq = tid ? wq.eq('task_id', tid) : wq.is('task_id', null)
        const { data: was } = await wq.maybeSingle()
        let dq = sb.from('project_links').delete().eq('project_id', id).eq('kind', str(b.kind)).eq('ref_id', str(b.refId))
        dq = tid ? dq.eq('task_id', tid) : dq.is('task_id', null)
        const { error } = await dq
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await logEvent(id, me, 'unlink', `detached ${was?.label || str(b.kind)}`, { name: was?.label || str(b.kind), from: str(b.kind) })
        break
      }
      // Tick a unit off a rollout — this is what drives "21/34 done" on the card.
      case 'linkDone': {
        const { error } = await sb.from('project_links').update({ done: !!b.done })
          .eq('project_id', id).eq('kind', str(b.kind) || 'listing').eq('ref_id', str(b.refId))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }

      // ---- CHECKLIST ---------------------------------------------------------------
      case 'stepAdd': {
        const title = str(b.title)
        if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
        const { error } = await sb.from('project_steps').insert({
          project_id: id, title: title.slice(0, 300), due_on: str(b.due_on) || null,
          assignee: str(b.assignee) || null, sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }
      case 'stepSet': {
        const patch: any = {}
        if (b.done !== undefined) {
          patch.done = !!b.done
          patch.done_at = b.done ? new Date().toISOString() : null
          patch.done_by = b.done ? me : null
        }
        if (b.title !== undefined) patch.title = str(b.title).slice(0, 300)
        if (b.due_on !== undefined) patch.due_on = str(b.due_on) || null
        if (b.assignee !== undefined) patch.assignee = str(b.assignee) || null
        const { error } = await sb.from('project_steps').update(patch).eq('id', str(b.stepId)).eq('project_id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }
      case 'stepDelete': {
        const { error } = await sb.from('project_steps').delete().eq('id', str(b.stepId)).eq('project_id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }

      // ---- MONEY -------------------------------------------------------------------
      // Spend is recorded as an increment with a note, not typed over, so the total always has a
      // story behind it.
      case 'spend': {
        const amt = toCents(b.amount)
        if (amt == null || amt === 0) return NextResponse.json({ error: 'amount required' }, { status: 400 })
        const { data: p } = await sb.from('projects').select('spent_cents').eq('id', id).maybeSingle()
        const next = Number(p?.spent_cents || 0) + amt
        const { error } = await sb.from('projects').update({ spent_cents: next }).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await logEvent(id, me, 'spend', `recorded spend ${amt > 0 ? '+' : ''}$${(amt / 100).toFixed(2)}${str(b.note) ? ' — ' + str(b.note) : ''}. Total now $${(next / 100).toFixed(2)}.`, { to: String(next) })
        break
      }

      // ---- TELLING THE TEAM A VENDOR IS COMING -------------------------------------
      // Jon, 2026-09-15: "Making sure the team is aware that they're arriving."
      //
      // The notice goes to everyone on the board, not only whoever the job is assigned to. A vendor
      // at the door is the building's problem for the morning: the person who needs to know is
      // whoever is standing there, and that is rarely the person the job was filed under.
      case 'vendorNotifyTeam': {
        const t = await taskRow(str(b.taskId))
        if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const { data: job } = await sb.from('project_steps')
          .select('title,visit_on,visit_window,est_minutes,vendor_name,vendor_key').eq('id', t.id).maybeSingle()
        const visit = String((job as any)?.visit_on || '').slice(0, 10)
        if (!visit) return NextResponse.json({ error: 'Set the date they are coming out first — there is nothing to tell the team yet.' }, { status: 400 })

        const vendor = String((job as any)?.vendor_name || '') || 'A vendor'
        const window = String((job as any)?.visit_window || '')
        const mins = estLabel((job as any)?.est_minutes)
        const where = ((await sb.from('project_links').select('kind,label').eq('task_id', t.id).in('kind', ['listing', 'building']).limit(1)).data || [])[0]
        const place = where ? ' at ' + String((where as any).label || '') : ''
        const line = `${vendor} is coming${place} on ${shortDate(visit)}${window ? ', ' + window : ''}${mins ? ` (about ${mins} on site)` : ''} — ${t.title}`

        // Everyone on the board with a login. A member with no email is on the roster but has no
        // inbox; they are reached by the board itself, not by this.
        const rows = members.filter(m => m.email).map(m => ({
          project_id: id, task_id: t.id, email: String(m.email).toLowerCase(), type: 'vendor_visit', actor: me,
          title: line, url: `/projects/${id}?task=${t.id}`,
          // One notice per PERSON per job per visit date. The email has to be in the key because
          // dedupe_key is unique across the whole table — without it these rows collide with each
          // other and exactly one member of the team gets told a vendor is coming.
          // Pressing the button twice does not send twice; moving the date to a new day is
          // genuinely new news and gets through.
          dedupe_key: `vendor_visit:${t.id}:${visit}:${String(m.email).toLowerCase()}`,
        }))
        if (rows.length) {
          const { error } = await sb.from('project_notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
          if (error && !/duplicate/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 })
        }
        await sb.from('project_steps').update({ team_notified_at: new Date().toISOString(), team_notified_for: visit }).eq('id', t.id)
          .then(() => {}, () => {})
        // In the feed as well as the inbox: somebody reading the job later needs to see that the
        // team was told, without going hunting through notification tables.
        await logEvent(id, me, 'task_moved', `told the team — ${line}`, { task_id: t.id, task_title: t.title })
        return NextResponse.json({ ok: true, told: rows.length, message: line, project: await getProject(id) })
      }

      // ---- ASKING FOR APPROVAL OVER $300, IN WRITING -------------------------------
      // Jon: "If it's over 300, it must be approved by the owner/general manager, and we can put
      // that in writing." This produces the writing. It does not send anything by itself — the
      // text comes back for a person to send and to keep, and the asking is stamped on the invoice
      // so the board can show what is out waiting on a reply rather than just "unapproved".
      case 'invoiceRequestApproval': {
        const invId = str(b.invoiceId)
        const { data: inv } = await sb.from('project_invoices').select('*').eq('id', invId).eq('project_id', id).maybeSingle()
        if (!inv) return NextResponse.json({ error: 'No such invoice.' }, { status: 404 })
        const to = str(b.to)
        const { data: proj } = await sb.from('projects').select('title,building,market,settings,owner_name').eq('id', id).maybeSingle()
        let jobTitle = '', unit = ''
        if (inv.task_id) {
          const { data: tk } = await sb.from('project_steps').select('title').eq('id', inv.task_id).maybeSingle()
          jobTitle = String((tk as any)?.title || '')
          const l = ((await sb.from('project_links').select('label').eq('task_id', inv.task_id).in('kind', ['listing', 'building']).limit(1)).data || [])[0]
          unit = String((l as any)?.label || '')
        }
        const mail = vendorApprovalEmail({
          amountCents: Number(inv.amount_cents) || 0,
          vendor: inv.vendor_name, jobTitle, unit: unit || (proj as any)?.building || (proj as any)?.market,
          number: inv.number, note: inv.note, ceiling: approvalCeiling((proj as any)?.settings),
          board: String((proj as any)?.title || 'a project'), fromName: first(me),
        })
        await sb.from('project_invoices').update({
          approval_requested_to: to || null, approval_requested_at: new Date().toISOString(), needs_approval: true,
        }).eq('id', invId).then(() => {}, () => {})
        await logEvent(id, me, 'spend', `asked ${to || 'the owner/GM'} to approve $${((Number(inv.amount_cents) || 0) / 100).toFixed(2)}${inv.vendor_name ? ' to ' + inv.vendor_name : ''}`, { invoice_id: invId, task_id: inv.task_id || undefined })
        return NextResponse.json({ ok: true, email: mail, project: await getProject(id) })
      }

      // ---- INVOICES (Jon, 2026-09-15: "add invoices… pull from once you save a vendor") ------
      // An invoice is money leaving the project with paper behind it: who billed us, how much,
      // which invoice number, and the PDF. It hangs off the project always and off a task when the
      // work was one task.
      //
      // WHY A SEPARATE NUMBER FROM `spent_cents`: spent_cents is typed in by a person and this
      // code must never overwrite it. `invoiced_cents` is recomputed from approved and paid
      // invoices after every write, and the page shows the two side by side. A quote is not money
      // out and never counts.
      case 'invoiceAdd': {
        const amount = toCents(b.amount)
        if (amount == null) return NextResponse.json({ error: 'How much is it for?' }, { status: 400 })
        if (amount < 0) return NextResponse.json({ error: 'An invoice cannot be negative. Use a credit note as a separate line.' }, { status: 400 })
        const status = INVOICE_STATUSES.includes(str(b.status) as any) ? str(b.status) : 'received'
        // The task must belong to this project, or an invoice could be hung off somebody else's
        // work by passing an id.
        const taskId = str(b.taskId)
        if (taskId && !(await taskRow(taskId))) return NextResponse.json({ error: 'No such task.' }, { status: 404 })

        // SAVE THE VENDOR WHILE YOU ARE HERE. Jon asked for exactly this: the first invoice from a
        // plumber is also how that plumber gets into the directory, phone number and all, so the
        // second one is a pick from a list.
        let vendorKey = str(b.vendorKey) || null
        let vendorName = str(b.vendorName) || null
        if (b.saveVendor && vendorName) {
          const v = await saveVendor({
            key: vendorKey || vendorName, label: vendorName,
            contact_name: b.vendorContact, phone: b.vendorPhone, email: b.vendorEmail, trade: b.vendorTrade,
            regular: !!b.vendorRegular, cadence: b.vendorCadence || null,
          }, me)
          if (v.ok) { vendorKey = v.vendor.key; vendorName = v.vendor.label }
        }
        if (vendorKey && !vendorName) vendorName = vendorKey

        const { data: proj } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
        const ceiling = approvalCeiling((proj as any)?.settings)
        const needs = amount > ceiling && status !== 'quoted' && status !== 'void'

        const row: any = {
          project_id: id, task_id: taskId || null,
          vendor_key: vendorKey, vendor_name: vendorName,
          number: str(b.number).slice(0, 80) || null,
          amount_cents: amount, status,
          issued_on: /^\d{4}-\d{2}-\d{2}$/.test(str(b.issued_on)) ? str(b.issued_on) : null,
          due_on: /^\d{4}-\d{2}-\d{2}$/.test(str(b.due_on)) ? str(b.due_on) : null,
          note: str(b.note).slice(0, 1000) || null,
          photo_id: str(b.photoId) || null,
          needs_approval: needs, created_by: me,
        }
        // An invoice entered as already approved by the person entering it is only approved if it
        // did not need approving. Nobody signs off their own over-ceiling invoice by picking a
        // dropdown value.
        if (status === 'approved' && !needs) { row.approved_by = me; row.approved_at = new Date().toISOString() }
        if (status === 'approved' && needs) row.status = 'received'
        if (status === 'paid') { row.paid_on = /^\d{4}-\d{2}-\d{2}$/.test(str(b.paid_on)) ? str(b.paid_on) : new Date().toISOString().slice(0, 10) }

        const { data, error } = await sb.from('project_invoices').insert(row).select('id').single()
        if (error) {
          if (/relation|does not exist/i.test(error.message)) return NextResponse.json({ error: 'Invoices need migration 087 — run it in Supabase and this will work.' }, { status: 500 })
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        await recountInvoiced(id)
        await logEvent(id, me, 'spend', `logged a ${INVOICE_STATUS_LABEL[row.status as keyof typeof INVOICE_STATUS_LABEL].toLowerCase()} invoice for $${((amount) / 100).toFixed(2)}${vendorName ? ' from ' + vendorName : ''}${needs ? ' — waiting on approval' : ''}`,
          { task_id: taskId || undefined, invoice_id: data.id, to: String(amount) })
        return NextResponse.json({ ok: true, invoiceId: data.id, needsApproval: needs, project: await getProject(id) })
      }

      case 'invoiceSet': {
        const invId = str(b.invoiceId)
        const { data: cur } = await sb.from('project_invoices').select('*').eq('id', invId).eq('project_id', id).maybeSingle()
        if (!cur) return NextResponse.json({ error: 'No such invoice.' }, { status: 404 })
        const patch: any = {}
        if (b.amount !== undefined) {
          const amount = toCents(b.amount)
          if (amount == null || amount < 0) return NextResponse.json({ error: 'That amount does not read as money.' }, { status: 400 })
          patch.amount_cents = amount
        }
        if (b.number !== undefined) patch.number = str(b.number).slice(0, 80) || null
        if (b.note !== undefined) patch.note = str(b.note).slice(0, 1000) || null
        if (b.vendorKey !== undefined) patch.vendor_key = str(b.vendorKey) || null
        if (b.vendorName !== undefined) patch.vendor_name = str(b.vendorName) || null
        if (b.photoId !== undefined) patch.photo_id = str(b.photoId) || null
        for (const f of ['issued_on', 'due_on', 'paid_on']) {
          if ((b as any)[f] !== undefined) patch[f] = /^\d{4}-\d{2}-\d{2}$/.test(str((b as any)[f])) ? str((b as any)[f]) : null
        }
        if (b.status !== undefined) {
          if (!INVOICE_STATUSES.includes(str(b.status) as any)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
          patch.status = str(b.status)
          // Moving to paid stamps the day if nobody said which; moving off paid clears it, so a
          // mistake corrected does not leave a payment date on an unpaid invoice.
          if (patch.status === 'paid' && !patch.paid_on && !cur.paid_on) patch.paid_on = new Date().toISOString().slice(0, 10)
          if (patch.status !== 'paid' && cur.status === 'paid' && b.paid_on === undefined) patch.paid_on = null
        }
        // The ceiling is re-tested against whatever the amount ENDS UP being, so editing $900 up to
        // $9,000 puts it back in front of an approver instead of riding in on the old decision.
        const finalAmount = patch.amount_cents ?? (Number(cur.amount_cents) || 0)
        const finalStatus = patch.status ?? cur.status
        const { data: proj } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
        const ceiling = approvalCeiling((proj as any)?.settings)
        const overNow = finalAmount > ceiling && finalStatus !== 'quoted' && finalStatus !== 'void'
        if (overNow && patch.amount_cents != null && patch.amount_cents !== Number(cur.amount_cents)) {
          patch.needs_approval = true; patch.approved_by = null; patch.approved_at = null
          if (finalStatus === 'approved' || finalStatus === 'paid') patch.status = 'received'
        } else if (!overNow) {
          patch.needs_approval = false
        }
        if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
        const { error } = await sb.from('project_invoices').update(patch).eq('id', invId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await recountInvoiced(id)
        if (patch.status && patch.status !== cur.status) {
          await logEvent(id, me, 'spend', `marked a $${((finalAmount) / 100).toFixed(2)} invoice ${INVOICE_STATUS_LABEL[patch.status as keyof typeof INVOICE_STATUS_LABEL].toLowerCase()}`, { invoice_id: invId, from: cur.status, to: patch.status })
        }
        break
      }

      // APPROVAL IS ITS OWN ACTION, not a status you can pick. It records WHO said yes and when,
      // which a dropdown cannot, and it is the only route to 'approved' for an over-ceiling invoice.
      case 'invoiceApprove': {
        const invId = str(b.invoiceId)
        const { data: cur } = await sb.from('project_invoices').select('*').eq('id', invId).eq('project_id', id).maybeSingle()
        if (!cur) return NextResponse.json({ error: 'No such invoice.' }, { status: 404 })
        // Over the ceiling, only a superadmin signs. Below it, anyone who can edit the project may
        // — that is what setting a ceiling means.
        const { data: proj } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
        const ceiling = approvalCeiling((proj as any)?.settings)
        const amount = Number(cur.amount_cents) || 0
        if (amount > ceiling && !viewer.superadmin) {
          return NextResponse.json({ error: `$${(amount / 100).toFixed(2)} is over the $${(ceiling / 100).toFixed(0)} limit on this project — an admin has to approve it.` }, { status: 403 })
        }
        const patch: any = { status: 'approved', needs_approval: false, approved_by: me, approved_at: new Date().toISOString() }
        // What they said when they said yes — "ok but get it done before the 3rd" is the half of an
        // approval that a tick box throws away, and the half somebody asks about later.
        if (str(b.note)) patch.approval_note = str(b.note).slice(0, 1000)
        let { error } = await sb.from('project_invoices').update(patch).eq('id', invId)
        if (error && /column|schema/i.test(error.message)) {
          delete patch.approval_note
          ;({ error } = await sb.from('project_invoices').update(patch).eq('id', invId))
        }
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await recountInvoiced(id)
        await logEvent(id, me, 'spend', `approved a $${(amount / 100).toFixed(2)} invoice${cur.vendor_name ? ' from ' + cur.vendor_name : ''}`, { invoice_id: invId, to: 'approved' })
        break
      }

      case 'invoiceDelete': {
        const invId = str(b.invoiceId)
        const { data: cur } = await sb.from('project_invoices').select('amount_cents,vendor_name,status').eq('id', invId).eq('project_id', id).maybeSingle()
        if (!cur) return NextResponse.json({ error: 'No such invoice.' }, { status: 404 })
        // A PAID invoice is a record of money that left. Voiding keeps the row and the history;
        // deleting it would make the project's books quietly disagree with the bank.
        if (cur.status === 'paid' && !viewer.superadmin) {
          return NextResponse.json({ error: 'This one is already paid — mark it void instead, so the history still shows it.' }, { status: 400 })
        }
        const { error } = await sb.from('project_invoices').delete().eq('id', invId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await recountInvoiced(id)
        await logEvent(id, me, 'spend', `deleted a $${((Number(cur.amount_cents) || 0) / 100).toFixed(2)} invoice${cur.vendor_name ? ' from ' + cur.vendor_name : ''}`, { invoice_id: invId })
        break
      }

      // ---- SAVING A VENDOR FROM THE FORM --------------------------------------------
      // The directory is the app's one `vendors` table, shared with the ops boards — saving a
      // plumber on a project saves them everywhere, which is the point of saving them at all.
      case 'vendorSave': {
        const r = await saveVendor(b.vendor || b, me)
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
        return NextResponse.json({ ok: true, vendor: r.vendor })
      }

      // ---- COMMENTS ----------------------------------------------------------------
      // `note` is the old board's name for the same thing; both land in one stream. A comment
      // with a taskId shows in that task's drawer AND the project feed.
      case 'note':
      case 'comment': {
        const body = str(b.body).slice(0, 4000)
        if (!body) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
        const taskId = str(b.taskId) || null
        const task = taskId ? await taskRow(taskId) : null
        if (taskId && !task) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const { data, error } = await sb.from('project_notes').insert({
          project_id: id, task_id: taskId, body, author: me, kind: 'comment', via_share: false,
        }).select('id').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const { data: asg } = taskId ? await sb.from('project_task_assignees').select('person_key,display,email').eq('task_id', taskId) : { data: [] as any[] }
        await tell(onComment({
          projectId: id, projectTitle: await projectTitle(), note: { id: data.id, body, task_id: taskId },
          task: task ? { id: task.id, title: task.title } : null, actor: me, members, taskAssignees: (asg || []) as any[],
        }))
        return NextResponse.json({ ok: true, noteId: data.id, project: await getProject(id) })
      }
      // Your own words are yours to change; an owner can remove anything. Nobody edits somebody
      // else's comment — a feed where words can be put in mouths is not a record.
      case 'commentEdit':
      case 'commentDelete': {
        const { data: n } = await sb.from('project_notes').select('id,author,kind').eq('id', str(b.noteId)).eq('project_id', id).maybeSingle()
        if (!n || n.kind !== 'comment') return NextResponse.json({ error: 'No such comment.' }, { status: 404 })
        const mine = String(n.author || '').toLowerCase() === String(me || '').toLowerCase()
        const owner = viewer.superadmin || members.some(m => String(m.email || '').toLowerCase() === String(me || '').toLowerCase() && m.role === 'owner')
        if (action === 'commentEdit') {
          if (!mine) return NextResponse.json({ error: 'You can only edit your own comments.' }, { status: 403 })
          const body = str(b.body).slice(0, 4000)
          if (!body) return NextResponse.json({ error: 'A comment cannot be empty — delete it instead.' }, { status: 400 })
          const { error } = await sb.from('project_notes').update({ body, edited_at: new Date().toISOString() }).eq('id', n.id)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        } else {
          if (!mine && !owner) return NextResponse.json({ error: 'Only the author or a project owner can delete this.' }, { status: 403 })
          const { error } = await sb.from('project_notes').delete().eq('id', n.id)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        }
        break
      }

      // ---- FILES -------------------------------------------------------------------
      // Uploads arrive through /api/projects/<id>/upload (multipart). Removal is here. Both the
      // row and the object go; a row without an object is a broken link and an object without a
      // row is a leak.
      case 'photoDelete':
      case 'fileDelete': {
        const fid = str(b.fileId) || str(b.photoId)
        const { data: f } = await sb.from('project_photos').select('id,name,storage_path,task_id,kind').eq('id', fid).eq('project_id', id).maybeSingle()
        if (!f) return NextResponse.json({ error: 'No such file.' }, { status: 404 })
        const { error } = await sb.from('project_photos').delete().eq('id', f.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (f.storage_path) await sb.storage.from(FILES_BUCKET).remove([f.storage_path]).catch(() => {})
        const t = f.task_id ? await taskRow(f.task_id) : null
        await logEvent(id, me, 'file_removed', `removed ${f.name || (f.kind === 'photo' ? 'a photo' : 'a file')}`, { name: f.name || undefined, task_id: f.task_id || undefined, task_title: t?.title })
        break
      }

      // ---- INTEGRATIONS (Jon, 2026-09-09) --------------------------------------------
      // A linked reservation / claim / glitch becomes a task so it can be assigned to a person
      // and dated — "Reservations: assign it to people". The task remembers what it came from.
      case 'linkToTask': {
        const kind = str(b.kind), refId = str(b.refId)
        const link = (await sb.from('project_links').select('*').eq('project_id', id).eq('kind', kind).eq('ref_id', refId).maybeSingle()).data
        if (!link) return NextResponse.json({ error: 'That is not attached to this project.' }, { status: 404 })
        const title = str(b.title) || (kind === 'reservation' ? `Look after ${link.label || 'the stay'}` : kind === 'claim' ? `Work the ${link.label || 'claim'}` : kind === 'glitch' ? `Fix: ${link.label || 'glitch'}` : String(link.label || kind))
        const people = (Array.isArray(b.assignees) ? b.assignees : []).map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
        const { data, error } = await sb.from('project_steps').insert({
          project_id: id, title: title.slice(0, 300), description: `From ${kind} · ${link.label || refId}`, status: 'todo',
          section: str(b.section) || null, priority: 'normal', due_on: str(b.due_on) || null, created_by: me,
        }).select('id').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (people.length) {
          await sb.from('project_task_assignees').upsert(people.map((who: any) => ({ task_id: data.id, project_id: id, ...who })), { onConflict: 'task_id,person_key' })
          await syncLegacyAssignee(data.id)
          await tell(onAssigned(id, { id: data.id, title }, people, me, members))
        }
        await logEvent(id, me, 'task_added', `made a task from the ${kind}`, { task_id: data.id, task_title: title, who: people.map((x: any) => x.display) })
        return NextResponse.json({ ok: true, taskId: data.id, project: await getProject(id) })
      }
      // Send a project task to Breezeway: a real field task on a unit, assigned to the same people.
      case 'taskToBreezeway': {
        const t = await taskRow(str(b.taskId))
        if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const { data: cur } = await sb.from('project_steps').select('breezeway_task_id,description').eq('id', t.id).maybeSingle()
        if (cur?.breezeway_task_id) return NextResponse.json({ error: 'This task is already in Breezeway.' }, { status: 400 })
        // The unit: what was picked, else the task's own attached unit, else the unit of its attached
        // reservation — "push from the board" should not need a form when the task already knows.
        let listingId = str(b.listingId)
        if (!listingId) {
          const { data: tl } = await sb.from('project_links').select('kind,ref_id').eq('task_id', t.id).in('kind', ['listing', 'reservation'])
          const unit = ((tl || []) as any[]).find(l => l.kind === 'listing')
          if (unit) listingId = String(unit.ref_id)
          else {
            const res = ((tl || []) as any[]).find(l => l.kind === 'reservation')
            if (res) listingId = String((await sb.from('guesty_reservations').select('listing_id').eq('id', res.ref_id).maybeSingle()).data?.listing_id || '')
          }
        }
        if (!listingId) return NextResponse.json({ error: 'Pick the unit this happens at.' }, { status: 400 })
        const department = ['housekeeping', 'inspection', 'maintenance', 'safety'].includes(str(b.department)) ? str(b.department) : 'maintenance'
        const priority = ['urgent', 'high', 'normal', 'low'].includes(str(b.priority)) ? str(b.priority) : 'normal'
        const date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : (t.due_on || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
        const { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson } = await import('@/lib/breezeway')
        const { data: props } = await sb.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
        const homeId = Number(((props || [])[0] || {}).home_id)
        const payload: Record<string, any> = {
          name: t.title.slice(0, 120), type_department: department, type_priority: priority, scheduled_date: date,
          description: [cur?.description, `From the “${await projectTitle()}” project in Lighthouse · sent by ${me}`].filter(Boolean).join('\n\n').slice(0, 1500),
        }
        if (Number.isFinite(homeId)) payload.home_id = homeId; else payload.reference_property_id = listingId
        // A Breezeway template is the CHECKLIST the field task carries (Jon: "create checklists").
        const templateId = Number(b.templateId)
        if (Number.isFinite(templateId) && templateId > 0) payload.template_id = templateId
        const r = await createBreezewayTask(payload)
        if (!r.ok || !r.data?.id) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
        const bzId = String(r.data.id)
        // Same people, matched by the shared name matcher; a name Breezeway does not know is skipped, not guessed.
        // Explicit people from the picker win; otherwise the task's assignees, matched by name.
        let ids: number[] = (Array.isArray(b.assigneeIds) ? b.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
        if (!ids.length) {
          const { data: asg } = await sb.from('project_task_assignees').select('display,email').eq('task_id', t.id)
          for (const a of (asg || []) as any[]) { const pid = await matchBreezewayPerson(a.email || a.display).catch(() => null); if (pid) ids.push(pid) }
        }
        let assigned = false
        if (ids.length) { try { assigned = !!(await updateBreezewayTask(bzId, { assignments: ids })).ok } catch { assigned = false } }
        await sb.from('project_steps').update({ breezeway_task_id: bzId, status: t.status === 'todo' ? 'doing' : t.status }).eq('id', t.id)
        try {
          await sb.from('breezeway_tasks_sync').upsert({ id: bzId, reference_property_id: listingId, name: t.title, status: 'created', scheduled_date: date, type_department: department, assignees: [], report_url: r.data.report_url || null, raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString() }, { onConflict: 'id' })
        } catch { /* the sync catches up */ }
        await logEvent(id, me, 'task_moved', `sent to Breezeway (${department}, ${date}${assigned ? ', assigned' : ''})`, { task_id: t.id, task_title: t.title, to: 'breezeway', name: bzId })
        return NextResponse.json({ ok: true, breezewayTaskId: bzId, reportUrl: r.data.report_url || null, assigned, project: await getProject(id) })
      }

      // Reassign or reschedule the field task from the board. Assignments REPLACE (Breezeway semantics).
      case 'taskBreezewayUpdate': {
        const t = await taskRow(str(b.taskId))
        if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const { data: cur } = await sb.from('project_steps').select('breezeway_task_id').eq('id', t.id).maybeSingle()
        if (!cur?.breezeway_task_id) return NextResponse.json({ error: 'This task is not in Breezeway yet.' }, { status: 400 })
        const { updateBreezewayTask } = await import('@/lib/breezeway')
        const patch: Record<string, any> = {}
        if (Array.isArray(b.assigneeIds)) patch.assignments = b.assigneeIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
        if (/^\d{4}-\d{2}-\d{2}$/.test(str(b.date))) patch.scheduled_date = str(b.date)
        if (['urgent', 'high', 'normal', 'low'].includes(str(b.priority))) patch.type_priority = str(b.priority)
        if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
        const r = await updateBreezewayTask(cur.breezeway_task_id, patch)
        if (!r.ok) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
        if (patch.scheduled_date) await sb.from('breezeway_tasks_sync').update({ scheduled_date: patch.scheduled_date }).eq('id', cur.breezeway_task_id)
        await logEvent(id, me, 'task_moved', `updated the Breezeway task${patch.assignments ? ' — reassigned' : ''}${patch.scheduled_date ? ' — ' + patch.scheduled_date : ''}`, { task_id: t.id, task_title: t.title, to: 'breezeway' })
        break
      }

      // ---- ONE TASK, SEVERAL PROJECTS (Jon, 2026-09-09: "assign to multiple projects that I am in")
      // You may home a task into any project you can edit. The task stays one task.
      case 'taskAddToProject': {
        const t = await taskRow(str(b.taskId))
        if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const target = str(b.projectId)
        if (!target || target === String(t.project_id)) return NextResponse.json({ error: 'Pick a different project.' }, { status: 400 })
        const g2 = await gateProject(target, viewer, 'edit')
        if (!g2.ok) return NextResponse.json({ error: g2.status === 404 ? 'You are not on that project.' : g2.error }, { status: g2.status })
        const { error } = await sb.from('project_task_homes').upsert({ task_id: t.id, project_id: target, section: str(b.section) || null, added_by: me }, { onConflict: 'task_id,project_id' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const tt = String((await sb.from('projects').select('title').eq('id', target).maybeSingle()).data?.title || 'another project')
        await logEvent(id, me, 'task_moved', `also put “${t.title}” in ${tt}`, { task_id: t.id, task_title: t.title, to: target, name: tt })
        await logEvent(target, me, 'task_added', `brought “${t.title}” in from another project`, { task_id: t.id, task_title: t.title })
        break
      }
      case 'taskRemoveFromProject': {
        const t = await taskRow(str(b.taskId))
        if (!t) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const target = str(b.projectId)
        if (!target) return NextResponse.json({ error: 'Which project?' }, { status: 400 })
        if (target === String(t.project_id)) return NextResponse.json({ error: 'That is the task’s own project — delete it there instead.' }, { status: 400 })
        const g2 = await gateProject(target, viewer, 'edit')
        if (!g2.ok) return NextResponse.json({ error: g2.error }, { status: g2.status })
        await sb.from('project_task_homes').delete().eq('task_id', t.id).eq('project_id', target)
        break
      }
      case 'taskProjects': {
        const { taskProjects } = await import('@/lib/projects')
        return NextResponse.json({ ok: true, projects: await taskProjects(str(b.taskId)) })
      }

      // ---- CUSTOM BOARDS (Jon, 2026-09-09: "build like Asana") ----------------------
      // Drag a task to a section and a position; the server renumbers that section so sort is
      // always dense and the client never computes midpoints.
      case 'taskMove': {
        const taskId = str(b.taskId)
        const moving = await taskRow(taskId)
        if (!moving) return NextResponse.json({ error: 'No such task.' }, { status: 404 })
        const section = b.section === null || b.section === undefined ? (moving.section || null) : (str(b.section) || null)
        const beforeId = str(b.beforeId) || null
        // The section's rows: native tasks plus tasks homed here, each with the sort it has HERE.
        let q = sb.from('project_steps').select('id,sort,created_at').eq('project_id', id).is('parent_id', null)
        q = section === null ? q.is('section', null) : q.eq('section', section)
        let hq = sb.from('project_task_homes').select('task_id,sort,created_at').eq('project_id', id)
        hq = section === null ? hq.is('section', null) : hq.eq('section', section)
        const [{ data: rows }, { data: hrows }] = await Promise.all([q, hq])
        const all = [...((rows || []) as any[]).map(r => ({ id: String(r.id), sort: r.sort, created_at: r.created_at, homed: false })),
                     ...((hrows || []) as any[]).map(r => ({ id: String(r.task_id), sort: r.sort, created_at: r.created_at, homed: true }))]
          .sort((a, b2) => (a.sort ?? 1e9) - (b2.sort ?? 1e9) || String(a.created_at).localeCompare(String(b2.created_at)))
        const order = all.map(r => r.id).filter(x => x !== taskId)
        const at = beforeId ? order.indexOf(beforeId) : -1
        if (at >= 0) order.splice(at, 0, taskId); else order.push(taskId)
        const homedIds = new Set(all.filter(r => r.homed).map(r => r.id)); if (moving.homed) homedIds.add(taskId)
        // One update per row in the section — sections are tens of tasks, not thousands.
        await Promise.all(order.map((tid, i) => {
          const isHome = homedIds.has(tid)
          const patch = tid === taskId ? { sort: (i + 1) * 10, section } : { sort: (i + 1) * 10 }
          return isHome ? sb.from('project_task_homes').update(patch).eq('task_id', tid).eq('project_id', id) : sb.from('project_steps').update(patch).eq('id', tid)
        }))
        if ((moving.section || null) !== section) await logEvent(id, me, 'task_moved', `moved to ${section || 'no section'}`, { task_id: taskId, task_title: moving.title, from: moving.section, to: section })
        break
      }
      case 'sectionRename': {
        const from = str(b.from), to = str(b.to).slice(0, 80)
        if (!from || !to) return NextResponse.json({ error: 'Both names are required.' }, { status: 400 })
        if (from !== to) {
          const { error } = await sb.from('project_steps').update({ section: to }).eq('project_id', id).eq('section', from)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
          const { data: cur } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
          const st = settingsOf(cur?.settings)
          const order = st.sectionOrder.map(x => (x === from ? to : x))
          if (!order.includes(to)) order.push(to)
          await sb.from('projects').update({ settings: { ...(cur?.settings || {}), sectionOrder: order } }).eq('id', id)
          await logEvent(id, me, 'task_moved', `renamed the “${from}” section to “${to}”`, { from, to })
        }
        break
      }
      // Deleting a section never deletes work: its tasks drop to "no section".
      case 'sectionDelete': {
        const name = str(b.name)
        if (!name) return NextResponse.json({ error: 'Which section?' }, { status: 400 })
        const { error } = await sb.from('project_steps').update({ section: null }).eq('project_id', id).eq('section', name)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const { data: cur } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
        const st = settingsOf(cur?.settings)
        await sb.from('projects').update({ settings: { ...(cur?.settings || {}), sectionOrder: st.sectionOrder.filter(x => x !== name) } }).eq('id', id)
        await logEvent(id, me, 'task_moved', `removed the “${name}” section (its tasks kept)`, { from: name })
        break
      }

      // ---- WAVE 4: how the board looks, whether it repeats, saving its shape --------
      case 'setSettings': {
        // Merge, so a page that only knows about `view` cannot wipe `sectionOrder`.
        const { data: cur } = await sb.from('projects').select('settings').eq('id', id).maybeSingle()
        const next = settingsOf({ ...(cur?.settings || {}), ...(b.settings || {}) })
        const { error } = await sb.from('projects').update({ settings: next }).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        break
      }
      case 'setRecurs': {
        const { normaliseRecurrence } = await import('@/lib/project-templates')
        const r = b.recurs ? normaliseRecurrence(b.recurs) : null
        const { error } = await sb.from('projects').update({ recurs: r }).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await logEvent(id, me, 'stage', r ? `set this to repeat — ${describeRecurrence(r)}, next on ${r.next_on}` : 'stopped this from repeating', { name: 'recurrence', to: r ? r.every : null })
        break
      }
      case 'saveTemplate': {
        const label = str(b.label)
        if (!label) return NextResponse.json({ error: 'Give the template a name.' }, { status: 400 })
        const { snapshotTemplate } = await import('@/lib/project-templates')
        const key = await snapshotTemplate(id, { key: str(b.key) || label, label, createdBy: me })
        await logEvent(id, me, 'stage', `saved this as the “${label}” template`, { name: 'template', to: key })
        return NextResponse.json({ ok: true, key, project: await getProject(id) })
      }
      case 'applyTemplate': {
        const { getTemplate, applyTemplate } = await import('@/lib/project-templates')
        const tpl = await getTemplate(str(b.template))
        if (!tpl) return NextResponse.json({ error: 'No such template.' }, { status: 404 })
        const n = await applyTemplate(id, tpl, { startsOn: str(b.starts_on) || null, createdBy: me })
        await logEvent(id, me, 'stage', `added ${n} task${n === 1 ? '' : 's'} from the ${tpl.label} template`, { name: 'template', to: tpl.key })
        break
      }

      // ---- OWNER APPROVAL EMAIL ----------------------------------------------------
      // DRAFT ONLY. It is returned for a human to read, edit and send — the app never mails an
      // owner about money on its own.
      case 'ownerEmail': {
        const p = await getProject(id)
        if (!p) return NextResponse.json({ error: 'No such project.' }, { status: 404 })
        const unitLabel = p.links.find((l: any) => l.kind === 'listing')?.label || p.building || null
        const draft = ownerApprovalEmail(p, p.steps, { unitLabel, fromName: str(b.fromName) || undefined })
        return NextResponse.json({ ok: true, draft })
      }

      default:
        return NextResponse.json({ error: 'Unknown action: ' + action }, { status: 400 })
    }

    const project = await getProject(id)
    return NextResponse.json({ ok: true, project })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
