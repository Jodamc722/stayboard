// FOCUS — the model decides what is actually worth doing today (Jon, 2026-09-09: "make sure the
// suggestions use fable to determine real things to focus on and clarity about suggestions and
// things to review").
//
// The engines already produce candidates honestly: lib/suggestions ranks preventative jobs that
// COULD happen today, lib/review-queue lists the maintenance backlog with the next day each unit is
// empty, lib/task-audit finds work done twice. What they cannot do is the judgement call a good
// ops lead makes at 7am — "these four, today; the rest can wait, and here is why". That call is
// this file. The model reads the day (crew, cleans, load) and every candidate, and returns:
//
//   headline   one sentence about the day's shape
//   focus      at most a handful of candidate ids, each with a reason a coordinator reads
//   review     everything else, with a short note, so nothing silently disappears
//   parked     one sentence on what was left and why
//
// NOTHING HERE WRITES. The picks are applied through the same routes the Review tab always used.
// CACHED for two hours per market, keyed on the candidate set, so a busy board costs a handful of
// model calls a day, not one per refresh; a changed candidate set re-asks.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { marketOf } from './segments'
import { buildSuggestions, type Suggestion } from './suggestions'
import { buildReviewQueue, type ReviewItem } from './review-queue'
import { auditDuplicates, type DupGroup } from './task-audit'
import { anthropicMessages } from './anthropic-call'
import { modelPairFor } from './ai-models'
import { createHash } from 'crypto'

export const OPS_FOCUS_KEY = 'ops_focus'
const TTL_MS = 2 * 60 * 60 * 1000
/** Under this age the stored verdict is served without reading the engines at all. */
const FRESH_MS = 20 * 60 * 1000
const MAX_FOCUS = 6

export type FocusPick = { id: string; reason: string; do: 'add' | 'move' | 'cancel' }
export type FocusVerdict = {
  headline: string
  focus: FocusPick[]
  review: { id: string; note: string }[]
  parked: string
}
export type FocusResult = {
  ok: true
  today: string
  market: string
  verdict: FocusVerdict
  /** The candidate set the verdict was made from — the client renders rows from its own reads and uses these ids. */
  candidates: { suggestions: number; waiting: number; duplicates: number }
  model: string
  at: string
  cached: boolean
  /** When the model could not be reached: the engines' own order stands in, and the page says so. */
  fallback?: string
}

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const str = (v: any) => String(v ?? '').trim()
export const dupId = (g: DupGroup) => 'dup:' + g.listingId + '|' + g.date + '|' + g.key

type Cached = { hash: string; at: string; model: string; verdict: FocusVerdict; candidates: FocusResult['candidates'] }

// One build per market at a time per instance: the badge and the tab mount together and would
// otherwise both miss the cold cache and both pay for the model.
const inflight = new Map<string, Promise<FocusResult>>()
export function buildOpsFocus(market: string, opts: { refresh?: boolean } = {}): Promise<FocusResult> {
  const k = market + (opts.refresh ? '!' : '')
  const cur = inflight.get(k); if (cur) return cur
  const p = buildOpsFocusNow(market, opts).finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

async function buildOpsFocusNow(market: string, opts: { refresh?: boolean } = {}): Promise<FocusResult> {
  const today = ymd(new Date())
  const db = supabaseAdmin()

  // ── CHEAP CACHE CHECK FIRST (2026-09-09 audit) ───────────────────────────────────────────────
  // The hash below needs the candidate set, so the original code ran all three engines — the
  // cadence scan, the review queue and the duplicate audit — BEFORE discovering it already had an
  // answer. The Focus badge mounts on every board view, so every page load paid that. A verdict
  // less than FRESH_MS old is served as-is; between FRESH_MS and the TTL we still rebuild the
  // candidates to check the hash, because a board that changed deserves a new answer.
  const cacheKeyEarly = today + '|' + market
  const cached = (await getSetting<Record<string, Cached>>(OPS_FOCUS_KEY, {})) || {}
  const early = cached[cacheKeyEarly]
  const age = early ? Date.now() - Date.parse(early.at) : Infinity
  if (!opts.refresh && early && age < FRESH_MS) {
    return { ok: true, today, market, verdict: early.verdict, candidates: early.candidates, model: early.model, at: early.at, cached: true }
  }

  // ── the same scope the Review tab reads ──
  const { data: lRes } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000)
  const nameOf: Record<string, string> = {}
  const ids: string[] = []
  for (const l of ((lRes || []) as any[])) {
    const name = String(l.nickname || l.title || 'Unit')
    const m = marketOf(l.building, l.address_city, name)
    if (market !== 'all' && m !== market) continue
    nameOf[String(l.id)] = name
    ids.push(String(l.id))
  }
  const [run, queue, dupes] = await Promise.all([
    buildSuggestions(today),
    buildReviewQueue(ids, today, { nameOf, horizon: 21, limit: 200 }),
    auditDuplicates({ listingIds: ids, days: 30, today }),
  ])
  // Same market rule as the client's all(market) (SuggestionsBand): vendor buildings file under 'Vendor', never under their geography.
  const sugs: Suggestion[] = run.enabled === false ? [] : run.suggestions.filter(s => market === 'all' || (market === 'Vendor' ? s.vendor : s.market === market && !s.vendor))
  // Bounded, for the bill: the longest-waiting 80 and up to 20 duplicate groups are plenty for a
  // morning's judgement; the Review tab still lists the whole queue.
  const waiting: ReviewItem[] = queue.items.slice(0, 80)
  const groups: DupGroup[] = (dupes.groups || []).slice(0, 20)
  const candidates = { suggestions: sugs.length, waiting: waiting.length, duplicates: groups.length }

  // ── cache: same candidates, same day, under two hours → same answer ──
  const hash = createHash('sha1').update(JSON.stringify({
    today, market, heavy: run.day.heavy, cap: run.day.cap,
    s: sugs.map(s => s.id + ':' + s.candidates.join(',')),
    w: waiting.map(w => w.taskId + ':' + (w.target?.date || '') + ':' + (w.target?.hasTrade ? 1 : 0)),
    d: groups.map(dupId),
  })).digest('hex').slice(0, 16)
  const cacheKey = today + '|' + market
  const all = cached
  const hit = all[cacheKey]
  if (!opts.refresh && hit && hit.hash === hash && Date.now() - Date.parse(hit.at) < TTL_MS) {
    return { ok: true, today, market, verdict: hit.verdict, candidates: hit.candidates, model: hit.model, at: hit.at, cached: true }
  }

  // ── nothing to decide → no model call ──
  if (!sugs.length && !waiting.length && !groups.length) {
    const verdict: FocusVerdict = { headline: 'Nothing outstanding in this market — every maintenance job is scheduled or done.', focus: [], review: [], parked: '' }
    return { ok: true, today, market, verdict, candidates, model: 'none', at: new Date().toISOString(), cached: false }
  }

  // ── the ask ──
  const day = run.day
  const lines: string[] = []
  lines.push(`DAY ${today} · market ${market} · ${day.openCleans} departure cleans still open · ${day.cleaners} cleaners · load ${day.load}/cleaner · ${day.heavy ? 'HEAVY turn day' : 'normal day'} · engine cap for new jobs today: ${day.cap}${day.verdict ? ' · ' + day.verdict : ''}`)
  lines.push('')
  lines.push('CANDIDATES — one per line, fields as key=value separated by " ;; ". The id field is the WHOLE string between id=" and the closing quote (ids contain | characters). S = preventative job the cadence engine says is due and could happen today (nobody has filed it yet; picking it means "add"). P = maintenance already on the books, waiting; target = next day the unit is empty; "with <name>" means a technician is already booked there (picking it means "move" it onto that day). D = the same job completed twice on one unit (picking it means "cancel" the extra).')
  const q = (v: string) => '"' + v.replace(/"/g, "'") + '"'
  for (const s of sugs) lines.push(`S id=${q(s.id)} ;; unit=${s.unit} ;; job=${s.label} ;; dept=${s.dept} ;; ${s.minutes}min ;; ${s.daysOver}d over ;; last=${s.lastDone || 'never'} ;; near=${s.candidates.join(', ') || 'nobody'} (${s.proximity}) ;; ${s.vacantTonight ? 'empty tonight' : 'occupied'} ;; why=${s.why}`)
  for (const w of waiting) lines.push(`P id=${q(w.taskId)} ;; unit=${w.unit} ;; job=${w.task} ;; dept=${w.dept} ;; ${w.waitingDays == null ? 'scheduled ahead' : w.waitingDays + 'd late'} ;; on it=${w.assignees.join(', ') || 'unassigned'} ;; target=${w.target ? w.target.date + (w.target.hasTrade ? ' with ' + w.target.who.join(', ') : ' (unit empty, nobody booked)') : 'none in 21 days'}`)
  for (const g of groups) lines.push(`D id=${q(dupId(g))} ;; unit=${g.unit} ;; job=${g.key.replace(/-/g, ' ')} ;; date=${g.date} ;; ${g.tasks.length} tasks, keep ${g.keepId}`)

  const system = `You are the operations lead's morning planner for a short-term rental company running ~300 units across Miami and Broward. A coordinator reads your output and acts on it; nothing you say is executed automatically.
Pick what is REAL and DOABLE today: a technician already in the building or unit, a unit empty today with someone near it, a badly late job with a workable day, a duplicate that wastes a visit. On a heavy turn day be stingy. Never pick more than ${MAX_FOCUS}; fewer is fine; zero is fine if the day cannot hold it. Every reason is one concrete sentence a coordinator can act on — who, where, why today — not a restatement of the line. Everything you do not pick goes under review automatically; add a "review" note ONLY for the few (at most 10) where a coordinator needs a word of context (e.g. "guest in until Fri", "needs a vendor"). Copy ids exactly. Return JSON only:
{"headline": "<one sentence, the day's shape and how many to focus on>", "focus": [{"id": "<id>", "do": "add"|"move"|"cancel", "reason": "<sentence>"}], "review": [{"id": "<id>", "note": "<a few words>"}], "parked": "<one sentence: what was left and why>"}`

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return fallbackVerdict(today, market, sugs, waiting, groups, candidates, 'AI not configured')
  const { model, fallback } = await modelPairFor('ops-focus')
  let verdict: FocusVerdict | null = null
  let answeredBy = model
  try {
    // No `temperature`: the Fable tier rejects it as deprecated (seen live 2026-09-09), and the
    // system prompt already asks for a stingy, literal answer.
    const r = await anthropicMessages(key, {
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: lines.join('\n') }],
    }, fallback)
    answeredBy = r.model
    if (!r.ok) throw new Error(str(r.data?.error?.message) || 'model call failed (' + r.status + ')')
    const text = (r.data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => String(c.text || '')).join('\n')
    verdict = parseVerdict(text)
  } catch (e: any) {
    return fallbackVerdict(today, market, sugs, waiting, groups, candidates, str(e?.message || e).slice(0, 160))
  }
  if (!verdict) return fallbackVerdict(today, market, sugs, waiting, groups, candidates, 'model answer was not JSON')

  // ── keep the model honest: only known ids, at most MAX_FOCUS, everything else under review ──
  const known = new Map<string, 'add' | 'move' | 'cancel'>()
  for (const s of sugs) known.set(s.id, 'add')
  for (const w of waiting) known.set(w.taskId, 'move')
  for (const g of groups) known.set(dupId(g), 'cancel')
  const seen = new Set<string>()
  const focus: FocusPick[] = []
  for (const p of verdict.focus) {
    const id = str(p.id); if (!known.has(id) || seen.has(id)) continue
    seen.add(id); focus.push({ id, do: known.get(id)!, reason: str(p.reason).slice(0, 240) || 'Worth doing today.' })
    if (focus.length >= MAX_FOCUS) break
  }
  const noted: Record<string, string> = {}
  for (const r of verdict.review) { const id = str(r.id); if (known.has(id) && !seen.has(id)) noted[id] = str(r.note).slice(0, 120) }
  const review = Array.from(known.keys()).filter(id => !seen.has(id)).map(id => ({ id, note: noted[id] || '' }))
  const clean: FocusVerdict = { headline: cut(str(verdict.headline), 260) || (focus.length + ' to focus on today.'), focus, review, parked: cut(str(verdict.parked), 480) }

  const at = new Date().toISOString()
  // RE-READ BEFORE WRITING. The map above was read before the engines ran and the model answered —
  // a window of many seconds now — so two markets building at once would clobber each other's entry.
  const fresh = (await getSetting<Record<string, Cached>>(OPS_FOCUS_KEY, {}).catch(() => all)) || all
  const next: Record<string, Cached> = {}
  for (const k of Object.keys(fresh)) if (k.startsWith(today + '|')) next[k] = fresh[k]
  next[cacheKey] = { hash, at, model: answeredBy, verdict: clean, candidates }
  await setSetting(OPS_FOCUS_KEY, next, null).catch(() => {})
  return { ok: true, today, market, verdict: clean, candidates, model: answeredBy, at, cached: false }
}

/** Cap on a word boundary — a sentence cut mid-word reads as a bug, not a limit. */
function cut(v: string, n: number) { if (v.length <= n) return v; const i = v.lastIndexOf(' ', n); return v.slice(0, i > n * 0.6 ? i : n).replace(/[,;:–—-]$/, '') + '…' }

function parseVerdict(text: string): FocusVerdict | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    return {
      headline: str(j.headline),
      focus: Array.isArray(j.focus) ? j.focus.map((p: any) => ({ id: str(p?.id), reason: str(p?.reason), do: p?.do === 'move' ? 'move' : p?.do === 'cancel' ? 'cancel' : 'add' })) : [],
      review: Array.isArray(j.review) ? j.review.map((r: any) => ({ id: str(r?.id), note: str(r?.note) })) : [],
      parked: str(j.parked),
    }
  } catch { return null }
}

/** The engines' own order, when the model cannot answer — labelled as such, never passed off as a judgement. */
function fallbackVerdict(today: string, market: string, sugs: Suggestion[], waiting: ReviewItem[], groups: DupGroup[], candidates: FocusResult['candidates'], why: string): FocusResult {
  const focus: FocusPick[] = []
  for (const s of sugs.slice(0, 3)) focus.push({ id: s.id, do: 'add', reason: s.why })
  for (const w of waiting.filter(w => w.target?.hasTrade).slice(0, MAX_FOCUS - focus.length)) focus.push({ id: w.taskId, do: 'move', reason: w.recommendation })
  const picked = new Set(focus.map(f => f.id))
  const review = [
    ...sugs.filter(s => !picked.has(s.id)).map(s => ({ id: s.id, note: 'engine-ranked' })),
    ...waiting.filter(w => !picked.has(w.taskId)).map(w => ({ id: w.taskId, note: w.target ? (w.target.hasTrade ? 'free trip' : 'unit empty ' + w.target.date) : 'no window' })),
    ...groups.map(g => ({ id: dupId(g), note: 'done twice' })),
  ]
  return {
    ok: true, today, market,
    verdict: { headline: focus.length ? focus.length + ' worth doing today, by the engines’ own ranking.' : 'Nothing the engines would push today.', focus, review, parked: '' },
    candidates, model: 'engine', at: new Date().toISOString(), cached: false, fallback: why,
  }
}
