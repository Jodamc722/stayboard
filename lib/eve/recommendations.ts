// The recommendation ledger — logging advice, and then grading it.
//
// The grading is the whole point, so it is worth being explicit about how it avoids lying:
//
//   * A recommendation is only graded if it was ACCEPTED. If Jon rejected it, or never looked at
//     it, there is nothing to measure — we did not do the thing, so the metric moving proves
//     nothing either way. Those close as 'inconclusive', not as wins.
//   * Grading compares the post-decision window against the BASELINE CAPTURED AT THE TIME, which is
//     stored on the row. If we recomputed the baseline at grading time, a sustained shift would
//     quietly move the yardstick and everything would look like it worked.
//   * A move inside one standard deviation is 'inconclusive', not 'worked'. Noise is not evidence.
//   * Direction is checked against what she PREDICTED, not against whether the number went up. A
//     recommendation to reduce cancellations "works" when cancellations fall.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { METRIC_BY_KEY } from './metrics'
import { computeTrend, loadSeries, MIN_BASELINE } from './trends'
import { saveMemory } from './memory'
import { todayET, shiftDay, round2, lc, num } from './ctx'

export type RecStatus = 'open' | 'accepted' | 'rejected' | 'superseded' | 'expired'
export type Outcome = 'worked' | 'didnt' | 'inconclusive'

export type Recommendation = {
  id: string; created_by: string | null; source: string; chat_id: string | null
  title: string; detail: string | null; scope: string
  metric: string; expect_direction: string; expect_pct: number | null
  measure_on: string; measure_window: number
  baseline_value: number | null; baseline_days: number | null; baseline_sd: number | null
  status: RecStatus; decided_by: string | null; decided_at: string | null; decision_note: string | null
  measured_at: string | null; actual_value: number | null; delta_pct: number | null
  outcome: Outcome | null; outcome_note: string | null; memory_id: string | null
  created_at: string; updated_at: string
}

export type NewRecommendation = {
  title: string; detail?: string; scope?: string; metric: string
  expect_direction?: string; expect_pct?: number; measure_in_days?: number; measure_window?: number
  created_by?: string; source?: string; chat_id?: string | null
}

/**
 * Create a recommendation, capturing the baseline AS IT IS NOW so grading cannot be moved later.
 * Refuses metrics that are not in the catalogue — Eve cannot invent something unmeasurable and
 * then claim credit for it.
 */
export async function createRecommendation(input: NewRecommendation): Promise<{ ok: boolean; id?: string; error?: string }> {
  const title = String(input.title || '').trim().slice(0, 300)
  if (!title) return { ok: false, error: 'title required' }
  const metric = String(input.metric || '').trim()
  const def = METRIC_BY_KEY[metric]
  if (!def) {
    return { ok: false, error: `"${metric}" is not a measurable metric. Pick one of: ${Object.keys(METRIC_BY_KEY).join(', ')}.` }
  }
  const scope = String(input.scope || 'portfolio')
  const dir = lc(input.expect_direction) === 'down' ? 'down' : 'up'
  const inDays = Math.min(Math.max(Number(input.measure_in_days) || 21, 3), 120)
  const window = Math.min(Math.max(Number(input.measure_window) || 14, 3), 60)

  // Snapshot the baseline now.
  const t: any = await computeTrend({ metric, scope, days: window })
  const baselineValue = t && !t.error ? t.baselineMean : null
  const baselineDays = t && !t.error ? t.baselineDays : 0
  const baselineSd = t && !t.error ? t.baselineSd : null

  const db = supabaseAdmin()
  const row: any = {
    created_by: input.created_by || null,
    source: ['chat', 'brief', 'watch', 'anomaly'].indexOf(String(input.source)) >= 0 ? String(input.source) : 'chat',
    chat_id: input.chat_id || null,
    title, detail: input.detail ? String(input.detail).slice(0, 3000) : null,
    scope, metric, expect_direction: dir,
    expect_pct: Number.isFinite(Number(input.expect_pct)) ? Number(input.expect_pct) : null,
    measure_on: shiftDay(todayET(), inDays),
    measure_window: window,
    baseline_value: baselineValue, baseline_days: baselineDays, baseline_sd: baselineSd,
    updated_at: new Date().toISOString(),
  }
  try {
    const { data, error } = await db.from('eve_recommendations').insert(row).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, id: (data as any)?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

export async function decideRecommendation(id: string, status: RecStatus, by: string, note?: string) {
  const db = supabaseAdmin()
  const patch: any = { status, decided_by: by, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  if (note != null) patch.decision_note = String(note).slice(0, 1000)
  const { error } = await db.from('eve_recommendations').update(patch).eq('id', id)
  return error ? { ok: false, error: error.message.slice(0, 200) } : { ok: true }
}

/**
 * Grade every accepted recommendation whose measure_on has arrived.
 * Returns what it did, so the cron response is auditable rather than a silent "ok".
 */
export async function gradeDue(limit = 40): Promise<{ graded: number; results: any[]; error?: string }> {
  const db = supabaseAdmin()
  const today = todayET()
  const { data, error } = await db.from('eve_recommendations').select('*')
    .is('outcome', null).lte('measure_on', today)
    .in('status', ['open', 'accepted'])
    .order('measure_on').limit(limit)
  if (error) return { graded: 0, results: [], error: error.message.slice(0, 200) }

  const results: any[] = []
  for (const rec of ((data || []) as any[])) {
    // Never accepted => we did not do the thing => nothing to prove.
    if (rec.status !== 'accepted') {
      await db.from('eve_recommendations').update({
        outcome: 'inconclusive',
        outcome_note: rec.status === 'open'
          ? 'Never accepted or rejected, so the change was probably never made. Not graded.'
          : `Status was "${rec.status}" at measurement time.`,
        measured_at: new Date().toISOString(), status: rec.status === 'open' ? 'expired' : rec.status,
        updated_at: new Date().toISOString(),
      }).eq('id', rec.id)
      results.push({ id: rec.id, title: rec.title, outcome: 'inconclusive', why: 'not accepted' })
      continue
    }

    const def = METRIC_BY_KEY[rec.metric]
    const from = shiftDay(rec.measure_on, -(Number(rec.measure_window) || 14) + 1)
    const pts = await loadSeries(rec.metric, rec.scope, from, rec.measure_on)
    const baseline = rec.baseline_value == null ? null : Number(rec.baseline_value)
    const sd = rec.baseline_sd == null ? null : Number(rec.baseline_sd)

    let outcome: Outcome = 'inconclusive'
    let note = ''
    let actual: number | null = null
    let deltaPct: number | null = null

    if (!pts.length) {
      note = 'No metric data landed in the measurement window — cannot grade.'
    } else if (baseline == null || (rec.baseline_days || 0) < MIN_BASELINE) {
      actual = round2(pts.reduce((a, p) => a + p.value, 0) / pts.length)
      note = `Baseline was too thin (${rec.baseline_days || 0} days) when this was written, so there is nothing trustworthy to compare against. Observed ${actual}.`
    } else {
      actual = round2(pts.reduce((a, p) => a + p.value, 0) / pts.length)
      deltaPct = baseline !== 0 ? round2(((actual - baseline) / Math.abs(baseline)) * 100) : null
      const moved = actual - baseline
      const wanted = rec.expect_direction === 'down' ? -1 : 1
      const movedRight = (moved > 0 ? 1 : moved < 0 ? -1 : 0) === wanted
      // Inside one standard deviation is noise, not evidence.
      const meaningful = sd != null && sd > 1e-9 ? Math.abs(moved) >= sd : Math.abs(deltaPct ?? 0) >= 5
      if (!meaningful) {
        outcome = 'inconclusive'
        note = `Moved ${deltaPct == null ? 'n/a' : deltaPct + '%'} — inside normal variation, so this proves nothing either way.`
      } else if (movedRight) {
        outcome = 'worked'
        note = `${def?.label || rec.metric} went ${rec.expect_direction} by ${Math.abs(deltaPct ?? 0)}% vs the baseline captured when this was written${rec.expect_pct ? ` (she predicted about ${rec.expect_pct}%)` : ''}.`
      } else {
        outcome = 'didnt'
        note = `${def?.label || rec.metric} moved the OTHER way (${deltaPct}%) against a prediction of ${rec.expect_direction}.`
      }
    }

    // Write the verdict into memory so it actually changes future behaviour. Confidence is
    // deliberately modest — one data point is one data point.
    let memoryId: string | null = null
    if (outcome !== 'inconclusive') {
      const saved = await saveMemory({
        kind: 'insight',
        text: `${outcome === 'worked' ? 'WORKED' : 'DID NOT WORK'}: "${rec.title}" — ${note}`,
        why: 'Graded automatically against the baseline captured when the recommendation was made.',
        scope: rec.scope, weight: outcome === 'worked' ? 6 : 7, source: 'system',
        confidence: 0.5, evidence: { recommendationId: rec.id, metric: rec.metric, baseline, actual, deltaPct },
      })
      memoryId = saved.id || null
    }

    await db.from('eve_recommendations').update({
      outcome, outcome_note: note.slice(0, 1000), actual_value: actual, delta_pct: deltaPct,
      measured_at: new Date().toISOString(), memory_id: memoryId, updated_at: new Date().toISOString(),
    }).eq('id', rec.id)
    results.push({ id: rec.id, title: rec.title, metric: rec.metric, scope: rec.scope, outcome, baseline, actual, deltaPct })
  }
  return { graded: results.length, results }
}

/** Her own track record. Eve is shown this so she can be honest about her hit rate. */
export async function scorecard(): Promise<any> {
  const db = supabaseAdmin()
  const { data, error } = await db.from('eve_recommendations').select('outcome,status,metric,scope,title,delta_pct,measured_at').limit(500)
  if (error) return { available: false, note: 'Recommendation ledger not set up yet — run migration 046.' }
  const rows = data || []
  const graded = rows.filter((r: any) => r.outcome)
  const worked = graded.filter((r: any) => r.outcome === 'worked').length
  const didnt = graded.filter((r: any) => r.outcome === 'didnt').length
  const incon = graded.filter((r: any) => r.outcome === 'inconclusive').length
  return {
    available: true,
    total: rows.length,
    open: rows.filter((r: any) => r.status === 'open').length,
    accepted: rows.filter((r: any) => r.status === 'accepted').length,
    rejected: rows.filter((r: any) => r.status === 'rejected').length,
    graded: graded.length, worked, didnt, inconclusive: incon,
    hit_rate: (worked + didnt) > 0 ? Math.round((worked / (worked + didnt)) * 100) : null,
    note: (worked + didnt) < 5 ? 'Too few graded recommendations to read anything into the hit rate yet.' : undefined,
  }
}
