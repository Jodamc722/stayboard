// WHO MAY TEACH EVE (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve"
// and "She can learn from any CCS agent, she can also learn from Roberto, Karla & Bernadette").
//
// ONE ANSWER, EVERY SURFACE. The web chat, the floating bubble, Slack and the memory admin all ask
// this file the same question — is this person a teacher, and how heavy may their word be — so a
// rule Karla teaches in Slack lands at the same weight as the one she types in the app.
//
//   Jon (superadmin)            weight up to 10, source 'jon'
//   the named teachers           weight up to 8  (Roberto, Karla, Bernadette — app_settings eve_teachers)
//   anyone on the CCS team       weight up to 6  (access role cs / cs_manager / ccs, or crew dept 'ccs')
//   everyone else                not a teacher: today's behaviour (STAFF_MAX_WEIGHT, suggestions only)
//
// The named list is a setting (`eve_teachers`), edited in Settings → Eve → Learning, so adding a
// teacher is not a deploy. Fail-open to the defaults below: a missing table never demotes Jon's team.
import 'server-only'
import { getSetting, getSettingFresh, setSetting } from '@/lib/app-settings'
import { isSuperadmin } from '@/lib/access'
import { nameMatches } from '@/lib/person-name'
import { ROBERTO_SLACK_ID, KARLA_SLACK_ID, BERNADETTE_SLACK_ID, JON_SLACK_ID } from '@/lib/slack-rules'

export const TEACHERS_KEY = 'eve_teachers'

export type TeachersCfg = {
  emails: string[]
  slackIds: string[]
  names: string[]
  /** Anyone on the CCS team teaches too (Jon: "She can learn from any CCS agent"). */
  ccs: boolean
  /** Access roles (app_roles.key) that count as CCS. */
  ccsRoles?: string[]
}

export const DEFAULT_TEACHERS: TeachersCfg = {
  emails: ['roberto@stay-hospitality.com', 'karla@stay-hospitality.com', 'bernadette@stay-hospitality.com'],
  slackIds: [ROBERTO_SLACK_ID, KARLA_SLACK_ID, BERNADETTE_SLACK_ID],
  names: ['Roberto Chiriboga', 'Karla Valle', 'Bernadette Tan'],
  ccs: true,
  ccsRoles: ['cs', 'cs_manager', 'ccs'],
}

export const TEACHER_WEIGHT = { jon: 10, named: 8, ccs: 6 } as const

export type TeacherIdentity = { email?: string | null; slackId?: string | null; name?: string | null; accessRole?: string | null }
export type Teacher = {
  teacher: boolean
  tier: 'jon' | 'named' | 'ccs' | null
  /** The heaviest weight this person's word may carry. 0 when not a teacher. */
  maxWeight: number
  /** How provenance reads ("Karla Valle", "jon", an email). */
  label: string
}

const list = (v: any): string[] => (Array.isArray(v) ? v : String(v || '').split(/[\n,]+/)).map((s: any) => String(s || '').trim()).filter(Boolean)

export function normTeachers(v: any): TeachersCfg {
  const o = v && typeof v === 'object' ? v : {}
  return {
    emails: Array.isArray(o.emails) ? list(o.emails).map(s => s.toLowerCase()) : DEFAULT_TEACHERS.emails.slice(),
    slackIds: Array.isArray(o.slackIds) ? list(o.slackIds) : DEFAULT_TEACHERS.slackIds.slice(),
    names: Array.isArray(o.names) ? list(o.names) : DEFAULT_TEACHERS.names.slice(),
    ccs: typeof o.ccs === 'boolean' ? o.ccs : DEFAULT_TEACHERS.ccs,
    ccsRoles: Array.isArray(o.ccsRoles) ? list(o.ccsRoles).map(s => s.toLowerCase()) : (DEFAULT_TEACHERS.ccsRoles || []).slice(),
  }
}

export async function getTeachers(fresh = false): Promise<TeachersCfg> {
  const raw = await (fresh ? getSettingFresh<any>(TEACHERS_KEY, null) : getSetting<any>(TEACHERS_KEY, null)).catch(() => null)
  return normTeachers(raw)
}

export async function saveTeachers(v: any, by: string): Promise<{ ok: boolean; error?: string; value?: TeachersCfg }> {
  const value = normTeachers(v)
  const r = await setSetting(TEACHERS_KEY, value, by)
  return r.ok ? { ok: true, value } : { ok: false, error: r.error }
}

const NOT: Teacher = { teacher: false, tier: null, maxWeight: 0, label: '' }

/**
 * Is this person a teacher, and how heavy is their word? Any one identity field is enough: an email
 * from the signed-in session, a Slack user id, a display name, or the Lighthouse access role.
 */
export async function teacherFor(id: TeacherIdentity | null | undefined): Promise<Teacher> {
  if (!id) return NOT
  const email = String(id.email || '').toLowerCase().trim()
  const slackId = String(id.slackId || '').trim()
  const name = String(id.name || '').trim()
  const label = name || email || slackId
  if (isSuperadmin(email) || (slackId && slackId === JON_SLACK_ID)) return { teacher: true, tier: 'jon', maxWeight: TEACHER_WEIGHT.jon, label: name || 'Jon' }
  const cfg = await getTeachers()
  if ((email && cfg.emails.includes(email)) || (slackId && cfg.slackIds.includes(slackId)) || (name && cfg.names.some(n => nameMatches(n, name)))) {
    return { teacher: true, tier: 'named', maxWeight: TEACHER_WEIGHT.named, label }
  }
  if (cfg.ccs) {
    const role = String(id.accessRole || '').toLowerCase()
    if (role && (cfg.ccsRoles || []).includes(role)) return { teacher: true, tier: 'ccs', maxWeight: TEACHER_WEIGHT.ccs, label }
    if (name) {
      try {
        const { getCrew } = await import('@/lib/crew')
        const crew = await getCrew()
        if (crew.deptOf(name, null, null) === 'ccs') return { teacher: true, tier: 'ccs', maxWeight: TEACHER_WEIGHT.ccs, label }
      } catch { /* the roster can be down; the role check above still answered */ }
    }
  }
  return NOT
}

export async function isTeacher(id: TeacherIdentity | null | undefined): Promise<boolean> { return (await teacherFor(id)).teacher }
/** The ceiling on this person's memory weight: 10 Jon, 8 named, 6 CCS, 0 not a teacher. */
export async function teacherWeight(id: TeacherIdentity | null | undefined): Promise<number> { return (await teacherFor(id)).maxWeight }

/** The identity of a signed-in Access, the way every web route sees a person. */
export function identityOfAccess(access: { email?: string | null; profile?: any; accessRole?: string | null } | null | undefined, extra?: { slackId?: string | null; name?: string | null }): TeacherIdentity {
  return {
    email: access?.email || null,
    name: String(access?.profile?.name || '') || extra?.name || null,
    accessRole: access?.accessRole || null,
    slackId: extra?.slackId || null,
  }
}

/**
 * Source and weight for a person's words, teacher-aware. Same shape as memory.ts personSource():
 * Jon is 'jon'; anyone else is 'staff' (created_by carries who, evidence.teacher the label). A
 * teacher's ceiling is their tier's; everyone else keeps STAFF_MAX_WEIGHT (6).
 */
export function teacherSource(t: Teacher, asked: number, staffMax = 6): { source: 'jon' | 'staff'; weight: number; maxWeight: number } {
  const w = Math.min(10, Math.max(1, Math.round(Number(asked) || 5)))
  if (t.tier === 'jon') return { source: 'jon', weight: w, maxWeight: 10 }
  const cap = t.teacher ? Math.max(staffMax, t.maxWeight) : staffMax
  return { source: 'staff', weight: Math.min(w, cap), maxWeight: cap }
}
