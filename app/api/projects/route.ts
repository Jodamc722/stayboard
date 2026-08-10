// PROJECT BOARD API.
//
//   GET    /api/projects                → board payload (projects + categories + pickers)
//   POST   /api/projects                → create
//   PATCH  /api/projects  { id, ... }   → update fields / move stage / approval / share
//   DELETE /api/projects  { id }        → archive (never a hard delete: projects carry money)
//
// Sub-resources (links, steps, photos, notes, owner email) live under /api/projects/[id]/… so this
// file stays about the project itself.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listProjects, getCategories, addNote, newShareToken, toCents,
  STAGES, PRIORITIES, APPROVALS, todayISO, type Stage,
} from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const oneOf = <T extends readonly string[]>(v: any, list: T): T[number] | null =>
  list.includes(String(v)) ? (String(v) as T[number]) : null

export async function GET(req: NextRequest) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const [projects, categories] = await Promise.all([
    listProjects({
      archived: sp.get('archived') === '1',
      category: str(sp.get('category')) || 'all',
      market: str(sp.get('market')) || 'all',
      lead: str(sp.get('lead')) || 'all',
    }),
    getCategories(),
  ])
  // Pickers, so the editor can offer real units and real people instead of free text.
  let listings: any[] = [], people: string[] = []
  try {
    const sb = supabaseAdmin()
    const [{ data: l }, { data: u }] = await Promise.all([
      sb.from('guesty_listings').select('id,nickname,title,building').limit(2000),
      sb.from('app_users').select('email,profile').eq('status', 'active').limit(200),
    ])
    listings = ((l || []) as any[]).map(x => ({ id: String(x.id), label: x.nickname || x.title || 'Unit', building: x.building || null }))
      .sort((a, b) => a.label.localeCompare(b.label))
    people = ((u || []) as any[]).map(x => String(x.email)).sort()
  } catch {}
  return NextResponse.json({ ok: true, projects, categories, listings, people, today: todayISO() })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({}))
    const title = str(b.title)
    if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })
    const row: any = {
      title: title.slice(0, 200),
      summary: str(b.summary) || null,
      category: str(b.category) || 'other',
      stage: oneOf(b.stage, STAGES) || 'idea',
      priority: oneOf(b.priority, PRIORITIES) || 'normal',
      lead_email: str(b.lead_email) || null,
      market: str(b.market) || null,
      building: str(b.building) || null,
      starts_on: str(b.starts_on) || null,
      due_on: str(b.due_on) || null,
      budget_cents: b.budget == null || b.budget === '' ? null : toCents(b.budget),
      billable: !!b.billable,
      owner_id: str(b.owner_id) || null,
      owner_name: str(b.owner_name) || null,
      approval: oneOf(b.approval, APPROVALS) || 'not_needed',
      created_by: g.access.email,
    }
    const { data, error } = await supabaseAdmin().from('projects').insert(row).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Optional units at creation time, so "a rollout across these 12 units" is one step.
    const units: string[] = Array.isArray(b.listingIds) ? b.listingIds.map(String) : []
    if (data && units.length) {
      await supabaseAdmin().from('project_links').insert(
        units.slice(0, 400).map(id => ({ project_id: data.id, kind: 'listing', ref_id: id, label: null })),
      )
    }
    if (data) await addNote(data.id, `Project created by ${g.access.email || 'someone'}.`, g.access.email, 'event')
    return NextResponse.json({ ok: true, project: data })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({}))
    const id = str(b.id)
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const sb = supabaseAdmin()
    const { data: before } = await sb.from('projects').select('*').eq('id', id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'No such project.' }, { status: 404 })

    const patch: any = {}
    const events: string[] = []
    if (b.title !== undefined) patch.title = str(b.title).slice(0, 200) || before.title
    if (b.summary !== undefined) patch.summary = str(b.summary) || null
    if (b.category !== undefined) patch.category = str(b.category) || 'other'
    if (b.priority !== undefined) patch.priority = oneOf(b.priority, PRIORITIES) || before.priority
    if (b.lead_email !== undefined) patch.lead_email = str(b.lead_email) || null
    if (b.market !== undefined) patch.market = str(b.market) || null
    if (b.building !== undefined) patch.building = str(b.building) || null
    if (b.starts_on !== undefined) patch.starts_on = str(b.starts_on) || null
    if (b.due_on !== undefined) patch.due_on = str(b.due_on) || null
    if (b.billable !== undefined) patch.billable = !!b.billable
    if (b.owner_id !== undefined) patch.owner_id = str(b.owner_id) || null
    if (b.owner_name !== undefined) patch.owner_name = str(b.owner_name) || null
    if (b.budget !== undefined) patch.budget_cents = b.budget === '' || b.budget == null ? null : toCents(b.budget)
    if (b.spent !== undefined) patch.spent_cents = toCents(b.spent) ?? 0
    if (b.sort !== undefined && Number.isFinite(Number(b.sort))) patch.sort = Number(b.sort)
    if (b.archived !== undefined) patch.archived = !!b.archived

    // Stage. done_on is stamped and cleared automatically so a reopened project stops reading done.
    if (b.stage !== undefined) {
      const s = oneOf(b.stage, STAGES) as Stage | null
      if (s) {
        patch.stage = s
        patch.done_on = s === 'done' ? todayISO() : null
        if (s !== before.stage) events.push(`Moved to ${s.replace('_', ' ')}.`)
      }
    }
    // Approval. Money decisions get their own audit line, always.
    if (b.approval !== undefined) {
      const a = oneOf(b.approval, APPROVALS)
      if (a) {
        patch.approval = a
        if (a === 'approved') { patch.approved_at = new Date().toISOString(); patch.approved_by = str(b.approved_by) || g.access.email }
        if (a === 'declined' || a === 'needed' || a === 'requested') { patch.approved_at = null; patch.approved_by = null }
        if (a !== before.approval) events.push(`Owner approval: ${a.replace('_', ' ')}.`)
      }
    }
    if (b.approval_note !== undefined) patch.approval_note = str(b.approval_note) || null

    // Vendor share link: create, rotate or revoke.
    if (b.share === 'new' || b.share === 'rotate') {
      patch.share_token = newShareToken()
      patch.share_expires = str(b.share_expires) || null
      patch.vendor_name = str(b.vendor_name) || before.vendor_name || null
      events.push(b.share === 'rotate' ? 'Vendor link rotated — the old link no longer works.' : 'Vendor link created.')
    }
    if (b.share === 'revoke') { patch.share_token = null; patch.share_expires = null; events.push('Vendor link revoked.') }
    if (b.vendor_name !== undefined && b.share == null) patch.vendor_name = str(b.vendor_name) || null

    const { data, error } = await sb.from('projects').update(patch).eq('id', id).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const e of events) await addNote(id, e, g.access.email, 'event')
    return NextResponse.json({ ok: true, project: data })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// Archive, not delete. A project carries budget, approval and photos — the audit trail outlives
// anyone's interest in tidying the board.
export async function DELETE(req: NextRequest) {
  const g = await requireLevel('projects', 'full')
  if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({}))
    const id = str(b.id)
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { error } = await supabaseAdmin().from('projects').update({ archived: true }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await addNote(id, `Archived by ${g.access.email || 'someone'}.`, g.access.email, 'event')
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
