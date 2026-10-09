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
    // ASKED FOR A TECHNICIAN, and that is ALL the link is ever told (Jon: the approval step is
    // what they must not see). No pending, no declined, no who decides — a request that Jon turns
    // down simply stops saying "requested", and the board carries on.
    requested: !t.breezeway_task_id && String(t.bz_request || '') === 'pending',
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
    // RELEASED INSPECTIONS. Only what Jon has personally let out, and deliberately not a verdict:
    // who walked the unit, when, and the report. Breezeway holds the judgement.
    inspections: p.sharedInspections || [],
  }
}

/**
 * The inspections Jon has released on this project, newest first. A join by hand rather than a
 * view: the share table says WHICH, breezeway_tasks_sync says what they were, and the project's
 * own unit links supply the name of the flat — the owner should read "Arya 1404", not an id.
 */
async function sharedInspections(p: any) {
  const ids = (await supabaseAdmin().from('project_inspection_shares').select('bz_task_id').eq('project_id', p.id)).data || []
  const list = (ids as any[]).map(r => String(r.bz_task_id)).slice(0, 200)
  if (!list.length) return []
  const { data } = await supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,scheduled_date,finished_at,assignees,assignee_name,report_url')
    .in('id', list)
  const labelOf: Record<string, string> = {}
  for (const l of (p.links || [])) if (l.kind === 'listing') labelOf[String(l.ref_id)] = str(l.label)
  const who = (t: any) => {
    const n = str(t.assignee_name)
    if (n) return n
    const a = Array.isArray(t.assignees) ? t.assignees : []
    return a.map((x: any) => (typeof x === 'string' ? x : str(x?.name) || str(x?.display))).filter(Boolean).join(', ')
  }
  return ((data || []) as any[])
    .map(t => ({
      id: String(t.id),
      unit: labelOf[String(t.reference_property_id)] || String(t.reference_property_id),
      name: str(t.name) || 'Inspection',
      inspector: who(t) || null,
      date: str(t.finished_at).slice(0, 10) || str(t.scheduled_date).slice(0, 10) || null,
      reportUrl: t.report_url || null,
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/** One read, one shape — GET and every POST return the project the same way. */
async function viewOf(p: any) {
  return vendorView({ ...p, sharedInspections: await sharedInspections(p) })
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
  return NextResponse.json({ ok: true, project: await viewOf(p) })
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
        description: str(b.description).slice(0, 2000) || null,
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
    } else if (action === 'translate') {
      // SPANISH AND ENGLISH, BOTH WAYS (Jon, 2026-10-09). Half this team works in Spanish and the
      // owners do not all read English; a board nobody can read is a board nobody uses. The page
      // sends every line it is showing in ONE call — one model round trip for a whole board, not
      // one per task — and gets them back in order. A line that cannot be translated comes back
      // as itself, so the board never renders a blank where a job used to be.
      const lines = (Array.isArray(b.lines) ? b.lines : []).map((x: any) => str(x)).slice(0, 120)
      const to = str(b.to) === 'es' ? 'es' : 'en'
      if (!lines.length) return NextResponse.json({ ok: true, lines: [] })
      const { translate } = await import('@/lib/eve/slack-triage')
      const packed = lines.map((l: string, i: number) => `${i + 1}\u0001 ${l.replace(/\n/g, ' ')}`).join('\n')
      const out = await translate(packed, null, to as any).catch(() => null)
      const back: string[] = lines.slice()
      if (out) {
        for (const row of String(out).split('\n')) {
          const m = row.match(/^\s*(\d+)\u0001?\s*(.*)$/)
          if (!m) continue
          const i = Number(m[1]) - 1
          const v = m[2].trim()
          if (i >= 0 && i < back.length && v) back[i] = v
        }
      }
      return NextResponse.json({ ok: true, lines: back, translated: !!out })
    } else if (action === 'requestBreezeway') {
      // ASKING FOR A TECHNICIAN (Jon, 2026-10-09: "want to be able to push breezeway task from
      // there ... Must be approved by me"). Nothing reaches Breezeway here — not a draft, not a
      // placeholder. It raises a flag on the task that puts it in front of Jon in Lighthouse, and
      // the reply to the link says only that it was asked for. Ticking and talking need no
      // permission; asking for a van to turn up is the one thing that does, and he is it.
      const taskId = str(b.taskId)
      const { data: step } = await supabaseAdmin().from('project_steps').select('id,title,breezeway_task_id').eq('id', taskId).eq('project_id', p.id).maybeSingle()
      if (!step) return NextResponse.json({ error: 'No such item.' }, { status: 404 })
      if ((step as any).breezeway_task_id) return NextResponse.json({ error: 'The team is already on this one.' }, { status: 400 })
      const note = str(b.note).slice(0, 500)
      const patch: any = { bz_request: 'pending', bz_request_by: who.slice(0, 60), bz_request_at: new Date().toISOString(), bz_request_note: note || null }
      let { error } = await supabaseAdmin().from('project_steps').update(patch).eq('id', taskId)
      if (error && /column|schema/i.test(error.message || '')) return NextResponse.json({ error: 'Requests are not switched on yet.' }, { status: 503 })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await addNote(p.id, `${who} asked for a technician on “${String((step as any).title || '').slice(0, 120)}”${note ? ': ' + note : ''}`, who, 'event', true)
    } else if (action === 'taskEdit' || action === 'subEdit') {
      // EVERYTHING EDITABLE (Jon, 2026-10-09). A board an owner can only tick is a board that
      // goes stale the first time a job changes shape. With edit access they can retitle a job,
      // write the detail, move it to another unit and change the date — the same fields we have.
      // Status and the Breezeway link are NOT here: those are facts about the field, set by the
      // field, and a board that lets anyone type over them stops being a record.
      if (!canEdit) return NextResponse.json({ error: 'This link can tick items and comment, but not change them.' }, { status: 403 })
      const stepId = str(b.stepId) || str(b.taskId)
      const { data: step } = await supabaseAdmin().from('project_steps').select('id,title').eq('id', stepId).eq('project_id', p.id).maybeSingle()
      if (!step) return NextResponse.json({ error: 'No such item.' }, { status: 404 })
      const patch: any = {}
      if (str(b.title)) patch.title = str(b.title).slice(0, 300)
      if (b.description !== undefined) patch.description = str(b.description).slice(0, 2000) || null
      if (b.section !== undefined) patch.section = str(b.section).slice(0, 80) || null
      if (b.due_on !== undefined) patch.due_on = /^\d{4}-\d{2}-\d{2}$/.test(str(b.due_on)) ? str(b.due_on) : null
      if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
      const { error } = await supabaseAdmin().from('project_steps').update(patch).eq('id', stepId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await addNote(p.id, `${who} edited “${String((step as any).title || '').slice(0, 120)}”`, who, 'event', true)
    } else if (action === 'subDelete') {
      // Removing work is the one edit kept to what came IN through the link. Our own jobs are
      // taken off the board by us — an owner who thinks one should go says so in the comments,
      // which leaves a trace; a silent delete does not.
      if (!canEdit) return NextResponse.json({ error: 'This link cannot remove work.' }, { status: 403 })
      const stepId = str(b.stepId)
      const { data: step } = await supabaseAdmin().from('project_steps').select('id,title,via_share').eq('id', stepId).eq('project_id', p.id).maybeSingle()
      if (!step) return NextResponse.json({ error: 'No such item.' }, { status: 404 })
      if (!(step as any).via_share) return NextResponse.json({ error: 'That one was added by the team — ask them to remove it.' }, { status: 403 })
      const { error } = await supabaseAdmin().from('project_steps').delete().eq('id', stepId).eq('project_id', p.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await addNote(p.id, `${who} removed “${String((step as any).title || '').slice(0, 120)}”`, who, 'event', true)
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
    return NextResponse.json({ ok: true, project: fresh ? await viewOf(fresh) : null })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
