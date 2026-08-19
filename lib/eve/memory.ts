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

/** Load the memories that matter for this turn, highest weight first. */
export async function loadMemories(scopes: string[], email: string, limit = 60): Promise<EveMemory[]> {
  const db = supabaseAdmin()
  const wanted = scopes.slice()
  if (email) wanted.push('person:' + lc(email))
  try {
    const { data, error } = await db.from('eve_memory')
      .select('*')
      .is('superseded_by', null)
      .in('scope', wanted)
      .order('weight', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error) return []
    const today = new Date().toISOString().slice(0, 10)
    return (data || []).filter((r: any) => !r.expires_on || String(r.expires_on) >= today) as EveMemory[]
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

export async function saveMemory(input: SaveMemoryInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const db = supabaseAdmin()
  const text = String(input.text || '').trim().slice(0, 1000)
  if (!text) return { ok: false, error: 'empty memory' }
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
