// TRAINING THE REFUND ADVISOR (Jon, 2026-09-22).
//
// "There should be an ability in the user settings to train the recommendation portal ... maybe in
// the glitch profile if you're an admin support."
//
// Two things teach it, both kept in app_settings under one key so a change needs no deploy:
//
//   GUIDANCE   House rules in plain English, written by an admin: "a lockout under an hour we fix
//              with an apology, not money", "Vrbo guests escalate fast — act on day one". Every
//              recommendation reads all of it.
//   CASES      Real glitches an admin saved as precedent, with what we actually paid and the lesson.
//              The advisor is shown the ones closest to the case in front of it (same category
//              first, then most recent), and the card shows them back as "cases like this".
//
// WHAT TRAINING CAN AND CANNOT MOVE. It steers the model's CLASSIFICATION — severity, where in the
// band, how to read speed and what was offered — which is what the policy turns into money. It does
// not bypass the policy: the arithmetic stays deterministic, so the same facts still produce the
// same number. That keeps a taught rule explainable ("it was classified moderate because of house
// rule 3") instead of a figure nobody can trace.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import type { Access } from './access'

export const TRAINING_KEY = 'refund_training'

export type TrainingCase = {
  id: string
  glitchId: string
  unit: string
  category: string
  channel: string
  nights: number
  nightly: number
  /** what happened, in one or two sentences */
  what: string
  /** what the advisor said at the time, if it was asked */
  recommended: number | null
  /** what we actually gave — the answer */
  paid: number
  /** the lesson, in the trainer's words: why this is the right number */
  lesson: string
  savedBy: string
  savedAt: string
}

export type Training = { guidance: string; cases: TrainingCase[]; updatedBy?: string; updatedAt?: string }

const EMPTY: Training = { guidance: '', cases: [] }

export async function loadTraining(): Promise<Training> {
  const v = await getSetting<any>(TRAINING_KEY, null)
  if (!v || typeof v !== 'object') return { ...EMPTY }
  return {
    guidance: String(v.guidance || '').slice(0, 8000),
    cases: Array.isArray(v.cases) ? v.cases.filter((c: any) => c && c.id).slice(0, 200) : [],
    updatedBy: v.updatedBy, updatedAt: v.updatedAt,
  }
}

export async function saveTraining(t: Training, by: string) {
  return setSetting(TRAINING_KEY, { ...t, updatedBy: by, updatedAt: new Date().toISOString() }, by)
}

/** Who may train it: an admin, or anyone with full access to the glitch board (support leads). */
export function canTrain(a: Pick<Access, 'role' | 'levels' | 'email'>): boolean {
  if (a.role === 'admin') return true
  return (a.levels || {} as any)['glitches'] === 'full'
}

/** The cases closest to this one: same category first, then the most recent. */
export function nearestCases(t: Training, category: string, n = 6): TrainingCase[] {
  const cat = String(category || '').toLowerCase()
  const same = t.cases.filter(c => cat && String(c.category || '').toLowerCase() === cat)
  const rest = t.cases.filter(c => same.indexOf(c) < 0)
  const byNew = (a: TrainingCase, b: TrainingCase) => String(b.savedAt).localeCompare(String(a.savedAt))
  return same.sort(byNew).concat(rest.sort(byNew)).slice(0, n)
}

/** The block of text the advisor reads. Empty string when nothing has been taught yet. */
export function trainingPrompt(t: Training, category: string): string {
  const cases = nearestCases(t, category)
  const parts: string[] = []
  if (t.guidance.trim()) {
    parts.push('HOUSE GUIDANCE FROM THE TEAM (follow it when classifying; it outranks your own instincts):\n' + t.guidance.trim())
  }
  if (cases.length) {
    parts.push('PAST CASES THE TEAM SAVED AS PRECEDENT. Use them to calibrate severity and where in the band this lands. Match the reasoning, not the number:\n' +
      cases.map((c, i) => {
        const pct = c.nightly && c.nights ? Math.round((c.paid / (c.nightly * c.nights)) * 100) : null
        return `${i + 1}. [${c.category || 'uncategorised'} · ${c.channel || 'channel?'} · ${c.nights || '?'} nights${c.nightly ? ' at $' + c.nightly : ''}] ${c.what}\n` +
          `   We paid $${c.paid}${pct != null ? ' (' + pct + '% of the stay)' : ''}${c.recommended != null ? '; the advisor had said $' + c.recommended : ''}.` +
          (c.lesson ? `\n   Lesson: ${c.lesson}` : '')
      }).join('\n'))
  }
  return parts.join('\n\n')
}
