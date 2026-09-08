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
import { getProject, addNote, ownerApprovalEmail, toCents, LINK_KINDS, canSee, canEdit, toPerson, TASK_STATUSES, MEMBER_ROLES, type Viewer } from '@/lib/projects'

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
  if (!p || !canSee(p.members, viewerOf(g.access))) return NextResponse.json({ error: 'No such project.' }, { status: 404 })
  return NextResponse.json({ ok: true, project: p, canEdit: canEdit(p.members, viewerOf(g.access)) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const id = params.id
  const sb = supabaseAdmin()
  try {
    const b = await req.json().catch(() => ({}))
    const action = str(b.action)
    const me = g.access.email
    const viewer = viewerOf(g.access)

    // Every write starts by proving the caller may see the project and may edit it. Same 404 as
    // the read for a non-member; a viewer-role member gets an honest 403 because they already
    // know it exists.
    const { data: memRows, error: memErr } = await sb.from('project_members').select('email,role,person_key').eq('project_id', id)
    if (memErr) return NextResponse.json({ error: 'Could not check access: ' + memErr.message }, { status: 500 })
    const members = (memRows || []) as any[]
    const { data: exists } = await sb.from('projects').select('id').eq('id', id).maybeSingle()
    if (!exists || !canSee(members, viewer)) return NextResponse.json({ error: 'No such project.' }, { status: 404 })
    if (!canEdit(members, viewer)) return NextResponse.json({ error: 'You can view this project but not change it.' }, { status: 403 })

    // Keep the old single-assignee column honest: first assignee, or null.
    const syncLegacyAssignee = async (taskId: string) => {
      const { data } = await sb.from('project_task_assignees').select('display').eq('task_id', taskId).order('created_at').limit(1)
      await sb.from('project_steps').update({ assignee: data && data[0] ? data[0].display : null }).eq('id', taskId)
    }

    switch (action) {
      // ---- MEMBERS: who is on this project, and therefore who can see it ---------
      case 'memberAdd': {
        const who = toPerson(str(b.person))
        if (!who.display) return NextResponse.json({ error: 'Who?' }, { status: 400 })
        const role = MEMBER_ROLES.includes(str(b.role) as any) ? str(b.role) : 'editor'
        const { error } = await sb.from('project_members').upsert(
          { project_id: id, ...who, role, added_by: me }, { onConflict: 'project_id,person_key' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await addNote(id, `${who.display} added as ${role}`, me, 'event')
        break
      }
      case 'memberRole': {
        const role = MEMBER_ROLES.includes(str(b.role) as any) ? str(b.role) : null
        if (!role) return NextResponse.json({ error: 'role must be owner, editor or viewer' }, { status: 400 })
        const { error } = await sb.from('project_members').update({ role }).eq('project_id', id).eq('person_key', str(b.personKey))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
        return NextResponse.json({ ok: true, taskId: data.id, project: await getProject(id) })
      }
      case 'taskSet': {
        const taskId = str(b.taskId)
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
          await sb.from('project_task_assignees').delete().eq('task_id', taskId)
          if (people.length) {
            const { error: e2 } = await sb.from('project_task_assignees').upsert(
              people.map((who: any) => ({ task_id: taskId, project_id: id, ...who })), { onConflict: 'task_id,person_key' })
            if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
          }
          await syncLegacyAssignee(taskId)
        }
        break
      }
      case 'taskDelete': {
        const { error } = await sb.from('project_steps').delete().eq('id', str(b.taskId)).eq('project_id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
        await addNote(id, `Linked ${str(b.label) || refs.length + ' ' + kind + (refs.length === 1 ? '' : 's')}${unitsAdded ? ` and its ${unitsAdded} unit${unitsAdded === 1 ? '' : 's'}` : ''}.`, me, 'event')
        break
      }
      case 'unlink': {
        const { error } = await sb.from('project_links').delete().eq('project_id', id).eq('kind', str(b.kind)).eq('ref_id', str(b.refId))
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
        await addNote(id, `Spend ${amt > 0 ? '+' : ''}$${(amt / 100).toFixed(2)}${str(b.note) ? ' — ' + str(b.note) : ''}. Total now $${(next / 100).toFixed(2)}.`, me, 'event')
        break
      }

      // ---- NOTES + PHOTOS ----------------------------------------------------------
      case 'note': {
        const body = str(b.body)
        if (!body) return NextResponse.json({ error: 'empty note' }, { status: 400 })
        await addNote(id, body, me, 'comment')
        break
      }
      case 'photoDelete': {
        const { error } = await sb.from('project_photos').delete().eq('id', str(b.photoId)).eq('project_id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
