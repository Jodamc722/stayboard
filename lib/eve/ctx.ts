// Eve's shared tool context. Every tool in lib/eve/* receives one of these instead of closing over
// route-local variables — that is what makes 40+ tools splittable across files at all.
//
// THE FOUR HARD RULES every tool in this folder inherits (learned the expensive way, see the
// full audit + the labor-econ header):
//   1. NEVER select `raw` or `raw->money` over thousands of rows. Use the JSON-path scalars.
//      Pulling whole raw JSONB is what hit the Postgres statement timeout on /marketing.
//   2. ALWAYS .order() before .limit(). Unordered LIMIT/OFFSET on PostgREST silently duplicates
//      and skips rows — it produced 491 -> 473 -> 459 departure cleans for one identical window
//      inside an hour, and it dropped whole buildings from the day sheet.
//   3. When a query comes back AT its row cap, SAY SO. A silently short list reads as "we're fine".
//      Every tool returns `truncated: true` in that case and Eve is told to surface it.
//   4. Money is redacted BEFORE it reaches the model, not after. A tool marked `money: true` runs
//      its output through redactMoney() when the asking user lacks the `money` permission.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'
import { buildingOf as canonicalBuilding } from '@/lib/segments'
import { pageRows } from '@/lib/db-page'
import type { Access } from '@/lib/access'

export type EveCtx = {
  db: ReturnType<typeof supabaseAdmin>
  access: Access
  email: string
  canMoney: boolean
  today: string
  /** listing id -> friendly name / status / rolled-up building. Loaded once per request. */
  listingMeta: Record<string, ListingMeta>
  nameOf: (listingId: any) => string
  buildingOf: (listingId: any) => string
  /** live, non-Waves, non-dead — the canonical "does this unit count" test for review scoping. */
  reviewable: (listingId: any) => boolean
  idsForBuilding: (building: string) => string[]
  idsForName: (name: string) => string[]
  /** The last user message, when the tool runs inside a chat turn — the conversation snippet on a thought. */
  question?: string
  /** A room other people read (Slack, a Telegram group): people's files stay out (lib/eve/brain.ts). */
  sharedRoom?: boolean
  /** The Slack tier asking (lib/eve/slack-tier.ts). 'vendor' strips guest details from every tool result. */
  tier?: 'admin' | 'staff' | 'vendor'
  /** An outside company can read this room (the vendor tier, or ANY asker in a vendor room): every tool
   *  result loses guest details in registry.runTool (2026-09-29 review, N3/N4). */
  guestSafe?: boolean
  /** Set when listingMeta was narrowed to a vendor's own buildings (buildCtx onlyBuildings). */
  scopedBuildings?: string[]
  /**
   * Set when the question came from Slack: the conversation it was asked in and who asked (their Slack
   * user id, verified by Slack's signature, and their name from the workspace directory). The door-code
   * tool uses it to decide by ROOM and to deliver a code to the asker by DM, never into the room
   * (lib/eve/door-code-rooms.ts, Jon 2026-09-29).
   */
  slack?: { channel: string; user: string; name?: string | null; how?: string | null; /** the thread the ask lives in, so a reminder lands back where it was asked */ thread?: string | null }
}

export type ListingMeta = { name: string; status: string; building: string; rollup: string }

export const DEAD_LISTING = /inactive|disabled|archived|deleted/i

export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
export function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}
export function shiftDay(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function clampLimit(n: any, def = 25, max = 100): number {
  const x = Number(n)
  return Math.min(Math.max(Number.isFinite(x) ? x : def, 1), max)
}
export function clampDays(n: any, def = 30, max = 400): number {
  const x = Number(n)
  return Math.min(Math.max(Number.isFinite(x) ? x : def, 1), max)
}
/** Ratings arrive on MIXED scales (Airbnb and Vrbo /5, Booking /10). Everything normalizes to /5. */
export function normStar(n: any): number | null {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.round((v <= 5 ? v : v / 2) * 100) / 100
}
export function round2(n: any): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}
export function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export function lc(v: any): string { return String(v || '').toLowerCase() }
export function has(hay: any, needle: any): boolean {
  const n = lc(needle).trim()
  return !!n && lc(hay).includes(n)
}

/** Wrap a query so a missing table / transient error degrades to a value instead of killing a turn. */
export async function safe<T>(p: PromiseLike<T>, fb: T): Promise<T> {
  try { return await p } catch { return fb }
}
export async function count(q: any): Promise<number> {
  const r: any = await safe(q, { count: 0 } as any)
  return r?.count || 0
}
/** Rule 3: report truncation rather than pretending a capped list is the whole list. */
export function cap<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return { rows, truncated: rows.length >= limit }
}

// One definition of paging for the whole app — see lib/db-page.ts for what it is undoing.
export { pageRows } from '@/lib/db-page'

/**
 * EVERY ROW, OR THE STEP FAILS (2026-09-29). For jobs whose runner records a failed step — the
 * standing audit (audit.ts) and the nightly sweep (sweep.ts): a paged read that stops short throws,
 * so that step fails out loud instead of scoring part of a window as the whole of it. `q` is the
 * (from, to) callback pageRows takes: an ordered query ending in .range(from, to).
 */
export async function allRowsOrThrow<T = any>(what: string, q: (from: number, to: number) => PromiseLike<any>, maxPages?: number): Promise<T[]> {
  const { rows, truncated } = await pageRows<T>(q, maxPages)
  if (truncated) {
    const msg = `${what}: read stopped after ${rows.length} rows`
    console.error('[eve] ' + msg)
    throw new Error(msg)
  }
  return rows
}

export async function buildCtx(access: Access, canMoney: boolean, opts: { onlyBuildings?: string[] } = {}): Promise<EveCtx> {
  const db = supabaseAdmin()
  const listingMeta: Record<string, ListingMeta> = {}
  try {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building').order('id')
    for (const l of (data || [])) {
      const row: any = l
      const building = String(row.building || '')
      const name = row.nickname || row.title || ''
      listingMeta[String(row.id)] = {
        name,
        status: lc(row.status),
        building,
        rollup: rollupBuilding(building, name),
      }
    }
  } catch { /* empty portfolio is survivable */ }
  // A VENDOR ROOM SEES ITS OWN BUILDINGS (2026-09-28 audit, F2). "Their own buildings" was a line in
  // the prompt; now the registry itself is narrowed, so unit lookups, portfolio counts and review
  // scoping only know the routing group's buildings (canonical labels from lib/segments, the same
  // ones the group lists).
  //
  // FAIL CLOSED (2026-09-29 review, N14). A scope that matches nothing — a group whose labels drifted,
  // or a vendor room with no buildings set — used to narrow nothing, which handed that room the whole
  // portfolio. Asking for a scope (onlyBuildings given, even empty) now always narrows: no match, no
  // units. run.ts tells her so, and the room is told an admin must fix the group's buildings.
  let scopedBuildings: string[] | undefined
  if (opts.onlyBuildings) {
    const only = opts.onlyBuildings.map(b => lc(b).trim()).filter(Boolean)
    const kept: Record<string, true> = {}
    for (const id of Object.keys(listingMeta)) {
      const m = listingMeta[id]
      if (only.indexOf(lc(canonicalBuilding(m.building, m.name) || '')) >= 0 || only.indexOf(lc(m.rollup)) >= 0) kept[id] = true
    }
    for (const id of Object.keys(listingMeta)) if (!kept[id]) delete listingMeta[id]
    scopedBuildings = opts.onlyBuildings.slice()
  }

  const nameOf = (lid: any) => listingMeta[String(lid)]?.name || 'Unknown'
  const buildingOf = (lid: any) => listingMeta[String(lid)]?.rollup || 'Unassigned'
  const reviewable = (lid: any) => {
    const m = listingMeta[String(lid)]
    return !!m && !DEAD_LISTING.test(m.status) && lc(m.building) !== 'waves'
  }
  const idsForBuilding = (building: string) => {
    const b = lc(building).trim()
    if (!b) return []
    return Object.keys(listingMeta).filter(id => lc(listingMeta[id].rollup).includes(b) || lc(listingMeta[id].building).includes(b))
  }
  const idsForName = (name: string) => {
    const n = lc(name).trim()
    if (!n) return []
    return Object.keys(listingMeta).filter(id => lc(listingMeta[id].name).includes(n))
  }

  return {
    db, access, email: lc(access.email), canMoney,
    today: todayET(), listingMeta, nameOf, buildingOf, reviewable, idsForBuilding, idsForName,
    scopedBuildings,
  }
}

/**
 * The listing ids a scoped room may see (buildCtx onlyBuildings — a vendor room), or null when the
 * registry was not narrowed. An EMPTY list means the scope matched nothing: show nothing (N14).
 */
export function scopeIds(ctx: EveCtx): string[] | null {
  return ctx.scopedBuildings ? Object.keys(ctx.listingMeta) : null
}

// ONE UNIT, OR A QUESTION — NEVER THE FIRST SUBSTRING HIT (Eve reorganisation, 2026-11-10).
//
// resolveListing used to take the first listing whose name CONTAINED the text. "1205" exists in more
// than one building (lib/eve/investigate.ts records the day that sent a report to the wrong unit), so
// a tool could answer, confidently, about a different unit from the one asked about. Now every match
// is scored — exact name, then whole-word match, then substring — and the best LIVE match wins only
// when it is alone at the top. A tie throws AmbiguousUnit, which registry.runTool turns into
// { ambiguous: true, candidates, question: "Which one?" } for whichever tool was running.
export type ListingCandidate = { id: string; name: string; building: string; status: string; live: boolean; score: number }

export class AmbiguousUnit extends Error {
  query: string
  candidates: ListingCandidate[]
  constructor(query: string, candidates: ListingCandidate[]) {
    super(`"${query}" matches ${candidates.length} units`)
    this.name = 'AmbiguousUnit'
    this.query = query
    this.candidates = candidates
  }
}

const unitTokens = (s: string): string[] => lc(s).split(/[^a-z0-9]+/).filter(Boolean)
const unitSquash = (s: string): string => lc(s).replace(/[^a-z0-9]+/g, '')

/** Every listing a piece of text could mean, best first. 100 exact · 95 same letters and digits · 80 every word present · 60 substring · 40 every word as a fragment. */
export function listingCandidates(ctx: EveCtx, text: any, building?: any): ListingCandidate[] {
  const q = lc(text).trim()
  if (!q) return []
  const qTok = unitTokens(q)
  const qSq = unitSquash(q)
  const b = lc(building).trim()
  const out: ListingCandidate[] = []
  for (const id of Object.keys(ctx.listingMeta)) {
    const m = ctx.listingMeta[id]
    const n = lc(m.name).trim()
    if (!n) continue
    if (b && !lc(m.rollup).includes(b) && !lc(m.building).includes(b) && !n.includes(b)) continue
    const nTok = unitTokens(n)
    let score = 0
    if (n === q) score = 100
    else if (qSq && unitSquash(n) === qSq) score = 95
    else if (qTok.length && qTok.every(t => nTok.indexOf(t) >= 0)) score = 80
    else if (n.includes(q)) score = 60
    else if (qTok.length && qTok.every(t => n.includes(t))) score = 40
    if (!score) continue
    out.push({ id, name: m.name, building: m.rollup, status: m.status, live: !DEAD_LISTING.test(m.status), score })
  }
  return out.sort((x, y) => (y.score - x.score) || (Number(y.live) - Number(x.live)) || x.name.localeCompare(y.name))
}

/**
 * Resolve a unit from a name or id to exactly one listing. Returns null when nothing matches (or no
 * unit was asked for) and THROWS AmbiguousUnit when more than one live unit matches equally well.
 * An optional `building` in the input narrows the candidates when it leaves any.
 */
export function resolveListing(ctx: EveCtx, input: any): { id: string; meta: ListingMeta } | null {
  const id = String(input?.id || '').trim()
  if (id && ctx.listingMeta[id]) return { id, meta: ctx.listingMeta[id] }
  const name = String(input?.name || '').trim()
  if (!name) return null
  let cands = listingCandidates(ctx, name, input?.building)
  if (!cands.length && input?.building) cands = listingCandidates(ctx, name)
  if (!cands.length) return null
  const live = cands.filter(c => c.live)
  const pool = live.length ? live : cands
  const top = pool[0].score
  const best = pool.filter(c => c.score === top)
  if (best.length > 1) throw new AmbiguousUnit(name, best.slice(0, 12))
  return { id: best[0].id, meta: ctx.listingMeta[best[0].id] }
}

/** What a tool returns when a unit name fits more than one unit: the candidates, and the question. */
export function ambiguousUnitResult(e: AmbiguousUnit): any {
  const blds = Array.from(new Set(e.candidates.map(c => c.building)))
  const wholeBuilding = blds.length === 1 && lc(blds[0]).includes(lc(e.query).trim())
    ? ` "${e.query}" also names the building ${blds[0]} — if the whole building was meant, pass it as building (or use building_360), not as a unit.`
    : ''
  return {
    ambiguous: true,
    question: `Which one? "${e.query}" fits ${e.candidates.length} units.`,
    candidates: e.candidates.map(c => ({ id: c.id, unit: c.name, building: c.building, status: c.status })),
    note: 'Do NOT pick one yourself. If the conversation or the channel already says which building, call again with the full unit name (building AND number) or the id; otherwise ask the person which one they mean, listing these.' + wholeBuilding,
  }
}

/**
 * The standard evidence block every newer tool returns as `_meta`, so an answer can say where a number
 * came from, over what window, and as of when (lib/eve/evidence.ts collects them for the chat).
 */
export function toolMeta(m: { source: string; window?: string | null; n?: number | null; truncated?: boolean; basis?: string | null; note?: string | null; /** when the data was BUILT (a nightly table), not when it was read; defaults to now */ as_of?: string | null }): any {
  const as_of = m.as_of || (new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET')
  const out: any = { source: m.source, window: m.window || null, as_of, n: m.n == null ? null : m.n, truncated: !!m.truncated }
  if (m.basis) out.basis = m.basis
  if (m.note) out.note = m.note
  return out
}

/** Chunked .in() — PostgREST chokes on very long id lists, and 232 listings is already long. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
