// ONE PROJECT — the detail read, plus every sub-resource write in a single action-dispatch POST.
//
//   GET  /api/projects/<id>                     → full project (links, steps, photos, notes)
//   POST /api/projects/<id> { action, ... }     → link/unlink, steps, notes, spend, owner email
//
// The actions live together because they all mean "change something about this project" and each
// one is a handful of lines; splitting them into eight route files would spread one idea across
// eight places. The switch is exhaustive and unknown actions are rejected.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProject, addNote, ownerApprovalEmail, toCents, LINK_KINDS } from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const p = await getProject(params.id)
  if (!p) return NextResponse.json({ error: 'No such project.' }, { status: 404 })
  return NextResponse.json({ ok: true, project: p })
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

    switch (action) {
      // ---- WHAT THE PROJECT TOUCHES ------------------------------------------------
      // Units, reservations and Breezeway tasks all attach the same way, which is what lets a
      // 34-unit rollout and a one-unit remodel share a card design.
      case 'link': {
        const kind = str(b.kind)
        if (!(LINK_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'bad kind' }, { status: 400 })
        const refs: string[] = Array.isArray(b.refIds) ? b.refIds.map(String) : (str(b.refId) ? [str(b.refId)] : [])
        if (!refs.length) return NextResponse.json({ error: 'nothing to link' }, { status: 400 })
        const rows = refs.slice(0, 400).map(ref_id => ({ project_id: id, kind, ref_id, label: str(b.label) || null }))
        const { error } = await sb.from('project_links').upsert(rows, { onConflict: 'project_id,kind,ref_id' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await addNote(id, `Linked ${refs.length} ${kind}${refs.length === 1 ? '' : 's'}.`, me, 'event')
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
