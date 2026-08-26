// lib/crew.ts — WHO IS ON WHICH CREW. One declared roster, used by every screen.
//
// Jon, 2026-08-12: "Housekeeping is just housekeepers. Yoslenis is a supervisor and shouldn't be
// counted in the margins targets — that should be its own separate category. Ronnie, Ethan,
// Ernesto and George are all maintenance."
//
// WHY THIS FILE EXISTS. Before it, five screens each guessed a person's department from a
// different signal, and every signal was wrong for somebody:
//   - Homebase `role` is free text and is BLANK for Ethan, George, Guillermo, Yoslenis and Roberto.
//   - The `staff` table had Ernesto down as "Inspector" while Homebase said "Maintenance".
//   - Majority-of-Breezeway-tasks put Ethan (27 housekeeping tasks in August) in housekeeping and
//     Yoslenis (42) there too — so a maintenance tech's wages landed in the cost per clean and a
//     supervisor's wages sat inside the housekeeping margin.
// Everybody here does a bit of everything, so no amount of inference fixes it. The crew a person
// belongs to is a fact about employment, not about last week's task list — so it is declared.
//
// RESOLUTION ORDER (first hit wins):
//   0. staff.dept              — THE ANSWER (migration 057). One record per person.
//   1. app_settings 'crew_roles' — legacy override, still honoured so nothing breaks mid-migration
//   2. DECLARED below            — the roster Jon confirmed, now a SEED for a blank staff row
//   3. the staff record's role text
//   4. the Homebase role text
//   5. what they actually did in Breezeway (last resort, and only for people nobody has named)
//
// ONE SOURCE (Jon, 2026-08-26: "make sure all staff and role is pulled from one source of data").
// Steps 1-5 all still exist, but only to fill a blank on somebody nobody has stated yet — and the
// moment anyone is stated, step 0 answers and the rest are never consulted again. Five places to
// look was how a houseman ended up filed as a housekeeper with 156 hours and 2 cleans inside the
// cost per clean, and nobody could say which of the five had put him there.
import 'server-only'
import { getSetting } from './app-settings'
import { nameMatchesRoster } from './homebase'
import { staffByName, resolveStaff, type StaffRow } from './staffing'

export type Dept = 'housekeeping' | 'supervision' | 'ccs' | 'maintenance' | 'inspection' | 'other'

export const DEPTS: Dept[] = ['housekeeping', 'supervision', 'ccs', 'maintenance', 'inspection', 'other']

export const DEPT_LABEL: Record<Dept, string> = {
  housekeeping: 'Housekeeping',
  supervision: 'Supervisors',
  // Jon, 2026-08-24: "Field Coordinator part of CCS team, Karla, Silvia CCS team Manager".
  // Central coordination — field coordinators and CCS managers. Overhead like supervision:
  // their wages never touch the cost per clean.
  ccs: 'CCS team',
  maintenance: 'Maintenance',
  inspection: 'Inspections',
  other: 'Other',
}

// The roster as Jon stated it (2026-08-12). Names are the Homebase spelling where one exists —
// including its typos, because that is what the timecards key on — and matching is fuzzy anyway.
//
// Two calls worth flagging rather than burying:
//   Abel Guada  — Jon did not name him. His Homebase role is literally "Maintenance Miami
//                 Atlantic" and he carries $435 of billable charges in August, so he is
//                 maintenance here. Move him with the settings override if that is wrong.
//   Ronnie      — no Ronnie exists in Homebase (98 names) or in Breezeway. Listed anyway so he
//                 lands in maintenance the moment he shows up in either system.
export const DECLARED: Record<string, Dept> = {
  'Yoslenis Rodiguez': 'supervision',
  'Guillermo Hernandez': 'supervision',
  'Roberto Chiriboga': 'supervision',
  'Ernesto Torres': 'maintenance',
  'Ethan Tucker': 'maintenance',
  'George Paz': 'maintenance',
  'Gehron Regis': 'maintenance',
  'Abel Guada': 'maintenance',
  'Ronnie': 'maintenance',
  // Jon, 2026-08-17 ("Maintenance", answering which crew Oscar belongs on). He was the biggest
  // biller outside any crew — $1,240 of maintenance charges in 30 days that vanished from the
  // maintenance line because he was unrostered. His wages and his billables both land here now.
  'Oscar Arciniegas': 'maintenance',
  // Office / not on a field crew. Named so a stray Breezeway task in someone's name never
  // drags the owner or an agency label into a crew's payroll and margin.
  'Jon McGill': 'other',
  'Opal Works Opal Works': 'other',
  // Jon, 2026-08-24: "Field Coordinator part of CCS team, Karla, Silvia CCS team Manager."
  // Karla was parked in Other until the CCS team existed as a department. Silvia has no
  // Homebase timecard yet (no surname known) — listed Ronnie-style so she lands in CCS the
  // moment she appears in Homebase or Breezeway; tighten to her full name once known.
  'Karla Valle': 'ccs',
  'Silvia': 'ccs',
}

/** Department implied by a free-text role ("Supervisor Maintenance Broward" → maintenance). */
export function deptOfRoleText(role: string | null | undefined): Dept | null {
  const s = String(role || '').toLowerCase()
  if (!s) return null
  // Order matters: "Supervisor Maintenance Broward Atlantic" is a maintenance tech who leads the
  // crew — his wages belong against maintenance billing, not in the supervisor overhead line.
  if (/maint|tech|repair|handy|hvac|plumb|electric/.test(s)) return 'maintenance'
  // CCS before Supervisors: "Field Coordinator" and "CCS Manager" both belong to the CCS team,
  // even though "manager"/"coordinator" would otherwise read as supervision.
  if (/\bccs\b|coordinat/.test(s)) return 'ccs'
  if (/supervis|lead|manager/.test(s)) return 'supervision'
  if (/inspect|audit|quality/.test(s)) return 'inspection'
  if (/clean|housekeep|turn|hk\b/.test(s)) return 'housekeeping'
  return null
}

/** WHERE a person's crew came from — the whole point of the roster editor is making this visible.
 *  Anything below `staff` is a guess, and a guess is what puts a maintenance tech's wages inside
 *  the cost per clean. */
export type DeptSource = 'record' | 'override' | 'declared' | 'staff' | 'homebase' | 'inferred' | 'unrostered'

export const SOURCE_LABEL: Record<DeptSource, string> = {
  record: 'Staff record',
  override: 'Set here',
  declared: 'Stay roster',
  staff: 'Staffing role',
  homebase: 'Homebase role text',
  inferred: 'Guessed from their tasks',
  unrostered: 'Nobody has said',
}

export type CrewMap = {
  /** Resolve a name (Homebase or Breezeway spelling) to its crew. */
  deptOf: (name: string, roleText?: string | null, fallback?: Dept | null) => Dept
  /** Same, but says WHERE the answer came from. Used by the roster editor. */
  deptOfDetailed: (name: string, roleText?: string | null, fallback?: Dept | null) => { dept: Dept; source: DeptSource }
  /** True when the person was named explicitly rather than inferred. */
  isDeclared: (name: string) => boolean
  /** True when an operator set this person by hand in app_settings 'crew_roles'. */
  isOverridden: (name: string) => boolean
  staff: Record<string, StaffRow>
  declared: Record<string, Dept>
  /** Just the operator overrides, so the editor can show what has been set by hand. */
  overrides: Record<string, Dept>
}

/**
 * Load the roster once per request and hand back a resolver. Fail-open: a missing settings row or
 * an unreachable staff table degrades to the declared list, never to an error.
 */
export async function getCrew(): Promise<CrewMap> {
  const [override, staff] = await Promise.all([
    getSetting<Record<string, string>>('crew_roles', {}).catch(() => ({} as Record<string, string>)),
    staffByName().catch(() => ({} as Record<string, StaffRow>)),
  ])
  const declared: Record<string, Dept> = {}
  for (const k of Object.keys(DECLARED)) declared[k] = DECLARED[k]
  const overrides: Record<string, Dept> = {}
  for (const k of Object.keys(override || {})) {
    const v = String((override as any)[k] || '').toLowerCase() as Dept
    if (DEPTS.indexOf(v) >= 0) { declared[k] = v; overrides[k] = v }
  }
  const declaredNames = Object.keys(declared)
  const overrideNames = Object.keys(overrides)
  const cache: Record<string, Dept | null> = {}

  const lookupDeclared = (name: string): Dept | null => {
    const n = String(name || '')
    if (!n) return null
    if (declared[n]) return declared[n]
    const hit = nameMatchesRoster(n, declaredNames)
    return hit ? declared[hit] : null
  }

  const deptOf = (name: string, roleText?: string | null, fallback?: Dept | null): Dept => {
    const key = String(name || '') + ' ' + String(roleText || '') + ' ' + String(fallback || '')
    if (key in cache && cache[key]) return cache[key] as Dept
    // THE RECORD ANSWERS FIRST. Everything below it is a seed for somebody nobody has stated.
    const recFirst = resolveStaff(String(name || ''), staff)
    const stated = String(recFirst?.dept || '').toLowerCase() as Dept
    if (stated && DEPTS.indexOf(stated) >= 0) { cache[key] = stated; return stated }
    const byName = lookupDeclared(name)
    if (byName) { cache[key] = byName; return byName }
    const rec = recFirst
    const byStaff = deptOfRoleText(rec?.role)
    if (byStaff) { cache[key] = byStaff; return byStaff }
    const byRole = deptOfRoleText(roleText)
    if (byRole) { cache[key] = byRole; return byRole }
    const out = fallback || 'other'
    cache[key] = out
    return out
  }

  // Same resolution order as deptOf, reported step by step. Kept as its own function rather than
  // threading a second return value through deptOf, which is called on every timecard row.
  const deptOfDetailed = (name: string, roleText?: string | null, fallback?: Dept | null): { dept: Dept; source: DeptSource } => {
    const n = String(name || '')
    const recFirst = resolveStaff(n, staff)
    const stated = String(recFirst?.dept || '').toLowerCase() as Dept
    if (stated && DEPTS.indexOf(stated) >= 0) return { dept: stated, source: 'record' }
    const ov = overrides[n] || (nameMatchesRoster(n, overrideNames) ? overrides[nameMatchesRoster(n, overrideNames) as string] : null)
    if (ov) return { dept: ov, source: 'override' }
    const byName = lookupDeclared(n)
    if (byName) return { dept: byName, source: 'declared' }
    const rec = recFirst
    const byStaff = deptOfRoleText(rec?.role)
    if (byStaff) return { dept: byStaff, source: 'staff' }
    const byRole = deptOfRoleText(roleText)
    if (byRole) return { dept: byRole, source: 'homebase' }
    // No fallback offered = nobody has placed this person. Say that, rather than dressing up
    // 'other' as an answer. Jon 2026-08-21: unrostered is flagged, never guessed.
    if (!fallback) return { dept: 'other', source: 'unrostered' }
    return { dept: fallback, source: 'inferred' }
  }

  return {
    deptOf, deptOfDetailed,
    isDeclared: (n: string) => !!lookupDeclared(n),
    isOverridden: (n: string) => !!(overrides[String(n || '')] || nameMatchesRoster(String(n || ''), overrideNames)),
    staff, declared, overrides,
  }
}
