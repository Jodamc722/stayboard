// VENDOR SHARE — the only project endpoint with no session.
//
// A vendor gets one link to one project. This returns a DELIBERATELY NARROW view: the scope, the
// checklist, the photos and the dates. It never returns budget, spend, owner name, approval state,
// internal notes or the lead's email — a contractor should see the job, not the commercials.
//
// GET  ?token=…                      → the vendor's view of one project
// POST { token, action: 'note' | 'stepDone' }  → the two things a vendor may change
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProjectByToken, addNote } from '@/lib/projects'

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
    steps: (p.steps || []).map((s: any) => ({ id: s.id, title: s.title, done: s.done, due_on: s.due_on })),
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
  return NextResponse.json({ ok: true, project: vendorView(p) })
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const p = await getProjectByToken(str(b.token))
    if (!p) return NextResponse.json({ error: 'This link is not valid or has expired.' }, { status: 404 })
    const who = p.vendor_name || 'vendor'
    const action = str(b.action)

    if (action === 'note') {
      const body = str(b.body)
      if (!body) return NextResponse.json({ error: 'empty note' }, { status: 400 })
      await addNote(p.id, body.slice(0, 2000), who, 'comment', true)
    } else if (action === 'stepDone') {
      // A vendor may tick their own checklist. They cannot add, rename or delete steps — the scope
      // of the job is ours to set.
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
