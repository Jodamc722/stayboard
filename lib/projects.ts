// PROJECTS — the reads, the writes and the one place that decides what "late" means.
//
// A project is the work that does not fit a task: it runs for weeks, has a lead, usually has money
// attached, and often needs an owner to approve it before anyone moves. Tasks stay in Breezeway;
// this never writes there. A project can POINT AT tasks, units and reservations (project_links),
// which is what lets the board say "34 units, 21 done" without owning any of them.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
export * from './projects-shared'
import {
  type Project, type ProjectFull, type Member, type Person, type Task, type Viewer,
  progressOf, healthOf, nestTasks, TASK_STATUSES, money, todayISO,
} from './projects-shared'

export async function getCategories(): Promise<{ key: string; label: string; color: string; sort: number }[]> {
  try {
    const { data } = await supabaseAdmin().from('project_categories').select('*').eq('active', true).order('sort')
    return (data || []) as any
  } catch { return [] }
}

export async function listProjects(opts: { archived?: boolean; category?: string; market?: string; lead?: string; viewer?: Viewer } = {}) {
  try {
    const sb = supabaseAdmin()
    let q = sb.from('projects').select('*').eq('archived', !!opts.archived)
    if (opts.category && opts.category !== 'all') q = q.eq('category', opts.category)
    if (opts.market && opts.market !== 'all') q = q.eq('market', opts.market)
    if (opts.lead && opts.lead !== 'all') q = q.eq('lead_email', opts.lead)
    const { data } = await q.order('sort', { nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
    let rows = (data || []) as any as Project[]
    if (!rows.length) return []
    // PRIVACY IS APPLIED HERE, NOT IN THE UI. When a viewer is given, the board only ever receives
    // the projects that viewer is a member of. A non-member does not get a greyed-out card; they
    // get nothing, and cannot tell the project exists.
    if (opts.viewer && !opts.viewer.superadmin) {
      const e = String(opts.viewer.email || '').trim().toLowerCase()
      if (!e) return []
      const { data: mine } = await sb.from('project_members').select('project_id').eq('email', e).limit(2000)
      const ok = new Set(((mine || []) as any[]).map(m => String(m.project_id)))
      rows = rows.filter(r => ok.has(String(r.id)))
      if (!rows.length) return []
    }
    const ids = rows.map(r => r.id)
    // Two round trips for the whole board rather than N+1 per card.
    const [{ data: links }, { data: steps }] = await Promise.all([
      sb.from('project_links').select('project_id,kind,ref_id,label,done').in('project_id', ids),
      sb.from('project_steps').select('project_id,done').in('project_id', ids),
    ])
    const byL: Record<string, any[]> = {}, byS: Record<string, any[]> = {}
    for (const l of (links || []) as any[]) (byL[l.project_id] = byL[l.project_id] || []).push(l)
    for (const s of (steps || []) as any[]) (byS[s.project_id] = byS[s.project_id] || []).push(s)
    return rows.map(p => ({
      ...p,
      links: byL[p.id] || [], steps: byS[p.id] || [],
      progress: progressOf(byL[p.id] || [], byS[p.id] || []),
      health: healthOf(p, byS[p.id] || []),
    }))
  } catch { return [] }
}

export async function getProject(id: string): Promise<ProjectFull | null> {
  const sb = supabaseAdmin()
  const { data: p, error } = await sb.from('projects').select('*').eq('id', id).maybeSingle()
  // A failed read is not a missing project. The old version returned null for both, and the page
  // rendered "not found" for a database blip — the false all-clear the audit was about.
  if (error) throw new Error('project read failed: ' + error.message)
  if (!p) return null
  const [links, steps, photos, notes, members, asg] = await Promise.all([
    sb.from('project_links').select('*').eq('project_id', id).order('created_at'),
    sb.from('project_steps').select('*').eq('project_id', id).order('sort', { nullsFirst: false }).order('created_at'),
    sb.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    sb.from('project_notes').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(200),
    sb.from('project_members').select('*').eq('project_id', id).order('created_at'),
    sb.from('project_task_assignees').select('task_id,person_key,display,email').eq('project_id', id),
  ])
  for (const r of [links, steps, photos, notes, members, asg]) if (r.error) throw new Error('project read failed: ' + r.error.message)
  const L = (links.data || []) as any[], S = (steps.data || []) as any[]
  const byTask: Record<string, Person[]> = {}
  for (const a of (asg.data || []) as any[]) (byTask[a.task_id] = byTask[a.task_id] || []).push({ person_key: a.person_key, display: a.display, email: a.email })
  return {
    ...(p as any),
    links: L, steps: S, photos: photos.data || [], notes: notes.data || [],
    members: (members.data || []) as Member[],
    tasks: nestTasks(S, byTask),
    progress: progressOf(L, S), health: healthOf(p as any, S),
  }
}

/** Resolve a vendor share link. Returns null for unknown, revoked or expired tokens. */
export async function getProjectByToken(token: string): Promise<ProjectFull | null> {
  const t = String(token || '').trim()
  if (t.length < 12) return null
  try {
    const { data } = await supabaseAdmin().from('projects').select('id,share_expires').eq('share_token', t).maybeSingle()
    if (!data) return null
    if (data.share_expires && new Date(data.share_expires).getTime() < Date.now()) return null
    return await getProject(data.id)
  } catch { return null }
}

// ---------------------------------------------------------------- writes
export async function addNote(projectId: string, body: string, author: string | null, kind: 'comment' | 'event' = 'comment', viaShare = false) {
  try {
    await supabaseAdmin().from('project_notes').insert({
      project_id: projectId, body: String(body).slice(0, 4000), author, kind, via_share: viaShare,
    })
  } catch {}
}

/** 32 hex chars from the crypto RNG — long enough that a link cannot be guessed. */
export function newShareToken(): string {
  const b = new Uint8Array(16)
  ;(globalThis.crypto as Crypto).getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- owner approval email
// The team should never have to write this from scratch, and the numbers in it must come from the
// project rather than from someone's memory — that is the whole point of drafting it here.
export function ownerApprovalEmail(p: Project, steps: { title: string; done: boolean }[] = [], opts: { unitLabel?: string | null; fromName?: string } = {}) {
  const unit = opts.unitLabel || p.building || p.market || 'your property'
  const budget = money(p.budget_cents)
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const scope = steps.filter(s => s.title).slice(0, 12)
  const subject = `Approval requested — ${p.title}${budget != null ? ` (${fmt(budget)})` : ''} at ${unit}`
  const lines: string[] = []
  lines.push(`Hi${p.owner_name ? ' ' + String(p.owner_name).split(' ')[0] : ''},`)
  lines.push('')
  lines.push(`We would like your approval for ${p.title.toLowerCase()} at ${unit}.`)
  if (p.summary) { lines.push(''); lines.push(p.summary) }
  if (scope.length) {
    lines.push(''); lines.push('What this covers:')
    for (const s of scope) lines.push(`  • ${s.title}`)
  }
  if (budget != null) {
    lines.push('')
    lines.push(`Estimated cost: ${fmt(budget)}${p.billable ? ', billed to the property.' : '.'}`)
  }
  if (p.due_on) { lines.push(''); lines.push(`We are aiming to complete this by ${new Date(p.due_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`) }
  lines.push('')
  lines.push('Reply to this email to approve and we will schedule it. Happy to talk it through first if you would rather.')
  lines.push('')
  lines.push(`Thank you,`)
  lines.push(opts.fromName || 'Stay Hospitality')
  return { subject, body: lines.join('\n') }
}
