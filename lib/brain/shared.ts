// THE BUSINESS BRAIN — shared plumbing for the builders in this folder (migration 178).
//
// Three rules every builder here keeps, because each one is a mistake this app has already made:
//   1. READS ARE PAGED AND ORDERED (lib/db-page). A read that came back short is reported as
//      `partial`, written onto the rows it fed, and never printed as a whole number.
//   2. WRITES ARE UPSERTS IN BATCHES. A re-run rewrites the same keys. The one delete: a
//      fact_unit_day row the builder would no longer write (a stay cancelled on a day the listing
//      was not active) is removed, so a cancelled booking cannot linger as revenue.
//   3. EVERYTHING FAILS OPEN. Until migration 178 has run, `brainTables()` says which tables are
//      missing and the cron answers "skipped" — nothing else in the app reads these tables.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const BRAIN_MIGRATION = '178_business_brain.sql'
export const BRAIN_TABLES = [
  'dim_building', 'dim_unit', 'person_xref', 'vendor_xref', 'entity_alias',
  'fact_unit_day', 'fact_maintenance_event', 'unit_health_daily', 'owner_month', 'vendor_month',
] as const
export type BrainTable = typeof BRAIN_TABLES[number]

/** app_settings key holding the backfill cursor and the last run's summary. */
export const BRAIN_STATE_KEY = 'business_brain_state'
export type BrainState = {
  /** fact_unit_day is built back to this day (inclusive). null = backfill not started. */
  backfilledTo: string | null
  /** true once the backfill has reached BACKFILL_DAYS ago. */
  backfillDone: boolean
  /** true once owner_month / vendor_month have been rebuilt over the whole backfilled range. */
  rollupsBackfilled?: boolean
  /** The DEFS_VERSION the history was built under. A different one re-runs the backfill once. */
  defsVersion?: number
  lastRunAt: string | null
  lastOk: boolean | null
  tables: Record<string, { rows: number; partial: boolean; error?: string; note?: string }>
}
export const EMPTY_STATE: BrainState = { backfilledTo: null, backfillDone: false, lastRunAt: null, lastOk: null, tables: {} }

/** `incomplete` = the write stopped before every row was sent (time limit or an upsert error). */
export type BuildResult = { rows: number; partial: boolean; error?: string; note?: string; incomplete?: boolean }

/**
 * Bumped whenever a DEFINITION changes (what a night is worth, which events repeat), so history
 * built under the old rule is rebuilt once instead of sitting beside new rows that disagree with it.
 *   2 — 2026-11-10: month-aligned chunks + Revenue Center's Expedia cleaning split and
 *       fareAccommodation fallback; double-booked nights keep both stays' money; tighter repeats.
 */
export const DEFS_VERSION = 2

export const TZ = 'America/New_York'
export const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const num = (v: any): number => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
export const numOrNull = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
export const round2 = (n: number): number => Math.round(n * 100) / 100
/** Per-night money is kept to 4 places so a month of nights adds back to the stay to the cent. */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000
export const dOf = (v: any): string => str(v).slice(0, 10)
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' })
export function todayET(): string { return ET_DAY.format(new Date()) }
/** The Eastern calendar day of a timestamp. A bare date passes through unchanged. */
export function etDay(ts: any): string {
  const s = str(ts)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? s.slice(0, 10) : ET_DAY.format(d)
}
/** The Eastern hour (0–23) of a timestamp, or null. */
export function etHour(ts: any): number | null {
  const d = new Date(str(ts))
  if (!str(ts) || isNaN(d.getTime())) return null
  const h = parseInt(ET_HOUR.format(d), 10)
  return Number.isFinite(h) ? h % 24 : null
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
}
/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(a + 'T12:00:00Z'), y = Date.parse(b + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400_000) : 0
}
/** The first day of the month `iso` falls in. */
export function monthStartOf(iso: string): string { return iso.slice(0, 8) + '01' }
/** The last day of the month `iso` falls in. */
export function monthEndOf(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return addDays(ny + '-' + (nm < 10 ? '0' + nm : String(nm)) + '-01', -1)
}

export function slug(v: any): string {
  return str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
export function aliasKey(v: any): string {
  return str(v).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** A table (or a column) this database does not have yet — the migration has not run. */
export function isMissing(err: any): boolean {
  const code = str(err?.code)
  return code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204'
    || /does not exist|could not find the (table|column)|schema cache/i.test(str(err?.message))
}

/**
 * Which brain tables exist. One tiny read each; any error that is not "missing" is reported as
 * present-but-erroring so a permissions problem is not mistaken for an unrun migration.
 */
export async function brainTables(): Promise<{ present: BrainTable[]; missing: BrainTable[]; errors: Record<string, string> }> {
  const db = supabaseAdmin()
  const present: BrainTable[] = [], missing: BrainTable[] = []
  const errors: Record<string, string> = {}
  await Promise.all(BRAIN_TABLES.map(async (t) => {
    try {
      const { error } = await db.from(t).select('built_at').limit(1)
      if (!error) present.push(t)
      else if (isMissing(error)) missing.push(t)
      else { present.push(t); errors[t] = str(error.message).slice(0, 160) }
    } catch (e: any) {
      present.push(t); errors[t] = str(e?.message || e).slice(0, 160)
    }
  }))
  const order = (a: BrainTable, b: BrainTable) => BRAIN_TABLES.indexOf(a) - BRAIN_TABLES.indexOf(b)
  return { present: present.sort(order), missing: missing.sort(order), errors }
}

/**
 * Upsert rows in batches. Returns how many were written and the first error, never throws.
 * Rows that share a key inside one batch are collapsed (last wins) — Postgres refuses an upsert
 * that touches the same row twice in one statement.
 */
export async function upsertBatches(
  table: string, rows: Record<string, any>[], onConflict: string,
  opts: { batch?: number; deadline?: number } = {},
): Promise<{ written: number; error?: string; stoppedEarly: boolean }> {
  const db = supabaseAdmin()
  const keys = onConflict.split(',').map(k => k.trim()).filter(Boolean)
  const byKey = new Map<string, Record<string, any>>()
  for (const r of rows) byKey.set(keys.map(k => str(r[k])).join('\u0001'), r)
  const uniq = Array.from(byKey.values())
  const size = Math.max(50, Math.min(1000, opts.batch || 500))
  let written = 0
  for (let i = 0; i < uniq.length; i += size) {
    if (opts.deadline && Date.now() > opts.deadline) return { written, stoppedEarly: true }
    const chunk = uniq.slice(i, i + size)
    try {
      const { error } = await db.from(table).upsert(chunk, { onConflict })
      if (error) return { written, error: str(error.message).slice(0, 200), stoppedEarly: true }
      written += chunk.length
    } catch (e: any) {
      return { written, error: str(e?.message || e).slice(0, 200), stoppedEarly: true }
    }
  }
  return { written, stoppedEarly: false }
}

/** `.in()` reads in chunks, so a long id list never becomes a URL PostgREST refuses. */
export async function readIn<T = any>(
  table: string, cols: string, col: string, ids: string[], chunk = 150,
): Promise<{ rows: T[]; truncated: boolean }> {
  const db = supabaseAdmin()
  const out: T[] = []
  let truncated = false
  const uniq = Array.from(new Set(ids.map(str).filter(Boolean)))
  for (let i = 0; i < uniq.length; i += chunk) {
    try {
      const { data, error } = await db.from(table).select(cols).in(col, uniq.slice(i, i + chunk))
      if (error) { truncated = true; continue }
      for (const r of ((data || []) as any[])) out.push(r as T)
    } catch { truncated = true }
  }
  return { rows: out, truncated }
}

/**
 * lib/db-page pageRows, but it also says WHY a read stopped. `missing` = the table or a column is
 * not there (an input that does not exist yet — not a short read); `truncated` = a page errored or
 * the page ceiling was hit (the read really is incomplete). Builders set `partial` only on the second.
 */
export async function pageRead<T = any>(
  q: (from: number, to: number) => PromiseLike<any>, maxPages = 12,
): Promise<{ rows: T[]; truncated: boolean; missing: boolean; error?: string }> {
  const out: T[] = []
  for (let p = 0; p < maxPages; p++) {
    let data: any[] = []
    try {
      const res: any = await q(p * 1000, p * 1000 + 999)
      if (res && res.error) {
        if (isMissing(res.error)) return { rows: out, truncated: false, missing: true, error: str(res.error.message).slice(0, 160) }
        return { rows: out, truncated: true, missing: false, error: str(res.error.message).slice(0, 160) }
      }
      data = res?.data || []
    } catch (e: any) {
      return { rows: out, truncated: true, missing: false, error: str(e?.message || e).slice(0, 160) }
    }
    for (const row of data) out.push(row as T)
    if (data.length < 1000) return { rows: out, truncated: false, missing: false }
  }
  return { rows: out, truncated: true, missing: false, error: 'page ceiling reached' }
}

export function median(xs: number[]): number | null {
  const a = xs.filter(x => Number.isFinite(x)).slice().sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
