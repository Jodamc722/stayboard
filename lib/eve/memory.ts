// Eve's memory — the difference between a search box and a colleague.
//
// WHY A TABLE AND NOT A PROMPT CONSTANT. Everything Eve "knew" before this lived in a string literal
// in the route, which meant only a deploy could teach her anything. A row here is written by Jon
// telling her something, or by Eve noticing something, and it reaches her next turn.
//
// SCOPING IS THE WHOLE TRICK. Loading every memory into every turn would blow the prompt and bury
// the relevant ones. Portfolio-scoped memories always load; building- and unit-scoped ones only load
// when that building or unit is actually in play. Scope is resolved deterministically from the
// listing registry, NOT by asking a model to guess.
//
// SUPERSEDING, NOT DELETING. When Eve is corrected, the old memory gets `superseded_by` pointed at
// the new one rather than being dropped, so the audit trail survives and /eve can show what changed.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lc } from './ctx'

export const MEMORY_KINDS = ['rule', 'preference', 'insight', 'decision', 'person', 'issue', 'correction'] as const
export type MemoryKind = typeof MEMORY_KINDS[number]

export type EveMemory = {
  id: string
  kind: string
  text: string
  why: string | null
  scope: string
  weight: number
  source: string
  confidence: number | null
  evidence: any
  created_by: string | null
  use_count: number
  last_used_at: string | null
  expires_on: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
}

export function normKind(v: any): MemoryKind {
  const k = lc(v).trim()
  return (MEMORY_KINDS as readonly string[]).includes(k) ? (k as MemoryKind) : 'insight'
}
export function normWeight(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 5
  return Math.min(10, Math.max(1, Math.round(n)))
}
/** Scope strings are `portfolio`, `building:<Rollup>`, `unit:<listingId>`, `person:<email>`. */
export function normScope(v: any): string {
  const s = String(v || '').trim()
  if (!s) return 'portfolio'
  if (s === 'portfolio') return 'portfolio'
  const m = s.match(/^(building|unit|person)\s*:\s*(.+)$/i)
  if (!m) return 'portfolio'
  return lc(m[1]) + ':' + m[2].trim()
}

/**
 * Which scopes are relevant to this question? Deterministic: we look for known building names and
 * known unit names in the text. No model call, no guessing — a building either appears or it does not.
 */
export function scopesForText(text: string, listingMeta: Record<string, { name: string; rollup: string }>): string[] {
  const hay = lc(text)
  const scopes: string[] = ['portfolio']
  const buildings: Record<string, true> = {}
  const ids: string[] = []
  const keys = Object.keys(listingMeta)
  for (const id of keys) {
    const m = listingMeta[id]
    const b = m.rollup
    if (b && b !== 'Unassigned' && hay.includes(lc(b))) buildings[b] = true
    const n = m.name
    // Unit names are short and collide with ordinary words, so require a reasonably specific match.
    if (n && n.length >= 4 && hay.includes(lc(n))) ids.push(id)
  }
  const bKeys = Object.keys(buildings)
  for (const b of bKeys) scopes.push('building:' + b)
  for (const id of ids.slice(0, 6)) scopes.push('unit:' + id)
  return scopes
}

// Tokenise for relevance scoring: lowercase words of 3+ chars, minus glue words that carry no
// signal. Deterministic and cheap — this runs on every turn, so no model call and no regex storms.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'have', 'has', 'are', 'was', 'were', 'you', 'your', 'her', 'she', 'about', 'should', 'would', 'could', 'from', 'into', 'they', 'them', 'there', 'their', 'been', 'being', 'not', 'can', 'will', 'why', 'how', 'who', 'all', 'any', 'our', 'out', 'get', 'got'])
function words(s: string): string[] {
  return lc(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w))
}

/**
 * Load the memories that matter for THIS turn. Two-stage on purpose:
 *   1. SQL narrows to the relevant scopes (never the whole table) and returns a wide candidate set.
 *   2. In-process ranking orders candidates by weight, proven usefulness (use_count), recency, AND
 *      overlap with the actual question — so when Jon asks about refunds, the refund rules beat an
 *      equally-weighted note about parking, instead of losing on a tie-break of updated_at.
 * The question is optional; without it the ranking degrades exactly to the old weight/recency order.
 */
export async function loadMemories(scopes: string[], email: string, limit = 60, question = ''): Promise<EveMemory[]> {
  const db = supabaseAdmin()
  const wanted = scopes.slice()
  if (email) wanted.push('person:' + lc(email))
  try {
    const { data, error } = await db.from('eve_memory')
      .select('id,kind,text,why,scope,weight,source,confidence,evidence,created_by,use_count,last_used_at,expires_on,superseded_by,created_at,updated_at')
      .is('superseded_by', null)
      .in('scope', wanted)
      .order('weight', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(Math.max(limit * 2, 120))
    if (error) return []
    const today = new Date().toISOString().slice(0, 10)
    const live = ((data || []) as any[]).filter(r => !r.expires_on || String(r.expires_on) >= today)
    const qWords = new Set(words(question))
    const now = Date.now()
    const scored = live.map(r => {
      let rel = 0
      if (qWords.size) {
        for (const w of words(String(r.text || '') + ' ' + String(r.why || ''))) if (qWords.has(w)) rel++
      }
      const ageDays = Math.max(0, (now - new Date(r.updated_at || r.created_at).getTime()) / 864e5)
      const recency = ageDays < 7 ? 3 : ageDays < 30 ? 2 : ageDays < 90 ? 1 : 0
      // Rules and corrections must never be crowded out by chatty insights — they get a floor bump.
      const kindBump = r.kind === 'rule' || r.kind === 'correction' ? 4 : r.kind === 'preference' ? 2 : 0
      const score = Number(r.weight || 0) * 3 + Math.min(Number(r.use_count || 0), 12) + recency + Math.min(rel, 6) * 4 + kindBump
      return { r, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(x => x.r) as EveMemory[]
  } catch { return [] }
}

/** Render for the system prompt. Grouped by kind so rules read as rules, not as trivia. */
export function renderMemories(rows: EveMemory[]): string {
  if (!rows.length) return ''
  const order = ['rule', 'preference', 'correction', 'decision', 'issue', 'person', 'insight']
  const byKind: Record<string, EveMemory[]> = {}
  for (const r of rows) { (byKind[r.kind] = byKind[r.kind] || []).push(r) }
  const out: string[] = []
  for (const k of order) {
    const list = byKind[k]
    if (!list || !list.length) continue
    const label = k === 'rule' ? 'STANDING RULES (follow these, they came from Jon)'
      : k === 'preference' ? 'HOW JON WANTS THINGS'
      : k === 'correction' ? 'MISTAKES YOU HAVE MADE BEFORE — do not repeat them'
      : k === 'decision' ? 'DECISIONS ALREADY MADE'
      : k === 'issue' ? 'KNOWN RECURRING ISSUES'
      : k === 'person' ? 'PEOPLE / NAME MAPPINGS'
      : 'THINGS YOU HAVE LEARNED'
    const lines = list.map(r => {
      const sc = r.scope === 'portfolio' ? '' : ` [${r.scope}]`
      const why = r.why ? ` (why: ${r.why})` : ''
      return `- ${r.text}${why}${sc}`
    })
    out.push(label + ':\n' + lines.join('\n'))
  }
  return out.join('\n\n')
}

export type SaveMemoryInput = {
  kind?: any; text: string; why?: any; scope?: any; weight?: any
  source?: string; confidence?: any; evidence?: any; created_by?: string | null
  supersedes?: string | null; expires_on?: string | null
}

// Near-duplicate test for the dedupe below: same words is the same memory, however punctuated.
function sameThought(a: string, b: string): boolean {
  const A = new Set(words(a)), B = new Set(words(b))
  if (!A.size || !B.size) return lc(a).trim() === lc(b).trim()
  let inter = 0
  A.forEach(w => { if (B.has(w)) inter++ })
  const jaccard = inter / (A.size + B.size - inter)
  const containment = inter / Math.min(A.size, B.size)
  return jaccard >= 0.85 || (containment >= 0.95 && Math.min(A.size, B.size) >= 4)
}

export async function saveMemory(input: SaveMemoryInput): Promise<{ ok: boolean; id?: string; error?: string; deduped?: boolean }> {
  const db = supabaseAdmin()
  const text = String(input.text || '').trim().slice(0, 1000)
  if (!text) return { ok: false, error: 'empty memory' }

  // DEDUPE, DON'T PILE UP (Jon, 2026-08-19: "make the memory feature faster and better"). The
  // nightly sweep and the remember tool both re-learn the same facts; before this, each re-learning
  // was a fresh row, so the table grew noise and the prompt budget filled with repeats. Now a new
  // memory that says what an existing same-scope one already says REINFORCES it — weight keeps the
  // higher value, the timestamp refreshes (so it ranks as current), and the row count stays flat.
  try {
    const scope = normScope(input.scope)
    const { data: peers } = await db.from('eve_memory')
      .select('id,text,weight,why')
      .is('superseded_by', null).eq('scope', scope)
      .order('updated_at', { ascending: false }).limit(120)
    const twin = ((peers || []) as any[]).find(p => sameThought(String(p.text || ''), text))
    if (twin) {
      await db.from('eve_memory').update({
        weight: Math.max(Number(twin.weight || 0), normWeight(input.weight)),
        why: twin.why || (input.why ? String(input.why).slice(0, 500) : null),
        updated_at: new Date().toISOString(),
      }).eq('id', twin.id)
      return { ok: true, id: twin.id, deduped: true }
    }
  } catch { /* dedupe is an optimisation — a failed check must never block learning */ }
  const row: any = {
    kind: normKind(input.kind),
    text,
    why: input.why ? String(input.why).slice(0, 500) : null,
    scope: normScope(input.scope),
    weight: normWeight(input.weight),
    source: ['jon', 'eve', 'system'].includes(String(input.source)) ? String(input.source) : 'eve',
    confidence: Number.isFinite(Number(input.confidence)) ? Math.min(1, Math.max(0, Number(input.confidence))) : null,
    evidence: input.evidence ?? null,
    created_by: input.created_by || null,
    expires_on: input.expires_on || null,
    updated_at: new Date().toISOString(),
  }
  try {
    const { data, error } = await db.from('eve_memory').insert(row).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    const id = (data as any)?.id
    if (input.supersedes && id) {
      await db.from('eve_memory').update({ superseded_by: id, updated_at: new Date().toISOString() }).eq('id', input.supersedes)
    }
    return { ok: true, id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/** Bump usage so the /eve page can show which memories are actually earning their place. */
export async function touchMemories(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = supabaseAdmin()
  try {
    await db.rpc('eve_touch_memories', { ids })
  } catch {
    // No RPC (migration not run, or PostgREST hasn't reloaded) — degrade to a plain stamp.
    try { await db.from('eve_memory').update({ last_used_at: new Date().toISOString() }).in('id', ids) } catch { /* never break a turn over telemetry */ }
  }
}

/**
 * MEMORY HYGIENE (Jon, 2026-08-19: "update constantly"). Learning forever means accumulating
 * forever unless something forgets. Every learning pass retires self-learned insights that have
 * EARNED retirement: source 'eve', never once loaded into a prompt (use_count 0), low weight, and
 * untouched for 60+ days. They are expired, not deleted — visible under include_superseded-style
 * review, recoverable by editing, and gone from every future prompt. Anything Jon taught her
 * (source 'jon') is never touched by this: humans retire human knowledge.
 */
export async function pruneStaleMemories(): Promise<number> {
  const db = supabaseAdmin()
  try {
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString()
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await db.from('eve_memory')
      .update({ expires_on: today, updated_at: new Date().toISOString() })
      .eq('source', 'eve').eq('use_count', 0).lte('weight', 4)
      .is('superseded_by', null).is('expires_on', null)
      .lt('updated_at', cutoff)
      .select('id')
    return (data || []).length
  } catch { return 0 }
}
