// AUDITING WHAT EVE BELIEVES.
//
// Jon, 2026-08-24: "run a clean audit of memory of Eve, clean it up, get rid of useless memory,
// make it more tight and efficient and useful."
//
// Memory is the only part of this system with a running cost per turn. Every live memory in scope
// is rendered into the prompt on EVERY message, so a vague line nobody needed is not neutral — it
// is rent, paid forever, in the space a useful line could have used. Learning without forgetting
// is just accumulation, and accumulation degrades the thing it was meant to improve.
//
// FIVE THINGS GO WRONG, and each needs a different remedy, which is why this is an audit rather
// than a delete button:
//
//   DUPLICATES ACROSS SCOPES  saveMemory dedupes within a scope. The same thought written once at
//                             portfolio and once at building level is invisible to that check and
//                             costs double.
//   CONTRADICTIONS            two live memories that disagree. Nothing has ever looked for these,
//                             and they are the worst kind of bloat: Eve picks one at random.
//   VAGUE                     "guests appreciate cleanliness". True, useless, and indistinguishable
//                             from a real rule until you read it. No number, no name, no date.
//   NEVER USED                written months ago, never once loaded into a prompt. The clearest
//                             possible evidence that it is not earning its rent.
//   WITHDRAWN EVIDENCE        a swept insight whose finding stopped coming back — handled by
//                             revalidateSweptMemories in the sweep, and counted here so the size
//                             of that problem is visible rather than silently self-correcting.
//
// NOTHING HERE DELETES ANYTHING BY ITSELF, and nothing here touches a memory a human wrote. Every
// output is a PROPOSAL with the row, the reason and the evidence, for a person to accept. Eve
// pruning her own instructions on her own judgement is precisely the loop nobody should build.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lc } from './ctx'
import type { EveMemory } from './memory'

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'have', 'has', 'are', 'was', 'were', 'you', 'your', 'her', 'she', 'about', 'should', 'would', 'could', 'from', 'into', 'they', 'them', 'there', 'their', 'been', 'being', 'not', 'can', 'will', 'why', 'how', 'who', 'all', 'any', 'our', 'out', 'get', 'got', 'more', 'less', 'than', 'over', 'under'])

function words(s: string): string[] {
  return lc(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
}
function overlap(a: string, b: string): number {
  const A = new Set(words(a)), B = new Set(words(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  A.forEach(w => { if (B.has(w)) inter++ })
  return inter / (A.size + B.size - inter)
}

// Polarity markers. Two memories about the same subject where one negates and the other does not
// are a contradiction candidate — not a verdict, a candidate. A human reads the pair.
const NEG = /\b(never|not|no longer|don'?t|do not|avoid|stop|without|cannot|can'?t|refuse|exclude)\b/i
const POS = /\b(always|must|should|do\b|use|include|prefer|require)\b/i

/** A memory with no number, no name, no date and no unit is almost never worth prompt space. */
function isVague(m: EveMemory): boolean {
  const t = String(m.text || '')
  if (t.length < 25) return true
  const hasNumber = /\d/.test(t)
  const hasProper = /\b[A-Z][a-z]{2,}\b/.test(t.replace(/^[A-Z]/, ''))
  const hasScope = m.scope && m.scope !== 'portfolio'
  return !hasNumber && !hasProper && !hasScope
}

export type MemoryFinding = {
  kind: 'duplicate' | 'contradiction' | 'vague' | 'unused' | 'withdrawn'
  severity: 'high' | 'medium' | 'low'
  reason: string
  /** What to do about it. Applied only when a person says so. */
  proposal: 'merge' | 'expire' | 'review'
  ids: string[]
  rows: { id: string; kind: string; scope: string; weight: number; source: string; text: string; use_count: number; updated_at: string }[]
}

export type MemoryAudit = {
  live: number
  bySource: Record<string, number>
  byKind: Record<string, number>
  promptCost: { chars: number; approxTokens: number; note: string }
  neverUsed: number
  humanWritten: number
  findings: MemoryFinding[]
  summary: string
}

const shape = (m: any) => ({
  id: String(m.id), kind: String(m.kind), scope: String(m.scope), weight: Number(m.weight),
  source: String(m.source), text: String(m.text || '').slice(0, 400),
  use_count: Number(m.use_count || 0), updated_at: String(m.updated_at),
})

export async function auditMemory(opts?: { limit?: number }): Promise<MemoryAudit> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_memory')
    .select('id,kind,text,why,scope,weight,source,confidence,evidence,use_count,last_used_at,expires_on,created_at,updated_at')
    .is('superseded_by', null).is('expires_on', null)
    .order('weight', { ascending: false }).limit(Math.min(opts?.limit || 800, 1500))
  const rows = (data || []) as any[]

  const bySource: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  let chars = 0
  for (const m of rows) {
    bySource[String(m.source)] = (bySource[String(m.source)] || 0) + 1
    byKind[String(m.kind)] = (byKind[String(m.kind)] || 0) + 1
    chars += String(m.text || '').length + String(m.why || '').length
  }

  const findings: MemoryFinding[] = []
  const human = rows.filter(m => String(m.source) === 'jon')

  // ---- duplicates, INCLUDING across scopes (the gap saveMemory cannot see) ----
  const seen = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    if (seen.has(String(rows[i].id))) continue
    const group = [rows[i]]
    for (let j = i + 1; j < rows.length; j++) {
      if (seen.has(String(rows[j].id))) continue
      if (overlap(rows[i].text, rows[j].text) >= 0.75) group.push(rows[j])
    }
    if (group.length < 2) continue
    group.forEach(g => seen.add(String(g.id)))
    const scopes = Array.from(new Set(group.map(g => String(g.scope))))
    findings.push({
      kind: 'duplicate', severity: group.length > 2 ? 'high' : 'medium',
      reason: scopes.length > 1
        ? `${group.length} memories say the same thing across ${scopes.length} scopes (${scopes.join(', ')}). Deduplication only ever looked within a scope, so these have been paying rent side by side.`
        : `${group.length} memories in ${scopes[0]} say the same thing.`,
      proposal: 'merge', ids: group.map(g => String(g.id)), rows: group.map(shape),
    })
  }

  // ---- contradictions: same subject, opposite polarity ----
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      if (String(a.scope) !== String(b.scope)) continue
      const ov = overlap(a.text, b.text)
      if (ov < 0.45 || ov >= 0.75) continue          // 0.75+ is a duplicate, already handled
      const aNeg = NEG.test(a.text), bNeg = NEG.test(b.text)
      if (aNeg === bNeg) continue
      if (!POS.test(aNeg ? b.text : a.text)) continue
      findings.push({
        kind: 'contradiction', severity: 'high',
        reason: 'These two talk about the same thing and one negates the other. Eve currently has both and will follow whichever ranks higher on the turn — which is not a decision anybody made.',
        proposal: 'review', ids: [String(a.id), String(b.id)], rows: [shape(a), shape(b)],
      })
    }
  }

  // ---- vague, never used, and withdrawn ----
  const vague = rows.filter(m => String(m.source) !== 'jon' && isVague(m))
  if (vague.length) {
    findings.push({
      kind: 'vague', severity: vague.length > 15 ? 'medium' : 'low',
      reason: `${vague.length} memories carry no number, no name, no date and no scope. True-but-useless lines are the hardest bloat to spot, because they read like knowledge.`,
      proposal: 'expire', ids: vague.map(m => String(m.id)), rows: vague.slice(0, 40).map(shape),
    })
  }

  const cutoff = Date.now() - 45 * 864e5
  const unused = rows.filter(m => String(m.source) !== 'jon' && Number(m.use_count || 0) === 0 && Date.parse(String(m.created_at)) < cutoff)
  if (unused.length) {
    findings.push({
      kind: 'unused', severity: unused.length > 40 ? 'high' : 'medium',
      reason: `${unused.length} memories are over six weeks old and have never once been loaded into a prompt. That is the clearest evidence available that they are not earning their place.`,
      proposal: 'expire', ids: unused.map(m => String(m.id)), rows: unused.slice(0, 40).map(shape),
    })
  }

  const withdrawn = rows.filter(m => String(m.source) === 'system' && m?.evidence?.sweptOn
    && Date.parse(String(m.evidence.sweptOn)) < Date.now() - 21 * 864e5)
  if (withdrawn.length) {
    findings.push({
      kind: 'withdrawn', severity: 'medium',
      reason: `${withdrawn.length} swept insights have not been re-confirmed by a sweep in three weeks. The nightly re-validation expires these automatically once their finding stops coming back; anything still here either keeps reappearing or predates that check.`,
      proposal: 'review', ids: withdrawn.map(m => String(m.id)), rows: withdrawn.slice(0, 30).map(shape),
    })
  }

  const approxTokens = Math.round(chars / 4)
  const neverUsed = rows.filter(m => Number(m.use_count || 0) === 0).length
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    live: rows.length, bySource, byKind,
    promptCost: {
      chars, approxTokens,
      note: `Roughly ${approxTokens} tokens of memory exist. Not all of it loads on every turn — memories are selected by scope and question — but this is the pool, and it is paid for out of the same budget as the actual conversation.`,
    },
    neverUsed, humanWritten: human.length,
    findings: findings.slice(0, 60),
    summary: `${rows.length} live memories (${human.length} written by a person, the rest learned). ${neverUsed} have never been used. ${findings.length} thing(s) worth cleaning up.`,
  }
}

/**
 * Apply a decision. Expiry, never deletion — the audit trail is the only way to answer "why did
 * she stop believing that", and a memory somebody expired by mistake can be brought back.
 *
 * A merge keeps the heaviest, most-used row and expires the rest, folding their weight into the
 * survivor so a thought that was learned four times does not come out weaker than one learned once.
 */
export async function applyMemoryDecision(input: {
  op: 'expire' | 'merge' | 'keep'; ids: string[]; by: string
}): Promise<{ ok: boolean; changed: number; kept?: string; error?: string }> {
  const db = supabaseAdmin()
  const ids = (input.ids || []).map(String).filter(Boolean)
  if (!ids.length) return { ok: false, changed: 0, error: 'no ids' }
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  try {
    // A human's own memory is never expired by this path, whatever was asked for.
    const { data } = await db.from('eve_memory').select('id,source,weight,use_count').in('id', ids)
    const rows = (data || []) as any[]
    const touchable = rows.filter(r => String(r.source) !== 'jon')
    if (!touchable.length) return { ok: false, changed: 0, error: 'Those memories were written by a person. Edit or delete them yourself in the Memory tab.' }

    if (input.op === 'keep') {
      await db.from('eve_memory').update({ updated_at: now }).in('id', touchable.map(r => r.id))
      return { ok: true, changed: touchable.length }
    }

    if (input.op === 'merge') {
      const survivor = rows.slice().sort((a, b) =>
        Number(b.use_count || 0) - Number(a.use_count || 0) || Number(b.weight || 0) - Number(a.weight || 0)
      )[0]
      const losers = touchable.filter(r => String(r.id) !== String(survivor.id))
      if (!losers.length) return { ok: true, changed: 0, kept: String(survivor.id) }
      const weight = Math.min(10, Math.max(...rows.map(r => Number(r.weight || 0))))
      await db.from('eve_memory').update({ weight, updated_at: now }).eq('id', survivor.id)
      await db.from('eve_memory').update({ superseded_by: survivor.id, updated_at: now }).in('id', losers.map(r => r.id))
      return { ok: true, changed: losers.length, kept: String(survivor.id) }
    }

    await db.from('eve_memory').update({ expires_on: today, updated_at: now }).in('id', touchable.map(r => r.id))
    return { ok: true, changed: touchable.length }
  } catch (e: any) { return { ok: false, changed: 0, error: String(e?.message || e).slice(0, 200) } }
}
