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

// ONE RECORD PER PERSON (Jon, 2026-08-26: "make sure all staff and role is pulled from one
// source of data"). Everything the app needs to know about who somebody is lives on this row:
// their crew, their job title, their market, who employs them, and what they cost. Migration 057
// added the second half; the fields are optional here so the app behaves identically whether or
// not that migration has been applied yet.
export type StaffRow = {
  name: string
  agency: string | null
  role: string | null
  area: string | null
  active: boolean
  notes?: string | null
  /** THE crew. lib/crew reads this first; every other signal is only a seed for a blank. */
  dept?: string | null
  /** Where the crew came from, for the People card: 'set here', 'seed:roster', 'seed:homebase'… */
  deptSource?: string | null
  title?: string | null
  /** Paid a salary — the salary IS the cost and punches never drive dollars (see lib/salary). */
  salaried?: boolean
  salaryHourly?: number | null
  salaryHoursPerWeek?: number | null
  salaryAnnual?: number | null
  /** HOW they are employed (Jon, 2026-09-01): 'w2' | 'contractor' | 'agency' | 'vendor'. Fact
   *  only for now — no burden math until Eric's app supplies the real rates. */
  employmentType?: string | null
}

/** A vendor company — who they are, which buildings they cover, how they bill (migration 062). */
export type Vendor = {
  key: string; label: string
  buildings: string[]
  billing: string | null; contact: string | null; notes: string | null
  active: boolean; sort: number
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
      // `select('*')` returns whatever columns exist, so these read as undefined until 057 is
      // applied and the whole app simply falls back to the old ladder. No branch needed.
      dept: r.dept ?? null,
      deptSource: r.dept_source ?? null,
      title: r.title ?? null,
      salaried: r.salaried === true,
      salaryHourly: r.salary_hourly == null ? null : num(r.salary_hourly),
      salaryHoursPerWeek: r.salary_hours_per_week == null ? null : num(r.salary_hours_per_week),
      salaryAnnual: r.salary_annual == null ? null : num(r.salary_annual),
      employmentType: r.employment_type ?? null,
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

// Columns migration 057 adds. Kept as a list because the write below has to be able to drop
// them again — see the retry.
const V057_COLUMNS = ['dept', 'dept_source', 'title', 'salaried', 'salary_hourly', 'salary_hours_per_week', 'salary_annual', 'employment_type']

export async function upsertStaff(s: Partial<StaffRow> & { name: string }): Promise<{ ok: boolean; error?: string; migrationPending?: boolean }> {
  try {
    const sb = supabaseAdmin()
    const row: any = { name: String(s.name).trim(), updated_at: new Date().toISOString() }
    if (!row.name) return { ok: false, error: 'name required' }
    if (s.agency !== undefined) row.agency = s.agency ? String(s.agency).trim().toLowerCase() : null
    if (s.role !== undefined) row.role = s.role
    if (s.area !== undefined) row.area = s.area
    if (s.active != null) row.active = !!s.active
    if (s.notes !== undefined) row.notes = s.notes
    if (s.dept !== undefined) row.dept = s.dept ? String(s.dept).trim().toLowerCase() : null
    if (s.deptSource !== undefined) row.dept_source = s.deptSource
    if (s.title !== undefined) row.title = s.title
    if (s.salaried !== undefined) row.salaried = !!s.salaried
    if (s.salaryHourly !== undefined) row.salary_hourly = s.salaryHourly == null ? null : num(s.salaryHourly)
    if (s.salaryHoursPerWeek !== undefined) row.salary_hours_per_week = s.salaryHoursPerWeek == null ? null : num(s.salaryHoursPerWeek)
    if (s.salaryAnnual !== undefined) row.salary_annual = s.salaryAnnual == null ? null : num(s.salaryAnnual)
    if (s.employmentType !== undefined) {
      const et = String(s.employmentType || '').trim().toLowerCase()
      row.employment_type = ['w2', 'contractor', 'agency', 'vendor'].includes(et) ? et : null
    }
    const { error } = await sb.from('staff').upsert(row, { onConflict: 'name' })
    if (!error) return { ok: true }
    // MIGRATION 057 NOT APPLIED YET. Rather than failing the whole save — which would make the
    // People card look broken for edits that have nothing to do with the new fields — drop the
    // new columns, save what the table can hold, and SAY the crew/pay half did not persist.
    // Silently succeeding here would be the worst option: the operator would believe they had
    // stated something the engine never saw.
    const missing = V057_COLUMNS.some(c => error.message.includes(c))
    if (missing) {
      const legacy: any = { ...row }
      for (const c of V057_COLUMNS) delete legacy[c]
      const retry = await sb.from('staff').upsert(legacy, { onConflict: 'name' })
      if (retry.error) return { ok: false, error: retry.error.message }
      return { ok: true, migrationPending: true }
    }
    return { ok: false, error: error.message }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** Does the staff table carry the single-source columns yet? Used to show migration state. */
export async function staffSingleSourceReady(): Promise<boolean> {
  try {
    const sb = supabaseAdmin()
    const { error } = await sb.from('staff').select('dept,salaried').limit(1)
    return !error
  } catch { return false }
}

// ---------------------------------------------------------------- inference
// AUTO-FILL (Jon 2026-08-08): "auto populate that in the user setting... help determine role,
// market area". Nobody should hand-type 40 people. Role and area are both derivable from work
// that already happened, so we derive them and let the settings page hold the answer:
//
//   area  — the market where a person's Breezeway tasks actually happened (majority vote). This is
//           the SAME rule the Labor board used to compute inline; now it is computed once, stored,
//           and read back, so the board and the settings page can never disagree.
//   role  — what they actually do, by task department, not by whatever was typed in Homebase.
//   agency— NEVER inferred. It is the one fact no system observes; guessing it would put hours on
//           the wrong invoice, so it stays blank until a human sets it.
//
// Suggestions never overwrite a value a human already chose — see mergeSuggestion below.
export type StaffSuggestion = { name: string; role: string | null; area: string | null; tasks: number }

export function roleFromDepartment(dept: string, taskName = ''): string | null {
  const s = `${dept || ''} ${taskName || ''}`.toLowerCase()
  if (/clean|housekeep|turn|laundry/.test(s)) return 'Housekeeper'
  if (/inspect|walk|qc\b/.test(s)) return 'Inspector'
  if (/maint|repair|fix|hvac|plumb|electric|pest|handy/.test(s)) return 'Maintenance'
  return null
}

/** Majority-vote role + area per person from their finished Breezeway tasks. */
export function suggestFromTasks(
  tasks: { doer: string | null; market: string | null; dept: string; name: string }[],
): Record<string, StaffSuggestion> {
  const acc: Record<string, { roles: Record<string, number>; areas: Record<string, number>; n: number }> = {}
  for (const t of tasks) {
    const who = String(t.doer || '').trim()
    if (!who) continue
    const a = acc[who] || (acc[who] = { roles: {}, areas: {}, n: 0 })
    a.n += 1
    const r = roleFromDepartment(t.dept, t.name)
    if (r) a.roles[r] = (a.roles[r] || 0) + 1
    if (t.market) a.areas[t.market] = (a.areas[t.market] || 0) + 1
  }
  const top = (m: Record<string, number>): string | null => {
    let best: string | null = null, n = 0
    for (const k of Object.keys(m)) if (m[k] > n) { best = k; n = m[k] }
    return best
  }
  const out: Record<string, StaffSuggestion> = {}
  for (const name of Object.keys(acc)) {
    out[name] = { name, role: top(acc[name].roles), area: top(acc[name].areas), tasks: acc[name].n }
  }
  return out
}

// AGENCY FROM HOMEBASE (Jon 2026-08-08: "why are you not pulling the employee, rate and agency
// from Homebase"). Homebase has no agency field of its own, so the only honest way to read one is
// to look for an agency's NAME in the text Homebase does carry — job title, department, or any
// custom field on the employee record. If Jon writes "Opal" anywhere on the person in Homebase,
// this finds it. If he does not, this returns null and the agency stays a human decision rather
// than becoming a guess that quietly puts hours on the wrong invoice.
export function agencyFromText(texts: (string | null | undefined)[], agencies: Agency[]): string | null {
  const hay = texts.filter(Boolean).join(' | ').toLowerCase()
  if (!hay.trim()) return null
  let best: string | null = null, bestLen = 0
  for (const a of agencies) {
    for (const cand of [a.label, a.key]) {
      const c = String(cand || '').trim().toLowerCase()
      // 3 chars minimum, on a word boundary — otherwise a key like "cb" matches half the roster.
      if (c.length < 3) continue
      const re = new RegExp('(^|[^a-z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)')
      if (re.test(hay) && c.length > bestLen) { best = a.key; bestLen = c.length }
    }
  }
  return best
}

/** Apply a suggestion WITHOUT clobbering anything already set by hand. */
export function mergeSuggestion(existing: StaffRow | null, s: StaffSuggestion, name: string): Partial<StaffRow> & { name: string } {
  return {
    name: existing?.name || name,
    role: existing?.role || s.role || null,
    area: existing?.area || s.area || null,
    agency: existing?.agency ?? null,     // never inferred
    active: existing ? existing.active : true,
  }
}


// ── VENDORS (Jon, 2026-09-01: "an option to add different vendors") ───────────────────────────
export async function getVendors(includeInactive = false): Promise<Vendor[]> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('vendors').select('*').order('sort').order('label')
    const rows = ((data || []) as any[]).map(r => ({
      key: String(r.key), label: String(r.label || r.key),
      buildings: Array.isArray(r.buildings) ? r.buildings.map(String) : [],
      billing: r.billing ?? null, contact: r.contact ?? null, notes: r.notes ?? null,
      active: r.active !== false, sort: num(r.sort, 100),
    }))
    return includeInactive ? rows : rows.filter(v => v.active)
  } catch { return [] }   // table may predate migration 062 — everything falls back to presets
}

export async function upsertVendor(v: Partial<Vendor> & { key: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = supabaseAdmin()
    const key = String(v.key).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    if (!key) return { ok: false, error: 'key required' }
    const row: any = { key, updated_at: new Date().toISOString() }
    if (v.label !== undefined) row.label = String(v.label || key)
    if (v.buildings !== undefined) row.buildings = (v.buildings || []).map(b => String(b).trim()).filter(Boolean)
    if (v.billing !== undefined) row.billing = v.billing
    if (v.contact !== undefined) row.contact = v.contact
    if (v.notes !== undefined) row.notes = v.notes
    if (v.active != null) row.active = !!v.active
    if (v.sort !== undefined) row.sort = num(v.sort, 100)
    const { error } = await sb.from('vendors').upsert(row, { onConflict: 'key' })
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}
