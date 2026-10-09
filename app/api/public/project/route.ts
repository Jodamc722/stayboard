// VENDOR SHARE — the only project endpoint with no session.
//
// A vendor gets one link to one project. This returns a DELIBERATELY NARROW view: the scope, the
// checklist, the photos and the dates. It never returns budget, spend, owner name, approval state,
// internal notes or the lead's email — a contractor should see the job, not the commercials.
//
// GET  ?token=…&pass=…              → the shared view of one project
// POST { token, pass, action }       → note · stepDone, and with edit access addTask · taskDone
//
// 2026-10-09 (Jon): the link can carry a PASSCODE and can grant EDIT. Both off by default, so an
// existing vendor link behaves exactly as it did. With a passcode set, nothing — not even the
// title — comes back without it; with edit granted, the holder can add tasks of their own and
// change status, which is what makes this usable as an owner's board rather than a read-out.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProjectByToken, addNote, shareLocked, shareCanEdit } from '@/lib/projects'
import { onComment } from '@/lib/project-notify'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

/**
 * A note reaches the link if it was written THROUGH the link, or if whoever wrote it marked it
 * shared. Events — "X moved this to done", the audit trail — never do: they are our bookkeeping.
 */
const sharedNote = (n: any) => n.kind === 'comment' && (!!n.via_share || !!n.shared)

/**
 * ONE ITEM, OPENED (Jon, 2026-10-09: "each item should be able to open up ... comment on each
 * item and attach a Breezeway task. If we do attach a Breezeway task to it, it should show you
 * the report. Should be able to attach photos, action steps, invoices, etc., and tag").
 *
 * Everything the holder needs to judge one job, and nothing about the rest of the business. The
 * Breezeway block is the field's own word on the work — its status, who has it, and the report
 * with the photos the technician took. The invoice shows as paperwork: the document and who
 * billed it, because the owner asked to SEE the invoice, not to be handed our margins.
 */
function taskView(t: any, p: any): any {
  const notes = (p.notes || []).filter((n: any) => n.task_id === t.id && sharedNote(n))
  const files = (p.photos || []).filter((f: any) => f.task_id === t.id)
  const bz = t.breezeway || null
  return {
    id: t.id, title: t.title, done: t.status === 'done' || !!t.done, status: t.status || null,
    due_on: t.due_on, section: t.section || null, note: t.description || null,
    addedByShare: !!t.via_share,
    assignees: (t.assignees || []).map((a: any) => str(a.display)).filter(Boolean),
    // Action steps. A checklist under the job, tickable from the link like the job itself.
    subtasks: (t.subtasks || []).map((s: any) => ({ id: s.id, title: s.title, done: s.status === 'done' || !!s.done })),
    breezeway: t.breezeway_task_id
      ? { id: String(t.breezeway_task_id), status: bz?.status || 'unknown', tone: bz?.tone || 'open', assignee: bz?.assignee || null, date: bz?.date || null, reportUrl: bz?.reportUrl || null }
      : null,
    photos: files.filter((f: any) => f.kind !== 'file').map((f: any) => ({ id: f.id, url: f.url, caption: f.caption, created_at: f.created_at })),
    // The paperwork, not the ledger: what it is and who billed it. No approval state, no running
    // spend, no budget — those stay on our side of the wall.
    invoices: (p.invoices || []).filter((i: any) => i.task_id === t.id).map((i: any) => ({
      id: i.id, number: i.number || null, vendor: i.vendor_name || null, issued_on: i.issued_on || null,
      file: i.file ? { name: i.file.name, url: i.file.url, mime: i.file.mime } : null,
    })),
    comments: notes.slice().reverse().map((n: any) => ({
      body: n.body, author: n.author, created_at: n.created_at,
      mine: !!n.via_share, mentions: Array.isArray(n.mentions) ? n.mentions : [],
    })),
  }
}

/**
 * The roster the link may tag, as NAMES. A member row often carries an email where a display name
 * should be, and "@jon@stay-hospitality.com" on an owner's screen is both ugly and a mail address
 * handed to whoever holds the link — so an email is cut to its local part and tidied. Anyone on
 * the project, plus anyone carrying one of its tasks; nobody else in the company.
 */
function teamNames(p: any): string[] {
  const pretty = (v: string) => {
    const raw = str(v)
    if (!raw) return ''
    const base = raw.includes('@') ? raw.split('@')[0] : raw
    return base.replace(/[._-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim()
  }
  const out: string[] = []
  const push = (v: string) => { const n = pretty(v); if (n && !out.includes(n)) out.push(n) }
  for (const m of (p.members || [])) push(str(m.display) || str(m.email))
  for (const t of (p.steps || [])) for (const a of (t.assignees || [])) push(str(a.display) || str(a.email))
  return out.slice(0, 40)
}

/** Strip everything commercial. Whitelist, not blacklist — a new column must not leak by default. */
function vendorView(p: any) {
  return {
    id: p.id, ref: p.ref, title: p.title, summary: p.summary,
    stage: p.stage, category: p.category,
    starts_on: p.starts_on, due_on: p.due_on,
    building: p.building, vendor_name: p.vendor_name,
    units: (p.links || []).filter((l: any) => l.kind === 'listing').map((l: any) => ({ ref_id: l.ref_id, label: l.label, done: l.done })),
    // GROUPED BY UNIT (Jon, 2026-10-09: "can you help me organize this"). Fourteen jobs across six
    // units read as one undifferentiated list; the section each task already carries is what turns
    // it back into six short lists. The owner's add form writes the section too, so what they add
    // lands under the unit rather than at the bottom of everything.
    steps: (p.tasks || []).map((t: any) => taskView(t, p)),
    canEdit: shareCanEdit(p),
    // WHO CAN BE TAGGED (Jon chose "our team by name"). Display names only — never the emails,
    // never the roles, never anyone who is not actually on this project.
    team: teamNames(p),
    photos: (p.photos || []).filter((x: any) => !x.task_id).map((x: any) => ({ id: x.id, url: x.url, caption: x.caption, phase: x.phase, created_at: x.created_at })),
    // Only the conversation the vendor is part of — internal comments stay internal.
    notes: (p.notes || []).filter((n: any) => !n.task_id && sharedNote(n)).map((n: any) => ({ body: n.body, author: n.author, created_at: n.created_at })),
    progress: p.progress,
  }
}

export async function GET(req: NextRequest) {
  const token = str(req.nextUrl.searchParams.get('token'))
  const p = await getProjectByToken(token)
  if (!p) return NextResponse.json({ error: 'This link is not valid or has expired.' }, { status: 404 })
  // The passcode is checked before ANY of the project is described — a locked link does not leak
  // its title, its units or how many tasks are on it.
  if (shareLocked(p, str(req.nextUrl.searchParams.get('pass')))) {
    return NextResponse.json({ ok: false, needsPass: true, name: 'Stay Hospitality' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, project: vendorView(p) })
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const p = await getProjectByToken(str(b.token))
    if (!p) return NextResponse.json({ error: 'This link is not valid or has expired.' }, { status: 404 })
    if (shareLocked(p, str(b.pass))) return NextResponse.json({ ok: false, needsPass: true }, { status: 401 })
    const who = str(b.who) || p.vendor_name || 'vendor'
    const action = str(b.action)
    const canEdit = shareCanEdit(p)

    if (action === 'addTask') {
      // ADDING WORK (edit access only). The holder writes what needs doing; it lands as a task on
      // the project like any other, marked as theirs so the team can see where it came from. It
      // never reaches Breezeway from here — pushing a task to the field is ours to decide.
      if (!canEdit) return NextResponse.json({ error: 'This link can tick items and comment, but not add work.' }, { status: 403 })
      const title = str(b.title)
      if (!title) return NextResponse.json({ error: 'Write what needs doing.' }, { status: 400 })
      const { error } = await supabaseAdmin().from('project_steps').insert({
        project_id: p.id, title: title.slice(0, 200), done: false,
        due_on: /^\d{4}-\d{2}-\d{2}$/.test(str(b.due_on)) ? str(b.due_on) : null,
        section: str(b.section).slice(0, 80) || null,
        assignee: who.slice(0, 60), via_share: true, sort: Date.now(),
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await addNote(p.id, `${who} added: ${title.slice(0, 160)}`, who, 'event', true)
    } else if (action === 'taskNote') {
      // COMMENTING ON ONE ITEM. Anyone holding the link can talk on a job — ticking and talking
      // were always the two things a share is for. Tags are stored as display names because that
      // is what both sides read, and they are checked against the project's actual roster: the
      // link cannot invent a person, and cannot be used to probe who else works here.
      const body = str(b.body)
      const taskId = str(b.taskId)
      if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
      const { data: step } = await supabaseAdmin().from('project_steps').select('id,title').eq('id', taskId).eq('project_id', p.id).maybeSingle()
      if (!step) return NextResponse.json({ error: 'No such item.' }, { status: 404 })
      const roster = teamNames(p)
      const tags = (Array.isArray(b.mentions) ? b.mentions : []).map((x: any) => str(x)).filter((x: string) => roster.includes(x)).slice(0, 10)
      const noteId = await addNote(p.id, body.slice(0, 2000), who, 'comment', true, { taskId, mentions: tags })
      // The people tagged are told, exactly as they would be from inside the app — same path, same
      // inbox. A tag nobody ever sees is the reason people stop using a board.
      if (noteId) {
        await onComment({
          projectId: p.id, projectTitle: p.title, note: { id: noteId, body: body.slice(0, 2000), task_id: taskId },
          task: { id: taskId, title: String((step as any).title || '') }, actor: who, members: p.members || [], taskAssignees: [],
        }).catch(e => console.error('[public project] notify failed:', String(e?.message || e)))
      }
    } else if (action === 'subDone') {
      // An action step ticks like the job it sits under.
      const stepId = str(b.stepId)
      const { error } = await supabaseAdmin().from('project_steps')
        .update({ status: b.done ? 'done' : 'todo', done: !!b.done, done_at: b.done ? new Date().toISOString() : null, done_by: b.done ? who : null })
        .eq('id', stepId).eq('project_id', p.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (action === 'subAdd') {
      if (!canEdit) return NextResponse.json({ error: 'This link can tick items and comment, but not add work.' }, { status: 403 })
      const title = str(b.title)
      const parentId = str(b.parentId)
      if (!title) return NextResponse.json({ error: 'Write what needs doing.' }, { status: 400 })
      const { data: parent } = await supabaseAdmin().from('project_steps').select('id,section').eq('id', parentId).eq('project_id', p.id).maybeSingle()
      if (!parent) return NextResponse.json({ error: 'No such item.' }, { status: 404 })
      const { error } = await supabaseAdmin().from('project_steps').insert({
        project_id: p.id, parent_id: parentId, title: title.slice(0, 200), done: false,
        section: (parent as any).section || null, assignee: who.slice(0, 60), via_share: true, sort: Date.now(),
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (action === 'note') {
      const body = str(b.body)
      if (!body) return NextResponse.json({ error: 'empty note' }, { status: 400 })
      await addNote(p.id, body.slice(0, 2000), who, 'comment', true)
    } else if (action === 'stepDone') {
      // Ticking is allowed on every share: a vendor marking their own work done was the original
      // point of the link. Adding and renaming is what edit access opens up.
      const stepId = str(b.stepId)
      const { error } = await supabaseAdmin().from('project_steps')
        .update({ done: !!b.done, done_at: b.done ? new Date().toISOString() : null, done_by: b.done ? who : null })
        .eq('id', stepId).eq('project_id', p.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await addNote(p.id, `${who} marked a step ${b.done ? 'done' : 'not done'}.`, who, 'event', true)
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    const fresh = await getProjectByToken(str(b.token))
    return NextResponse.json({ ok: true, project: fresh ? vendorView(fresh) : null })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
