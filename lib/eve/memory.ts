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
import { lc, pageRows } from './ctx'
import { otaChannelOf, channelsInText } from '@/lib/ota-playbook'
import { isSuperadmin } from '@/lib/access'
import { beliefStrength, beliefTag, currentConfidence, isHuman, RETIRE_BELOW, beliefOf, storedConfidence, withBelief } from './beliefs'
import { aiFetch } from '@/lib/ai-usage'
import { modelFor } from '@/lib/ai-models'
import { looksLikeDoorCode, codeNearDigits } from './redact'
import { buildingOf, KNOWN_BUILDINGS } from '@/lib/segments'

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
/**
 * Scope strings are `portfolio`, `building:<Rollup>`, `unit:<listingId>`, `person:<email>` and,
 * since the OTA playbook (2026-09-21), `channel:<Airbnb|Vrbo|Booking.com|Expedia|Direct|Other>` —
 * a channel rule loads only when that channel is in the conversation, the way a building rule does.
 */
export function normScope(v: any): string {
  const s = String(v || '').trim()
  if (!s) return 'portfolio'
  if (s === 'portfolio') return 'portfolio'
  const m = s.match(/^(building|unit|person|channel)\s*:\s*(.+)$/i)
  if (!m) return 'portfolio'
  if (lc(m[1]) === 'channel') { const ch = otaChannelOf(m[2]); return ch ? 'channel:' + ch : 'portfolio' }
  return lc(m[1]) + ':' + m[2].trim()
}

/**
 * ONE SPELLING PER BUILDING, ON THE WAY IN (2026-11-09). A scope is matched as a plain string, and the
 * reader of the Slack rooms wrote the name however the room did — "building:17 West", "building:17west",
 * "building:17WEST" were three scopes, so the same-scope dedupe missed them and recall (which asks for
 * 'building:' + the listing rollup) never loaded two of the three. canonBuilding maps a name onto the
 * canonical label in lib/segments (the same label the rollup uses) or returns null for a name it does
 * not know; canonScope applies it to a scope string and leaves anything else exactly as normScope does.
 * Used on the WRITE path only — reads are unchanged, so rows already stored are still found as before.
 */
export function canonBuilding(name: any): string | null {
  const raw = String(name || '').trim()
  if (!raw) return null
  const hit = buildingOf(raw, null)
  return hit && KNOWN_BUILDINGS.some(b => b.label === hit) ? hit : null
}
export function canonScope(v: any): string {
  const s = normScope(v)
  if (!s.startsWith('building:')) return s
  const b = canonBuilding(s.slice('building:'.length))
  return b ? 'building:' + b : s
}

/**
 * Buildings named in free text, by the alias patterns in lib/segments (canonBuilding). One- and
 * two-word runs are tried. Guards against the patterns that are right for a listing name and wrong
 * for a sentence: a bare number ("906") or a two-letter code ("pt") never names a building here, and
 * a two-word run counts only when neither word names a building by itself ("park towers", "17 west",
 * "district 225" — not "elser 906", which the single word already found, and not "906 is").
 */
export function buildingsNamedIn(text: string): string[] {
  const toks = lc(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(-3000)
  const out: Record<string, true> = {}
  const one: Record<string, string | null> = {}
  const alone = (t: string): string | null => {
    if (!(t in one)) one[t] = canonBuilding(t)
    return one[t]
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.length >= 4 && !/^\d+$/.test(t)) { const b = alone(t); if (b) out[b] = true }
    const u = toks[i + 1]
    if (!u || (/^\d+$/.test(t) && /^\d+$/.test(u))) continue
    if (alone(t) || alone(u)) continue
    const b2 = canonBuilding(t + ' ' + u)
    if (b2) out[b2] = true
  }
  return Object.keys(out)
}

/** A row id that can be handed to a uuid column without the query failing. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * UNCONFIRMED (2026-11-10). What she overheard in a Slack room or concluded in her nightly reflection
 * is a claim nobody has checked. It is marked evidence.status = 'pending' when written; rows learned
 * that way before the mark existed count as pending too. Pending rows may still be recalled as
 * RELEVANT (tagged unconfirmed), never as a standing rule, and they wait in Settings → Eve → Memory →
 * "Confirm what she learned" until a person approves, edits or rejects them.
 */
export function isPendingMemory(m: { source?: any; evidence?: any } | null | undefined): boolean {
  const ev = m?.evidence && typeof m.evidence === 'object' && !Array.isArray(m.evidence) ? m.evidence : null
  const status = ev ? String(ev.status || '') : ''
  if (status === 'pending') return true
  if (status) return false
  const src = String(m?.source || '')
  return src === 'slack' || (src === 'eve' && !!ev && ev.from === 'sleep')
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
  // Rollup labels as they are spelled in the registry, keyed without spaces or punctuation, so an
  // alias hit ("17 west") lands on the registry's own spelling of that building.
  const rollupByKey: Record<string, string> = {}
  for (const id of keys) {
    const m = listingMeta[id]
    const b = m.rollup
    if (b && b !== 'Unassigned') rollupByKey[lc(b).replace(/[^a-z0-9]/g, '')] = b
    if (b && b !== 'Unassigned' && hay.includes(lc(b))) buildings[b] = true
    const n = m.name
    // Unit names are short and collide with ordinary words, so require a reasonably specific match.
    if (n && n.length >= 4 && hay.includes(lc(n))) ids.push(id)
  }
  // ALIASES (2026-11-10). The loop above only finds a building whose label appears letter for letter,
  // so "17 west", "park tower" or "lucenre" brought no building memories in. The same patterns that
  // file a listing under its building (lib/segments) are run over the words of the question.
  // ONE scope per building: the registry's spelling when it has that building, else the canonical
  // label — two spellings of one building would read as two buildings to whoever asks "which one?".
  for (const label of buildingsNamedIn(hay)) {
    const spelled = rollupByKey[lc(label).replace(/[^a-z0-9]/g, '')]
    buildings[spelled || label] = true
  }
  // A UNIT BY ITS NUMBER (2026-11-10). People write "Eden 2202" or just "2202" once the building is
  // in play; the full listing name ("Eden 2202 - 2BR Ocean") almost never appears. A 3-4 digit number
  // names a unit only when exactly ONE listing carries it — inside the buildings in play, or, with no
  // building named, anywhere in the portfolio and only when written as a unit ("unit 2202", "#2202").
  const nums = Array.from(new Set(hay.match(/\b\d{3,4}\b/g) || [])).slice(0, 12)
  const anyBuilding = Object.keys(buildings).length > 0
  for (const num of nums) {
    const inName = new RegExp('(^|[^0-9])' + num + '([^0-9]|$)')
    let hits: string[] = []
    if (anyBuilding) hits = keys.filter(id => buildings[listingMeta[id].rollup] && inName.test(String(listingMeta[id].name || '')))
    else if (new RegExp('(?:unit|apt|apartment|room|#)\\s*#?\\s*' + num + '\\b').test(hay)) hits = keys.filter(id => inName.test(String(listingMeta[id].name || '')))
    if (hits.length === 1 && ids.indexOf(hits[0]) < 0) ids.push(hits[0])
  }
  const bKeys = Object.keys(buildings)
  for (const b of bKeys) scopes.push('building:' + b)
  for (const id of ids.slice(0, 6)) scopes.push('unit:' + id)
  // A channel named in the thread brings its playbook rules in (deposit, refunds, claims, charging).
  const chans = channelsInText(text)
  for (let i = 0; i < chans.length; i++) scopes.push('channel:' + chans[i])
  return scopes
}

// Tokenise for relevance scoring: lowercase words of 3+ chars, minus glue words that carry no
// signal. Deterministic and cheap — this runs on every turn, so no model call and no regex storms.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'have', 'has', 'are', 'was', 'were', 'you', 'your', 'her', 'she', 'about', 'should', 'would', 'could', 'from', 'into', 'they', 'them', 'there', 'their', 'been', 'being', 'not', 'can', 'will', 'why', 'how', 'who', 'all', 'any', 'our', 'out', 'get', 'got'])
export function words(s: string): string[] {
  return lc(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w))
}

/**
 * WHICH INJECTED MEMORIES DID THE ANSWER ACTUALLY USE (2026-09-21, the learning audit). Loading a
 * memory into the prompt is not the same as it changing the answer, and use_count only ever
 * measured the first. This is the cheap second measure: a memory counts as USED when the answer's
 * words cover at least 40% of the memory's distinctive words, or the answer quotes a run of it.
 * Deterministic, no model call, so it can run on every turn. Memories with fewer than three
 * distinctive words are skipped — "Eden: 2-beds" would match half of everything.
 */
export function memoryHitsFor(rows: Array<{ id: string; text: string }>, answer: string, question = ''): string[] {
  const aWords = new Set(words(answer))
  const aLc = lc(answer)
  if (!aWords.size) return []
  // A RULE IS USED WHEN IT IS IN PLAY, NOT WHEN IT IS QUOTED (Eve audit 2026-10-10). "Never offer a
  // refund over $350" was loaded 453 times and counted as used 0 times, because an answer that obeys
  // it never repeats it. A rule-shaped memory (never / always / only / must / don't) counts as used
  // when a third of its distinctive words appear in the question OR the answer — the topic was live.
  const qWords = new Set(words(question))
  const both = new Set([...Array.from(aWords), ...Array.from(qWords)])
  const used: string[] = []
  for (const r of rows) {
    const text = String(r.text || '')
    const mw = Array.from(new Set(words(text)))
    if (mw.length < 3) continue
    let inter = 0
    for (const w of mw) if (aWords.has(w)) inter++
    if (inter / mw.length >= 0.4) { used.push(r.id); continue }
    if (/\b(never|always|only|must|do not|don'?t|no longer|not allowed|prohibited|required)\b/i.test(text)) {
      let both_n = 0
      for (const w of mw) if (both.has(w)) both_n++
      if (both_n >= 2 && both_n / mw.length >= 0.34) { used.push(r.id); continue }
    }
    // A quoted run: any 6-word window of the memory appearing verbatim in the answer.
    const raw = lc(String(r.text || '')).split(/\s+/).filter(Boolean)
    for (let i = 0; i + 6 <= raw.length; i++) {
      if (aLc.includes(raw.slice(i, i + 6).join(' '))) { used.push(r.id); break }
    }
  }
  return used
}

/** Stamp the memories an answer actually drew on (hit_count / last_hit_at, migration 103). Degrades silently before it. */
export async function recordMemoryHits(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('eve_memory').select('id,hit_count').in('id', ids)
    // All at once, not one round trip per memory after the reply (2026-09-29, 04-F17).
    const at = new Date().toISOString()
    await Promise.all(((data as any[]) || []).map(r => db.from('eve_memory').update({ hit_count: Number(r.hit_count || 0) + 1, last_hit_at: at }).eq('id', r.id)))
  } catch { /* column not there yet — the audit shows "no telemetry" rather than breaking a turn */ }
}

/**
 * Memories that are loaded into prompts and never once shape an answer — the dead weight the
 * audit shows first, most-injected first. Only rows that have been injected at least `minInjected`
 * times qualify: a memory nobody has asked about yet is untested, not dead.
 */
export async function neverUsedMemories(limit = 10, minInjected = 5): Promise<Array<{ id: string; text: string; kind: string; scope: string; weight: number; source: string; use_count: number; created_at: string }>> {
  const db = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)
  try {
    const { data, error } = await db.from('eve_memory')
      .select('id,text,kind,scope,weight,source,use_count,created_at,hit_count,expires_on')
      .is('superseded_by', null).gte('use_count', minInjected).eq('hit_count', 0)
      .order('use_count', { ascending: false }).limit(limit * 3)
    if (error) return []
    return ((data as any[]) || []).filter(r => !r.expires_on || String(r.expires_on) >= today).slice(0, limit)
  } catch { return [] }
}

/**
 * Load the memories that matter for THIS turn.
 *
 * RECALL, REBUILT (Jon, 2026-09-28: "learn faster … improve the learning model"). The weekly audit
 * that morning: 3,540 memories loaded across 59 chats, 14 of them shaped an answer — 0.4%. The
 * ranking was weight × 3 first and relevance a distant second, so every turn opened with the same
 * sixty heaviest lines whatever was asked, and the line that would have answered the question sat
 * below the cut. Loading a memory is not remembering it; a colleague who recited the same sixty
 * facts before every answer would not be called well-informed.
 *
 * THREE LANES NOW, each with its own budget, so no lane can crowd out another:
 *   STANDING  rules, corrections and preferences from a person (Jon, a document, a colleague), in
 *             scope. Always in her head, because they are the constitution. (≤ 16)
 *   RELEVANT  everything in scope, in the neighbourhood, or recalled by full text — ranked by how
 *             much of the QUESTION each one covers, rarer words counting more (the rarity is
 *             measured across the candidates themselves, so "clean" counts for little and "ozone"
 *             for a lot), a unit or building named outright counting double. Then a cheap model
 *             pass reads the question next to the top candidates and picks the ones a good
 *             colleague would want in mind — the pass that word overlap cannot do. (≤ 18)
 *   RECENT    what was learned in the last seven days in scope. New is news. (≤ 6)
 * The rows come back tagged with their lane so the learning audit can see which lane the answers
 * actually draw on. Without a question the lanes degrade to the old weight-and-recency order.
 *
 * SCOPE, unchanged: SQL narrows to the relevant scopes plus `nearScopes` (the units of a building
 * in play) and a full-text recall across every live memory; expired rows, superseded rows and
 * self-made beliefs faded below the floor (lib/eve/beliefs.ts) never load.
 */
export type RecallLane = 'standing' | 'relevant' | 'recent'
const LANE_BUDGET: Record<RecallLane, number> = { standing: 16, relevant: 18, recent: 6 }

export async function loadMemories(scopes: string[], email: string, limit = 60, question = '', opts: { nearScopes?: string[]; references?: boolean } = {}): Promise<(EveMemory & { lane?: RecallLane })[]> {
  const db = supabaseAdmin()
  const wanted = scopes.slice()
  if (email) wanted.push('person:' + lc(email))
  const near = new Set((opts.nearScopes || []).filter(s => wanted.indexOf(s) < 0).slice(0, 80))
  const COLS = 'id,kind,text,why,scope,weight,source,confidence,evidence,created_by,use_count,last_used_at,expires_on,superseded_by,created_at,updated_at'
  // last_hit_at arrived with migration 103; ask for it, and fall back to the older shape if it is not there.
  const read = async (build: (cols: string) => any): Promise<any[]> => {
    let r: any = await build(COLS + ',last_hit_at')
    if (r?.error) r = await build(COLS)
    return r?.error ? [] : ((r?.data || []) as any[])
  }
  try {
    const direct = await read(cols => db.from('eve_memory').select(cols)
      .is('superseded_by', null)
      .in('scope', wanted.concat(Array.from(near)))
      .order('weight', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(Math.max(limit * 3, 240)))
    const qWords = words(question)
    const qSet = new Set(qWords)
    // The words that carry the question, longest first: short common words recall everything.
    const terms = Array.from(qSet).filter(w => w.length >= 4 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length).slice(0, 8)
    let recalled: any[] = []
    // THE IN-SCOPE POOL IS FOUND BY THE QUESTION, NOT BY WEIGHT (2026-11-10). `direct` is the 240
    // heaviest rows in scope; with 800 live memories, most of them at the same weight, everything
    // below that line could only arrive through the portfolio-wide recall (80 rows, heaviest first)
    // and 191 memories had never once been loaded. The same full-text match is now also run INSIDE
    // the scopes in play, newest first, and those rows join the pool as in-scope rows.
    let scoped: any[] = []
    let refs: any[] = []
    if (terms.length) {
      const fts = terms.join(' or ')
      const got = await Promise.all([
        read(cols => db.from('eve_memory').select(cols)
          .is('superseded_by', null)
          .textSearch('text', fts, { type: 'websearch', config: 'english' })
          .order('weight', { ascending: false })
          .limit(80)).catch(() => [] as any[]),
        read(cols => db.from('eve_memory').select(cols)
          .is('superseded_by', null)
          .in('scope', wanted.concat(Array.from(near)))
          .textSearch('text', fts, { type: 'websearch', config: 'english' })
          .order('updated_at', { ascending: false })
          .limit(200)).catch(() => [] as any[]),
        opts.references === false ? Promise.resolve([] as any[]) : referenceCandidates(terms).catch(() => [] as any[]),
        // What is filed under a person (person:<name>, lib/eve/schedule-knowledge): never in `wanted`,
        // and easily crowded out of the 80 above. See "A PERSON'S FILE" below for when it counts.
        read(cols => db.from('eve_memory').select(cols)
          .is('superseded_by', null)
          .like('scope', 'person:%').not('scope', 'like', '%@%')
          .textSearch('text', fts, { type: 'websearch', config: 'english' })
          .order('updated_at', { ascending: false })
          .limit(40)).catch(() => [] as any[]),
      ])
      recalled = got[0].concat(got[3]); scoped = got[1]; refs = got[2]
    }
    const byId = new Map<string, any>()
    for (const r of direct) byId.set(String(r.id), r)
    for (const r of scoped) if (!byId.has(String(r.id))) byId.set(String(r.id), r)
    for (const r of recalled) if (!byId.has(String(r.id))) byId.set(String(r.id), { ...r, _recalled: true })
    // A PERSON'S FILE IS IN SCOPE WHEN THE PERSON IS NAMED (2026-11-10). lib/eve/schedule-knowledge
    // files what it learns about a cleaner under person:<name>, and nothing ever asked for that scope
    // (only person:<the asker's email> is). When the question carries the first name in the scope,
    // the row is treated as in scope — a named person, like a named building.
    const personScopes = new Set<string>()
    byId.forEach(r => {
      const sc = String(r.scope || '')
      // person:<email> is a note for that one asker and stays theirs; only a name-keyed file opens up.
      if (!r._recalled || !sc.startsWith('person:') || sc.includes('@')) return
      const first = words(sc.slice(7))[0]
      if (first && qSet.has(first)) { delete r._recalled; personScopes.add(sc) }
    })

    const today = new Date().toISOString().slice(0, 10)
    const now = Date.now()
    const live: any[] = []
    byId.forEach(r => {
      if (r.expires_on && String(r.expires_on) < today) return
      if (!isHuman(r.source) && currentConfidence(r, now) < RETIRE_BELOW) return
      r._words = Array.from(new Set(words(String(r.text || '') + ' ' + String(r.why || ''))))
      live.push(r)
    })
    if (!live.length) return []

    // ── Rarity across the pool: a word half the candidates share says nothing about which one.
    const df = new Map<string, number>()
    for (const r of live) for (const w of r._words as string[]) df.set(w, (df.get(w) || 0) + 1)
    const N = live.length
    const idf = (w: string) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1
    const avgLen = live.reduce((a, r) => a + (r._words as string[]).length, 0) / N || 1
    const namedScopes = new Set(scopes.filter(s => s.startsWith('unit:') || s.startsWith('building:') || s.startsWith('channel:')).concat(Array.from(personScopes)))
    // BM25-shaped overlap: how much of the question this memory covers, damped for long memories.
    const relevance = (r: any): number => {
      if (!qSet.size) return 0
      const mw = r._words as string[]
      let s = 0
      for (const w of mw) if (qSet.has(w)) s += idf(w) * (2.2 / (1 + 1.2 * (0.25 + 0.75 * (mw.length / avgLen))))
      if (namedScopes.has(String(r.scope))) s *= 2
      if (r._recalled && s < 2) return 0
      return s
    }
    const ageDays = (r: any) => Math.max(0, (now - new Date(r.updated_at || r.created_at).getTime()) / 864e5)
    const standingKind = (r: any) => r.kind === 'rule' || r.kind === 'correction' || r.kind === 'preference'

    // ── STANDING: a person's rules and preferences, in scope (not recalled — the recall lane can
    // pull a rule from a building that is not in play, and that belongs in RELEVANT on its merits).
    // An auto-captured "always / never" sentence is not a rule until Jon confirms it (F15): it can be
    // picked as RELEVANT on its merits, never read out as a standing rule.
    const standing = live
      .filter(r => !r._recalled && standingKind(r) && (isHuman(r.source) || Number(r.weight || 0) >= 8) && !(r.evidence && r.evidence.autoCaptured) && !isPendingMemory(r))
      .sort((a, b) => (Number(b.weight) - Number(a.weight)) || (beliefStrength(b, now) - beliefStrength(a, now)) || (Number(b.use_count || 0) - Number(a.use_count || 0)))
      .slice(0, LANE_BUDGET.standing)
    const taken = new Set(standing.map(r => String(r.id)))

    // ── RELEVANT: coverage of the question × weight × belief (2026-11-10). It was a sum, in which
    // weight 10 was worth as much as a rare word matched, so a heavy line that barely touched the
    // question outranked a light one that answered it. As a product, relevance decides and weight
    // and belief scale it: a line that covers none of the question scores nothing whatever it weighs.
    // An unconfirmed line counts for a little less; a neighbour's (a unit of the building in play)
    // a little less again.
    let relevantPool = live
      .filter(r => !taken.has(String(r.id)))
      .map(r => ({ r, rel: relevance(r) }))
      .filter(x => x.rel > 0)
      .map(x => ({ r: x.r, score: x.rel * (0.5 + Number(x.r.weight || 0) / 10) * (0.5 + beliefStrength(x.r, now)) * (isPendingMemory(x.r) ? 0.85 : 1) * (near.has(String(x.r.scope)) ? 0.85 : 1) }))
      .sort((a, b) => b.score - a.score)
    let reranked = false
    let rerank = relevantPool.length > 6 ? (qWords.length >= 5 ? 'pending' : 'short question') : 'pool ' + relevantPool.length
    if (relevantPool.length > 6 && qWords.length >= 5) {
      const res = await rerankByQuestion(question, relevantPool.slice(0, 36).map(x => x.r), LANE_BUDGET.relevant)
      rerank = res.why
      const picked = res.ids
      if (picked) {
        reranked = true
        const order = new Map(picked.map((id, i) => [id, i]))
        const chosen = relevantPool.filter(x => order.has(String(x.r.id))).sort((a, b) => (order.get(String(a.r.id)) || 0) - (order.get(String(b.r.id)) || 0))
        const rest = relevantPool.filter(x => !order.has(String(x.r.id)))
        relevantPool = chosen.concat(rest)
      }
    }
    const relevant = relevantPool.slice(0, LANE_BUDGET.relevant).map(x => x.r)
    for (const r of relevant) taken.add(String(r.id))

    // ── RECENT: learned this week, in scope, not already carried.
    const recent = live
      .filter(r => !taken.has(String(r.id)) && !r._recalled && ageDays(r) < 7)
      .sort((a, b) => ageDays(a) - ageDays(b))
      .slice(0, LANE_BUDGET.recent)
    for (const r of recent) taken.add(String(r.id))

    // ── No question (a cron turn, a bare greeting): the lanes above are thin, so fall back to the
    // old order — weight, then recency — up to the limit, so nothing regresses for those callers.
    let fill: any[] = []
    if (!qSet.size) {
      fill = live.filter(r => !taken.has(String(r.id)) && !r._recalled)
        .sort((a, b) => (Number(b.weight) - Number(a.weight)) || (ageDays(a) - ageDays(b)))
        .slice(0, Math.max(0, Math.min(limit, 40) - standing.length - recent.length))
    }

    const strip = (r: any, lane: RecallLane) => { const { _recalled, _words, ...rest } = r; return { ...rest, lane } as EveMemory & { lane: RecallLane } }
    const out = standing.map(r => strip(r, 'standing'))
      .concat(relevant.map(r => strip(r, 'relevant')))
      .concat(recent.map(r => strip(r, 'recent')))
      .concat(fill.map(r => strip(r, 'relevant')))
    // Trim FIRST: slice() returns a new array, and a tag set on the old one would be lost.
    // The written passages recalled for this question (at most REFERENCE_CAP) ride after the
    // memories, outside `limit`, so a document never pushes out something a person taught her.
    const trimmed = out.slice(0, limit).concat(refs.slice(0, REFERENCE_CAP))
    ;(trimmed as any).reranked = reranked
    ;(trimmed as any).rerank = rerank
    return trimmed
  } catch { return [] }
}

/**
 * THE WRITTEN HOUSE KNOWLEDGE, RECALLED WITHOUT BEING ASKED FOR (2026-11-10). Documents were only
 * ever read when she thought to call doc_search, and the guest FAQ the nightly pass mines only
 * through knowledge_search, so the paragraph of the SOP that answered the question sat unread. The
 * passages (eve_doc_chunks) and FAQ rows (eve_knowledge, type 'faq') that share at least two of the
 * question's words now join the relevant lane as kind 'reference', each with its citation in
 * `evidence` (document title, section, date) for renderMemories to print.
 *
 * NOT A MEMORY, SO: the id is the passage's own uuid (or a uuid-shaped hash for an FAQ row) — every
 * place that hands memory ids to eve_memory simply matches nothing for it. The scope is
 * REFERENCE_SCOPE, a channel-style scope on purpose: run.ts drops channel-scoped rows in a room an
 * outside company reads (lib/eve/redact.ts isGuestOrPersonMemory), and an internal playbook must
 * not be read out there either. Any failure — a missing table, a search error — is no references.
 */
const REFERENCE_CAP = 6
export const REFERENCE_SCOPE = 'channel:reference'
function hashHex(s: string): string {
  let a = 5381, b = 52711
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) + c) >>> 0 }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12).padStart(12, '0')
}
async function referenceCandidates(terms: string[]): Promise<any[]> {
  if (!terms.length) return []
  const db = supabaseAdmin()
  const fts = terms.join(' or ')
  const need = Math.min(2, terms.length)
  const matched = (hay: string) => { let n = 0; for (const t of terms) if (hay.includes(t)) n++; return n }
  const clip = (v: any, n: number) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
  const out: { score: number; row: any }[] = []
  const [chunksRes, faqRes] = await Promise.all([
    Promise.resolve(db.from('eve_doc_chunks').select('id,doc_id,idx,heading,text')
      .textSearch('text', fts, { type: 'websearch', config: 'english' }).limit(40)).then((r: any) => r, () => ({ data: [] })),
    Promise.resolve(db.from('eve_knowledge').select('id,title,content,evidence_count,updated_at')
      .eq('type', 'faq').order('evidence_count', { ascending: false }).limit(300)).then((r: any) => r, () => ({ data: [] })),
  ])
  const chunks: any[] = (chunksRes && !chunksRes.error && Array.isArray(chunksRes.data)) ? chunksRes.data : []
  if (chunks.length) {
    const docIds = Array.from(new Set(chunks.map(c => String(c.doc_id))))
    const docsRes: any = await Promise.resolve(db.from('eve_docs').select('id,title,category,updated_at,active').in('id', docIds)).then((r: any) => r, () => ({ data: [] }))
    const docs: Record<string, any> = {}
    for (const d of ((docsRes && !docsRes.error && Array.isArray(docsRes.data)) ? docsRes.data : []) as any[]) if (d.active !== false) docs[String(d.id)] = d
    for (const c of chunks) {
      const d = docs[String(c.doc_id)]
      if (!d || !UUID_RE.test(String(c.id))) continue
      const head = lc(c.heading || '')
      const n = matched(head + ' \n ' + lc(c.text || ''))
      if (n < need) continue
      out.push({ score: n + matched(head) * 0.5, row: {
        id: String(c.id), kind: 'reference', text: clip(c.text, 520), why: null, scope: REFERENCE_SCOPE, weight: 5, source: 'doc',
        confidence: null, evidence: { ref: 'doc', doc_id: String(c.doc_id), title: String(d.title || ''), section: c.heading ? String(c.heading).slice(0, 120) : null, doc_updated_at: d.updated_at || null },
        created_by: null, use_count: 0, last_used_at: null, expires_on: null, superseded_by: null,
        created_at: d.updated_at || new Date().toISOString(), updated_at: d.updated_at || new Date().toISOString(), lane: 'relevant',
      } })
    }
  }
  const faqs: any[] = (faqRes && !faqRes.error && Array.isArray(faqRes.data)) ? faqRes.data : []
  for (const f of faqs) {
    const n = matched(lc(f.title || '') + ' \n ' + lc(f.content || ''))
    if (n < need) continue
    const h = hashHex(String(f.id))
    out.push({ score: n - 0.25, row: {
      id: `00000000-0000-4000-8000-${h}`, kind: 'reference', text: clip(`Guests often ask: ${String(f.title || '')}${f.content ? ' — ' + String(f.content) : ''}`, 420), why: null,
      scope: REFERENCE_SCOPE, weight: 4, source: 'system', confidence: null,
      evidence: { ref: 'faq', knowledge_id: String(f.id), seen: Number(f.evidence_count) || 1, doc_updated_at: f.updated_at || null },
      created_by: null, use_count: 0, last_used_at: null, expires_on: null, superseded_by: null,
      created_at: f.updated_at || new Date().toISOString(), updated_at: f.updated_at || new Date().toISOString(), lane: 'relevant',
    } })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, REFERENCE_CAP).map(x => x.row)
}

/**
 * THE PASS WORD OVERLAP CANNOT DO. A cheap model reads the question next to the top candidates and
 * says which ones a good colleague would want in mind before answering — "Capri is Opal's building"
 * for a question about a Capri repair, whether or not the question used the word. One short call
 * on Haiku, a few hundred tokens, capped at six seconds; on any failure the lexical order stands,
 * so a slow or missing model costs nothing but this refinement. Returns ids in the model's order,
 * or null when it did not run.
 */
async function rerankByQuestion(question: string, candidates: any[], max: number): Promise<{ ids: string[] | null; why: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !candidates.length) return { ids: null, why: key ? 'no candidates' : 'no api key' }
  const lines = candidates.map((r, i) => `${i + 1}. [${r.kind}${r.scope === 'portfolio' ? '' : ' ' + r.scope}] ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 170)}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await aiFetch('memory-recall', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor('memory-recall'),
        max_tokens: 80,
        system: 'You pick which of a colleague\'s notes matter for answering a question. Reply with ONLY a JSON array of note numbers, most useful first, at most ' + max + ' of them. Include a note only if knowing it would change or sharpen the answer: a rule that applies, a fact about the unit, building, guest, person or channel in question, a past mistake on this kind of question, a decision already made. Leave out notes that merely share words with the question. An empty array is a valid answer.',
        messages: [{ role: 'user', content: 'QUESTION:\n' + question.slice(0, 700) + '\n\nNOTES:\n' + lines.join('\n') }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return { ids: null, why: 'api ' + r.status + ' ' + String(d?.error?.message || '').slice(0, 80) }
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const m = text.match(/\[[\s\d,]*\]/)
    if (!m) return { ids: null, why: 'no array in: ' + text.slice(0, 80) }
    const nums: number[] = JSON.parse(m[0])
    const ids: string[] = []
    for (const n of nums) { const c = candidates[Number(n) - 1]; if (c && !ids.includes(String(c.id))) ids.push(String(c.id)) }
    return { ids: ids.slice(0, max), why: 'ok ' + ids.length }
  } catch (e: any) { return { ids: null, why: 'threw: ' + String(e?.name === 'AbortError' ? 'timeout' : e?.message || e).slice(0, 80) } } finally { clearTimeout(timer) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Nov 3" this year, "Nov 3, 2025" otherwise, '' for no date. Eastern time: that is the team's day. */
export function shortDate(iso: any): string {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return ''
  // A bare YYYY-MM-DD is a calendar day, not an instant: do not let a time zone move it.
  const bare = /^\d{4}-\d{2}-\d{2}$/.exec(String(iso))
  const ymd = bare ? String(iso) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10))
  if (!y || !m || !d) return ''
  const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date()))
  return `${MONTHS[m - 1]} ${d}${y === thisYear ? '' : ', ' + y}`
}

/**
 * WHERE A LINE CAME FROM AND WHEN, in a few words (2026-11-10): " — Jon, Sep 2", " — overheard in
 * #vr-ops, Nov 3 — unconfirmed", " — Housekeeping SOP › Linens, updated Oct 12". The prompt printed
 * the class of source and no date, so she could not tell a rule from last week from one a year old,
 * and could not say where a fact came from when asked. The date is the day it was learned (or
 * confirmed, when a person has confirmed it) — never the day it was last re-read.
 */
export function memoryCitation(r: Pick<EveMemory, 'source' | 'created_by' | 'created_at' | 'updated_at' | 'evidence'>): string {
  const ev: any = r.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence) ? r.evidence : {}
  const who = (v: any) => { const s = String(v || '').trim(); return s.includes('@') ? s.split('@')[0] : s }
  const learned = shortDate(ev.learned_at || r.created_at)
  const on = (d: string) => (d ? ', ' + d : '')
  // A passage or FAQ row recalled as reference: the document is the citation.
  if (ev.ref === 'doc') return ` [${String(ev.title || 'a company document').slice(0, 80)}${ev.section ? ' › ' + String(ev.section).slice(0, 80) : ''}${ev.doc_updated_at ? ', updated ' + shortDate(ev.doc_updated_at) : ''}]`
  if (ev.ref === 'faq') return ` [guest FAQ, mined from guest messages${ev.seen ? ', seen about ' + ev.seen + '×' : ''}${ev.doc_updated_at ? ', ' + shortDate(ev.doc_updated_at) : ''} — not policy]`
  const pending = isPendingMemory(r)
  const room = ev.channel_name ? '#' + String(ev.channel_name).replace(/^#/, '').slice(0, 40) : ''
  // Something she overheard that a person has since confirmed keeps where it was heard and says who confirmed it.
  const confirmed = ev.verified_by ? ` — confirmed by ${who(ev.verified_by) || 'a person'}${on(shortDate(ev.verified_at))}` : ''
  if (ev.learned_from === 'slack' || r.source === 'slack') {
    // The room and the day, not the speaker: this line can be read out in a shared room. Who said it
    // is on the row (evidence.speaker) and shown in Settings → Eve → Memory.
    const heard = ` — overheard in ${room || 'Slack'}${on(shortDate(ev.said_at || ev.learned_at || r.created_at))}`
    return heard + (confirmed || (pending ? ' — unconfirmed, not from Jon' : ', not from Jon'))
  }
  if (r.source === 'jon') return ` — Jon${on(shortDate(ev.verified_at || ev.learned_at || r.created_at))}${ev.learned_from === 'reflection' ? ' (confirmed; first noticed by Eve)' : ''}`
  if (r.source === 'staff') return ` — taught by ${ev.teacher ? String(ev.teacher).slice(0, 40) : (who(r.created_by) || 'a colleague')}${on(learned)}, not Jon`
  if (r.source === 'doc') {
    if (ev.title) return ` — ${String(ev.title).slice(0, 80)}${ev.section ? ' › ' + String(ev.section).slice(0, 80) : ''}${ev.doc_updated_at ? ', updated ' + shortDate(ev.doc_updated_at) : on(learned)}`
    return ` — from a company document${on(learned)}`
  }
  if (r.source === 'telegram') return ` — said on Telegram${on(learned)}`
  if (r.source === 'system') return ` — found by the nightly sweep${on(shortDate(ev.sweptOn || r.updated_at || r.created_at))}`
  return ` — learned by Eve${on(learned)}${confirmed || (pending ? ' — unconfirmed, not from Jon' : ', not from Jon')}`
}

/** Render for the system prompt. Grouped by kind so rules read as rules, not as trivia. */
export function renderMemories(rows: EveMemory[]): string {
  if (!rows.length) return ''
  const order = ['rule', 'preference', 'correction', 'decision', 'issue', 'person', 'insight', 'reference']
  const byKind: Record<string, EveMemory[]> = {}
  for (const r of rows) { (byKind[r.kind] = byKind[r.kind] || []).push(r) }
  const out: string[] = []
  for (const k of order) {
    const list = byKind[k]
    if (!list || !list.length) continue
    const label = k === 'rule' ? 'STANDING RULES (follow these; from Jon unless a line says otherwise)'
      : k === 'preference' ? 'HOW JON WANTS THINGS'
      : k === 'correction' ? 'MISTAKES YOU HAVE MADE BEFORE — do not repeat them'
      : k === 'decision' ? 'DECISIONS ALREADY MADE'
      : k === 'issue' ? 'KNOWN RECURRING ISSUES'
      : k === 'person' ? 'PEOPLE / NAME MAPPINGS'
      : k === 'reference' ? 'FROM THE WRITTEN DOCUMENTS AND THE GUEST FAQ (recalled for this question; when you use one, name the document and section; doc_read gives the whole document)'
      : 'THINGS YOU HAVE LEARNED'
    const lines = list.map(r => {
      if (k === 'reference') return `- ${r.text}${memoryCitation(r)}`
      const sc = r.scope === 'portfolio' ? '' : ` [${r.scope}]`
      const ev: any = r.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence) ? r.evidence : {}
      // A document rule's `why` only repeats the title and section the citation already carries.
      const why = r.why && !(r.source === 'doc' && ev.title) ? ` (why: ${r.why})` : ''
      // Provenance, said plainly, with its date (memoryCitation). A Slack or document memory is not
      // Jon's word and must not read as it; a colleague's lesson says whose it is.
      // How sure she is, said out loud when it matters (lib/eve/beliefs.ts): a faded hunch or a
      // disputed rule carries a tag so it is never stated as settled fact.
      return `- ${r.text}${why}${sc}${memoryCitation(r)}${beliefTag(r)}`
    })
    out.push(label + ':\n' + lines.join('\n'))
  }
  return out.join('\n\n')
}

export type SaveMemoryInput = {
  kind?: any; text: string; why?: any; scope?: any; weight?: any
  source?: string; confidence?: any; evidence?: any; created_by?: string | null
  supersedes?: string | null; expires_on?: string | null
  /** The CALLER'S ceiling (a Slack tier's memoryWeightCap, for instance). Weight never exceeds it. */
  maxWeight?: number
}

// WHERE A MEMORY CAME FROM, KEPT HONEST (2026-09-18 audit, P0-8). This used to flatten anything
// that was not jon/eve/system to 'eve', so a rule overheard in a Slack channel — possibly from a
// vendor — rendered in the prompt under "they came from Jon". The source now survives the write,
// and renderMemories() says it.
//
// 'staff' (Jon, 2026-09-23 review): a colleague teaching her something on purpose. Before this,
// every Eve user's "teach her", correction and question answer was filed as source 'jon' at weight
// 8-9 — so anybody with Eve could put words in Jon's mouth at the top of her prompt. Only the
// superadmin writes 'jon' now; everyone else writes 'staff', capped at STAFF_MAX_WEIGHT, and the
// prompt names who taught it.
const SOURCES = ['jon', 'staff', 'eve', 'system', 'slack', 'doc', 'telegram']
export const STAFF_MAX_WEIGHT = 6
function normSource(v: any): string { const s = String(v || '').toLowerCase(); return SOURCES.includes(s) ? s : 'eve' }
function cappedWeight(input: SaveMemoryInput): number {
  const w = normWeight(input.weight)
  const cap = Number(input.maxWeight)
  return Number.isFinite(cap) ? Math.max(1, Math.min(w, cap)) : w
}

/**
 * WHO IS ALLOWED TO SPEAK AS JON (Jon, 2026-09-23 review). Every route that files a person's words
 * calls this with the signed-in email: the superadmin gets source 'jon' at the weight asked for;
 * anyone else gets 'staff' with the weight capped at STAFF_MAX_WEIGHT.
 */
export function personSource(email: string | null | undefined, weight: number): { source: 'jon' | 'staff'; weight: number } {
  if (isSuperadmin(email)) return { source: 'jon', weight: normWeight(weight) }
  return { source: 'staff', weight: Math.min(normWeight(weight), STAFF_MAX_WEIGHT) }
}

// THE WORDS THAT FLIP A MEANING (Jon, 2026-09-23 review). words() drops short tokens and glue
// words — including "not" — which is right for relevance scoring and wrong for "is this the same
// memory?". "Pets are allowed at Eden" and "Pets are not allowed at Eden" came out identical, as did
// "$25 deposit" and "$50 deposit", so a correction was swallowed as a reinforcement of the thing it
// corrected. Two texts that differ in any number or in any negation are never the same thought.
const NEGATIONS = new Set(['not', 'no', 'never', "don't", 'dont', "isn't", 'isnt', "aren't", 'arent', "won't", 'wont', "can't", 'cant', 'cannot', 'without', 'nobody', 'none'])
function numberTokens(s: string): string[] {
  const m = lc(s).match(/[$€£]?\d[\d,]*(?:\.\d+)?%?/g) || []
  return Array.from(new Set(m.map(t => t.replace(/,/g, '')))).sort()
}
function negationTokens(s: string): string[] {
  const toks = lc(s).replace(/[\u2018\u2019]/g, "'").split(/[^a-z']+/).map(t => t.replace(/^'+|'+$/g, ''))
  // "don't", "can't", "cannot", "isn't"… all say "not", so "Don't do X" and "Do not do X" still
  // match; "never", "no", "without", "nobody" and "none" stay themselves.
  const neg = toks.filter(t => NEGATIONS.has(t) || /n't$/.test(t))
    .map(t => (/n'?t$/.test(t) || t === 'cannot') ? 'not' : t)
  return Array.from(new Set(neg)).sort()
}
function sameList(a: string[], b: string[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]) }

// Near-duplicate test for the dedupe below: same words is the same memory, however punctuated —
// unless a number or a negation differs, which makes it a different (often opposite) claim.
export function sameThought(a: string, b: string, threshold = 0.85): boolean {
  if (!sameList(numberTokens(a), numberTokens(b))) return false
  if (!sameList(negationTokens(a), negationTokens(b))) return false
  const A = new Set(words(a)), B = new Set(words(b))
  if (!A.size || !B.size) return lc(a).trim() === lc(b).trim()
  let inter = 0
  A.forEach(w => { if (B.has(w)) inter++ })
  const jaccard = inter / (A.size + B.size - inter)
  const containment = inter / Math.min(A.size, B.size)
  return jaccard >= threshold || (containment >= 0.95 && Math.min(A.size, B.size) >= 4)
}

/**
 * SAME SUBJECT, DIFFERENT CLAIM (2026-11-10). sameThought() above rightly refuses to call "$25
 * deposit" and "$50 deposit" — or "pets allowed" and "pets not allowed" — the same thought. But that
 * was the end of it: both were stored, both loaded, and she followed whichever ranked higher that
 * turn. This is the other half of the test: two texts about the same thing (60% of their words,
 * numbers aside, at least three words each) that differ in a negation, or in a VALUE — an amount, a
 * percentage, a count or an hour (valueNumbers). A number that names something is not a value:
 * "402's AC leaks" and "502's AC leaks", or a 1BR and a 2BR, are two facts, not a disagreement.
 */
function subjectWords(s: string): string[] { return Array.from(new Set(words(s).filter(w => !/\d/.test(w)))) }
// A VALUE is a number that says how much, how many or when: money, a percentage, a clock time, or a
// count of minutes / hours / days / nights / guests and the like. Digits glued to a label ("2BR",
// "unit 402") and bare numbers are not values — they name things.
function valueNumbers(s: string): string[] {
  const t = lc(s).replace(/,/g, '')
  const re = /[$€£]\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d+(?:\.\d+)?\s?(?:minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|months?|years?|times|guests?|people|keys?|sets?)\b/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) out.push(m[0].replace(/\s+/g, ''))
  return Array.from(new Set(out)).sort()
}
export function contradictsThought(a: string, b: string): boolean {
  const A = new Set(subjectWords(a)), B = new Set(subjectWords(b))
  if (A.size < 3 || B.size < 3) return false
  let inter = 0
  A.forEach(w => { if (B.has(w)) inter++ })
  if (inter / (A.size + B.size - inter) < 0.6) return false
  // Different unit or building numbers: two places, not two claims about one.
  const named = (s: string) => Array.from(new Set(lc(s).match(/\b\d{3,4}\b/g) || [])).sort()
  if (!sameList(named(a), named(b))) return false
  if (!sameList(negationTokens(a), negationTokens(b))) return true
  const va = valueNumbers(a), vb = valueNumbers(b)
  return va.length > 0 && vb.length > 0 && !sameList(va, vb)
}

/** The five live memories in one scope closest to a text, by full-text match then shared words. [] on any failure. */
async function nearestNeighbours(db: any, scope: string, text: string): Promise<any[]> {
  const subj = subjectWords(text)
  const terms = subj.filter(w => w.length >= 4).sort((x, y) => y.length - x.length).slice(0, 8)
  if (terms.length < 2) return []
  try {
    const { data, error } = await db.from('eve_memory')
      .select('id,text,weight,why,source,evidence,confidence,scope,expires_on,created_by')
      .is('superseded_by', null).eq('scope', scope)
      .textSearch('text', terms.join(' or '), { type: 'websearch', config: 'english' })
      .limit(60)
    if (error) return []
    const today = new Date().toISOString().slice(0, 10)
    const A = new Set(subj)
    return ((data || []) as any[])
      .filter(p => !(p.expires_on && String(p.expires_on) < today))
      .map(p => { const B = new Set(subjectWords(String(p.text || ''))); let inter = 0; A.forEach(w => { if (B.has(w)) inter++ }); return { p, j: inter / Math.max(1, A.size + B.size - inter) } })
      .filter(x => x.j > 0).sort((x, y) => y.j - x.j).slice(0, 5).map(x => x.p)
  } catch { return [] }
}
const evObj = (v: any): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v : (v == null ? {} : { prior: v }))
/** Two writes that fill the same slot: one document, one OTA playbook cell, or one person's own words. */
function sameOrigin(old: any, input: SaveMemoryInput): boolean {
  const a = evObj(old?.evidence), b = evObj(input.evidence)
  if (a.doc_id && b.doc_id && String(a.doc_id) === String(b.doc_id)) return true
  if (a.ota && b.ota && String(a.ota.channel) === String(b.ota.channel) && String(a.ota.topic) === String(b.ota.topic)) return true
  const by = lc(input.created_by || '')
  return !!by && by.includes('@') && by === lc(old?.created_by || '')
}

export async function saveMemory(input: SaveMemoryInput): Promise<{ ok: boolean; id?: string; error?: string; deduped?: boolean; conflict?: 'asked' | 'superseded' }> {
  const db = supabaseAdmin()
  const text = String(input.text || '').trim().slice(0, 1000)
  if (!text) return { ok: false, error: 'empty memory' }
  // A DOOR CODE IS NEVER A MEMORY (2026-09-28 audit, B-7). `remember` took the model's text as it
  // came, so a code she had just seen could be filed and then injected into prompts on every
  // surface. Code-shaped text (the same patterns the tool-output redactor uses) is refused here, on
  // every write path — remember, corrections, question answers, the sweep. Since 2026-09-29 (N5) also
  // any lock / door / code word within ~24 characters of a 4-8 digit number, however it is phrased.
  if (looksLikeDoorCode(text) || looksLikeDoorCode(input.why) || codeNearDigits(text) || codeNearDigits(input.why)) {
    return { ok: false, error: 'That looks like a door or access code (a lock, door, gate, keypad or code word next to a 4-8 digit number). Codes are never stored in memory — they are read fresh through the door-code flow every time. If the number is a unit, write it as "unit 1102".' }
  }

  // BACKSTOP ON 'jon' (Jon, 2026-09-23 review). The routes decide with personSource(), but a few
  // library paths (Thinking → dismiss, Telegram replies) still pass source 'jon' with the person's
  // email in created_by. If that email is not the superadmin, it is filed as 'staff' at the staff
  // cap here, so no path can label a colleague's words as Jon's. Writes with no email on them
  // (cron, system) are left as they are.
  if (normSource(input.source) === 'jon' && input.created_by && String(input.created_by).includes('@') && !isSuperadmin(input.created_by)) {
    const cap = Number.isFinite(Number(input.maxWeight)) ? Math.min(Number(input.maxWeight), STAFF_MAX_WEIGHT) : STAFF_MAX_WEIGHT
    input = { ...input, source: 'staff', maxWeight: cap }
  }

  // DEDUPE, DON'T PILE UP (Jon, 2026-08-19: "make the memory feature faster and better"). The
  // nightly sweep and the remember tool both re-learn the same facts; before this, each re-learning
  // was a fresh row, so the table grew noise and the prompt budget filled with repeats. Now a new
  // memory that says what an existing same-scope one already says REINFORCES it — weight keeps the
  // higher value, the timestamp refreshes (so it ranks as current), and the row count stays flat.
  //
  // A SAVE THAT SUPERSEDES IS A CORRECTION, NOT A REPEAT (Jon, 2026-09-23 review). When the caller
  // names the row it replaces, the dedupe is skipped: otherwise a correction that reads like its
  // target matched the target itself, returned its id, and the "supersede" pointed a row at itself.
  //
  // THE SWEEP'S NUMBERS MOVE (Jon, 2026-09-23 review). When the nightly sweep (source 'system')
  // re-finds one of its own memories, the new text carries this week's figures, so the row takes the
  // new text and evidence (with evidence.sweptOn refreshed) instead of only a fresh timestamp.
  // A human-written twin is never rewritten by the sweep.
  // ACROSS SCOPES TOO, FOR WHAT SHE LEARNED HERSELF (2026-11-09). 521 of 800 memories were overheard in
  // Slack, many of them the same sentence saved once per building: the check below only ever looked
  // inside ONE scope, at the 120 newest rows, with a near-exact match. For a machine-learned memory
  // (source slack or eve) that finds no twin in its own scope, the whole portfolio + building pool is
  // searched as well, at the looser 0.75 the memory audit uses (a number or a negation that differs
  // still makes it a different thought). A twin found in another scope is reinforced instead of a new
  // row being written; when both are machine-learned and sit in two different buildings, the surviving
  // row is widened to portfolio — it was true in two places. A person's memory (jon, staff, doc,
  // telegram) is never searched this way: a person scoping a rule to one building meant it.
  const MACHINE = ['slack', 'eve']
  // A live memory in the same scope that says the opposite, or a different figure (see
  // contradictsThought). Found below, dealt with after the new row exists.
  let contradicts: any = null
  if (!input.supersedes) try {
    const scope = canonScope(input.scope)
    const src = normSource(input.source)
    const { data: peers } = await db.from('eve_memory')
      .select('id,text,weight,why,source,evidence,confidence,scope,expires_on')
      .is('superseded_by', null).eq('scope', scope)
      .order('updated_at', { ascending: false }).limit(120)
    // A sweep memory is also the twin of the live system row for the SAME finding, whatever its
    // numbers now say — the number check above would otherwise make every re-sweep a new row.
    const finding = src === 'system' && input.evidence && typeof input.evidence === 'object' ? input.evidence.finding : null
    let twin = ((peers || []) as any[]).find(p => (finding && String(p.source) === 'system' && p?.evidence?.finding === finding) || sameThought(String(p.text || ''), text))
    let widen = false
    if (!twin && MACHINE.includes(src) && (scope === 'portfolio' || scope.startsWith('building:'))) {
      const { data: pool } = await db.from('eve_memory')
        .select('id,text,weight,why,source,evidence,confidence,scope,expires_on')
        .is('superseded_by', null).or('scope.eq.portfolio,scope.like."building:%"')
        .order('updated_at', { ascending: false }).limit(2000)
      twin = ((pool || []) as any[]).find(p => sameThought(String(p.text || ''), text, 0.75))
      const today = new Date().toISOString().slice(0, 10)
      widen = !!twin && MACHINE.includes(String(twin.source)) && String(twin.scope) !== scope
        && String(twin.scope).startsWith('building:') && scope.startsWith('building:')
        && !(twin.expires_on && String(twin.expires_on) <= today)
      // Already known from a person or a document, in another scope: nothing to write and nothing of
      // theirs to touch — their row keeps its weight, its scope and its confidence.
      if (twin && !MACHINE.includes(String(twin.source))) return { ok: true, id: twin.id, deduped: true }
    }
    // THE FIVE NEAREST, BY WHAT THEY SAY (2026-11-10). The twin check above reads the 120 newest rows
    // of the scope; an older twin, or a row that contradicts this one, was never looked at. The five
    // closest live rows in the same scope are found by full text: the same thought reinforces it (as
    // above); a contradiction is remembered and settled once the new row is written. The sweep's own
    // rows are left out on both sides — their figures move every night by design.
    if (!twin && src !== 'system') {
      const close = await nearestNeighbours(db, scope, text)
      twin = close.find(p => sameThought(String(p.text || ''), text))
      if (!twin) contradicts = close.find(p => String(p.source) !== 'system' && contradictsThought(String(p.text || ''), text)) || null
    }
    if (twin) {
      const patch: any = {
        weight: Math.max(Number(twin.weight || 0), cappedWeight(input)),
        why: twin.why || (input.why ? String(input.why).slice(0, 500) : null),
        updated_at: new Date().toISOString(),
      }
      if (widen) patch.scope = 'portfolio'
      if (normSource(input.source) === 'system' && String(twin.source) === 'system') {
        const prev = twin.evidence && typeof twin.evidence === 'object' && !Array.isArray(twin.evidence) ? twin.evidence : {}
        const next = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : {}
        patch.text = text
        patch.evidence = { ...prev, ...next, sweptOn: next.sweptOn || new Date().toISOString().slice(0, 10) }
      }
      // LEARNING IT AGAIN IS EVIDENCE (lib/eve/beliefs.ts). Re-finding a belief from a new source or
      // on a new night is the belief holding up: it counts as support and closes a tenth of the gap
      // to certainty. It also resets the fade, because it has just been true in front of her.
      const bel = beliefOf(twin)
      bel.for += 1; bel.lastConfirmed = patch.updated_at
      bel.history = bel.history.concat([{ at: patch.updated_at, d: 0, why: `re-learned (${normSource(input.source)})` }]).slice(-12)
      patch.evidence = withBelief(patch.evidence !== undefined ? patch.evidence : twin.evidence, bel)
      const c0 = storedConfidence(twin)
      patch.confidence = Math.round(Math.min(0.99, c0 + (1 - c0) * 0.1) * 1000) / 1000
      await db.from('eve_memory').update(patch).eq('id', twin.id)
      return { ok: true, id: twin.id, deduped: true }
    }
  } catch { /* dedupe is an optimisation — a failed check must never block learning */ }
  // NEVER BOTH, SILENTLY (2026-11-10). When the row this contradicts is a PERSON'S (Jon, a colleague,
  // a document) the new one does not overrule it: it is written beside it, marked as disputing it
  // (and unconfirmed when she learned it herself), and one `conflict` question carries both texts —
  // the answer retires both (lib/eve/questions.ts answerQuestion). When Jon himself is the one
  // saying the new thing, or it fills the same slot (the same document, the same playbook cell, the
  // same person's own earlier words), or the old row is something she learned herself, the newer one
  // simply supersedes the older and the old row is linked to it.
  const newSource = normSource(input.source)
  const askConflict = !!contradicts && isHuman(contradicts.source) && newSource !== 'jon' && !sameOrigin(contradicts, input)
  let evidenceIn: any = input.evidence ?? null
  if (askConflict) evidenceIn = { ...evObj(evidenceIn), conflicts_with: String(contradicts.id), ...(isHuman(newSource) ? {} : { status: 'pending' }) }
  const row: any = {
    kind: normKind(input.kind),
    text,
    why: input.why ? String(input.why).slice(0, 500) : null,
    scope: canonScope(input.scope),
    weight: cappedWeight(input),
    source: newSource,
    confidence: Number.isFinite(Number(input.confidence)) ? Math.min(1, Math.max(0, Number(input.confidence))) : null,
    evidence: evidenceIn,
    created_by: input.created_by || null,
    expires_on: input.expires_on || null,
    updated_at: new Date().toISOString(),
  }
  try {
    const { data, error } = await db.from('eve_memory').insert(row).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    const id = (data as any)?.id
    // Never point a row at itself (Jon, 2026-09-23 review) — a self-superseded row vanishes from
    // every prompt with nothing replacing it.
    if (input.supersedes && id && String(input.supersedes) !== String(id)) {
      await db.from('eve_memory').update({ superseded_by: id, updated_at: new Date().toISOString() }).eq('id', input.supersedes)
    }
    let conflict: 'asked' | 'superseded' | undefined
    if (contradicts && id && String(contradicts.id) !== String(id)) {
      try {
        if (askConflict) {
          // Dynamic import: questions.ts imports saveMemory from this file.
          const { askQuestion } = await import('./questions')
          const oldBy = contradicts.source === 'jon' ? 'You told me' : contradicts.source === 'doc' ? 'A document says' : `${String(contradicts.created_by || 'A colleague').split('@')[0]} told me`
          const newBy = newSource === 'slack' ? 'I overheard in Slack' : newSource === 'doc' ? 'a document says' : newSource === 'staff' ? `${String(input.created_by || 'a colleague').split('@')[0]} says` : 'I have since picked up'
          const r = await askQuestion({
            question: `${oldBy}: "${String(contradicts.text || '').slice(0, 170)}". Now ${newBy}: "${text.slice(0, 170)}". Which one is right?`.slice(0, 500),
            why: 'These cannot both be true. Until you say, I keep following the first and treat the second as unconfirmed; your answer replaces both.',
            scope: row.scope, kind: 'conflict', source: 'eve',
            evidence: { memory_ids: [String(contradicts.id), String(id)], from: 'write-check' },
            dedupeKey: 'memory-conflict:' + String(contradicts.id),
          })
          if (r.ok) conflict = 'asked'
        } else {
          await db.from('eve_memory').update({ superseded_by: id, updated_at: new Date().toISOString() }).eq('id', contradicts.id).is('superseded_by', null)
          conflict = 'superseded'
        }
      } catch { /* the new row is saved either way; the memory audit still lists the pair */ }
    }
    return { ok: true, id, ...(conflict ? { conflict } : {}) }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/*
 * TAUGHT RULES REACH EVERYTHING (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we
 * can teach Eve"). The chat loads memory per question; the briefs, the Slack reader and the nudges
 * never read eve_memory at all, so a rule taught on Monday was obeyed in chat and ignored by the
 * hourly pass. This is the short list every other model prompt gets: active rules and corrections
 * at weight ≥ 7 (a teacher's or Jon's word), not superseded or expired, in scope, one line each.
 * '' on any failure — a prompt without it is today's prompt.
 */
export async function standingRulesForPrompt(scope?: string | string[], cap = 25): Promise<string> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    let q: any = supabaseAdmin().from('eve_memory').select('id,kind,text,scope,weight,source,created_by,evidence,expires_on')
      .is('superseded_by', null).in('kind', ['rule', 'correction']).gte('weight', 7)
      .order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(cap * 3)
    const scopes = scope == null ? null : (Array.isArray(scope) ? scope : [scope]).map(s => normScope(s))
    if (scopes && scopes.length) q = q.in('scope', Array.from(new Set(['portfolio', ...scopes])))
    const { data, error } = await q
    if (error) return ''
    const rows = ((data as any[]) || [])
      .filter(r => !r.expires_on || String(r.expires_on) >= today)
      .filter(r => !(r.evidence && r.evidence.autoCaptured && !r.evidence.teacher))
      .filter(r => !isPendingMemory(r))
      .slice(0, cap)
    if (!rows.length) return ''
    // A CRON'S READ IS A READ (2026-11-10). use_count only ever counted chat turns, so a rule the
    // hourly Slack reader and the briefs leaned on every day still showed "never used".
    touchMemories(rows.map(r => String(r.id))).catch(() => {})
    const lines = rows.map(r => {
      const where = r.scope && r.scope !== 'portfolio' ? ` [${String(r.scope).replace(/^building:/, '').replace(/^channel:/, '')}]` : ''
      const who = r.source === 'jon' ? 'Jon' : (r.evidence?.teacher || (r.created_by ? String(r.created_by).split('@')[0] : r.source))
      return `- ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 220)}${where} (${r.kind === 'correction' ? 'correction' : 'rule'}, ${who})`
    })
    return 'STANDING RULES THE TEAM HAS TAUGHT EVE (follow them; they override your defaults):\n' + lines.join('\n')
  } catch { return '' }
}

/** Bump usage so the /eve page can show which memories are actually earning their place. */
export async function touchMemories(ids: string[]): Promise<void> {
  // Only real memory ids: a recalled document passage rides in the same list with its own id.
  ids = Array.from(new Set(ids.map(String).filter(id => UUID_RE.test(id))))
  if (!ids.length) return
  const db = supabaseAdmin()
  try {
    const { error } = await db.rpc('eve_touch_memories', { ids })
    if (error) throw error
  } catch {
    // No RPC (migration not run, or PostgREST hasn't reloaded) — degrade to a plain stamp.
    try { await db.from('eve_memory').update({ last_used_at: new Date().toISOString() }).in('id', ids) } catch { /* never break a turn over telemetry */ }
  }
}

/**
 * MEMORY HYGIENE (Jon, 2026-08-19: "update constantly"). Learning forever means accumulating
 * forever unless something forgets. Every learning pass retires self-learned insights that have
 * EARNED retirement: source 'eve' — and, since 2026-11-09, source 'slack' (what she overheard in the
 * rooms, held to the same bar) — never once loaded into a prompt (use_count 0), low weight, and
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
      .in('source', ['eve', 'slack']).eq('use_count', 0).lte('weight', 4)
      .is('superseded_by', null).is('expires_on', null)
      .lt('updated_at', cutoff)
      .select('id')
    // AND THE REST OF WHAT NOBODY EVER NEEDED (2026-11-10). A fact overheard in a staff room is
    // filed at weight 6, so the weight-4 line above never reached it: it sat unread until its
    // confidence faded months later. Anything she learned herself (never a person's, a document's
    // or the sweep's) at weight 6 or under, written 90+ days ago and never once loaded, is expired
    // on the same terms. A fact a person has confirmed is theirs now and is not touched.
    let more = 0
    try {
      const cutoff90 = new Date(Date.now() - 90 * 864e5).toISOString()
      const { data: old } = await db.from('eve_memory')
        .select('id,evidence')
        .in('source', ['eve', 'slack']).eq('use_count', 0).lte('weight', 6)
        .is('superseded_by', null).is('expires_on', null)
        .lt('created_at', cutoff90).limit(500)
      const ids = ((old || []) as any[]).filter(r => !(r.evidence && typeof r.evidence === 'object' && r.evidence.verified_by)).map(r => String(r.id))
      for (let i = 0; i < ids.length; i += 100) {
        const { data: done } = await db.from('eve_memory')
          .update({ expires_on: today, updated_at: new Date().toISOString() })
          .in('id', ids.slice(i, i + 100)).eq('use_count', 0).is('expires_on', null).select('id')
        more += (done || []).length
      }
    } catch { /* the first pass stands */ }
    return (data || []).length + more
  } catch { return 0 }
}


/**
 * RE-VALIDATION — the fix for a belief that outlived its evidence.
 *
 * Jon, 2026-08-24: "run a clean audit of memory of Eve, clean it up, get rid of useless memory."
 *
 * The nightly sweep writes its findings into memory with source 'system'. Every one of those was
 * true on the night it was written, and NOTHING ever checked it again. pruneStaleMemories only
 * touches source 'eve', so a swept memory was immortal by accident: "Botanica runs hot on
 * maintenance" could keep asserting itself for a year after Botanica stopped running hot, taking up
 * prompt space every single turn and quietly making Eve wrong with confidence.
 *
 * The evidence to fix it was already there. Every swept memory carries evidence.finding — the id of
 * the deterministic finding that produced it. So the test is simply: did that finding come back in
 * this sweep? If a finding stops appearing, the records that produced it no longer say what they
 * said, and the memory is a claim the data has withdrawn.
 *
 * It EXPIRES rather than deletes, with a grace period, because miners fail and a single bad night
 * must not wipe what Eve knows. Anything a human wrote is never touched: humans retire human
 * knowledge.
 */
export async function revalidateSweptMemories(currentFindingIds: string[], graceDays = 10): Promise<{ checked: number; expired: number }> {
  const db = supabaseAdmin()
  const live = new Set(currentFindingIds.map(String))
  try {
    // Paged (2026-09-29): graded plans are 'system' memories too, so past 1,000 live rows the oldest
    // swept findings — the likeliest to be stale — would never be re-checked. A short read only
    // means fewer rows checked, never an expiry that should not happen.
    const { rows, truncated } = await pageRows<any>((a, b) => db.from('eve_memory')
      .select('id,evidence,updated_at')
      .eq('source', 'system').is('superseded_by', null).is('expires_on', null)
      .order('updated_at', { ascending: false }).order('id').range(a, b))
    if (truncated) console.error('revalidateSweptMemories: read of live system memories incomplete — some were not re-checked')
    const cutoff = Date.now() - graceDays * 864e5
    const stale = rows.filter(r => {
      const fid = r?.evidence?.finding
      if (!fid) return false                       // not from a miner — leave it alone
      if (live.has(String(fid))) return false      // the evidence still says it
      return Date.parse(String(r.updated_at)) < cutoff
    })
    if (!stale.length) return { checked: rows.length, expired: 0 }
    const today = new Date().toISOString().slice(0, 10)
    for (let i = 0; i < stale.length; i += 100) {
      await db.from('eve_memory')
        .update({ expires_on: today, updated_at: new Date().toISOString() })
        .in('id', stale.slice(i, i + 100).map(r => r.id))
    }
    return { checked: rows.length, expired: stale.length }
  } catch { return { checked: 0, expired: 0 } }
}
