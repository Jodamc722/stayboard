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
import { requireLevel, isSuperadmin } from '@/lib/access'
import { personKey, nameMatches } from '@/lib/person-name'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listProjects, getCategories, addNote, newShareToken, toCents,
  STAGES, PRIORITIES, APPROVALS, PROJECT_KINDS, todayISO, type Stage,
  toPerson,
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
      // The board only ever receives what this person may see. See canSee in lib/projects.
      viewer: { email: g.access.email, superadmin: isSuperadmin(g.access.email) },
    }),
    getCategories(),
  ])
  // Pickers, so the editor can offer real units and real people instead of free text.
  let listings: any[] = [], people: string[] = []
  // ROSTER: app users AND field staff (Jon, 2026-09-08 — "app users and roster names"). A person
  // with a login can be notified; a roster name can be assigned but only named. The picker shows
  // both and marks which is which, deduplicated through the shared matcher so a cleaner who also
  // has a login is one entry, not two.
  let roster: { display: string; email: string | null; notifiable: boolean }[] = []
  try {
    const sb = supabaseAdmin()
    const [{ data: l }, { data: u }] = await Promise.all([
      sb.from('guesty_listings').select('id,nickname,title,building').limit(2000),
      sb.from('app_users').select('email,profile').eq('status', 'active').limit(200),
    ])
    listings = ((l || []) as any[]).map(x => ({ id: String(x.id), label: x.nickname || x.title || 'Unit', building: x.building || null }))
      .sort((a, b) => a.label.localeCompare(b.label))
    people = ((u || []) as any[]).map(x => String(x.email)).sort()
    const seen = new Set<string>()
    for (const x of ((u || []) as any[])) {
      const display = String((x.profile && (x.profile.name || x.profile.full_name)) || x.email)
      const k = personKey(display) || String(x.email).toLowerCase()
      if (seen.has(k)) continue
      seen.add(k); seen.add(String(x.email).toLowerCase())
      roster.push({ display, email: String(x.email).toLowerCase(), notifiable: true })
    }
    try {
      const { breezewayPeopleLite } = await import('@/lib/breezeway')
      for (const bp of await breezewayPeopleLite()) {
        const k = personKey(bp.name)
        if (!k || seen.has(k)) continue
        // A field person whose name matches an app user is that app user, not a second row.
        const twin = roster.find(r => nameMatches(r.display, bp.name))
        if (twin) { seen.add(k); continue }
        seen.add(k)
        roster.push({ display: bp.name, email: null, notifiable: false })
      }
    } catch { /* Breezeway down: app users alone are still a usable roster */ }
    roster.sort((a, b) => a.display.localeCompare(b.display))
  } catch {}
  let templates: any[] = []
  try {
    const { listTemplates } = await import('@/lib/project-templates')
    templates = (await listTemplates()).map(t => ({ key: t.key, label: t.label, kind: t.kind, category: t.category, blurb: t.blurb || '', builtIn: !!t.builtIn, sections: t.sections.map(s => s.name), recurs: t.recurs || null }))
  } catch {}
  return NextResponse.json({ ok: true, projects, categories, listings, people, roster, templates, today: todayISO() })
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
    // Wave 4: what shape it starts in. A template fills sections and tasks; a kind decides who can
    // see it (personal = only me, one_on_one = private to its members); a recurrence makes it a series.
    const { getTemplate, applyTemplate, normaliseRecurrence } = await import('@/lib/project-templates')
    const tpl = str(b.template) ? await getTemplate(str(b.template)) : null
    const kind = (PROJECT_KINDS as readonly string[]).includes(str(b.kind)) ? str(b.kind) : (tpl?.kind || 'project')
    const personal = kind === 'personal'
    if (tpl) { row.category = str(b.category) || tpl.category; if (!row.summary && tpl.summary) row.summary = tpl.summary }
    if (personal || kind === 'one_on_one') row.private = true
    row.kind = kind
    if (personal) { row.lead_email = null; row.stage = 'in_progress' }
    const recurs = normaliseRecurrence(b.recurs || (tpl?.recurs && b.repeat !== false && kind === 'one_on_one' ? tpl.recurs : null), str(b.starts_on) || undefined)
    if (recurs) { row.recurs = recurs; if (!row.stage || row.stage === 'idea') row.stage = 'in_progress' }
    const { data, error } = await supabaseAdmin().from('projects').insert(row).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // THE CREATOR IS THE FIRST OWNER. Without this row the project is visible to nobody but the
    // superadmin the moment it exists — privacy would lock people out of what they just made.
    // The lead, when named and different, comes in as an owner too.
    if (data) {
      const seed = [toPerson(String(g.access.email || ''))]
      const lead = str(b.lead_email)
      if (!personal && lead && lead.toLowerCase() !== String(g.access.email || '').toLowerCase()) seed.push(toPerson(lead))
      // A personal board has exactly one member, whatever the form sent.
      const extra = personal ? [] : (Array.isArray(b.members) ? b.members : []).map((x: any) => toPerson(String(x))).filter((x: any) => x.display)
      const rows = [
        ...seed.filter(x => x.display).map(x => ({ project_id: data.id, ...x, role: 'owner', added_by: g.access.email })),
        ...extra.map((x: any) => ({ project_id: data.id, ...x, role: 'editor', added_by: g.access.email })),
      ]
      const { error: mErr } = await supabaseAdmin().from('project_members').upsert(rows, { onConflict: 'project_id,person_key' })
      if (mErr) return NextResponse.json({ error: 'Project created but membership failed: ' + mErr.message }, { status: 500 })
      if (b.private && !personal && kind === 'project') await supabaseAdmin().from('projects').update({ private: true }).eq('id', data.id)
      if (tpl) {
        try { await applyTemplate(data.id, tpl, { startsOn: str(b.starts_on) || null, createdBy: String(g.access.email || '') }) }
        catch (e: any) { return NextResponse.json({ error: 'Project created but the template did not apply: ' + String(e?.message || e) }, { status: 500 }) }
      }
    }
    // Optional units at creation time, so "a rollout across these 12 units" is one step.
    const units: string[] = Array.isArray(b.listingIds) ? b.listingIds.map(String) : []
    if (data && units.length) {
      await supabaseAdmin().from('project_links').insert(
        units.slice(0, 400).map(id => ({ project_id: data.id, kind: 'listing', ref_id: id, label: null })),
      )
    }
    if (data) await addNote(data.id, `created this ${personal ? 'board' : kind === 'one_on_one' ? 'one-on-one' : 'project'}${tpl ? ` from the ${tpl.label} template` : ''}${recurs ? ' · repeats' : ''}`, g.access.email, 'event', false, { meta: { type: 'stage', name: 'created' } })
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
