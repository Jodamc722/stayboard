// Turning stored numbers into a judgement.
//
// THE POINT. "Botanica's cleaning margin looks lower" is not information. "Botanica's cost per clean
// is 2.1 sigma above its own 90-day norm, and it started on the 4th" is. The difference is a
// baseline and some honest arithmetic, which is all this file is.
//
// WHY z-SCORES AGAINST THE SCOPE'S OWN HISTORY, not against other buildings: a 4BR house in South
// of Fifth and a studio on Collins are not comparable to each other on any metric, but each is
// comparable to ITSELF last month. Self-comparison is the only fair test across a mixed portfolio.
//
// GUARDRAILS, because a confident wrong number is worse than no number:
//   - Fewer than MIN_BASELINE points -> no z-score at all. Returns null and says why.
//   - Zero variance (a metric that has been flat) -> no z-score. Otherwise every tiny move is
//     infinite sigma, which is how you end up paging someone at 3am because a count went 0 -> 1.
//   - Forward-only metrics carry a warning until they have enough history to mean anything.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { METRIC_BY_KEY, type MetricDef } from './metrics'
import { todayET, shiftDay, round2 } from './ctx'

/** Below this many baseline days we refuse to compute a z-score rather than guess. */
export const MIN_BASELINE = 14
export const ANOMALY_SIGMA = 2

export type TrendPoint = { day: string; value: number; n: number }
export type Trend = {
  metric: string; label: string; unit: string; scope: string
  current: number | null; currentDays: number
  prior: number | null; priorDays: number
  changePct: number | null; changeAbs: number | null
  baselineMean: number | null; baselineSd: number | null; baselineDays: number
  z: number | null
  direction: 'up' | 'down' | 'flat' | null
  verdict: string
  higherIsBetter: boolean | null
  series: TrendPoint[]
  caveat?: string
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
function sd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1))
}

/**
 * Some metrics are RATES (occupancy, ADR, review average) and must be averaged across days.
 * Others are COUNTS (revenue, bookings, cleans) and must be summed. Averaging revenue across a
 * window and calling it "revenue" would be flatly wrong, so the catalogue decides.
 */
function isRate(def: MetricDef | undefined): boolean {
  return !!def && (def.unit === 'pct' || def.unit === 'rating' || def.key === 'adr' || def.key === 'revpar' || def.key === 'clean_minutes' || def.unit === 'minutes')
}
function aggregate(def: MetricDef | undefined, points: TrendPoint[]): number | null {
  if (!points.length) return null
  if (isRate(def)) {
    // Weight by sample size so a day with 2 reviews does not count as much as a day with 40.
    const wsum = points.reduce((a, p) => a + Math.max(1, p.n), 0)
    const acc = points.reduce((a, p) => a + p.value * Math.max(1, p.n), 0)
    return wsum > 0 ? acc / wsum : null
  }
  return points.reduce((a, p) => a + p.value, 0)
}

export async function loadSeries(metric: string, scope: string, from: string, to: string): Promise<TrendPoint[]> {
  const db = supabaseAdmin()
  const { data, error } = await db.from('eve_metrics').select('day,value,n')
    .eq('metric', metric).eq('scope', scope).gte('day', from).lte('day', to)
    .order('day')
  if (error) return []
  return (data || []).filter((r: any) => r.value != null).map((r: any) => ({ day: String(r.day).slice(0, 10), value: Number(r.value), n: Number(r.n) || 0 }))
}

export async function computeTrend(opts: { metric: string; scope?: string; days?: number; baselineDays?: number }): Promise<Trend | { error: string }> {
  const def = METRIC_BY_KEY[opts.metric]
  if (!def) return { error: `Unknown metric "${opts.metric}".` }
  const scope = opts.scope || 'portfolio'
  const win = Math.min(Math.max(Number(opts.days) || 7, 1), 90)
  const baseDays = Math.min(Math.max(Number(opts.baselineDays) || 90, 21), 365)
  const today = todayET()
  // Yesterday is the last COMPLETE day. Including a partial today makes every metric look like it
  // fell off a cliff at 9am, which is the fastest way to lose trust in a trend engine.
  const end = shiftDay(today, -1)
  const curFrom = shiftDay(end, -(win - 1))
  const priorEnd = shiftDay(curFrom, -1)
  const priorFrom = shiftDay(priorEnd, -(win - 1))
  const baseFrom = shiftDay(end, -(baseDays - 1))

  const all = await loadSeries(opts.metric, scope, baseFrom, end)
  if (!all.length) {
    return {
      metric: def.key, label: def.label, unit: def.unit, scope,
      current: null, currentDays: 0, prior: null, priorDays: 0,
      changePct: null, changeAbs: null, baselineMean: null, baselineSd: null, baselineDays: 0,
      z: null, direction: null, higherIsBetter: def.higherIsBetter, series: [],
      verdict: 'NO DATA — nothing has been snapshotted for this metric and scope yet.',
      caveat: def.backfillable ? 'This metric can be backfilled — run the metrics job with ?backfill=90.' : 'This metric is point-in-time only and starts accumulating from the day the nightly job first ran.',
    }
  }
  const inRange = (p: TrendPoint, a: string, b: string) => p.day >= a && p.day <= b
  const cur = all.filter(p => inRange(p, curFrom, end))
  const prior = all.filter(p => inRange(p, priorFrom, priorEnd))
  const current = aggregate(def, cur)
  const priorVal = aggregate(def, prior)

  // The baseline is per-day values across the window, EXCLUDING the current window so a sustained
  // shift does not quietly move the yardstick it is being measured against.
  const basePts = all.filter(p => p.day < curFrom)
  const baseVals = basePts.map(p => p.value)
  const bMean = baseVals.length ? mean(baseVals) : null
  const bSd = baseVals.length >= 2 ? sd(baseVals) : null

  let z: number | null = null
  let caveat: string | undefined
  if (baseVals.length < MIN_BASELINE) {
    caveat = `Only ${baseVals.length} baseline day(s) — need ${MIN_BASELINE} before a z-score means anything. Treat the change figure as directional only.`
  } else if (!bSd || bSd < 1e-9) {
    caveat = 'This metric has been perfectly flat, so there is no variance to score against. The change is real but "sigma" would be meaningless.'
  } else if (current != null && bMean != null) {
    // Score the current window's PER-DAY level against the per-day baseline.
    const perDay = isRate(def) ? current : (cur.length ? current / cur.length : 0)
    z = round2((perDay - bMean) / bSd)
  }

  const changeAbs = current != null && priorVal != null ? round2(current - priorVal) : null
  const changePct = current != null && priorVal != null && priorVal !== 0 ? round2(((current - priorVal) / Math.abs(priorVal)) * 100) : null
  const direction: 'up' | 'down' | 'flat' | null = changeAbs == null ? null : changeAbs > 0 ? 'up' : changeAbs < 0 ? 'down' : 'flat'

  let verdict = 'Normal.'
  if (z != null && Math.abs(z) >= 3) verdict = `EXTREME — ${Math.abs(z)} sigma ${z > 0 ? 'above' : 'below'} its own ${baseVals.length}-day norm.`
  else if (z != null && Math.abs(z) >= ANOMALY_SIGMA) verdict = `UNUSUAL — ${Math.abs(z)} sigma ${z > 0 ? 'above' : 'below'} its own ${baseVals.length}-day norm.`
  else if (z != null) verdict = `Within normal range (${z} sigma).`
  else verdict = caveat || 'Not enough history to judge.'
  if (def.higherIsBetter != null && z != null && Math.abs(z) >= ANOMALY_SIGMA) {
    const good = (z > 0) === def.higherIsBetter
    verdict += good ? ' This is a GOOD move.' : ' This is a BAD move.'
  }

  return {
    metric: def.key, label: def.label, unit: def.unit, scope,
    current, currentDays: cur.length, prior: priorVal, priorDays: prior.length,
    changePct, changeAbs,
    baselineMean: bMean == null ? null : round2(bMean), baselineSd: bSd == null ? null : round2(bSd), baselineDays: baseVals.length,
    z, direction, higherIsBetter: def.higherIsBetter, verdict, caveat,
    series: all.slice(-Math.min(60, all.length)),
  }
}

export type Anomaly = { scope: string; metric: string; label: string; z: number; current: number | null; baselineMean: number | null; verdict: string; good: boolean | null }

/** Sweep every metric across every scope and return whatever is genuinely off its own norm. */
export async function anomalyScan(opts?: { days?: number; sigma?: number; scope?: string }): Promise<{ scanned: number; anomalies: Anomaly[]; note?: string }> {
  const db = supabaseAdmin()
  const sigma = Math.max(1.5, Number(opts?.sigma) || ANOMALY_SIGMA)
  const days = Math.min(Math.max(Number(opts?.days) || 7, 1), 30)
  const { data: scopeRows } = await db.from('eve_metrics').select('scope').limit(5000)
  const seen: Record<string, true> = {}
  const scopes: string[] = []
  for (const r of (scopeRows || [])) {
    const s = String((r as any).scope)
    if (!seen[s]) { seen[s] = true; scopes.push(s) }
  }
  const useScopes = opts?.scope ? scopes.filter(s => s === opts.scope) : scopes
  const metrics = Object.keys(METRIC_BY_KEY)
  const out: Anomaly[] = []
  let scanned = 0
  for (const scope of useScopes) {
    for (const metric of metrics) {
      scanned++
      const t = await computeTrend({ metric, scope, days })
      if ((t as any).error) continue
      const tr = t as Trend
      if (tr.z == null || Math.abs(tr.z) < sigma) continue
      const good = tr.higherIsBetter == null ? null : (tr.z > 0) === tr.higherIsBetter
      out.push({ scope, metric, label: tr.label, z: tr.z, current: tr.current, baselineMean: tr.baselineMean, verdict: tr.verdict, good })
    }
  }
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  return {
    scanned,
    anomalies: out,
    note: out.length ? undefined : 'Nothing outside normal range. That is a real answer, not a failure.',
  }
}
