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

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

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
    steps: (p.steps || []).map((s: any) => ({ id: s.id, title: s.title, done: s.done, due_on: s.due_on, section: s.section || null, note: s.description || null, assignee: s.assignee || null, addedByShare: !!s.via_share })),
    canEdit: shareCanEdit(p),
    photos: (p.photos || []).map((x: any) => ({ id: x.id, url: x.url, caption: x.caption, phase: x.phase, created_at: x.created_at })),
    // Only the conversation the vendor is part of — internal comments stay internal.
    notes: (p.notes || []).filter((n: any) => n.via_share).map((n: any) => ({ body: n.body, author: n.author, created_at: n.created_at })),
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
