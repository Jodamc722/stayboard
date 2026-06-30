// Breezeway public API client. Auth = client-credentials -> JWT (header is literally
// `Authorization: JWT <token>`, NOT Bearer). Credentials come from Vercel env:
//   BREEZEWAY_CLIENT_ID, BREEZEWAY_CLIENT_SECRET
// Request an account API key from Breezeway (Settings / API access form). The token
// endpoint is rate-limited to ~1 request/min, so the access token is cached in the
// warm lambda. Docs: https://developer.breezeway.io/
const AUTH = process.env.BREEZEWAY_AUTH_URL || 'https://api.breezeway.io/public/auth/v1'
const BASE = process.env.BREEZEWAY_BASE_URL || 'https://api.breezeway.io/public/inventory/v1'

let cached: { token: string; exp: number } | null = null

export function breezewayConfigured(): boolean {
  return !!(process.env.BREEZEWAY_CLIENT_ID && process.env.BREEZEWAY_CLIENT_SECRET)
}

export async function getBreezewayToken(force = false): Promise<string> {
  if (!force && cached && cached.exp > Date.now() + 60_000) return cached.token
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
  return bzApi(`/task/${encodeURIComponent(String(taskId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
