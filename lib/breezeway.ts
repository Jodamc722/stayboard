// Breezeway public API client. Auth = client-credentials -> JWT (header is literally
// `Authorization: JWT <token>`, NOT Bearer). Credentials come from Vercel env:
//   BREEZEWAY_CLIENT_ID, BREEZEWAY_CLIENT_SECRET
// Request an account API key from Breezeway (Settings / API access form). The token
// endpoint is rate-limited to ~1 request/min, so the access token is cached in the
// warm lambda. Docs: https://developer.breezeway.io/
import { supabaseAdmin } from '@/lib/supabase-admin'

const AUTH = process.env.BREEZEWAY_AUTH_URL || 'https://api.breezeway.io/public/auth/v1'
const BASE = process.env.BREEZEWAY_BASE_URL || 'https://api.breezeway.io/public/inventory/v1'

let cached: { token: string; exp: number } | null = null

export function breezewayConfigured(): boolean {
  return !!(process.env.BREEZEWAY_CLIENT_ID && process.env.BREEZEWAY_CLIENT_SECRET)
}

export async function getBreezewayToken(force = false): Promise<string> {
  if (!force && cached && cached.exp > Date.now() + 60_000) return cached.token
// SHARED cross-lambda token cache (Supabase breezeway_token_cache). The token endpoint allows
// ~1 mint/min, so cold lambdas kept 429ing and the schedule lost assignees/sync badges.
if (!force) {
try {
const { data } = await supabaseAdmin().from('breezeway_token_cache').select('token,exp').eq('id', 1).limit(1)
const v: any = (data && data[0]) || null
if (v && v.token && Number(v.exp) > Date.now() + 60_000) { cached = { token: String(v.token), exp: Number(v.exp) }; return cached.token }
} catch { /* cache table optional */ }
}
  const id = process.env.BREEZEWAY_CLIENT_ID
  const secret = process.env.BREEZEWAY_CLIENT_SECRET
  if (!id || !secret) throw new Error('Breezeway not configured — add BREEZEWAY_CLIENT_ID and BREEZEWAY_CLIENT_SECRET in Vercel env.')
  const r = await fetch(`${AUTH}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret }),
    cache: 'no-store',
  })
  const text = await r.text().catch(() => '')
  if (!r.ok) throw new Error(`Breezeway auth ${r.status}: ${text.slice(0, 200)}`)
  let j: any = {}
  try { j = JSON.parse(text) } catch { throw new Error('Breezeway auth returned non-JSON.') }
  const token = j.access_token || j.token || j.accessToken
  if (!token) throw new Error('No access_token in Breezeway auth response.')
  cached = { token, exp: Date.now() + 23 * 3600 * 1000 } // tokens live ~24h
try { await supabaseAdmin().from('breezeway_token_cache').upsert({ id: 1, token, exp: cached.exp, updated_at: new Date().toISOString() }, { onConflict: 'id' }) } catch { /* cache table optional */ }
  return token
}

export async function bzApi(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const token = await getBreezewayToken()
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `JWT ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  const text = await r.text().catch(() => '')
  let data: any = null
  try { data = JSON.parse(text) } catch { /* leave null */ }
  return { ok: r.ok, status: r.status, data, text }
}

// Normalize a Breezeway task into the columns we store. Defensive — falls back across
// the documented field shapes so it survives minor API variation.
export function mapBreezewayTask(t: any) {
  const assignments = Array.isArray(t?.assignments) ? t.assignments : []
  const first = assignments[0] || {}
  const finishedBy = t?.finished_by || {}
  const dept = t?.type_department || t?.department || {}
  const status = t?.type_task_status || t?.status || {}
  const totalTime = String(t?.total_time || '')
  // total_time is "H:MM:SS"; convert to minutes.
  let totalMinutes: number | null = null
  const parts = totalTime.split(':').map((x: string) => Number(x))
  if (parts.length === 3 && parts.every((n: number) => Number.isFinite(n))) totalMinutes = Math.round(parts[0] * 60 + parts[1] + parts[2] / 60)
  return {
    id: String(t?.id ?? t?._id ?? ''),
    home_id: t?.home_id ?? null,
    reference_property_id: t?.reference_property_id ?? null,
    type_department: String((typeof dept === 'object' ? dept.name || dept.code : dept) || '').toLowerCase() || null,
    name: t?.name || null,
    status: String((typeof status === 'object' ? status.code || status.name : status) || '').toLowerCase() || null,
    assignee_id: first.assignee_id ?? first.id ?? null,
    assignee_name: first.name ?? null,
    assignee_count: assignments.length,
    assignees: assignments.map((a: any) => ({ id: a?.assignee_id ?? a?.id ?? null, name: a?.name ?? null })).filter((a: any) => a.id || a.name),
    finished_by_id: finishedBy?.id ?? null,
    finished_by_name: finishedBy?.name ?? null,
    started_at: t?.started_at ?? null,
    finished_at: t?.finished_at ?? null,
    total_time: totalTime || null,
    total_minutes: totalMinutes,
    rate_paid: t?.rate_paid ?? null,
    scheduled_date: t?.scheduled_date ?? null,
    linked_reservation_id: t?.linked_reservation?.external_reservation_id ? String(t.linked_reservation.external_reservation_id) : null,
    report_url: t?.report_url ?? t?.task_report_url ?? null,
    raw: t,
  }
}

// Create a task in Breezeway (POST /task). `body.name` is required; pass home_id (preferred,
// integer) or reference_property_id. Returns the standard bzApi result; the created task is in
// `.data` with id, type_task_status, report_url, scheduled_date, assignments.
export async function createBreezewayTask(body: Record<string, any>): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  return bzApi('/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

// TASK TEMPLATES — the formats our team actually works to (preventative maintenance, field
// report, the inspection checklists). Breezeway documents these at
//   https://developer.breezeway.io/reference/list-available-templates
// Templates are what makes a created task carry OUR checklist instead of a bare title, so the
// Add-task sheet in Today in Ops reads this and passes template_id back on create.
//
// WHY THIS PROBES INSTEAD OF CALLING ONE PATH. Breezeway publishes the endpoint but not its
// response schema, and their other list endpoints disagree with each other about shape (/people
// returns a bare array, some return {results}, some {data}). Rather than pick one guess and have
// the picker silently come back empty in production, this walks a short list of candidates and
// keeps the first that yields usable rows — then remembers which one won. The unwrapping is
// equally forgiving for the same reason.
//
// An empty result is NOT an error state: the Add-task sheet falls back to its built-in presets, so
// the worst case is the sheet behaving exactly as it did before templates existed.
//
// Cached in-module for 10 minutes: the list changes when somebody edits a template in Breezeway,
// which is a monthly event, not a per-request one — and the ops board opens this on every mount.
export type BzTemplate = { id: number; name: string; department: string; description: string }
export type BzTemplateProbe = { path: string; status: number; count: number; keys: string[]; sample: string }
const TPL_PATHS = ['/companies/templates', '/companies/templates?limit=200', '/templates', '/template']
let TPL_CACHE: { at: number; list: BzTemplate[]; probes: BzTemplateProbe[] } | null = null

/** Pull the rows out of whichever envelope Breezeway used. */
function tplRows(d: any): any[] {
  if (Array.isArray(d)) return d
  for (const k of ['results', 'data', 'templates', 'items', 'records']) {
    if (Array.isArray(d?.[k])) return d[k]
  }
  return []
}
function tplDept(t: any): string {
  const s = String(t?.type_department?.code ?? t?.type_department?.name ?? t?.type_department ?? t?.department ?? '').toLowerCase()
  if (/housekeep|clean/.test(s)) return 'housekeeping'
  if (/maint/.test(s)) return 'maintenance'
  if (/inspect/.test(s)) return 'inspection'
  if (/safe/.test(s)) return 'safety'
  return ''
}

export async function listBreezewayTemplates(force = false): Promise<BzTemplate[]> {
  return (await probeBreezewayTemplates(force)).list
}

/**
 * The same fetch, with the evidence attached. The API route exposes the probe behind ?debug=1 so
 * that "the picker is empty" is a two-second diagnosis — which path was tried, what came back —
 * instead of a round trip through a deploy.
 */
export async function probeBreezewayTemplates(force = false): Promise<{ list: BzTemplate[]; probes: BzTemplateProbe[]; path: string }> {
  if (!force && TPL_CACHE && Date.now() - TPL_CACHE.at < 10 * 60_000) {
    return { list: TPL_CACHE.list, probes: TPL_CACHE.probes, path: TPL_CACHE.probes.find(p => p.count > 0)?.path || '' }
  }
  const probes: BzTemplateProbe[] = []
  let list: BzTemplate[] = []
  let won = ''
  for (const path of TPL_PATHS) {
    let r: { ok: boolean; status: number; data: any; text: string }
    try { r = await bzApi(path) } catch (e: any) { probes.push({ path, status: 0, count: 0, keys: [], sample: String(e?.message || e).slice(0, 200) }); continue }
    const rows = r.ok ? tplRows(r.data) : []
    const first = rows[0]
    probes.push({
      path, status: r.status, count: rows.length,
      keys: first && typeof first === 'object' ? Object.keys(first).slice(0, 20) : [],
      sample: (r.ok ? JSON.stringify(first ?? r.data) : String(r.text || '')).slice(0, 300),
    })
    if (!rows.length) continue
    const mapped = rows
      .map((t: any) => ({
        id: Number(t?.id ?? t?.template_id ?? t?.templateId),
        name: String(t?.name ?? t?.title ?? t?.template_name ?? t?.templateName ?? '').trim(),
        department: tplDept(t),
        description: String(t?.description ?? t?.details ?? t?.instructions ?? '').trim().slice(0, 600),
      }))
      .filter((t: BzTemplate) => Number.isFinite(t.id) && t.id > 0 && !!t.name)
    if (!mapped.length) continue
    // De-dupe by id: a paged endpoint that ignores `limit` can repeat rows.
    const seen: Record<number, true> = {}
    list = mapped.filter(t => (seen[t.id] ? false : (seen[t.id] = true)))
      .sort((a: BzTemplate, b: BzTemplate) => a.name.localeCompare(b.name))
    won = path
    break
  }
  // A blip must not wipe a good list — serve the last one we had.
  if (!list.length && TPL_CACHE && TPL_CACHE.list.length) return { list: TPL_CACHE.list, probes, path: '' }
  TPL_CACHE = { at: Date.now(), list, probes }
  return { list, probes, path: won }
}

// Retrieve a single task by id (for status tracking / "action taken").
export async function retrieveBreezewayTask(taskId: string | number): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  return bzApi(`/task/${encodeURIComponent(String(taskId))}`)
}

// Normalize a Breezeway task status object to our lifecycle.
export function normalizeTaskStatus(t: any): 'created' | 'in_progress' | 'completed' | 'approved' {
  const st = t?.type_task_status || {}
  const code = String(st.code || st.name || '').toLowerCase()
  const stage = String(st.stage || '').toLowerCase()
  if (code.includes('approv')) return 'approved'
  if (t?.finished_at || code.includes('close') || code.includes('complet') || code.includes('finish') || stage === 'done') return 'completed'
  if (t?.started_at || stage === 'in_progress' || code.includes('progress')) return 'in_progress'
  return 'created'
}

// Active people (assignable team members). Names are first_name + last_name; type_departments
// says which activities they do; groups[] are their regions. Used for task assignment.
export async function listBreezewayPeople(): Promise<{ id: number; name: string; departments: string[]; region: string | null; role: string | null }[]> {
  const r = await bzApi('/people?status=active&limit=300')
  if (!r.ok) return []
  const arr = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.results) ? r.data.results : (Array.isArray(r.data?.data) ? r.data.data : []))
  return arr.filter((p: any) => p && (p.active !== false)).map((p: any) => ({
    id: Number(p.id),
    name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || `Person ${p.id}`,
    departments: Array.isArray(p.type_departments) ? p.type_departments.map((d: any) => String(d).toLowerCase()) : [],
    region: Array.isArray(p.groups) && p.groups[0]?.name ? String(p.groups[0].name) : null,
    role: p.type_role || null,
  })).filter((p: any) => Number.isFinite(p.id))
}

// Update a task (used to reassign people). Body e.g. { assignments: [personId, ...] }.
export async function updateBreezewayTask(taskId: string | number, body: Record<string, any>): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  // PATCH is the documented update method. `assignments` is a full array of person IDs and REPLACES
  // the task's current assignees (override, not append) — so re-pushing a different cleaner swaps them.
  return bzApi(`/task/${encodeURIComponent(String(taskId))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

// Best-effort: mark a Breezeway task complete. The exact completion enum is not documented for our
// instance, so we attempt a status update and tolerate failure - the app record is the master.
export async function completeBreezewayTask(taskId: string | number): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  return bzApi(`/task/${encodeURIComponent(String(taskId))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type_task_status: { code: 'complete' } }) })
}

// Housekeeping tasks for ONE property over a scheduled-date window (YYYY-MM-DD). Breezeway requires
// a property scope, so the schedule resolves cleans per-property on demand to find the auto-created
// departure clean for a unit + checkout date (to assign a cleaner + write notes/door code).
// TASK COMMENTS — Breezeway's own comment thread on a task (GET/POST /task/{id}/comments).
// This is what the field crew reads and replies to in their app, so app comments post here
// (not into the description) and their replies come back to us.
// Mentions arrive encoded as {{personId,Person Name}} - strip to a readable @Name.
export function cleanBreezewayComment(s: any): string {
  return String(s == null ? '' : s).replace(/\{\{\s*\d+\s*,\s*([^}]+)\}\}/g, (_m, nm) => '@' + String(nm).trim().replace(/\s+/g, ' ')).trim()
}

export async function listBreezewayComments(taskId: string | number): Promise<{ ok: boolean; comments: { id: string; body: string; at: string }[] }> {
  const r = await bzApi('/task/' + encodeURIComponent(String(taskId)) + '/comments')
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, comments: [] }
  const comments = (r.data as any[]).map(x => ({
    id: String(x.id ?? ''),
    body: cleanBreezewayComment(x.comment ?? x.body ?? x.text),
    at: String(x.created_at ?? x.createdAt ?? ''),
  })).filter(x => x.body)
  return { ok: true, comments }
}

// Breezeway REQUIRES company_people_id on a comment (422 without it) - a comment belongs to a
// person, not to an app. We map the StayBoard user to their Breezeway person: their profile name
// or the email prefix, matched against the people list. app_settings can pin a fallback person
// for staff who have no Breezeway account (see resolveCommentPerson in the comments route).
let _peopleCache: { at: number; list: { id: number; name: string }[] } | null = null
export async function breezewayPeopleLite(): Promise<{ id: number; name: string }[]> {
  if (_peopleCache && Date.now() - _peopleCache.at < 10 * 60 * 1000) return _peopleCache.list
  try {
    const list = (await listBreezewayPeople()).map(p => ({ id: p.id, name: p.name }))
    _peopleCache = { at: Date.now(), list }
    return list
  } catch { return _peopleCache ? _peopleCache.list : [] }
}

function normPerson(s: any): string { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim() }

/**
 * Best-effort match of a person NAME (or an email prefix like "jon.doe") to a Breezeway person id.
 *
 * THE BUG THIS FIXES (2026-07-31): Jon's app profile says "Jonathan McGill", Breezeway says
 * "Jon McGill". The old rule required the Breezeway name to START WITH the app first name, so
 * "jon mcgill" failed against "jonathan…" — no person id, the comment POST was rejected, and every
 * comment silently fell back to stamping the task description. People shorten their own first name
 * all the time, so the surname decides and the first name only has to be a shortening either way.
 */
export async function matchBreezewayPerson(nameOrEmail: string): Promise<number | null> {
  const raw = String(nameOrEmail || '')
  const guess = normPerson(raw.includes('@') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw)
  if (!guess) return null
  const people = await breezewayPeopleLite()
  if (!people.length) return null
  const exact = people.find(p => normPerson(p.name) === guess)
  if (exact) return exact.id
  const parts = guess.split(' ').filter(Boolean)
  const first = parts[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  // "jon" vs "jonathan" — either one being a prefix of the other counts as the same first name
  const sameFirst = (a: string, b: string) => !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a))
  if (last) {
    const nameParts = (p: { name: string }) => normPerson(p.name).split(' ').filter(Boolean)
    const both = people.filter(p => { const n = nameParts(p); return n.length > 1 && n[n.length - 1] === last && sameFirst(n[0], first) })
    if (both.length === 1) return both[0].id
    const byLast = people.filter(p => { const n = nameParts(p); return n.length > 1 && n[n.length - 1] === last })
    if (byLast.length === 1) return byLast[0].id   // one person with that surname — unambiguous
  }
  if (!last && first.length > 2) {
    const hits = people.filter(p => sameFirst(normPerson(p.name).split(' ')[0], first))
    if (hits.length === 1) return hits[0].id   // only when the first name is unambiguous
  }
  return null
}

/** The name of a Breezeway person, for showing the operator who they are posting as. */
export async function breezewayPersonName(id: number | null | undefined): Promise<string | null> {
  if (!Number.isFinite(Number(id))) return null
  const people = await breezewayPeopleLite()
  const hit = people.find(p => p.id === Number(id))
  return hit ? hit.name : null
}

/**
 * Breezeway encodes an @mention inside the comment text as `{{personId,Person Name}}` — that is
 * exactly what their API hands back on read, so we write the same token to tag someone.
 */
export function breezewayMention(id: number | string, name: string): string {
  return '{{' + Number(id) + ',' + String(name || '').trim().replace(/[{}]/g, '') + '}}'
}

export async function createBreezewayComment(taskId: string | number, body: string, companyPeopleId?: number | null): Promise<{ ok: boolean; status: number; text: string; path: string }> {
  const payload: Record<string, any> = { comment: String(body).slice(0, 2000) }
  if (Number.isFinite(Number(companyPeopleId))) payload.company_people_id = Number(companyPeopleId)
  const enc = encodeURIComponent(String(taskId))
  // The documented path is /task/{id}/comments. It has answered 404 on some tasks, so a
  // route-shaped rejection (404/405) falls through to the known variants. A REAL rejection
  // (422 missing field, 400 bad payload) stops immediately — repeating it would only risk
  // posting the same comment twice.
  const paths = ['/task/' + enc + '/comments', '/task/' + enc + '/comments/', '/task/' + enc + '/comment']
  let last = { ok: false, status: 0, text: '', path: '' }
  for (const p of paths) {
    const r = await bzApi(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    last = { ok: r.ok, status: r.status, text: r.text, path: p }
    if (r.ok) return last
    if (r.status !== 404 && r.status !== 405) return last
  }
  return last
}

export async function listPropertyHousekeeping(refId: string, from: string, to: string) {
  // Prefer Breezeway's own home_id (resolved from our property map) — the reference_property_id
  // filter on their /task endpoint misses some properties (e.g. Oasis) that home_id finds fine.
  let q = `reference_property_id=${encodeURIComponent(refId)}`
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', refId).limit(1)
    const n = Number((data || [])[0]?.home_id)
    if (Number.isFinite(n)) q = `home_id=${n}`
  } catch { /* fall back to reference id */ }
  const r = await bzApi(`/task/?${q}&type_department=housekeeping&scheduled_date=${from},${to}&limit=100`)
  if (!r.ok) return [] as ReturnType<typeof mapBreezewayTask>[]
  const arr = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.results) ? r.data.results : (Array.isArray(r.data?.data) ? r.data.data : []))
  return arr.map(mapBreezewayTask)
}

// Pick the DEPARTURE clean from a housekeeping task list (falls back to any clean on the date).
// WHAT IS A DEPARTURE CLEAN? One answer, used by the scheduler, the day sheet and the live lookup.
//
// The scheduler is the departure-clean board and nothing else — Jon: "it is extremely important that
// departure cleans are managed there, with no other tasks, because it creates confusion." The old
// test was /depart|clean|turn/, which matches ANY housekeeping task with the word clean in it, so
// "Oven deep cleaning" on 17WEST 505 became a departure clean on the board. So did "Refresh clean",
// "Re Cleans || Guest Complaint (Occupied)" and "Exterior Walkthrough / Cleaning common areas".
//
// Checked against live data: every genuine departure clean in the portfolio is named "Departure
// Clean Checklist" (sometimes with notes appended). So the rule is that the name must SAY it is the
// turnover. Anything else a housekeeper does is real work, it just does not belong on this board.
const SAYS_TURNOVER = /departur|turnover|check-?out clean|move-?out clean|limpieza de salida/i
const NOT_THE_TURNOVER = /strip|walk-?through|inspect|unit check/i

export function isDepartureCleanName(name: any): boolean {
  const n = String(name || '')
  if (!n.trim()) return false
  if (SAYS_TURNOVER.test(n)) return true          // says departure -> it is one, appended notes are fine
  return false                                     // everything else stays off the board
}
/** Kept separate: strip/walkthrough/inspection are never the clean even if adopted as a fallback. */
export function isPrepTaskName(name: any): boolean { return NOT_THE_TURNOVER.test(String(name || '')) }

export function pickDepartureClean(tasks: ReturnType<typeof mapBreezewayTask>[], date: string) {
  const onDate = tasks.filter(t => String(t.scheduled_date || '').slice(0, 10) === date)
  // Never treat strip/walkthrough/inspection tasks as the departure clean. If the real
  // departure clean was moved off this date, return null so the board can flag the move.
  const eligible = onDate.filter(t => !isPrepTaskName(t.name))
  // The old second fallback was /clean|turnover|turn/ — that is how an oven clean got adopted as the
  // departure clean on the day view. There is no loose fallback any more.
  return eligible.find(t => isDepartureCleanName(t.name)) || null
}
