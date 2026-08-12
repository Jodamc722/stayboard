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
//   1. app_settings 'crew_roles'  — operator override, no deploy needed: {"George Paz":"maintenance"}
//   2. DECLARED below            — the roster Jon confirmed
//   3. the staff record (/users → Staffing)
//   4. the Homebase role text
//   5. what they actually did in Breezeway (last resort, and only for people nobody has named)
import 'server-only'
import { getSetting } from './app-settings'
import { nameMatchesRoster } from './homebase'
import { staffByName, resolveStaff, type StaffRow } from './staffing'

export type Dept = 'housekeeping' | 'supervision' | 'maintenance' | 'inspection' | 'other'

export const DEPTS: Dept[] = ['housekeeping', 'supervision', 'maintenance', 'inspection', 'other']

export const DEPT_LABEL: Record<Dept, string> = {
  housekeeping: 'Housekeeping',
  supervision: 'Supervisors',
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
}

/** Department implied by a free-text role ("Supervisor Maintenance Broward" → maintenance). */
export function deptOfRoleText(role: string | null | undefined): Dept | null {
  const s = String(role || '').toLowerCase()
  if (!s) return null
  // Order matters: "Supervisor Maintenance Broward Atlantic" is a maintenance tech who leads the
  // crew — his wages belong against maintenance billing, not in the supervisor overhead line.
  if (/maint|tech|repair|handy|hvac|plumb|electric/.test(s)) return 'maintenance'
  if (/supervis|lead|manager|coordinat/.test(s)) return 'supervision'
  if (/inspect|audit|quality/.test(s)) return 'inspection'
  if (/clean|housekeep|turn|hk\b/.test(s)) return 'housekeeping'
  return null
}

export type CrewMap = {
  /** Resolve a name (Homebase or Breezeway spelling) to its crew. */
  deptOf: (name: string, roleText?: string | null, fallback?: Dept | null) => Dept
  /** True when the person was named explicitly rather than inferred. */
  isDeclared: (name: string) => boolean
  staff: Record<string, StaffRow>
  declared: Record<string, Dept>
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
  for (const k of Object.keys(override || {})) {
    const v = String((override as any)[k] || '').toLowerCase() as Dept
    if (DEPTS.indexOf(v) >= 0) declared[k] = v
  }
  const declaredNames = Object.keys(declared)
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
    const byName = lookupDeclared(name)
    if (byName) { cache[key] = byName; return byName }
    const rec = resolveStaff(String(name || ''), staff)
    const byStaff = deptOfRoleText(rec?.role)
    if (byStaff) { cache[key] = byStaff; return byStaff }
    const byRole = deptOfRoleText(roleText)
    if (byRole) { cache[key] = byRole; return byRole }
    const out = fallback || 'other'
    cache[key] = out
    return out
  }

  return { deptOf, isDeclared: (n: string) => !!lookupDeclared(n), staff, declared }
}
