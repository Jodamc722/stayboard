// PROJECTS — the reads, the writes and the one place that decides what "late" means.
//
// A project is the work that does not fit a task: it runs for weeks, has a lead, usually has money
// attached, and often needs an owner to approve it before anyone moves. Tasks stay in Breezeway;
// this never writes there. A project can POINT AT tasks, units and reservations (project_links),
// which is what lets the board say "34 units, 21 done" without owning any of them.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

export const STAGES = ['idea', 'planned', 'in_progress', 'blocked', 'review', 'done', 'cancelled'] as const
export type Stage = typeof STAGES[number]
export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Idea', planned: 'Planned', in_progress: 'In progress',
  blocked: 'Blocked', review: 'Review', done: 'Done', cancelled: 'Cancelled',
}
/** Columns shown on the board. Done and cancelled are reachable but not a standing column. */
export const BOARD_STAGES: Stage[] = ['idea', 'planned', 'in_progress', 'blocked', 'review', 'done']
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const APPROVALS = ['not_needed', 'needed', 'requested', 'approved', 'declined'] as const
export const LINK_KINDS = ['listing', 'reservation', 'task', 'owner', 'building'] as const
export const PHOTO_PHASES = ['before', 'during', 'after'] as const

const OPEN_STAGES: Stage[] = ['idea', 'planned', 'in_progress', 'blocked', 'review']
export const isOpenStage = (s: any) => OPEN_STAGES.includes(String(s) as Stage)

export type Project = {
  id: string; ref: string | null; title: string; summary: string | null
  category: string; stage: Stage; priority: string
  lead_email: string | null; market: string | null; building: string | null
  starts_on: string | null; due_on: string | null; done_on: string | null
  budget_cents: number | null; spent_cents: number; billable: boolean
  owner_id: string | null; owner_name: string | null
  approval: string; approval_note: string | null; approved_at: string | null; approved_by: string | null
  share_token: string | null; share_expires: string | null; vendor_name: string | null
  archived: boolean; sort: number | null
  created_by: string | null; created_at: string; updated_at: string
}

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
export const money = (cents: number | null | undefined) =>
  cents == null ? null : Math.round(Number(cents)) / 100
export const toCents = (dollars: any): number | null => {
  // Strip currency furniture, but a string with NO DIGITS must be null, not 0. Number('') is 0,
  // so the naive version turned an empty box or a typo into a $0.00 budget — which reads on the
  // card as "budgeted at nothing" rather than "no budget set". Those are different facts.
  const cleaned = String(dollars ?? '').replace(/[^0-9.\-]/g, '')
  if (!/\d/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const TZ = 'America/New_York'
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

/** ONE definition of trouble, so the card, the column count and the digest always agree. */
export function healthOf(p: Project, steps: { done: boolean }[] = []): {
  state: 'ok' | 'due' | 'late' | 'blocked' | 'done'
  daysLeft: number | null
  reason: string | null
} {
  if (p.stage === 'done' || p.stage === 'cancelled') return { state: 'done', daysLeft: null, reason: null }
  if (p.stage === 'blocked') return { state: 'blocked', daysLeft: null, reason: 'Blocked' }
  if (!p.due_on) return { state: 'ok', daysLeft: null, reason: null }
  const days = Math.round(
    (new Date(p.due_on + 'T12:00:00').getTime() - new Date(todayISO() + 'T12:00:00').getTime()) / 86400000,
  )
  if (days < 0) return { state: 'late', daysLeft: days, reason: `${Math.abs(days)}d overdue` }
  if (days <= 7) return { state: 'due', daysLeft: days, reason: days === 0 ? 'Due today' : `${days}d left` }
  return { state: 'ok', daysLeft: days, reason: null }
}

/** Progress from linked units first (a rollout is measured in units), else from the checklist. */
export function progressOf(links: { kind: string; done: boolean }[], steps: { done: boolean }[]) {
  const units = links.filter(l => l.kind === 'listing')
  const src = units.length ? units : steps
  const total = src.length
  const done = src.filter((x: any) => x.done).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : null, basis: units.length ? 'units' : 'steps' }
}

// ---------------------------------------------------------------- reads
// FAIL-SOFT: a missing table (migration not run yet) returns empty rather than 500ing the page,
// same contract as the rest of the app's settings-backed features.
export async function getCategories(): Promise<{ key: string; label: string; color: string; sort: number }[]> {
  try {
    const { data } = await supabaseAdmin().from('project_categories').select('*').eq('active', true).order('sort')
    return (data || []) as any
  } catch { return [] }
}

export type ProjectFull = Project & {
  links: any[]; steps: any[]; photos: any[]; notes: any[]
  progress: ReturnType<typeof progressOf>; health: ReturnType<typeof healthOf>
}

export async function listProjects(opts: { archived?: boolean; category?: string; market?: string; lead?: string } = {}) {
  try {
    const sb = supabaseAdmin()
    let q = sb.from('projects').select('*').eq('archived', !!opts.archived)
    if (opts.category && opts.category !== 'all') q = q.eq('category', opts.category)
    if (opts.market && opts.market !== 'all') q = q.eq('market', opts.market)
    if (opts.lead && opts.lead !== 'all') q = q.eq('lead_email', opts.lead)
    const { data } = await q.order('sort', { nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
    const rows = (data || []) as any as Project[]
    if (!rows.length) return []
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
  try {
    const sb = supabaseAdmin()
    const { data: p } = await sb.from('projects').select('*').eq('id', id).maybeSingle()
    if (!p) return null
    const [{ data: links }, { data: steps }, { data: photos }, { data: notes }] = await Promise.all([
      sb.from('project_links').select('*').eq('project_id', id).order('created_at'),
      sb.from('project_steps').select('*').eq('project_id', id).order('sort', { nullsFirst: false }).order('created_at'),
      sb.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      sb.from('project_notes').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(200),
    ])
    const L = (links || []) as any[], S = (steps || []) as any[]
    return {
      ...(p as any), links: L, steps: S, photos: photos || [], notes: notes || [],
      progress: progressOf(L, S), health: healthOf(p as any, S),
    }
  } catch { return null }
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
