// THE GARDEN HOTEL'S HOMEBASE (Jon, 2026-09-29: "Garden uses Homebase for non-W2 contract labor just
// like us… make sure we have Homebase connectors as well").
//
// Two ways the hotel can be on Homebase, and both work:
//   own account     GARDEN_HOMEBASE_API_KEY is set → the hotel's own company; every location it sees
//                   is the hotel's (or pick some).
//   shared account  no hotel key → HOMEBASE_API_KEY (Stay's account); the hotel is one or more
//                   LOCATIONS in it, picked in Users & admin → Settings → Homebase. Picked locations
//                   are then LEFT OUT of the Stay Hospitality labor numbers (lib/homebase
//                   getLocationUuids), so a hotel housekeeper never lands in VR cost per clean.
//
// What it mirrors, into garden_* only: employees (matched to the hotel's staff roster by Homebase id,
// email, then name) and timecards (garden_timecards, one row per punch). Read-only — nothing is
// written back to Homebase.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getSetting, setSetting } from '../app-settings'
import { fetchWithTimeout } from '../fetch-timeout'

const BASE = process.env.HOMEBASE_BASE_URL || 'https://app.joinhomebase.com/api/public'
export const HB_KEY = 'garden_homebase'
export type GardenHbSettings = { locationUuids: string[]; lookbackDays: number; enabled: boolean }
const DEFAULTS: GardenHbSettings = { locationUuids: [], lookbackDays: 3, enabled: true }

type Json = any
const pick = (o: Json, ...ks: string[]) => { for (const k of ks) if (o?.[k] != null && o[k] !== '') return o[k]; return null }
const num = (v: Json): number | null => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }
const arr = (d: Json): Json[] => { if (Array.isArray(d)) return d; for (const k of ['data', 'locations', 'employees', 'timecards', 'results']) if (Array.isArray(d?.[k])) return d[k]; return [] }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function hbMode(): { mode: 'own' | 'shared' | 'none'; env: string | null } {
  if (process.env.GARDEN_HOMEBASE_API_KEY) return { mode: 'own', env: 'GARDEN_HOMEBASE_API_KEY' }
  if (process.env.HOMEBASE_API_KEY || process.env['Homebase_Secret_id']) return { mode: 'shared', env: 'HOMEBASE_API_KEY' }
  return { mode: 'none', env: null }
}
const key = () => process.env.GARDEN_HOMEBASE_API_KEY || process.env.HOMEBASE_API_KEY || process.env['Homebase_Secret_id'] || ''

async function hb(path: string): Promise<Json> {
  const k = key()
  if (!k) throw new Error('No Homebase key — set GARDEN_HOMEBASE_API_KEY (the hotel\'s own account) or HOMEBASE_API_KEY in Vercel.')
  const r = await fetchWithTimeout(`${BASE}${path}`, { headers: { Authorization: `Bearer ${k}`, Accept: 'application/vnd.homebase-v1+json' }, cache: 'no-store' }, { label: `Homebase(garden) ${path.split('?')[0]}` })
  if (!r.ok) throw new Error(`Homebase ${r.status} on ${path.split('?')[0]}`)
  return r.json()
}
async function paged(path: string, cap = 15): Promise<Json[]> {
  const out: Json[] = []
  for (let page = 1; page <= cap; page++) {
    const batch = arr(await hb(`${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=100`))
    out.push(...batch)
    if (batch.length < 100) return out
    await sleep(120)
  }
  throw new Error(`Homebase pagination cap hit on ${path.split('?')[0]}`)
}

export async function gardenHbSettings(): Promise<GardenHbSettings> {
  const s = await getSetting<any>(HB_KEY, null).catch(() => null)
  return { ...DEFAULTS, ...(s || {}), locationUuids: Array.isArray(s?.locationUuids) ? s.locationUuids.map(String) : [] }
}
export async function saveGardenHbSettings(patch: Partial<GardenHbSettings>, by: string) {
  const cur = await gardenHbSettings()
  const next = { ...cur, ...patch }
  if (patch.lookbackDays != null) next.lookbackDays = Math.min(31, Math.max(1, Math.round(Number(patch.lookbackDays) || 3)))
  await setSetting(HB_KEY, next, by)
  return next
}

/** Every location the key can see, with its name — for the picker. */
export async function listHbLocations(): Promise<{ uuid: string; name: string }[]> {
  return arr(await hb('/locations')).map((l: Json) => ({ uuid: String(pick(l, 'uuid', 'id', 'location_uuid') || ''), name: String(pick(l, 'name', 'display_name', 'address') || 'Location') })).filter(l => l.uuid)
}

/** The locations that are the hotel's. Own account with none picked → all; shared → only picked. */
export async function gardenLocations(): Promise<string[]> {
  const s = await gardenHbSettings()
  if (s.locationUuids.length) return s.locationUuids
  if (hbMode().mode === 'own') return (await listHbLocations()).map(l => l.uuid)
  return []
}

export async function pullHbEmployees(): Promise<{ matched: number; total: number; unmatched: string[] }> {
  const db = supabaseAdmin()
  const locs = await gardenLocations()
  if (!locs.length) throw new Error('Pick the hotel\'s Homebase location first (Users & admin → Settings → Homebase).')
  const seen = new Set<string>(), people: Json[] = []
  for (const loc of locs) {
    let batch: Json[] = []
    try { batch = await paged(`/locations/${loc}/employees?with_archived=true`) } catch { batch = await paged(`/locations/${loc}/employees`) }
    for (const e of batch) { const id = String(pick(e, 'uuid', 'id', 'employee_id') || ''); if (id && seen.has(id)) continue; if (id) seen.add(id); people.push(e) }
  }
  const { data: staff } = await db.from('garden_staff').select('id,name,email,homebase_id')
  const S = (staff || []) as any[]
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  let matched = 0; const unmatched: string[] = []
  for (const e of people) {
    const id = String(pick(e, 'uuid', 'id', 'employee_id') || '')
    const name = (String(pick(e, 'name', 'full_name') || '') || [pick(e, 'first_name'), pick(e, 'last_name')].filter(Boolean).join(' ')).trim()
    const email = String(pick(e, 'email', 'email_address') || '').toLowerCase() || null
    let wage = num(pick(e, 'wage_rate', 'default_wage_rate', 'hourly_rate', 'wage'))
    for (const k of ['roles', 'job_roles', 'wages']) for (const r of (Array.isArray(e?.[k]) ? e[k] : [])) { const w = num(pick(r, 'wage_rate', 'wage', 'rate')); if (w != null && (wage == null || w > wage)) wage = w }
    const hit = S.find(s => s.homebase_id === id) || (email ? S.find(s => (s.email || '').toLowerCase() === email) : null) || S.find(s => norm(s.name) === norm(name))
    if (hit) { matched++; await db.from('garden_staff').update({ homebase_id: id, wage_rate: wage, employment: 'contract' }).eq('id', hit.id) }
    else if (name) unmatched.push(name)
  }
  return { matched, total: people.length, unmatched: unmatched.slice(0, 40) }
}

/** Pull punches for [from, to] a week at a time, every hotel location, into garden_timecards. */
export async function pullHbTimecards(from: string, to: string): Promise<{ cards: number; failedWeeks: string[] }> {
  const db = supabaseAdmin()
  const locs = await gardenLocations()
  if (!locs.length) throw new Error('Pick the hotel\'s Homebase location first (Users & admin → Settings → Homebase).')
  const { data: staff } = await db.from('garden_staff').select('id,homebase_id')
  const byHb: Record<string, string> = {}; for (const s of ((staff || []) as any[])) if (s.homebase_id) byHb[s.homebase_id] = s.id
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const rows: any[] = [], failedWeeks: string[] = []
  for (let a = Date.parse(from + 'T12:00:00Z'); a <= Date.parse(to + 'T12:00:00Z'); a += 7 * 864e5) {
    const wa = iso(a), wb = iso(Math.min(a + 6 * 864e5, Date.parse(to + 'T12:00:00Z')))
    try {
      for (const loc of locs) for (const t of await paged(`/locations/${loc}/timecards?start_date=${wa}&end_date=${wb}`)) {
        const emp = pick(t, 'employee', 'user') || {}
        const empId = String(pick(t, 'employee_id', 'user_id') || pick(emp, 'id', 'uuid') || '')
        const name = String(pick(t, 'employee_name', 'name') || pick(emp, 'name', 'full_name') || [pick(t, 'first_name') || pick(emp, 'first_name'), pick(t, 'last_name') || pick(emp, 'last_name')].filter(Boolean).join(' ') || '').trim()
        const clockIn = pick(t, 'clock_in', 'clock_in_at', 'start_at'), clockOut = pick(t, 'clock_out', 'clock_out_at', 'end_at')
        const lab = pick(t, 'labor') || {}
        let hours = num(pick(lab, 'paid_hours')) ?? num(pick(t, 'hours', 'total_hours', 'worked_hours'))
        if (hours == null && clockIn && clockOut) hours = Math.round((Date.parse(clockOut) - Date.parse(clockIn)) / 36e3) / 100
        const wage = num(pick(lab, 'wage_rate')) ?? num(pick(t, 'wage_rate', 'wage'))
        const cost = num(pick(lab, 'costs')) ?? num(pick(t, 'labor_cost', 'estimated_wages')) ?? (wage != null && hours != null ? Math.round(wage * hours * 100) / 100 : null)
        const id = String(pick(t, 'id', 'uuid') || `${empId || name}:${clockIn}`)
        const date = clockIn ? new Date(clockIn).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : (pick(t, 'date') || wa)
        rows.push({ id, location_uuid: loc, homebase_employee_id: empId || null, staff_id: byHb[empId] || null, name, role: pick(t, 'role', 'job_title') || pick(emp, 'role') || null, date, clock_in: clockIn, clock_out: clockOut, hours, wage_rate: wage, labor_cost: cost, open: !!clockIn && !clockOut, synced_at: new Date().toISOString() })
      }
    } catch (e: any) { failedWeeks.push(`${wa}..${wb}: ${String(e?.message || e).slice(0, 80)}`) }
    await sleep(150)
  }
  for (let i = 0; i < rows.length; i += 400) await db.from('garden_timecards').upsert(rows.slice(i, i + 400), { onConflict: 'id' })
  return { cards: rows.length, failedWeeks }
}

async function mark(entity: string, ok: { count?: number } | { error: string }) {
  const row: any = { entity, last_sync_at: new Date().toISOString() }
  if ('error' in ok) row.last_error = ok.error.slice(0, 500); else { row.last_error = null; row.count = ok.count ?? null }
  await supabaseAdmin().from('garden_sync_status').upsert(row, { onConflict: 'entity' })
}

/** Rides the Garden sync. Quiet when Homebase is not set up for the hotel. */
export async function syncGardenHomebase(opts: { full?: boolean } = {}): Promise<any> {
  const s = await gardenHbSettings()
  if (!s.enabled || hbMode().mode === 'none' || !(await gardenLocations()).length) return { skipped: 'Homebase not set up for the hotel' }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const from = new Date(Date.now() - (opts.full ? 30 : s.lookbackDays) * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const out: any = {}
  try { out.employees = await pullHbEmployees(); await mark('homebase_staff', { count: out.employees.total }) } catch (e: any) { out.employees = { error: String(e?.message || e) }; await mark('homebase_staff', { error: out.employees.error }) }
  try { out.timecards = await pullHbTimecards(from, today); await mark('homebase_timecards', out.timecards.failedWeeks.length ? { error: `${out.timecards.failedWeeks.length} week(s) failed: ${out.timecards.failedWeeks[0]}` } : { count: out.timecards.cards }) } catch (e: any) { out.timecards = { error: String(e?.message || e) }; await mark('homebase_timecards', { error: out.timecards.error }) }
  return out
}

/** Hours and cost for the hotel over a window, by person and by day — for the panel and reports. */
export async function gardenLabor(from: string, to: string) {
  const { data } = await supabaseAdmin().from('garden_timecards').select('name,staff_id,date,hours,labor_cost,open').gte('date', from).lte('date', to)
  const T = (data || []) as any[]
  const by: Record<string, { name: string; hours: number; cost: number; shifts: number; matched: boolean }> = {}
  for (const t of T) { const k = t.name || '—'; const p = by[k] = by[k] || { name: k, hours: 0, cost: 0, shifts: 0, matched: !!t.staff_id }; p.hours += Number(t.hours) || 0; p.cost += Number(t.labor_cost) || 0; p.shifts++ }
  const people = Object.values(by).map(p => ({ ...p, hours: Math.round(p.hours * 10) / 10, cost: Math.round(p.cost) })).sort((a, b) => b.hours - a.hours)
  return { from, to, hours: Math.round(people.reduce((a, p) => a + p.hours, 0) * 10) / 10, cost: people.reduce((a, p) => a + p.cost, 0), open: T.filter(t => t.open).length, people }
}
