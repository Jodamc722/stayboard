// STAFFING AGENCIES + STAFF RECORDS — the two facts Homebase cannot tell us.
//
// Homebase owns punches: who worked, what day, how many hours, at what wage. It has no idea that
// Maria is contracted through Opal and Luis through CityBest, and its `role` is free text typed by
// whoever built the schedule. So this file stores ONLY agency + our own role/area, keyed on the
// Homebase roster name, and every hour on an invoice is read live from Homebase at export time.
// A punch corrected in Homebase changes the next invoice with no action here — hours are never
// copied into our database, so the two can never drift.
//
// Fee model (Jon 2026-08-08): fees attach PER AGENCY, and the invoice is built on the Homebase
// wage plus that agency's markup. All three fee kinds stack, each defaulting to 0, so a contract
// can be pure %, pure per-hour, pure flat, or any mix, without a fee_type enum to migrate.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { nameMatchesRoster } from './homebase'

export type Agency = {
  key: string; label: string
  fee_percent: number; fee_per_hour: number; fee_flat: number
  active: boolean; notes?: string | null; sort?: number
}

export type StaffRow = {
  name: string
  agency: string | null
  role: string | null
  area: string | null
  active: boolean
  notes?: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

// ---------------------------------------------------------------- reads
// FAIL-OPEN like the rest of settings: a missing table must never take the Labor page down. An
// empty agency list simply means nobody is billed to an agency yet.
export async function getAgencies(includeInactive = false): Promise<Agency[]> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('staffing_agencies').select('*').order('sort').order('label')
    const rows = ((data || []) as any[]).map(r => ({
      key: String(r.key), label: String(r.label || r.key),
      fee_percent: num(r.fee_percent), fee_per_hour: num(r.fee_per_hour), fee_flat: num(r.fee_flat),
      active: r.active !== false, notes: r.notes ?? null, sort: num(r.sort, 100),
    }))
    return includeInactive ? rows : rows.filter(a => a.active)
  } catch { return [] }
}

export async function getStaff(includeInactive = false): Promise<StaffRow[]> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('staff').select('*').order('name')
    const rows = ((data || []) as any[]).map(r => ({
      name: String(r.name),
      agency: r.agency ? String(r.agency) : null,
      role: r.role ?? null, area: r.area ?? null,
      active: r.active !== false, notes: r.notes ?? null,
    }))
    return includeInactive ? rows : rows.filter(s => s.active)
  } catch { return [] }
}

/** Name -> staff record, tolerant of the spelling drift between Homebase and Breezeway. */
export async function staffByName(): Promise<Record<string, StaffRow>> {
  const rows = await getStaff(true)
  const out: Record<string, StaffRow> = {}
  for (const r of rows) out[r.name.toLowerCase()] = r
  return out
}

/** Resolve a punch name to a staff record: exact first, then the fuzzy roster match. */
export function resolveStaff(name: string, index: Record<string, StaffRow>): StaffRow | null {
  const direct = index[String(name || '').toLowerCase()]
  if (direct) return direct
  const hit = nameMatchesRoster(String(name || ''), Object.values(index).map(s => s.name))
  return hit ? index[hit.toLowerCase()] || null : null
}

// ---------------------------------------------------------------- fee maths
// ONE definition of what an agency is owed, used by both the on-screen preview and the export, so
// the invoice a vendor receives can never disagree with the number Jon approved on screen.
export type AgencyCharge = {
  hours: number; base: number
  feePercentAmt: number; feePerHourAmt: number; feeFlatAmt: number
  fees: number; total: number
}

export function computeAgencyCharge(hours: number, base: number, a: Agency | null): AgencyCharge {
  const h = round2(num(hours)), b = round2(num(base))
  if (!a) return { hours: h, base: b, feePercentAmt: 0, feePerHourAmt: 0, feeFlatAmt: 0, fees: 0, total: b }
  const feePercentAmt = round2(b * (num(a.fee_percent) / 100))
  const feePerHourAmt = round2(h * num(a.fee_per_hour))
  const feeFlatAmt = round2(num(a.fee_flat))          // once per invoice, not per line
  const fees = round2(feePercentAmt + feePerHourAmt + feeFlatAmt)
  return { hours: h, base: b, feePercentAmt, feePerHourAmt, feeFlatAmt, fees, total: round2(b + fees) }
}

// ---------------------------------------------------------------- writes
export async function upsertAgency(a: Partial<Agency> & { key: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = supabaseAdmin()
    const row: any = { key: String(a.key).trim().toLowerCase(), updated_at: new Date().toISOString() }
    if (a.label != null) row.label = String(a.label).trim() || row.key
    if (a.fee_percent != null) row.fee_percent = num(a.fee_percent)
    if (a.fee_per_hour != null) row.fee_per_hour = num(a.fee_per_hour)
    if (a.fee_flat != null) row.fee_flat = num(a.fee_flat)
    if (a.active != null) row.active = !!a.active
    if (a.notes !== undefined) row.notes = a.notes
    if (a.sort != null) row.sort = num(a.sort, 100)
    if (!row.label) row.label = row.key
    const { error } = await sb.from('staffing_agencies').upsert(row, { onConflict: 'key' })
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

export async function upsertStaff(s: Partial<StaffRow> & { name: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = supabaseAdmin()
    const row: any = { name: String(s.name).trim(), updated_at: new Date().toISOString() }
    if (!row.name) return { ok: false, error: 'name required' }
    if (s.agency !== undefined) row.agency = s.agency ? String(s.agency).trim().toLowerCase() : null
    if (s.role !== undefined) row.role = s.role
    if (s.area !== undefined) row.area = s.area
    if (s.active != null) row.active = !!s.active
    if (s.notes !== undefined) row.notes = s.notes
    const { error } = await sb.from('staff').upsert(row, { onConflict: 'name' })
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}
