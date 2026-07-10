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

// Housekeeping tasks for ONE property over a scheduled-date window (YYYY-MM-DD). Breezeway requires
// a property scope, so the schedule resolves cleans per-property on demand to find the auto-created
// departure clean for a unit + checkout date (to assign a cleaner + write notes/door code).
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
export function pickDepartureClean(tasks: ReturnType<typeof mapBreezewayTask>[], date: string) {
  const onDate = tasks.filter(t => String(t.scheduled_date || '').slice(0, 10) === date)
  // Never treat strip/walkthrough/inspection tasks as the departure clean. If the real
  // departure clean was moved off this date, return null so the board can flag the move.
  const eligible = onDate.filter(t => !/strip|walkthrough|inspect/i.test(String(t.name || '')))
  return eligible.find(t => /departure/i.test(String(t.name || '')) && /clean/i.test(String(t.name || '')))
    || eligible.find(t => /clean|turnover|turn/i.test(String(t.name || '')))
    || null
}
