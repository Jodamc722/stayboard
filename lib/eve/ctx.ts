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
/** Ratings arrive on MIXED scales (Airbnb /5, Booking & Vrbo /10). Everything normalizes to /5. */
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

/**
 * READ A WHOLE RANGE, NOT THE FIRST PAGE OF IT.
 *
 * `.limit(4000)` does NOT get you 4000 rows. PostgREST caps every response at the project's
 * max-rows setting (1000 here), so a `.limit()` above that is a number nobody enforces: you are
 * handed the first 1000 rows of your ordering and no error, no flag, nothing that distinguishes
 * "that was all of them" from "that was where I stopped".
 *
 * Found the hard way on 2026-08-26. `moved_cleans` asked for a padded 38-day window of housekeeping
 * tasks ordered by scheduled_date — 1,451 rows. It got the first 1,000, which ran out partway
 * through the 22nd, and reported ZERO cleans for the 23rd through the 26th. Not an error, not a
 * gap: four confident zeroes on days that had 27, 38, 27 and 29 cleans on them. The labor engine
 * had paged this same table since the beginning (lib/labor-econ.ts), which is the only reason its
 * numbers were right while Eve's were wrong about the same days.
 *
 * So: any query over a range that can plausibly exceed 1,000 rows goes through here. `truncated`
 * is only true when we hit the page ceiling — a real limit, honestly reported, which is what
 * Rule 3 asked for in the first place.
 */
export async function pageRows(
  q: (from: number, to: number) => PromiseLike<any>,
  maxPages = 12,
): Promise<{ rows: any[]; truncated: boolean }> {
  const out: any[] = []
  const seen: Record<string, boolean> = {}
  for (let p = 0; p < maxPages; p++) {
    const res: any = await safe(q(p * 1000, p * 1000 + 999), { data: [] } as any)
    const data: any[] = res?.data || []
    if (!data.length) return { rows: out, truncated: false }
    // Even with a stable order, never let the same row land twice.
    for (const row of data) {
      const k = row && row.id != null ? String(row.id) : null
      if (k) { if (seen[k]) continue; seen[k] = true }
      out.push(row)
    }
    if (data.length < 1000) return { rows: out, truncated: false }
  }
  return { rows: out, truncated: true }
}

export async function buildCtx(access: Access, canMoney: boolean): Promise<EveCtx> {
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
  }
}

/** Resolve a unit from a name or id to exactly one listing, the way unit_status does. */
export function resolveListing(ctx: EveCtx, input: any): { id: string; meta: ListingMeta } | null {
  const id = String(input?.id || '').trim()
  if (id && ctx.listingMeta[id]) return { id, meta: ctx.listingMeta[id] }
  const ids = ctx.idsForName(String(input?.name || ''))
  if (!ids.length) return null
  const live = ids.filter(x => !DEAD_LISTING.test(ctx.listingMeta[x].status))
  const pick = live[0] || ids[0]
  return { id: pick, meta: ctx.listingMeta[pick] }
}

/** Chunked .in() — PostgREST chokes on very long id lists, and 232 listings is already long. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
