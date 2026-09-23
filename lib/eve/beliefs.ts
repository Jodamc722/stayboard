// BELIEFS, NOT NOTES (Jon, 2026-09-23: "She needs to operate like a neural network, like a human,
// not just a list of memories, constantly updating, learning, improving.").
//
// Until now a memory was a sentence with a weight, and the weight never moved: a hunch Eve wrote down
// in August was exactly as sure of itself in December, whether or not anything had borne it out, and
// nothing she saw afterwards could make it stronger or weaker. A person does not hold beliefs like
// that. What they are sure of depends on who told them, how often it has held up, and how long it has
// been since it was last true in front of them.
//
// So every row in eve_memory is now a BELIEF with four things a person would weigh:
//
//   1. AUTHORITY: who said it. Jon > a company document > a colleague > the data sweep > Eve's own
//      inference > something overheard in Slack. Authority never changes; it is where the belief came
//      from.
//   2. CONFIDENCE: how sure she is, 0 to 1. It starts where the source puts it and then MOVES:
//      evidence that bears a belief out (a prediction built on it came true, an answer that used it
//      got a thumbs-up, the nightly reflection saw it hold) pushes it up; evidence against pushes it
//      down. The history of every move is kept on the row (evidence.belief.history), so "why do you
//      think that?" always has an answer.
//   3. DECAY: a belief Eve arrived at herself fades if nothing re-confirms it. Half-life 60 days from
//      the last time it held up. A belief a PERSON gave her does not fade with time, because "humans
//      retire human knowledge" (lib/eve/memory.ts), and evidence against it does not quietly lower it
//      either: it is marked disputed and becomes a question for Jon.
//   4. STRENGTH = authority × current confidence. That is what ranks it for the prompt, what decides
//      whether she says it flatly or says "I think, but check", and what retires it when it falls
//      below the floor.
//
// NO MIGRATION. eve_memory has carried an unused `confidence` column and a free-form `evidence` JSON
// since migration 045, and both are exactly what this needs. Migrations here are run by hand and a
// feature that needs one ships dark (see lib/eve/study.ts), so this one uses what is already there.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** Sources a PERSON stands behind. Time never fades them and data never quietly overrules them. */
export const HUMAN_SOURCES = new Set(['jon', 'doc', 'staff'])

const AUTHORITY: Record<string, number> = { jon: 1, doc: 0.9, staff: 0.8, system: 0.7, telegram: 0.7, eve: 0.6, slack: 0.5 }
const BASE_CONFIDENCE: Record<string, number> = { jon: 0.95, doc: 0.85, staff: 0.8, system: 0.7, telegram: 0.7, eve: 0.6, slack: 0.55 }
/** Days for an unconfirmed self-made belief to lose half its confidence. */
export const HALF_LIFE_DAYS = 60
/** Below this a self-made belief leaves the prompt, and the nightly pass retires it. */
export const RETIRE_BELOW = 0.15
/** Below this she says it as a hunch, not a fact. */
export const UNSURE_BELOW = 0.45

export type BeliefState = {
  for: number
  against: number
  lastConfirmed: string | null
  lastContradicted: string | null
  disputed?: boolean
  history: { at: string; d: number; why: string }[]
}

type Row = { source?: any; confidence?: any; evidence?: any; updated_at?: any; created_at?: any; last_hit_at?: any }

export const authorityOf = (source: any): number => AUTHORITY[String(source || '')] ?? 0.6
export const isHuman = (source: any): boolean => HUMAN_SOURCES.has(String(source || ''))

export function beliefOf(row: Row): BeliefState {
  const ev = row?.evidence
  const b = ev && typeof ev === 'object' && !Array.isArray(ev) ? ev.belief : null
  return {
    for: Number(b?.for) || 0,
    against: Number(b?.against) || 0,
    lastConfirmed: b?.lastConfirmed || null,
    lastContradicted: b?.lastContradicted || null,
    disputed: !!b?.disputed,
    history: Array.isArray(b?.history) ? b.history.slice(-12) : [],
  }
}

/** Stored confidence, or where this source starts. */
export function storedConfidence(row: Row): number {
  const c = Number(row?.confidence)
  if (row?.confidence != null && Number.isFinite(c)) return Math.min(1, Math.max(0, c))
  return BASE_CONFIDENCE[String(row?.source || '')] ?? 0.6
}

/** Confidence right now: the stored figure, faded by time since it last held up (self-made beliefs only). */
export function currentConfidence(row: Row, now = Date.now()): number {
  const c = storedConfidence(row)
  if (isHuman(row?.source)) return c
  const b = beliefOf(row)
  // The last time this was true in front of her: a confirmation, else an answer that drew on it,
  // else when it was written or last reinforced.
  const anchor = b.lastConfirmed || row?.last_hit_at || row?.updated_at || row?.created_at
  const t = Date.parse(String(anchor || ''))
  if (!Number.isFinite(t)) return c
  const days = Math.max(0, (now - t) / 864e5)
  return c * Math.pow(0.5, days / HALF_LIFE_DAYS)
}

/** Authority × current confidence, 0..1. */
export function beliefStrength(row: Row, now = Date.now()): number {
  return authorityOf(row?.source) * currentConfidence(row, now)
}

/** The short tag the prompt carries when she should not state a belief flatly. '' when she can. */
export function beliefTag(row: Row, now = Date.now()): string {
  const b = beliefOf(row)
  if (b.disputed) return ' (recent evidence disputes this; a question is open with Jon, so say so if you rely on it)'
  if (isHuman(row?.source)) return ''
  const c = currentConfidence(row, now)
  if (c < UNSURE_BELOW) return ` (a hunch, ${Math.round(c * 100)}% sure; check the data before relying on it)`
  return ''
}

export function withBelief(evidence: any, belief: BeliefState): any {
  const base = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : (evidence == null ? {} : { prior: evidence })
  return { ...base, belief }
}

export type BeliefMove = { id: string; from: number; to: number; disputed?: boolean; skipped?: string }

/**
 * Evidence FOR or AGAINST a set of beliefs. `strength` 0..1 scales the move (a thumbs-up on an
 * answer is weak evidence; a confident prediction that came true is stronger).
 *
 * The update is proportional to the room left: support closes a quarter of the gap to 1, a
 * contradiction takes away a third of what is there. So nothing reaches certainty on its own, and a
 * belief that has held up many times needs several misses to fall.
 *
 * Against a PERSON'S belief (jon / doc / staff) the confidence does not move. The row is marked
 * disputed and the caller is told, so it can ask Jon; data never quietly overrules a person.
 */
export async function moveBeliefs(ids: string[], dir: 1 | -1, why: string, strength = 1): Promise<BeliefMove[]> {
  const uniq = Array.from(new Set(ids.map(String).filter(Boolean))).slice(0, 40)
  if (!uniq.length) return []
  const db = supabaseAdmin()
  const out: BeliefMove[] = []
  const s = Math.min(1, Math.max(0.05, Number(strength) || 1))
  const now = new Date().toISOString()
  try {
    const { data } = await db.from('eve_memory').select('id,source,confidence,evidence,updated_at,created_at,superseded_by').in('id', uniq)
    for (const r of ((data as any[]) || [])) {
      if (r.superseded_by) { out.push({ id: r.id, from: 0, to: 0, skipped: 'superseded' }); continue }
      const b = beliefOf(r)
      const from = storedConfidence(r)
      let to = from
      const patch: any = {}
      if (dir > 0) {
        to = from + (1 - from) * 0.25 * s
        b.for += 1; b.lastConfirmed = now
        // Held up again: a dispute raised by one bad day does not outlive the evidence that settles it.
        if (b.disputed && b.for > b.against + 1) b.disputed = false
      } else {
        b.against += 1; b.lastContradicted = now
        if (isHuman(r.source)) b.disputed = true
        else to = from - from * 0.35 * s
      }
      to = Math.round(Math.min(0.99, Math.max(0.01, to)) * 1000) / 1000
      b.history = b.history.concat([{ at: now, d: Math.round((to - from) * 1000) / 1000, why: String(why || '').slice(0, 160) }]).slice(-12)
      patch.evidence = withBelief(r.evidence, b)
      if (to !== from) patch.confidence = to
      await db.from('eve_memory').update(patch).eq('id', r.id)
      out.push({ id: r.id, from, to, ...(b.disputed ? { disputed: true } : {}) })
    }
  } catch { /* bookkeeping; never worth failing the caller over */ }
  return out
}

export const reinforceBeliefs = (ids: string[], why: string, strength = 1) => moveBeliefs(ids, 1, why, strength)
export const contradictBeliefs = (ids: string[], why: string, strength = 1) => moveBeliefs(ids, -1, why, strength)

/** For "how sure are you" questions and the nightly journal: the shape of what she believes. */
export async function beliefStats(): Promise<{
  total: number; bySource: Record<string, number>; unsure: number; disputed: number; fading: number
  strengthened7d: { id: string; text: string; to: number }[]; weakened7d: { id: string; text: string; to: number }[]
}> {
  const db = supabaseAdmin()
  const out = { total: 0, bySource: {} as Record<string, number>, unsure: 0, disputed: 0, fading: 0, strengthened7d: [] as any[], weakened7d: [] as any[] }
  try {
    const { pageRows } = await import('@/lib/db-page')
    const { rows } = await pageRows<any>((a, b) => db.from('eve_memory')
      .select('id,text,source,confidence,evidence,updated_at,created_at,last_hit_at,expires_on')
      .is('superseded_by', null).order('id').range(a, b), 6)
    const today = new Date().toISOString().slice(0, 10)
    const since = Date.now() - 7 * 864e5
    for (const r of rows) {
      if (r.expires_on && String(r.expires_on) < today) continue
      out.total++
      out.bySource[r.source] = (out.bySource[r.source] || 0) + 1
      const b = beliefOf(r)
      if (b.disputed) out.disputed++
      if (!isHuman(r.source)) {
        const c = currentConfidence(r)
        if (c < UNSURE_BELOW) out.unsure++
        if (storedConfidence(r) - c > 0.15) out.fading++
      }
      const recent = b.history.filter(h => Date.parse(h.at) >= since)
      const net = recent.reduce((s, h) => s + Number(h.d || 0), 0)
      if (recent.length && net > 0) out.strengthened7d.push({ id: r.id, text: String(r.text).slice(0, 140), to: storedConfidence(r) })
      if (recent.length && (net < 0 || b.disputed)) out.weakened7d.push({ id: r.id, text: String(r.text).slice(0, 140), to: storedConfidence(r) })
    }
    out.strengthened7d = out.strengthened7d.slice(0, 8)
    out.weakened7d = out.weakened7d.slice(0, 8)
  } catch { /* an empty picture is honest when the read fails */ }
  return out
}
