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
import { lc, pageRows } from './ctx'
import { sameThought, type EveMemory } from './memory'
import { getSettingFresh, setSetting } from '@/lib/app-settings'

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
  /** Every duplicate group (not capped like `findings`) — what "Merge all" would act on. */
  duplicateGroups: number
  duplicateRows: number
  /** Slack-learned, never loaded into a prompt, older than STALE_SLACK_DAYS — what "Retire" would act on. */
  staleSlack: number
  findings: MemoryFinding[]
  summary: string
}

const shape = (m: any) => ({
  id: String(m.id), kind: String(m.kind), scope: String(m.scope), weight: Number(m.weight),
  source: String(m.source), text: String(m.text || '').slice(0, 400),
  use_count: Number(m.use_count || 0), updated_at: String(m.updated_at),
})

/** Sources a person (or a document a person gave her) wrote. Never retired or superseded by a clean-up. */
const MACHINE_SOURCES = ['slack', 'eve', 'system']
const isMachine = (m: any) => MACHINE_SOURCES.includes(String(m?.source))

export const STALE_SLACK_DAYS = 60
const isStaleSlack = (m: any) => String(m?.source) === 'slack' && Number(m?.use_count || 0) === 0
  && Date.parse(String(m?.created_at)) < Date.now() - STALE_SLACK_DAYS * 864e5

/**
 * Groups of live memories that say the same thing, across every scope. Same words (0.75 overlap) AND
 * the same numbers and negations (memory.ts sameThought) — "pets are allowed" and "pets are not
 * allowed" share every word and are opposites, so they are never a group. Word sets are built once.
 */
function findDuplicateGroups(rows: any[]): any[][] {
  const sets = rows.map(r => new Set(words(String(r.text || ''))))
  const ov = (i: number, j: number): number => {
    const A = sets[i], B = sets[j]
    if (!A.size || !B.size) return 0
    let inter = 0
    A.forEach(w => { if (B.has(w)) inter++ })
    return inter / (A.size + B.size - inter)
  }
  const taken = new Set<number>()
  const out: any[][] = []
  for (let i = 0; i < rows.length; i++) {
    if (taken.has(i)) continue
    const group = [rows[i]]
    const members = [i]
    for (let j = i + 1; j < rows.length; j++) {
      if (taken.has(j)) continue
      if (ov(i, j) >= 0.75 && sameThought(String(rows[i].text || ''), String(rows[j].text || ''), 0)) { group.push(rows[j]); members.push(j) }
    }
    if (group.length < 2) continue
    members.forEach(m => taken.add(m))
    // A group of only person-written rows is theirs to sort out; there is nothing a clean-up may merge.
    if (group.filter(isMachine).length === 0) continue
    out.push(group)
  }
  return out
}

async function liveRows(limit = 800): Promise<any[]> {
  const { data } = await supabaseAdmin().from('eve_memory')
    .select('id,kind,text,why,scope,weight,source,confidence,evidence,use_count,last_used_at,expires_on,created_at,updated_at')
    .is('superseded_by', null).is('expires_on', null)
    .order('weight', { ascending: false }).limit(Math.min(limit, 1500))
  return (data || []) as any[]
}

export async function auditMemory(opts?: { limit?: number }): Promise<MemoryAudit> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_memory')
    .select('id,kind,text,why,scope,weight,source,confidence,evidence,use_count,last_used_at,expires_on,created_at,updated_at')
    .is('superseded_by', null).is('expires_on', null)
    .order('weight', { ascending: false }).limit(Math.min(opts?.limit || 800, 1500))
  const rows = (data || []) as any[]

  let bySource: Record<string, number> = {}
  let byKind: Record<string, number> = {}
  let chars = 0
  for (const m of rows) {
    bySource[String(m.source)] = (bySource[String(m.source)] || 0) + 1
    byKind[String(m.kind)] = (byKind[String(m.kind)] || 0) + 1
    chars += String(m.text || '').length + String(m.why || '').length
  }

  // THE COUNTS ARE COUNTS, NOT THE PAGE (2026-11-10). `rows` above is the 800 heaviest memories with
  // no expiry date — the set the duplicate and contradiction checks can afford to compare pairwise —
  // and every headline number used to be taken from it, so the card could never say more than "800
  // live" however many there were, and a memory with an expiry date was not counted at all. The
  // headline numbers now come from a read of every live row (four small columns, paged): live means
  // not superseded and not past its expiry. If that read stops short the old figures stand.
  let exact: { live: number; neverUsed: number; human: number; staleSlack: number } | null = null
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { rows: slim, truncated } = await pageRows<any>((a, b) => db.from('eve_memory')
      .select('id,source,kind,use_count,expires_on,created_at')
      .is('superseded_by', null).order('id').range(a, b), 20)
    if (!truncated) {
      const liveRows = slim.filter(m => !(m.expires_on && String(m.expires_on) < today))
      const src: Record<string, number> = {}, knd: Record<string, number> = {}
      for (const m of liveRows) { src[String(m.source)] = (src[String(m.source)] || 0) + 1; knd[String(m.kind)] = (knd[String(m.kind)] || 0) + 1 }
      bySource = src; byKind = knd
      exact = {
        live: liveRows.length,
        neverUsed: liveRows.filter(m => Number(m.use_count || 0) === 0).length,
        human: liveRows.filter(m => String(m.source) === 'jon').length,
        staleSlack: liveRows.filter(m => !m.expires_on && isStaleSlack(m)).length,
      }
    }
  } catch { exact = null }

  const findings: MemoryFinding[] = []
  const human = rows.filter(m => String(m.source) === 'jon')

  // ---- duplicates, INCLUDING across scopes (the gap saveMemory cannot see) ----
  const dupGroups = findDuplicateGroups(rows)
  for (const group of dupGroups) {
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

  const liveN = exact ? exact.live : rows.length
  const humanN = exact ? exact.human : human.length
  const neverN = exact ? exact.neverUsed : neverUsed
  return {
    live: liveN, bySource, byKind,
    promptCost: {
      chars, approxTokens,
      note: `Roughly ${approxTokens} tokens of memory exist. Not all of it loads on every turn — memories are selected by scope and question — but this is the pool, and it is paid for out of the same budget as the actual conversation.`,
    },
    neverUsed: neverN, humanWritten: humanN,
    duplicateGroups: dupGroups.length,
    duplicateRows: dupGroups.reduce((n, g) => n + g.length, 0),
    staleSlack: exact ? exact.staleSlack : rows.filter(isStaleSlack).length,
    // Duplicates first and never cut off by the cap: they are what the Memory clean-up card lists.
    findings: [...findings.filter(f => f.kind === 'duplicate'), ...findings.filter(f => f.kind !== 'duplicate').slice(0, 60)],
    summary: `${liveN} live memories (${humanN} written by Jon, the rest taught by the team or learned). ${neverN} have never been loaded into a prompt. ${findings.length} thing(s) worth cleaning up${liveN > rows.length ? ` (duplicates and contradictions were checked across the ${rows.length} heaviest)` : ''}.`,
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
    const touchable = rows.filter(isMachine)
    if (!touchable.length) return { ok: false, changed: 0, error: 'Those memories were written by a person. Edit or delete them yourself in the Memory tab.' }

    if (input.op === 'keep') {
      await db.from('eve_memory').update({ updated_at: now }).in('id', touchable.map(r => r.id))
      return { ok: true, changed: touchable.length }
    }

    if (input.op === 'merge') {
      const r = await mergeGroup(ids, input.by)
      return r.error ? { ok: false, changed: 0, error: r.error } : { ok: true, changed: r.merged, kept: r.kept || undefined }
    }

    await db.from('eve_memory').update({ expires_on: today, updated_at: now }).in('id', touchable.map(r => r.id))
    return { ok: true, changed: touchable.length }
  } catch (e: any) { return { ok: false, changed: 0, error: String(e?.message || e).slice(0, 200) } }
}

// ---- Memory clean-up: merge and retire, with a record ------------------------------------------------
// (2026-11-10) What the "Memory clean-up" card on Settings → Eve → Memory runs.
//
// MERGE. One row is kept per group and the others point at it (superseded_by) — nothing is deleted.
//   • A row a person wrote (jon, staff, a document, a Telegram answer) is ALWAYS the one kept when the
//     group has one, and is never changed: not its weight, not its scope. Any other person-written row
//     in the group is left exactly as it is.
//   • Otherwise the heaviest machine-learned row is kept (then the most used), takes the group's highest
//     weight, and — when the copies sat in different scopes — becomes portfolio, so the thought is not
//     lost for the buildings whose copy was folded in.
//   • Kept by a person's row scoped to one building: only the machine copies in that same scope (or all
//     of them, if the person's row is portfolio) are folded into it; copies in other scopes are merged
//     among themselves by the rule above.
// Every merge and every retire is written to app_settings `eve_memory_cleanup_log` (newest first, 300
// kept): who, when, which row was kept, which were folded in, with their words.
const CLEANUP_LOG_KEY = 'eve_memory_cleanup_log'
type CleanupEntry = { at: string; by: string; op: 'merge' | 'retire_slack'; kept?: { id: string; source: string; scope: string; text: string } | null; merged?: { id: string; source: string; scope: string; text: string }[]; count?: number }
async function logCleanup(entries: CleanupEntry[]): Promise<void> {
  if (!entries.length) return
  try {
    const cur = await getSettingFresh<CleanupEntry[]>(CLEANUP_LOG_KEY, [])
    await setSetting(CLEANUP_LOG_KEY, [...entries, ...(Array.isArray(cur) ? cur : [])].slice(0, 300), 'memory-cleanup')
  } catch { /* the merge stands; superseded_by on each row is the record of last resort */ }
}
const brief = (r: any) => ({ id: String(r.id), source: String(r.source), scope: String(r.scope), text: String(r.text || '').slice(0, 200) })
const byWeight = (a: any, b: any) => Number(b.weight || 0) - Number(a.weight || 0) || Number(b.use_count || 0) - Number(a.use_count || 0)

async function mergeRows(rows: any[], by: string, log: CleanupEntry[]): Promise<{ merged: number; kept: string | null }> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const people = rows.filter(r => !isMachine(r)).sort(byWeight)
  const machines = rows.filter(isMachine).sort(byWeight)
  if (!machines.length) return { merged: 0, kept: people[0] ? String(people[0].id) : null }
  if (people.length) {
    const keep = people[0]
    const fold = machines.filter(m => String(keep.scope) === 'portfolio' || String(m.scope) === String(keep.scope))
    const rest = machines.filter(m => !fold.includes(m))
    let merged = 0
    if (fold.length) {
      const { error } = await db.from('eve_memory').update({ superseded_by: keep.id, updated_at: now }).in('id', fold.map(r => r.id))
      if (error) throw new Error(error.message)
      merged += fold.length
      log.push({ at: now, by, op: 'merge', kept: brief(keep), merged: fold.map(brief) })
    }
    if (rest.length > 1) merged += (await mergeRows(rest, by, log)).merged
    return { merged, kept: String(keep.id) }
  }
  const keep = machines[0]
  const losers = machines.slice(1)
  if (!losers.length) return { merged: 0, kept: String(keep.id) }
  const patch: any = { weight: Math.min(10, Math.max(...machines.map(r => Number(r.weight || 0)))), updated_at: now }
  if (machines.some(m => String(m.scope) !== String(keep.scope))) patch.scope = 'portfolio'
  const up = await db.from('eve_memory').update(patch).eq('id', keep.id)
  if (up.error) throw new Error(up.error.message)
  const { error } = await db.from('eve_memory').update({ superseded_by: keep.id, updated_at: now }).in('id', losers.map(r => r.id))
  if (error) throw new Error(error.message)
  log.push({ at: now, by, op: 'merge', kept: { ...brief(keep), scope: String(patch.scope || keep.scope) }, merged: losers.map(brief) })
  return { merged: losers.length, kept: String(keep.id) }
}

/** Merge one group, named by its ids (the "Merge" button on a row). Only live rows take part. */
export async function mergeGroup(ids: string[], by: string): Promise<{ merged: number; kept: string | null; error?: string }> {
  try {
    const { data } = await supabaseAdmin().from('eve_memory').select('id,text,scope,weight,source,use_count')
      .in('id', ids.slice(0, 200)).is('superseded_by', null).is('expires_on', null)
    const rows = (data || []) as any[]
    if (rows.length < 2) return { merged: 0, kept: rows[0] ? String(rows[0].id) : null }
    if (!rows.some(isMachine)) return { merged: 0, kept: null, error: 'Those memories were written by a person. Edit or delete them yourself in the Memory tab.' }
    const log: CleanupEntry[] = []
    const r = await mergeRows(rows, by, log)
    await logCleanup(log)
    return r
  } catch (e: any) { return { merged: 0, kept: null, error: String(e?.message || e).slice(0, 200) } }
}

/** Merge every duplicate group, found fresh on the server at the moment of the click. */
export async function mergeAllDuplicates(by: string): Promise<{ ok: boolean; groups: number; merged: number; error?: string }> {
  let groups = 0, merged = 0
  const log: CleanupEntry[] = []
  try {
    for (const g of findDuplicateGroups(await liveRows())) {
      const r = await mergeRows(g, by, log)
      if (r.merged) { groups++; merged += r.merged }
    }
    await logCleanup(log)
    return { ok: true, groups, merged }
  } catch (e: any) {
    await logCleanup(log)
    return { ok: false, groups, merged, error: String(e?.message || e).slice(0, 200) }
  }
}

/** Retire (expire, not delete) what she overheard in Slack, never used, older than STALE_SLACK_DAYS. */
export async function retireStaleSlack(by: string): Promise<{ ok: boolean; retired: number; error?: string }> {
  try {
    // Asked for directly (2026-11-10): liveRows() is the 800 heaviest, and what was overheard and never
    // used sits at the light end, so most of it was never reached by this button.
    const cutoff = new Date(Date.now() - STALE_SLACK_DAYS * 864e5).toISOString()
    const { data: stale, error: readErr } = await supabaseAdmin().from('eve_memory').select('id,source,use_count,created_at')
      .eq('source', 'slack').eq('use_count', 0).is('superseded_by', null).is('expires_on', null)
      .lt('created_at', cutoff).order('created_at').limit(2000)
    if (readErr) throw new Error(readErr.message)
    const ids = ((stale || []) as any[]).filter(isStaleSlack).map(r => String(r.id))
    if (!ids.length) return { ok: true, retired: 0 }
    const now = new Date().toISOString()
    let retired = 0
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabaseAdmin().from('eve_memory').update({ expires_on: now.slice(0, 10), updated_at: now })
        .in('id', ids.slice(i, i + 100)).eq('source', 'slack').eq('use_count', 0).is('expires_on', null).select('id')
      if (error) throw new Error(error.message)
      retired += (data || []).length
    }
    await logCleanup([{ at: now, by, op: 'retire_slack', count: retired }])
    return { ok: true, retired }
  } catch (e: any) { return { ok: false, retired: 0, error: String(e?.message || e).slice(0, 200) } }
}

/** The last things the clean-up did, for the card. */
export async function cleanupLog(limit = 10): Promise<CleanupEntry[]> {
  try { const v = await getSettingFresh<CleanupEntry[]>(CLEANUP_LOG_KEY, []); return (Array.isArray(v) ? v : []).slice(0, limit) } catch { return [] }
}
