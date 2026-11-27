// TRAIN EVE (Jon, 2026-11-26): "a place to ask questions if you are unsure … part of the admin
// dashboard / today page so team can train you. Only managers / admin and Sulaman."
//
// She already has an inbox for what she needs decided. This is the other direction, and it is small on
// purpose: three things a trainer can do from Today without opening the Eve page.
//
//   CHECK   a call she made and is not sure of. Today that is one kind: "I flagged this as a safety
//           matter — was it?" A No takes it off the safety list, turns the glitch back into an ordinary
//           one, and teaches the watch that wording, so the same words never page customer care again.
//   ANSWER  a question she raised (the same eve_questions the Eve page answers).
//   TEACH   one sentence she should know. It is saved as a memory with the trainer's name on it.
//
// WHO: admins, the manager role, and the named trainers in app_settings `eve_trainers` (Sulaman to
// start). Not the whole customer care team: a correction here changes what pages people at 2am.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isSuperadmin, type Access } from '@/lib/access'
import { getSetting, getSettingFresh, setSetting } from '@/lib/app-settings'
import { saveMemory, personSource, STAFF_MAX_WEIGHT } from './memory'
import { categoryFor } from '@/lib/guest-issue-judge'

export const TRAINERS_KEY = 'eve_trainers'
export const NOT_SAFETY_KEY = 'guest_issue_not_safety'
export const DEFAULT_TRAINERS = ['suleman.afzal@jnjsolutionsllc.com']
const TRAINER_ROLES = new Set(['admin', 'manager'])
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const lc = (v: any) => str(v).toLowerCase().trim()

export async function trainerEmails(): Promise<string[]> {
  const v = await getSetting<any>(TRAINERS_KEY, DEFAULT_TRAINERS).catch(() => DEFAULT_TRAINERS)
  return (Array.isArray(v) ? v : DEFAULT_TRAINERS).map(lc).filter(Boolean)
}

/** May this person train Eve? Admin, the manager role, or a named trainer. */
export async function canTrainEve(access: Pick<Access, 'email' | 'role' | 'accessRole' | 'allowed'>): Promise<boolean> {
  if (!access.allowed || !access.email) return false
  if (isSuperadmin(access.email) || access.role === 'admin') return true
  if (TRAINER_ROLES.has(lc(access.accessRole))) return true
  return (await trainerEmails()).includes(lc(access.email))
}

export type SafetyCheck = { key: string; at: string; unit: string; guest: string; kind: string; headline: string; issues: string[]; link: string | null }

/** Safety flags from the last week that no trainer has ruled on yet, newest first. */
export async function safetyChecks(limit = 8): Promise<SafetyCheck[]> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data } = await supabaseAdmin().from('guest_issue_detections')
    .select('source_key, detected_at, unit, guest_name, kind, headline, issues, link, note, verdict')
    .eq('severity', 'security').gte('detected_at', since)
    .not('verdict', 'in', '(dismissed)')
    .order('detected_at', { ascending: false }).limit(60)
  return ((data || []) as any[])
    .filter(r => !/trainer:/i.test(str(r.note)))
    .slice(0, limit)
    .map(r => ({
      key: str(r.source_key), at: str(r.detected_at), unit: str(r.unit), guest: str(r.guest_name), kind: str(r.kind),
      headline: str(r.headline).slice(0, 220), issues: Array.isArray(r.issues) ? r.issues.map(String).slice(0, 5) : [], link: str(r.link) || null,
    }))
}

/** A trainer's ruling on one safety flag. */
export async function ruleOnSafety(key: string, isSafety: boolean, why: string, by: string): Promise<{ ok: boolean; error?: string; taught?: number }> {
  const db = supabaseAdmin()
  const { data } = await db.from('guest_issue_detections').select('*').eq('source_key', key).maybeSingle()
  const d: any = data
  if (!d) return { ok: false, error: 'That flag is no longer there.' }
  const day = new Date().toISOString().slice(0, 10)
  const reason = str(why).trim().slice(0, 300)
  const stamp = `trainer: ${isSafety ? 'a safety matter' : 'not a safety matter'}${reason ? ' — ' + reason : ''} (${by}, ${day})`
  const note = [str(d.note), stamp].filter(Boolean).join(' · ').slice(0, 900)
  if (isSafety) {
    const { error } = await db.from('guest_issue_detections').update({ note }).eq('source_key', key)
    return error ? { ok: false, error: error.message.slice(0, 200) } : { ok: true, taught: 0 }
  }
  const issues: string[] = Array.isArray(d.issues) ? d.issues.map(String) : []
  const text = issues.length ? issues.join(' · ') : str(d.headline)
  const { error } = await db.from('guest_issue_detections')
    .update({ severity: 'issue', category: categoryFor(text, { noSafety: true }), note }).eq('source_key', key)
  if (error) return { ok: false, error: error.message.slice(0, 200) }
  // The glitch it became goes back to an ordinary one. Only one still labelled a security incident is touched.
  if (d.glitch_id) {
    try { await db.from('glitches').update({ glitch_type: 'Glitch (Quality Issue)', priority: 'normal' }).eq('id', d.glitch_id).eq('glitch_type', 'Security Incident') } catch { /* the ruling stands either way */ }
  }
  // Teach the watch the wording: each named issue, or a short headline. Long call summaries are not phrases.
  const phrases = (issues.length ? issues : [str(d.headline)]).map(s => s.trim()).filter(s => s.length >= 6 && s.length <= 120)
  let taught = 0
  if (phrases.length) {
    const cur = await getSettingFresh<any>(NOT_SAFETY_KEY, []).catch(() => [])
    const list: string[] = Array.isArray(cur) ? cur.map(String) : []
    const have = new Set(list.map(lc))
    for (const p of phrases) if (!have.has(lc(p))) { list.push(p); have.add(lc(p)); taught++ }
    if (taught) await setSetting(NOT_SAFETY_KEY, list.slice(-400), by)
  }
  const who = personSource(by, 8)
  await saveMemory({
    kind: 'correction',
    text: `Not a safety or security matter: "${text.slice(0, 300)}"${d.unit ? ' at ' + str(d.unit) : ''}.${reason ? ' ' + reason : ''} Safety means a person at risk or a unit that is not secure right now.`.slice(0, 900),
    why: `Ruled by ${by} on ${day} from Train Eve on Today, on a flag Eve raised as Safety/security.`,
    scope: 'portfolio', weight: who.weight, maxWeight: who.source === 'staff' ? STAFF_MAX_WEIGHT : undefined,
    source: who.source, confidence: 1, created_by: by, evidence: { detection: key, train: 'safety' },
  }).catch(() => null)
  return { ok: true, taught }
}

/** One thing a trainer wants her to know. */
export async function teachEve(text: string, by: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const t = str(text).trim()
  if (t.length < 8) return { ok: false, error: 'Write a full sentence she can use.' }
  const who = personSource(by, 8)
  const r = await saveMemory({
    kind: 'rule', text: t.slice(0, 900),
    why: `Taught by ${by} on ${new Date().toISOString().slice(0, 10)} from Train Eve on Today.`,
    scope: 'portfolio', weight: who.weight, maxWeight: who.source === 'staff' ? STAFF_MAX_WEIGHT : undefined,
    source: who.source, confidence: 1, created_by: by, evidence: { train: 'teach' },
  })
  if (r.ok && r.id && !r.deduped) { try { const { probeForMemory } = await import('./learning-audit'); await probeForMemory(r.id, 'answered') } catch { /* saved either way */ } }
  return { ok: r.ok, id: r.id, error: r.error }
}
