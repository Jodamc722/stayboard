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
  type Project, type ProjectFull, type Member, type Person, type Task, type Viewer, type EventType,
  progressOf, healthOf, nestTasks, TASK_STATUSES, money, todayISO, canSee, canEdit,
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
    if (opts.viewer) {
      const e = String(opts.viewer.email || '').trim().toLowerCase()
      const { data: mine } = e ? await sb.from('project_members').select('project_id').eq('email', e).limit(2000) : { data: [] as any[] }
      const ok = new Set(((mine || []) as any[]).map(m => String(m.project_id)))
      // A personal board is its owner's alone — the superadmin's all-access stops at the kind.
      rows = rows.filter(r => canSee(ok.has(String(r.id)) ? [{ email: e }] : [], opts.viewer!, (r as any).kind))
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
    sb.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(500),
    sb.from('project_notes').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(1000),
    sb.from('project_members').select('*').eq('project_id', id).order('created_at'),
    sb.from('project_task_assignees').select('task_id,person_key,display,email').eq('project_id', id),
  ])
  for (const r of [links, steps, photos, notes, members, asg]) if (r.error) throw new Error('project read failed: ' + r.error.message)
  const L = (links.data || []) as any[], S = (steps.data || []) as any[]
  const byTask: Record<string, Person[]> = {}
  for (const a of (asg.data || []) as any[]) (byTask[a.task_id] = byTask[a.task_id] || []).push({ person_key: a.person_key, display: a.display, email: a.email })
  return {
    ...(p as any),
    links: L, steps: S, photos: await signFiles(photos.data || []), notes: notes.data || [],
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

// ---------------------------------------------------------------- files
// Wave 2 uploads live in a PRIVATE bucket. The row stores the storage key; the URL people open is
// minted here, per read, and dies in six hours. Old rows from the public bucket have no key and
// keep their permanent URL — nothing about them changed.
export const FILES_BUCKET = 'project-files'
const SIGN_TTL = 6 * 3600

export async function ensureFilesBucket(sb = supabaseAdmin()) {
  const { data } = await sb.storage.getBucket(FILES_BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(FILES_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}

async function signFiles(rows: any[]): Promise<any[]> {
  const keyed = rows.filter(r => r.storage_path)
  if (!keyed.length) return rows
  try {
    const { data, error } = await supabaseAdmin().storage.from(FILES_BUCKET).createSignedUrls(keyed.map(r => r.storage_path), SIGN_TTL)
    if (error || !data) throw error || new Error('no urls')
    const byPath: Record<string, string> = {}
    for (const d of data) if (d.signedUrl && d.path) byPath[d.path] = d.signedUrl
    return rows.map(r => (r.storage_path && byPath[r.storage_path]) ? { ...r, url: byPath[r.storage_path] } : r)
  } catch {
    // A signing failure must not hide the row. The name still shows; the click fails honestly.
    return rows
  }
}

// ---------------------------------------------------------------- access gate
// The one membership check every write path uses. 404 for a non-member (the project must not be
// confirmed to exist), 403 for a member who can look but not touch.
export async function gateProject(id: string, viewer: Viewer, need: 'view' | 'edit'):
  Promise<{ ok: true; members: Member[] } | { ok: false; status: number; error: string }> {
  const sb = supabaseAdmin()
  const { data: memRows, error: memErr } = await sb.from('project_members').select('*').eq('project_id', id)
  if (memErr) return { ok: false, status: 500, error: 'Could not check access: ' + memErr.message }
  const members = (memRows || []) as Member[]
  const { data: exists, error: exErr } = await sb.from('projects').select('id,kind').eq('id', id).maybeSingle()
  if (exErr) return { ok: false, status: 500, error: 'Could not check access: ' + exErr.message }
  if (!exists || !canSee(members, viewer, exists.kind)) return { ok: false, status: 404, error: 'No such project.' }
  if (need === 'edit' && !canEdit(members, viewer, exists.kind)) return { ok: false, status: 403, error: 'You can view this project but not change it.' }
  return { ok: true, members }
}

// ---------------------------------------------------------------- writes
export async function addNote(projectId: string, body: string, author: string | null, kind: 'comment' | 'event' = 'comment', viaShare = false,
  extra: { taskId?: string | null; meta?: any } = {}) {
  try {
    await supabaseAdmin().from('project_notes').insert({
      project_id: projectId, body: String(body).slice(0, 4000), author, kind, via_share: viaShare,
      task_id: extra.taskId || null, meta: extra.meta || null,
    })
  } catch {}
}

/** An activity event: what somebody did, with enough structure for the feed to link the task. */
export async function logEvent(projectId: string, who: string | null, type: EventType, body: string,
  meta: { task_id?: string; task_title?: string; from?: string | null; to?: string | null; who?: string[]; name?: string } = {}) {
  await addNote(projectId, body, who, 'event', false, { taskId: meta.task_id || null, meta: { type, ...meta } })
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
