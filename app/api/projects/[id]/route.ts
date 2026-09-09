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
} from '@/lib/projects'
import { onAssigned, onAdded, onComment } from '@/lib/project-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

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
    const gate = await gateProject(id, viewer, ['comment', 'note', 'memberNotify'].includes(action) ? 'view' : 'edit')
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    const members = gate.members as Member[]
    const projectTitle = async () => String((await sb.from('projects').select('title').eq('id', id).maybeSingle()).data?.title || 'a project')
    // Notifications are best-effort: a mail-table hiccup must never fail the edit that caused it.
    const tell = (p: Promise<any>) => p.catch(e => console.error('[projects] notify failed:', String(e?.message || e)))

    // Keep the old single-assignee column honest: first assignee, or null.
    const syncLegacyAssignee = async (taskId: string) => {
      const { data } = await sb.from('project_task_assignees').select('display').eq('task_id', taskId).order('created_at').limit(1)
      await sb.from('project_steps').update({ assignee: data && data[0] ? data[0].display : null }).eq('id', taskId)
    }
    // Events name the task by title; one small read gives the title and the before-state.
    const taskRow = async (taskId: string) => {
      const { data } = await sb.from('project_steps').select('id,title,status,due_on,section').eq('id', taskId).eq('project_id', id).maybeSingle()
      return data as { id: string; title: string; status: string; due_on: string | null; section: string | null } | null
    }
    const first = (s: string | null | undefined) => String(s || '').split(/[\s@]/)[0]

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
        const people = (Array.isArray(b.assignees) ? b.assignees : []).map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
        if (people.length) {
          const { error: e2 } = await sb.from('project_task_assignees').upsert(
            people.map((who: any) => ({ task_id: data.id, project_id: id, ...who })), { onConflict: 'task_id,person_key' })
          if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
          await syncLegacyAssignee(data.id)
        }
        await logEvent(id, me, 'task_added', `added ${str(b.parentId) ? 'a subtask' : 'a task'}`, { task_id: data.id, task_title: title.slice(0, 300), who: people.map((x: any) => x.display) })
        if (people.length) await tell(onAssigned(id, { id: data.id, title: title.slice(0, 300) }, people, me, members))
        return NextResponse.json({ ok: true, taskId: data.id, project: await getProject(id) })
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
        if (Object.keys(patch).length) {
          const { error } = await sb.from('project_steps').update(patch).eq('id', taskId).eq('project_id', id)
          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        }
        // Assignees are replaced as a set, so the client never has to diff.
        if (Array.isArray(b.assignees)) {
          const people = b.assignees.map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
          const { data: prev } = await sb.from('project_task_assignees').select('person_key,display').eq('task_id', taskId)
          await sb.from('project_task_assignees').delete().eq('task_id', taskId)
          if (people.length) {
            const { error: e2 } = await sb.from('project_task_assignees').upsert(
              people.map((who: any) => ({ task_id: taskId, project_id: id, ...who })), { onConflict: 'task_id,person_key' })
            if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
          }
          await syncLegacyAssignee(taskId)
          const was = new Set(((prev || []) as any[]).map(x => x.person_key))
          const now = new Set(people.map((x: any) => x.person_key))
          const added = people.filter((x: any) => !was.has(x.person_key)).map((x: any) => x.display)
          const dropped = ((prev || []) as any[]).filter(x => !now.has(x.person_key)).map(x => x.display)
          if (added.length) {
            await logEvent(id, me, 'task_assigned', `assigned ${added.join(', ')}`, { task_id: taskId, task_title: before.title, who: added, to: 'added' })
            await tell(onAssigned(id, { id: taskId, title: before.title }, people.filter((x: any) => !was.has(x.person_key)), me, members))
          }
          if (dropped.length) await logEvent(id, me, 'task_assigned', `unassigned ${dropped.join(', ')}`, { task_id: taskId, task_title: before.title, who: dropped, to: 'removed' })
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
        const rows: any[] = refs.slice(0, 400).map(ref_id => ({ project_id: id, kind, ref_id, label: str(b.label) || null }))
        // A BUILDING IS A COLLECTIVE OF UNITS (Jon, 2026-09-08). Attaching one attaches the building
        // row AND one listing row per unit, so "12 of 34 done" is computed from real links rather
        // than typed, and a unit that joins the building in Guesty later shows up as not-done.
        // An owner attaches the same way when asked — their units come along.
        const expand: string[] = Array.isArray(b.expandUnitIds) ? b.expandUnitIds.map(String).slice(0, 400) : []
        if ((kind === 'building' || kind === 'owner') && expand.length) {
          const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title').in('id', expand)
          for (const l of ((ls || []) as any[])) rows.push({ project_id: id, kind: 'listing', ref_id: String(l.id), label: String(l.nickname || l.title || 'Unit') })
        }
        const { error } = await sb.from('project_links').upsert(rows, { onConflict: 'project_id,kind,ref_id' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const unitsAdded = rows.length - refs.length
        await logEvent(id, me, 'link', `attached ${str(b.label) || refs.length + ' ' + kind + (refs.length === 1 ? '' : 's')}${unitsAdded ? ` and its ${unitsAdded} unit${unitsAdded === 1 ? '' : 's'}` : ''}`, { name: str(b.label) || kind, to: kind })
        break
      }
      case 'unlink': {
        const { data: was } = await sb.from('project_links').select('label').eq('project_id', id).eq('kind', str(b.kind)).eq('ref_id', str(b.refId)).maybeSingle()
        const { error } = await sb.from('project_links').delete().eq('project_id', id).eq('kind', str(b.kind)).eq('ref_id', str(b.refId))
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
        const listingId = str(b.listingId)
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
        const r = await createBreezewayTask(payload)
        if (!r.ok || !r.data?.id) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
        const bzId = String(r.data.id)
        // Same people, matched by the shared name matcher; a name Breezeway does not know is skipped, not guessed.
        const { data: asg } = await sb.from('project_task_assignees').select('display,email').eq('task_id', t.id)
        const ids: number[] = []
        for (const a of (asg || []) as any[]) { const pid = await matchBreezewayPerson(a.email || a.display).catch(() => null); if (pid) ids.push(pid) }
        let assigned = false
        if (ids.length) { try { assigned = !!(await updateBreezewayTask(bzId, { assignments: ids })).ok } catch { assigned = false } }
        await sb.from('project_steps').update({ breezeway_task_id: bzId, status: t.status === 'todo' ? 'doing' : t.status }).eq('id', t.id)
        try {
          await sb.from('breezeway_tasks_sync').upsert({ id: bzId, reference_property_id: listingId, name: t.title, status: 'created', scheduled_date: date, type_department: department, assignees: [], report_url: r.data.report_url || null, raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString() }, { onConflict: 'id' })
        } catch { /* the sync catches up */ }
        await logEvent(id, me, 'task_moved', `sent to Breezeway (${department}, ${date}${assigned ? ', assigned' : ''})`, { task_id: t.id, task_title: t.title, to: 'breezeway', name: bzId })
        return NextResponse.json({ ok: true, breezewayTaskId: bzId, reportUrl: r.data.report_url || null, assigned, project: await getProject(id) })
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
        let q = sb.from('project_steps').select('id,sort,created_at').eq('project_id', id).is('parent_id', null)
        q = section === null ? q.is('section', null) : q.eq('section', section)
        const { data: rows } = await q.order('sort', { nullsFirst: false }).order('created_at')
        const order = ((rows || []) as any[]).map(r => String(r.id)).filter(x => x !== taskId)
        const at = beforeId ? order.indexOf(beforeId) : -1
        if (at >= 0) order.splice(at, 0, taskId); else order.push(taskId)
        // One update per row in the section — sections are tens of tasks, not thousands.
        await Promise.all(order.map((tid, i) => sb.from('project_steps').update(tid === taskId ? { sort: (i + 1) * 10, section } : { sort: (i + 1) * 10 }).eq('id', tid)))
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
