// WHAT SHE IS THINKING (2026-09-21). Jon: "Let's keep her observing but I want to see what she is
// thinking." The rungs stay at observe. Until today an observe-mode fire left one line in
// eve_agent_log — "clean_late observed, rung 0" — and threw away the prepared action, the draft
// she wrote and the reason. That is the opposite of what observing is for: the point of watching
// her before letting her act is to see what she WOULD have done.
//
// So every time she steps down to observe or draft, the whole prepared action is written here as a
// THOUGHT: what she would do, to what, why, the exact payload the executor would have run (the
// draft text, the task name and assignees, the note, the email), the one-line ask she would have
// sent, the evidence lines, and what she would have done at the recommended setup. Same for the
// review's plans, critiques and questions, the morning-ask candidates the budget cut, and her own
// propose_action attempts in chat.
//
// A thought is a row in eve_actions (kind 'thought', status 'open' — no migration; the table already
// takes a jsonb payload). It has three buttons, and two of them teach her:
//   Do it        — one-off, with a person's yes: runs the executor with human:true, as a proposal
//                  approval would. The rungs do not move.
//   Not this     — dismissed; the reason (if given) becomes a memory at weight 8, source jon:
//                  "Jon declined <action> for <subject> because …". Observing is how she learns.
//   Ask me next  — raises that one watch's rung override to 2, so next time she proposes instead.
//
// Seen state is per person, in app_users.prefs (no migration): a timestamp for "mark all seen" and
// the last few ids ticked one by one.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ACTIONS, recommendedRungs, modeOf, logAgent, recordAgentAction, afterAct, type ActionType, type AgentSettings } from './agent-mode'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (v: any, n: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, n)

export type ThoughtSource = 'chat' | 'review' | 'ask' | string   // 'watch:<key>'
export type WouldHaveBeen = 'act' | 'propose' | 'draft' | 'observe'

export type ThoughtInput = {
  /** An ActionType for anything an executor could run; 'plan' | 'critique' | 'question' for the review. */
  action: ActionType | 'plan' | 'critique' | 'question'
  /** The executor input, verbatim — draft text, task name + dept + date + assignees, note text, email. */
  payload: any | null
  /** The watch's reason, or Eve's own `why` from propose_action. */
  why: string
  /** The one-line ask she would have sent ("put Dayrene on the late clean at 4105?"). */
  ask: string
  source: ThoughtSource
  /** A unit, a thread, a listing, a task — the cooldown key. */
  subject?: string | null
  rungNow: number
  wouldHaveBeen: WouldHaveBeen
  evidence?: string[]
  /** What Eve was asked, when the thought came out of chat. */
  snippet?: string | null
  /** e.g. 'draft skipped — AI budget' */
  note?: string | null
  by?: string
  actor?: string | null
  /** Dedupe window in hours (one thought per source+subject per window). 0 = never dedupe. */
  cooldownHours?: number
}

export type ThoughtRow = {
  id: string; createdAt: string; status: string
  action: string; payload: any; why: string; ask: string; headline: string
  source: string; subject: string | null; rungNow: number; wouldHaveBeen: WouldHaveBeen
  evidence: string[]; snippet: string | null; note: string | null; by: string
  decidedBy: string | null; decidedAt: string | null; result: any
  draft: string | null
}

/** "I would put Dayrene on the late clean at 4105" — the ask, turned into a first-person line. */
export function headlineOf(action: string, ask: string, payload: any): string {
  let a = clip(ask, 240).replace(/\?+\s*$/, '').replace(/\s*\((?:it waits|nothing reaches|it waits on)[^)]*\)\s*$/i, '')
  if (!a) {
    if (action === 'task_create') a = `create "${clip(payload?.title, 80)}"`
    else if (action === 'task_assign') a = `assign task #${str(payload?.taskId)} to ${str(payload?.person)}`
    else if (action === 'task_note') a = `note on task #${str(payload?.taskId)}`
    else if (action === 'guest_reply_draft') a = `draft a reply to ${str(payload?.guest) || 'the guest'}`
    else if (action === 'email_draft') a = `draft "${clip(payload?.subject, 80)}"`
    else a = action.replace(/_/g, ' ')
  }
  a = a.charAt(0).toLowerCase() + a.slice(1)
  if (action === 'plan') return `I would plan: ${a}`
  if (action === 'critique') return `I would flag: ${a}`
  if (action === 'question') return `I would ask: ${a}`
  return `I would ${a}`
}

/** What she would have done at the recommended setup (the "Recommended setup" button's rungs). */
export function wouldHaveBeenFor(action: string): WouldHaveBeen {
  const rec = recommendedRungs()
  const r = (rec as any)[action]
  if (r == null) return 'propose'
  const m = modeOf(r)
  return m === 'deferred' ? 'act' : m
}

const DRAFT_KEYS = ['draft', 'body', 'text', 'note']
function draftOf(action: string, payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null
  if (action === 'email_draft') return str(payload.text || payload.html) || null
  for (const k of DRAFT_KEYS) if (str(payload[k]).trim()) return str(payload[k])
  return null
}

/**
 * Write one thought. Deduped per (source, subject) inside `cooldownHours` — a watch that trips on
 * the same late clean every 30 minutes leaves ONE thought, not sixteen. Never throws.
 */
export async function recordThought(t: ThoughtInput): Promise<{ ok: boolean; id?: string; deduped?: boolean }> {
  const db = supabaseAdmin()
  const subject = str(t.subject).trim() || null
  const cooldown = t.cooldownHours == null ? 24 : Math.max(0, Number(t.cooldownHours) || 0)
  try {
    if (subject && cooldown > 0) {
      const since = new Date(Date.now() - cooldown * 3600_000).toISOString()
      const { data } = await db.from('eve_actions').select('id').eq('kind', 'thought').filter('payload->>source', 'eq', t.source).filter('payload->>subject', 'eq', subject).gte('created_at', since).limit(1)
      const prior = ((data as any[]) || [])[0]
      if (prior) return { ok: true, id: str(prior.id), deduped: true }
    }
    const payload = {
      action: t.action, payload: t.payload ?? null, why: clip(t.why, 600), ask: clip(t.ask, 400),
      headline: headlineOf(t.action, t.ask, t.payload), source: t.source, subject, rungNow: Number(t.rungNow) || 0,
      wouldHaveBeen: t.wouldHaveBeen, evidence: (t.evidence || []).map(e => clip(e, 300)).filter(Boolean).slice(0, 8),
      snippet: t.snippet ? clip(t.snippet, 400) : null, note: t.note ? clip(t.note, 200) : null, by: t.by || 'eve',
      draft: draftOf(t.action, t.payload),
      // The watches' second cooldown lock reads these two off any eve_actions row.
      watchKey: t.source.startsWith('watch:') ? t.source.slice(6) : null,
    }
    const { data, error } = await db.from('eve_actions').insert({
      created_by: t.actor || t.by || 'eve', kind: 'thought', payload, why: clip(t.why, 400) || null, status: 'open',
      evidence: payload.evidence.length ? payload.evidence : null,
    }).select('id').maybeSingle()
    if (error) throw error
    return { ok: true, id: str((data as any)?.id) || undefined }
  } catch (e: any) {
    console.error('[thoughts] could not record', String(e?.message || e).slice(0, 160))
    return { ok: false }
  }
}

function rowOf(r: any): ThoughtRow {
  const pl = r.payload || {}
  return {
    id: str(r.id), createdAt: str(r.created_at), status: str(r.status),
    action: str(pl.action), payload: pl.payload ?? null, why: str(pl.why || r.why), ask: str(pl.ask), headline: str(pl.headline) || headlineOf(str(pl.action), str(pl.ask), pl.payload),
    source: str(pl.source) || 'eve', subject: pl.subject || null, rungNow: Number(pl.rungNow) || 0, wouldHaveBeen: pl.wouldHaveBeen || 'propose',
    evidence: Array.isArray(pl.evidence) ? pl.evidence.map(str) : [], snippet: pl.snippet || null, note: pl.note || null, by: str(pl.by || r.created_by || 'eve'),
    decidedBy: r.decided_by || null, decidedAt: r.decided_at || null, result: r.result || null,
    draft: pl.draft ?? draftOf(str(pl.action), pl.payload),
  }
}

export async function listThoughts(opts: { since?: string; source?: string; status?: 'open' | 'all'; limit?: number } = {}): Promise<ThoughtRow[]> {
  try {
    let q = supabaseAdmin().from('eve_actions').select('id,payload,why,status,created_by,created_at,decided_by,decided_at,result').eq('kind', 'thought')
    if (opts.status !== 'all') q = q.eq('status', 'open')
    if (opts.since) q = q.gte('created_at', opts.since)
    if (opts.source) q = opts.source === 'watch' ? q.like('payload->>source', 'watch:%') : q.filter('payload->>source', 'eq', opts.source)
    const { data } = await q.order('created_at', { ascending: false }).limit(Math.min(Math.max(opts.limit || 200, 1), 500))
    return ((data as any[]) || []).map(rowOf)
  } catch { return [] }
}

export async function getThought(id: string): Promise<ThoughtRow | null> {
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,payload,why,status,created_by,created_at,decided_by,decided_at,result').eq('id', id).eq('kind', 'thought').maybeSingle()
    return data ? rowOf(data) : null
  } catch { return null }
}

// ---- Seen state: per person, app_users.prefs ------------------------------------------------------

export type SeenState = { seenAt: string | null; seenIds: string[] }

export async function readSeen(email: string): Promise<SeenState> {
  try {
    const { data } = await supabaseAdmin().from('app_users').select('prefs').eq('email', email).maybeSingle()
    const p = (data as any)?.prefs
    const s = p && typeof p === 'object' && p.eve_thoughts && typeof p.eve_thoughts === 'object' ? p.eve_thoughts : {}
    return { seenAt: str(s.seenAt) || null, seenIds: Array.isArray(s.seenIds) ? s.seenIds.map(str) : [] }
  } catch { return { seenAt: null, seenIds: [] } }
}

export async function markSeen(email: string, ids?: string[]): Promise<{ ok: boolean }> {
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('app_users').select('prefs').eq('email', email).maybeSingle()
    if (!data) return { ok: false }
    const prefs = (data as any).prefs && typeof (data as any).prefs === 'object' ? { ...(data as any).prefs } : {}
    const cur = await readSeen(email)
    const next: SeenState = ids && ids.length
      ? { seenAt: cur.seenAt, seenIds: Array.from(new Set(cur.seenIds.concat(ids.map(str)))).slice(-300) }
      : { seenAt: new Date().toISOString(), seenIds: [] }
    prefs.eve_thoughts = next
    const { error } = await db.from('app_users').update({ prefs }).eq('email', email)
    return { ok: !error }
  } catch { return { ok: false } }
}

export function isUnseen(t: ThoughtRow, seen: SeenState): boolean {
  if (seen.seenIds.indexOf(t.id) >= 0) return false
  if (seen.seenAt && Date.parse(t.createdAt) <= Date.parse(seen.seenAt)) return false
  return true
}

export async function unseenCount(email: string): Promise<number> {
  const [rows, seen] = await Promise.all([listThoughts({ status: 'open', limit: 300 }), readSeen(email)])
  let n = 0
  for (const r of rows) if (isUnseen(r, seen)) n++
  return n
}

/** True when nothing she does would leave the app: agent mode OFF, or every outward rung at 0. */
export function allObserving(s: AgentSettings): boolean {
  if (!s.enabled) return true
  for (const a of ACTIONS) if (a.cap > 1 && (s.rungs[a.key] || 0) > 0) return false
  return true
}

// ---- The three buttons ----------------------------------------------------------------------------

/**
 * DO IT — a person's one-off yes. The executor runs with human:true (the welded actions accept
 * that), the row closes with the receipt, the act is logged with its undo and graded like any
 * other. The rungs do not move: this is "do this one", not "do these from now on".
 */
export async function doThought(id: string, by: string): Promise<{ ok: boolean; done?: string; error?: string; logId?: string | null }> {
  const t = await getThought(id)
  if (!t) return { ok: false, error: 'that thought is no longer on file' }
  if (t.status !== 'open') return { ok: false, error: `already ${t.status}` }
  const isAction = ACTIONS.some(a => a.key === t.action)
  if (!isAction) return { ok: false, error: 'a review plan, critique or question is decided on the Review tab, not run' }
  if (!t.payload) return { ok: false, error: t.note || 'there is no prepared action to run (the draft was skipped)' }
  const action = t.action as ActionType
  const db = supabaseAdmin()
  // Claim it first, so two taps do not create two tasks.
  let claimed = false
  try {
    const { data } = await db.from('eve_actions').update({ status: 'doing', decided_by: by, decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'open').select('id')
    claimed = !!((data as any[]) || []).length
  } catch { claimed = false }
  if (!claimed) return { ok: false, error: 'someone got there first' }
  const { runExecutor } = await import('./executors')
  const r = await runExecutor(action, t.payload, { by: 'chat', actor: by, human: true })
  const nowISO = new Date().toISOString()
  try { await db.from('eve_actions').update({ status: r.ok ? 'executed' : 'open', executed_at: r.ok ? nowISO : null, result: { by, ok: r.ok, done: r.ok ? (r.done || r.summary) : undefined, error: r.ok ? undefined : (r.error || r.summary), ref: r.ref || null } }).eq('id', id) } catch { /* fine */ }
  const logId = await recordAgentAction(action, { rung: t.rungNow as any, allowed: r.ok, mode: 'act', reason: r.ok ? `one-off: ${by} said do it from Thinking` : `one-off from Thinking by ${by} failed: ${r.error || r.summary}`, summary: r.ok ? (r.done || r.summary) : t.headline, ref: r.ref || id, by: 'chat', actor: by, countAs: r.ok ? 'action' : 'none', undo: r.undo || undefined })
  if (r.ok) await afterAct(action, { ok: true, done: r.done || r.summary, ref: r.ref || null, undo: r.undo || null }, { by: t.by, actor: by, watchKey: t.source.startsWith('watch:') ? t.source.slice(6) : null, subject: t.subject, summary: t.headline })
  return r.ok ? { ok: true, done: r.done || r.summary, logId } : { ok: false, error: r.error || r.summary, logId }
}

/**
 * NOT THIS — dismissed. With a reason it becomes a memory at weight 8, source jon, so the next
 * time the same shape comes up she has the rule in front of her. Without one, she just moves on.
 */
export async function dismissThought(id: string, by: string, reason?: string): Promise<{ ok: boolean; memoryId?: string | null; error?: string }> {
  const t = await getThought(id)
  if (!t) return { ok: false, error: 'that thought is no longer on file' }
  if (t.status !== 'open') return { ok: false, error: `already ${t.status}` }
  const why = clip(reason, 300)
  try { await supabaseAdmin().from('eve_actions').update({ status: 'dismissed', decided_by: by, decided_at: new Date().toISOString(), result: why ? { note: why } : { note: 'not this' } }).eq('id', id).eq('status', 'open') } catch { return { ok: false, error: 'could not update' } }
  let memoryId: string | null = null
  if (why) {
    try {
      const { saveMemory } = await import('./memory')
      const label = ACTIONS.find(a => a.key === t.action)?.label.toLowerCase() || t.action
      const what = t.subject ? `${label} for ${subjectLabel(t)}` : label
      const r = await saveMemory({
        kind: 'correction', text: `Jon declined ${what} because ${why}${/[.!?]$/.test(why) ? '' : '.'} (She would have: ${t.headline.replace(/^I would /, '')}.)`,
        why: `Declined from Eve → Thinking (${t.source})`, scope: scopeOf(t), weight: 8, source: 'jon', created_by: by,
        evidence: { thought_id: id, source: t.source, subject: t.subject, ask: t.ask },
      })
      memoryId = r.ok ? (r.id || null) : null
    } catch { memoryId = null }
  }
  await logAgent({ action: (ACTIONS.some(a => a.key === t.action) ? t.action : 'memory_rule') as ActionType, rung: t.rungNow as any, allowed: false, mode: 'observe', reason: why ? `declined by ${by}: ${why}` : `declined by ${by}`, summary: t.headline, ref: id, by: 'chat', actor: by })
  return { ok: true, memoryId }
}

function subjectLabel(t: ThoughtRow): string {
  const p = t.payload || {}
  return str(p.unit || p.guest || p.subject || p.title) || str(t.subject).replace(/^(task|thread|res|rev|glitch|listings):/, '') || 'this'
}
function scopeOf(t: ThoughtRow): string {
  const unit = str(t.payload?.unit).trim()
  return unit ? `unit:${unit}` : 'portfolio'
}

/** ASK ME NEXT TIME — that one watch proposes from now on (rung override 2). */
export async function askNextTime(id: string, by: string): Promise<{ ok: boolean; watch?: string; error?: string }> {
  const t = await getThought(id)
  if (!t) return { ok: false, error: 'that thought is no longer on file' }
  if (!t.source.startsWith('watch:')) return { ok: false, error: 'only a watch can be told to ask next time — this came from ' + t.source }
  const key = t.source.slice(6)
  const { setWatch } = await import('./watches')
  const r = await setWatch(key, { rungOverride: 2 }, by)
  if (!r.ok) return { ok: false, error: r.error }
  try { await supabaseAdmin().from('eve_actions').update({ status: 'dismissed', decided_by: by, decided_at: new Date().toISOString(), result: { note: 'ask me next time — watch raised to propose' } }).eq('id', id).eq('status', 'open') } catch { /* fine */ }
  return { ok: true, watch: key }
}

// ---- The Telegram digest (optional, OFF by default) ----------------------------------------------

/** "Yesterday I would have: …" — three lines at most, for the 09:00 ask when thinkingDigest is on. */
export async function thinkingDigestLines(max = 3): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const rows = await listThoughts({ since, status: 'all', limit: 100 })
  const seen: Record<string, true> = {}
  const out: string[] = []
  for (const r of rows) {
    const k = r.source + '|' + (r.subject || r.headline)
    if (seen[k]) continue
    seen[k] = true
    out.push(`• ${r.headline.replace(/^I would /, '')}${r.why ? ` — ${clip(r.why, 90)}` : ''}`)
    if (out.length >= max) break
  }
  return out
}
