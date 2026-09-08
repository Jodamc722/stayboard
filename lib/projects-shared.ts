// PROJECTS — THE PARTS BOTH SIDES OF THE WIRE NEED.
//
// Types, constants, the privacy rule and the pure helpers. No imports of anything that touches the
// database or the environment, so the project page (a client component) can use the same
// definitions the API does. lib/projects.ts is server-only and re-exports everything here, so
// nothing that imported from there had to change.
//
// The split exists for the same reason lib/person-name.ts does: a rule that lives only where the
// browser cannot reach it gets re-implemented in the browser, and the two drift.
import { personKey, nameMatches, nameTokens, norm } from './person-name'

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

export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const
export type TaskStatus = typeof TASK_STATUSES[number]
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'Doing', blocked: 'Blocked', done: 'Done' }
export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const

export type Person = { person_key: string; display: string; email: string | null }
export type Member = Person & { id: string; project_id: string; role: string; notify: any; added_by: string | null; created_at: string }
export type Task = {
  id: string; project_id: string; title: string; description: string | null
  status: TaskStatus; done: boolean; section: string | null; parent_id: string | null
  priority: string; due_on: string | null; sort: number | null
  done_at: string | null; done_by: string | null; created_by: string | null
  created_at: string; updated_at: string
  /** Kept in sync with the first assignee for old readers; never the source of truth. */
  assignee: string | null
  assignees: Person[]
  subtasks: Task[]
}

// ── COMMENTS, EVENTS AND FILES (Wave 2) ──────────────────────────────────────────────────────────
// One stream holds both what people SAID (kind=comment) and what people DID (kind=event). An event
// carries `meta` so the feed can render it with the task linked instead of parsing prose. Both can
// point at a task; a null task_id is project-level.
export type EventType =
  | 'task_added' | 'task_status' | 'task_assigned' | 'task_due' | 'task_deleted' | 'task_moved'
  | 'member_added' | 'member_removed' | 'member_role' | 'link' | 'unlink' | 'file_added' | 'file_removed'
  | 'spend' | 'stage' | 'photo'
export type Note = {
  id: string; project_id: string; task_id: string | null
  kind: 'comment' | 'event'; body: string; author: string | null
  via_share: boolean; created_at: string; edited_at: string | null
  meta: null | { type: EventType; task_id?: string; task_title?: string; from?: string | null; to?: string | null; who?: string[]; name?: string }
}
export type ProjectFile = {
  id: string; project_id: string; task_id: string | null
  kind: 'photo' | 'file'; url: string; name: string | null; mime: string | null; bytes: number | null
  caption: string | null; phase: string; uploaded_by: string | null; via_share: boolean
  storage_path: string | null; created_at: string
}
export const isImage = (f: { mime?: string | null; kind?: string | null; url?: string }) =>
  f.kind === 'photo' || /^image\//.test(String(f.mime || '')) || /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(String(f.url || ''))
export const fmtBytes = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(Number(n))) return ''
  const b = Number(n)
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}
/** "just now", "4m", "3h", "2d", else a short date. Feeds read better in relative time. */
export const ago = (iso: string, now = Date.now()) => {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd'
  try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(t)) } catch { return iso.slice(0, 10) }
}

// ── NOTIFICATIONS (Wave 3) ──────────────────────────────────────────────────────────────────────
export type NotifyType = 'assigned' | 'mentioned' | 'comment' | 'added' | 'due_soon' | 'overdue'
export type Notification = {
  id: string; project_id: string; task_id: string | null; note_id: string | null
  email: string; type: NotifyType; title: string; body: string | null; url: string; actor: string | null
  created_at: string; read_at: string | null; emailed_at: string | null; digested_at: string | null
}
/** What a member gets EMAILED about. The bell in the app shows everything regardless. */
export type NotifyPrefs = { assigned: boolean; mentions: boolean; comments: boolean; digest: boolean }
export const DEFAULT_PREFS: NotifyPrefs = { assigned: true, mentions: true, comments: true, digest: true }
export const prefsOf = (raw: any): NotifyPrefs => ({
  assigned: raw?.assigned !== false, mentions: raw?.mentions !== false, comments: raw?.comments !== false, digest: raw?.digest !== false,
})

// ── @MENTIONS ───────────────────────────────────────────────────────────────────────────────────
// "@Roberto can you look at 407" — the name after the @ is matched against the project's members
// with the shared name matcher, so @roberto, @Roberto Diaz and @Diaz all reach the same person and
// a typo does not silently reach nobody. Longest candidate first: "@Luis Mendez" must not stop at
// "@Luis" when there are two Luises.
export function parseMentions<M extends { display: string; email?: string | null; person_key?: string }>(body: string, members: M[]): M[] {
  const out: M[] = []
  const seen = new Set<string>()
  const re = /(^|[^\w@])@([A-Za-zÀ-ɏ][\wÀ-ɏ.'-]*(?:\s+[A-Za-zÀ-ɏ][\wÀ-ɏ.'-]*){0,2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(body || '')))) {
    const words = m[2].split(/\s+/)
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const cand = words.slice(0, n).join(' ')
      // Exact-ish first (nameMatches forgives a typo and accepts first-name-only), but a lone
      // first name that fits two members is ambiguous and reaches neither — better silent than wrong.
      const hits = members.filter(x => nameMatches(cand, x.display)
        || (x.email && cand.toLowerCase() === x.email.split('@')[0].toLowerCase())
        // "@Diaz" — a lone surname is how half the crew refers to the other half.
        || (n === 1 && nameTokens(x.display).length > 1 && nameTokens(x.display).slice(-1)[0] === norm(cand)))
      if (hits.length === 1) {
        const h = hits[0]
        const k = h.person_key || h.email || h.display
        if (!seen.has(k)) { seen.add(k); out.push(h) }
        break
      }
      if (hits.length > 1 && n === 1) break
    }
  }
  return out
}

export type ProjectFull = Project & {
  private: boolean; kind: string; template_key: string | null; recurs: any
  links: any[]; steps: any[]; photos: ProjectFile[]; notes: Note[]
  members: Member[]
  tasks: Task[]
  progress: ReturnType<typeof progressOf>; health: ReturnType<typeof healthOf>
}

// ── WHO CAN SEE A PROJECT ───────────────────────────────────────────────────────────────────────
// Jon chose "members only, plus owner" (2026-09-08). A project is visible to the people on its
// members list and to the superadmin, and to nobody else. Not the lead, not "admins", not
// "everyone with board access" — those were the two looser options and he turned them down,
// because a one-on-one about Roberto can hold notes about Roberto.
//
// So this is the ONLY rule, and every read path goes through it. There is no second code path that
// lists projects without asking.
export type Viewer = { email: string | null; superadmin: boolean }

export function canSee(members: { email?: string | null; person_key?: string | null }[], viewer: Viewer): boolean {
  if (viewer.superadmin) return true
  const e = String(viewer.email || '').trim().toLowerCase()
  if (!e) return false
  return members.some(m => String(m.email || '').trim().toLowerCase() === e)
}

export function canEdit(members: { email?: string | null; role?: string | null }[], viewer: Viewer): boolean {
  if (viewer.superadmin) return true
  const e = String(viewer.email || '').trim().toLowerCase()
  if (!e) return false
  const m = members.find(x => String(x.email || '').trim().toLowerCase() === e)
  return !!m && (m.role === 'owner' || m.role === 'editor')
}

/** Resolve a typed name or email into the shape the members and assignees tables want. */
export function toPerson(raw: string): Person {
  const display = String(raw || '').replace(/\s+/g, ' ').trim()
  const isEmail = /@/.test(display)
  return {
    person_key: isEmail ? display.toLowerCase() : personKey(display),
    display,
    email: isEmail ? display.toLowerCase() : null,
  }
}

/** Nest flat task rows: top-level tasks carry their subtasks. Order within a level is sort, then created. */
export function nestTasks(rows: any[], assigneesByTask: Record<string, Person[]>): Task[] {
  const byId: Record<string, Task> = {}
  const order = (a: any, b: any) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || String(a.created_at).localeCompare(String(b.created_at))
  for (const r of rows) {
    byId[r.id] = { ...r, status: TASK_STATUSES.includes(r.status) ? r.status : (r.done ? 'done' : 'todo'), assignees: assigneesByTask[r.id] || [], subtasks: [] }
  }
  const top: Task[] = []
  for (const r of rows.slice().sort(order)) {
    const t = byId[r.id]
    if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].subtasks.push(t)
    else top.push(t)
  }
  return top
}
