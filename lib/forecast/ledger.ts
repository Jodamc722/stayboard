// THE PREDICTION LEDGER — every forecast kept, every forecast graded (audit 2026-09-28).
//
// A forward number is a claim about the future, and a claim nobody checks is a guess wearing a
// suit. So a forecast is written here the day it is made (`recordPredictions`), and once its day
// has passed the grader writes what actually happened beside it (`gradePredictions`). The track
// record (`trackRecord`) is the only honest answer to "can I trust this number?": how far off it
// has been, which way, and at what lead time.
//
// No model lives here — this is the scorer. The forecasts themselves are in the sibling files
// (lib/forecast/staffing.ts), each keeping to rules, ratios and backtests.
//
// MIGRATION-SAFE. The table is migration 133. Until it has run, every call here answers
// `{ ok: false, missing: true }` and nothing throws: the forecasts still show, they just are not
// being kept yet — which is exactly what the caller should say.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { pageRows } from '../db-page'

export type PredictionInput = {
  /** What is predicted: 'cleans', 'people_needed', … */
  kind: string
  /** What it is about: a market ('Miami'), later a unit or a building. */
  subject: string
  /** The ET day the forecast was made, and the day it is about. */
  madeOn: string
  forDate: string
  predicted: number
  /** The range, where there is one. By convention `low` = what is on the books with no pickup. */
  low?: number | null
  high?: number | null
  /** The inputs behind the number, so a grade can say WHY it missed. */
  meta?: Record<string, any>
}
export type PredictionRow = {
  id: number; kind: string; subject: string; made_on: string; for_date: string; lead_days: number
  predicted: number; low: number | null; high: number | null; actual: number | null; error: number | null
  meta: Record<string, any>; graded_at: string | null
}
export type LedgerResult = { ok: boolean; written: number; missing?: boolean; error?: string }

const TABLE = 'predictions'
const MISSING_NOTE = 'predictions table missing — run migration 133'
const round2 = (n: number) => Math.round(n * 100) / 100
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/** A table or column that is not there yet (migration pending) — a normal state, never a 500. */
export function isMissingTable(err: any): boolean {
  const code = String(err?.code || '')
  const msg = String(err?.message || err || '')
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703'
    || /does not exist|could not find the table|schema cache/i.test(msg)
}

async function probe(): Promise<{ ok: boolean; missing?: boolean; error?: string }> {
  const { error } = await supabaseAdmin().from(TABLE).select('id', { count: 'exact', head: true }).limit(1)
  if (!error) return { ok: true }
  return isMissingTable(error) ? { ok: false, missing: true, error: MISSING_NOTE } : { ok: false, error: error.message }
}

/**
 * Keep forecasts. One row per (kind, subject, made_on, for_date) — recording the same forecast
 * again the same day replaces it (and clears any grade, since it is a new forecast).
 */
export async function recordPredictions(rows: PredictionInput[]): Promise<LedgerResult> {
  const clean = rows.filter(r => r && r.kind && r.subject && /^\d{4}-\d{2}-\d{2}$/.test(r.madeOn) && /^\d{4}-\d{2}-\d{2}$/.test(r.forDate) && Number.isFinite(Number(r.predicted)))
  if (!clean.length) return { ok: true, written: 0 }
  const payload = clean.map(r => ({
    kind: r.kind, subject: r.subject, made_on: r.madeOn, for_date: r.forDate,
    lead_days: daysBetween(r.madeOn, r.forDate),
    predicted: round2(Number(r.predicted)),
    low: r.low == null || !Number.isFinite(Number(r.low)) ? null : round2(Number(r.low)),
    high: r.high == null || !Number.isFinite(Number(r.high)) ? null : round2(Number(r.high)),
    meta: r.meta || {},
    actual: null, error: null, graded_at: null,
  }))
  const db = supabaseAdmin()
  let written = 0
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200)
    const { error } = await db.from(TABLE).upsert(chunk, { onConflict: 'kind,subject,made_on,for_date' })
    if (error) return isMissingTable(error) ? { ok: false, written, missing: true, error: MISSING_NOTE } : { ok: false, written, error: error.message }
    written += chunk.length
  }
  return { ok: true, written }
}

/** Forecasts whose day has passed (for_date before `today`) and that nobody has graded yet. */
export async function ungradedBefore(today: string, kinds: string[], opts: { sinceDays?: number } = {}): Promise<{ ok: boolean; rows: PredictionRow[]; missing?: boolean; error?: string; truncated?: boolean }> {
  const p = await probe()
  if (!p.ok) return { ok: false, rows: [], missing: p.missing, error: p.error }
  const since = shift(today, -(opts.sinceDays ?? 30))
  const db = supabaseAdmin()
  const got = await pageRows<PredictionRow>((a, b) => db.from(TABLE)
    .select('id,kind,subject,made_on,for_date,lead_days,predicted,low,high,actual,error,meta,graded_at')
    .in('kind', kinds).is('graded_at', null).lt('for_date', today).gte('for_date', since)
    .order('for_date').order('id').range(a, b), 10)
  return { ok: true, rows: got.rows, truncated: got.truncated }
}

/** Write what happened. `error` = actual − predicted (positive = the forecast was low). */
export async function gradePredictions(grades: { id: number; predicted: number; actual: number; meta?: Record<string, any> }[]): Promise<LedgerResult> {
  if (!grades.length) return { ok: true, written: 0 }
  const db = supabaseAdmin()
  const at = new Date().toISOString()
  let written = 0
  let firstError: string | undefined
  // Five at a time: a night's grading is a few dozen small updates, not worth a stored procedure.
  for (let i = 0; i < grades.length; i += 5) {
    const res = await Promise.all(grades.slice(i, i + 5).map(g => {
      const patch: Record<string, any> = { actual: round2(g.actual), error: round2(g.actual - g.predicted), graded_at: at }
      if (g.meta) patch.meta = g.meta
      return db.from(TABLE).update(patch).eq('id', g.id)
    }))
    for (const r of res) {
      if (r.error) { if (isMissingTable(r.error)) return { ok: false, written, missing: true, error: MISSING_NOTE }; firstError = firstError || r.error.message }
      else written++
    }
  }
  return { ok: !firstError, written, error: firstError }
}

export type TrackRecord = {
  kind: string
  subject: string
  since: string
  /** Graded forecasts in the window. */
  n: number
  /** Mean absolute error, in the kind's own unit (cleans, people). */
  mae: number | null
  /** Mean signed error: positive = forecasts ran low. */
  bias: number | null
  /** How close counts as right, in the kind's own unit. */
  tolerance: number
  /** Share of forecasts within the tolerance — null under five graded (too few to call). */
  withinPct: number | null
  byLead: { lead: string; n: number; mae: number | null; withinPct: number | null }[]
}

const LEADS: { label: string; lo: number; hi: number }[] = [
  { label: '1 day', lo: 0, hi: 1 }, { label: '2–3 days', lo: 2, hi: 3 },
  { label: '4–7 days', lo: 4, hi: 7 }, { label: '8–14 days', lo: 8, hi: 14 },
]

/**
 * How a kind of forecast has actually done. Percentages need a sample: under five graded forecasts
 * the share is null, and the caller says "too few to call" rather than printing 100%.
 */
export async function trackRecord(kind: string, opts: { days?: number; subject?: string; tolerance?: number } = {}): Promise<TrackRecord | null> {
  const p = await probe()
  if (!p.ok) return null
  const since = shift(ymdET(), -(opts.days ?? 30))
  const tol = opts.tolerance ?? 1
  const db = supabaseAdmin()
  const got = await pageRows<PredictionRow>((a, b) => {
    let q = db.from(TABLE).select('id,kind,subject,lead_days,predicted,actual,error,for_date,made_on,low,high,meta,graded_at')
      .eq('kind', kind).not('graded_at', 'is', null).gte('for_date', since)
    if (opts.subject) q = q.eq('subject', opts.subject)
    return q.order('for_date').order('id').range(a, b)
  }, 6)
  const rows = got.rows.filter(r => r.error != null && Number.isFinite(Number(r.error)))
  const stat = (rs: PredictionRow[]) => {
    const n = rs.length
    if (!n) return { n, mae: null as number | null, bias: null as number | null, withinPct: null as number | null }
    const errs = rs.map(r => Number(r.error))
    const mae = round2(errs.reduce((a, e) => a + Math.abs(e), 0) / n)
    const bias = round2(errs.reduce((a, e) => a + e, 0) / n)
    const within = errs.filter(e => Math.abs(e) <= tol).length
    return { n, mae, bias, withinPct: n >= 5 ? Math.round((within / n) * 100) : null }
  }
  const all = stat(rows)
  return {
    kind, subject: opts.subject || 'all', since, n: all.n, mae: all.mae, bias: all.bias, tolerance: tol, withinPct: all.withinPct,
    byLead: LEADS.map(L => {
      const s = stat(rows.filter(r => Number(r.lead_days) >= L.lo && Number(r.lead_days) <= L.hi))
      return { lead: L.label, n: s.n, mae: s.mae, withinPct: s.withinPct }
    }),
  }
}
