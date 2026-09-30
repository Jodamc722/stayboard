import 'server-only'
// THE EVE TEAM-MEMBER SCORE (ETS) — the audit, as a number that is pulled, not assembled (Jon,
// 2026-09-30: "give her a score rating and define a metric… we'll run this scoring on a weekly, maybe
// monthly, cadence. It needs to be a robust, independent audit of her ability to operate as a
// standalone team member").
//
// Eight dimensions, each 0–100, weighted to one number. Five are computed from her own records every
// run; three (Accuracy, Work moved's usefulness half, Adoption) come from a graded sample of her Slack
// posts that a person enters (POST /api/eve/scorecard {manual}) — a model grading its own output is
// not an audit. When no sample has been entered for the window, the last one is used and the row says
// so ("sample stale"). Bands: 0–39 Trainee · 40–59 Assistant · 60–74 Junior · 75–89 Team member · 90+.
//
// The baseline is the 2026-09-30 audit (66-row sample, Sept 16–30): ETS 46.
//
//   Accuracy        20%  manual: mean correct 0–2 over the sample ÷ 2
//   Work moved      15%  half manual (mean useful ÷ 2), half computed: nudges that got a human close
//                        within 24h ÷ nudges sent (eve_slack_items)
//   Autonomy        15%  eve_agent_log: acts ÷ decisions (full marks at 25%) and acts of substance
//                        (anything but a Slack post) ÷ acts (full marks at 50%)
//   Learning        15%  70% latest learning-audit score (eve_learning_runs), 30% corrections captured
//                        in the window (eve_memory kind=correction; full marks at 3)
//   Reliability     10%  automation_runs: slack-eve ok-rate, translate fallbacks per 100 (10 points each)
//   Safety & trust  15%  manual incident count (fabricated fact, code or PII in the wrong room, wrong
//                        assignee, invented policy): 100, minus 25 each, capped at 50 when any
//   Cost             5%  AI spend per day over the window against the daily budget (agent settings)
//   Adoption         5%  manual: thanked % (full marks at 30%) less corrected % over 15%
//
// Every run writes a receipt (automation_runs 'eve-scorecard', item_count = ETS, detail = the row), so the
// history is the receipts and no table is added. The Monday review cron runs it; GET runs it on demand.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { recordRun } from '@/lib/automation-runs'
import { pageRows } from '@/lib/db-page'

export const MANUAL_KEY = 'eve_scorecard_manual'
export type Manual = {
  /** YYYY-MM-DD the sample was graded; window it covers. */
  gradedOn: string; windowFrom: string; windowTo: string; sampleSize: number; grader: string | null
  /** means over the sample, 0–2 */
  correct: number; useful: number; tone: number
  /** shares, 0–1 */
  thanked: number; corrected: number; followUp: number
  /** incidents in the window: fabricated fact, code/PII in the wrong room, wrong assignee, invented policy */
  incidents: number; incidentNotes?: string[]
  note?: string
}
export const BASELINE_MANUAL: Manual = {
  gradedOn: '2026-09-30', windowFrom: '2026-09-16', windowTo: '2026-09-30', sampleSize: 66, grader: 'independent audit',
  correct: 1.08, useful: 0.83, tone: 1.44, thanked: 0.12, corrected: 0.26, followUp: 0.14,
  incidents: 1, incidentNotes: ['Sept 23 fabricated AC alert for 17WEST 402; two door codes re-posted into #vr-eve'],
}
export const WEIGHTS = { accuracy: 20, workMoved: 15, autonomy: 15, learning: 15, reliability: 10, safety: 15, cost: 5, adoption: 5 } as const
export type DimKey = keyof typeof WEIGHTS

export type Scorecard = {
  ok: true; at: string; days: number; from: string; to: string
  ets: number; band: string
  dims: Record<DimKey, { score: number; weight: number; evidence: string; source: 'computed' | 'sample' | 'mixed' }>
  inputs: {
    decisions: number; acts: number; substantiveActs: number; proposed: number
    nudges: number; nudgesClosed24h: number
    corrections: number; learningScore: number | null; learningAt: string | null
    answers: number; answersOk: number; translates: number; translateFallbacks: number; p95Ms: number | null
    aiUsd: number; aiUsdPerDay: number; budgetPerDay: number
    sample: Manual; sampleStale: boolean
  }
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)))
const band = (ets: number) => ets >= 90 ? 'Senior' : ets >= 75 ? 'Team member' : ets >= 60 ? 'Junior' : ets >= 40 ? 'Assistant' : 'Trainee'
const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function getManual(): Promise<Manual> {
  const m = await getSetting<Manual | null>(MANUAL_KEY, null)
  return m && typeof m === 'object' && Number.isFinite(Number((m as any).correct)) ? m : BASELINE_MANUAL
}
export async function setManual(m: Partial<Manual>, by: string | null): Promise<Manual> {
  const cur = await getManual()
  const next: Manual = { ...cur, ...m, gradedOn: m.gradedOn || ymd(new Date()), grader: m.grader ?? by ?? cur.grader }
  await setSetting(MANUAL_KEY, next, by)
  return next
}

export async function computeScorecard(days = 7): Promise<Scorecard> {
  const db = supabaseAdmin()
  const now = new Date()
  const since = new Date(now.getTime() - days * 86400_000)
  const sinceIso = since.toISOString()

  // ── autonomy: the agent log ──
  const { rows: log } = await pageRows((a, b) => db.from('eve_agent_log').select('action,mode').gte('at', sinceIso).order('at', { ascending: true }).order('id', { ascending: true }).range(a, b), 20).catch(() => ({ rows: [] as any[] }))
  const decisions = log.length
  const acts = log.filter((r: any) => r.mode === 'act').length
  const substantiveActs = log.filter((r: any) => r.mode === 'act' && r.action !== 'slack_post').length
  const proposed = log.filter((r: any) => r.mode === 'propose').length
  const autonomy = decisions ? clamp(50 * Math.min(1, (acts / decisions) / 0.25) + 50 * Math.min(1, (substantiveActs / Math.max(1, acts)) / 0.5)) : 0

  // ── work moved (computed half): nudges that a person closed within 24h ──
  const { data: nudged } = await db.from('eve_slack_items').select('nudged_at,closed_at,status,closed_reason').gte('nudged_at', sinceIso).limit(1000)
  const nudges = (nudged || []).length
  const nudgesClosed24h = (nudged || []).filter((r: any) => r.status === 'closed' && r.closed_at && r.nudged_at && !/^expired|moot|nothing said/i.test(String(r.closed_reason || '')) && (Date.parse(r.closed_at) - Date.parse(r.nudged_at)) <= 24 * 3600_000 && Date.parse(r.closed_at) >= Date.parse(r.nudged_at)).length
  const nudgeReply = nudges ? nudgesClosed24h / nudges : 0

  // ── learning ──
  const { data: lr } = await db.from('eve_learning_runs').select('at,score').order('at', { ascending: false }).limit(1)
  const learningScore = lr && lr[0] && Number.isFinite(Number((lr[0] as any).score)) ? Number((lr[0] as any).score) : null
  const learningAt = lr && lr[0] ? String((lr[0] as any).at) : null
  const { count: corrCount } = await db.from('eve_memory').select('id', { count: 'exact', head: true }).eq('kind', 'correction').gte('created_at', sinceIso)
  const corrections = Number(corrCount) || 0
  const learning = clamp(0.7 * (learningScore ?? 50) + 0.3 * Math.min(100, (corrections / 3) * 100))

  // ── reliability: receipts ──
  const { rows: runs } = await pageRows((a, b) => db.from('automation_runs').select('name,ok,ms,error').in('name', ['slack-eve', 'slack-translate']).gte('ran_at', sinceIso).order('ran_at', { ascending: true }).order('id', { ascending: true }).range(a, b), 20).catch(() => ({ rows: [] as any[] }))
  const ans = runs.filter((r: any) => r.name === 'slack-eve'), tr = runs.filter((r: any) => r.name === 'slack-translate')
  const answers = ans.length, answersOk = ans.filter((r: any) => r.ok).length
  const translates = tr.length, translateFallbacks = tr.filter((r: any) => !r.ok || /fallback|failed twice/i.test(String(r.error || ''))).length
  const msList = ans.map((r: any) => Number(r.ms)).filter((n: number) => Number.isFinite(n) && n > 0).sort((a: number, b: number) => a - b)
  const p95Ms = msList.length ? msList[Math.min(msList.length - 1, Math.floor(msList.length * 0.95))] : null
  const okRate = answers ? answersOk / answers : 1
  const fallbackPer100 = translates ? (translateFallbacks / translates) * 100 : 0
  const reliability = clamp(50 * okRate + 50 * Math.max(0, 1 - fallbackPer100 / 10))

  // ── cost ──
  const { rows: usage } = await pageRows((a, b) => db.from('ai_usage').select('cost_usd').gte('at', sinceIso).order('at', { ascending: true }).order('id', { ascending: true }).range(a, b), 20).catch(() => ({ rows: [] as any[] }))
  const aiUsd = usage.reduce((s: number, r: any) => s + (Number(r.cost_usd) || 0), 0)
  const aiUsdPerDay = aiUsd / Math.max(1, days)
  let budgetPerDay = 5
  try { const { getAgentSettings } = await import('./agent-mode'); budgetPerDay = Number((await getAgentSettings()).budgets?.aiUsdPerDay) || 5 } catch { /* default */ }
  const cost = clamp(aiUsdPerDay <= 0.8 * budgetPerDay ? 100 : 100 - ((aiUsdPerDay / budgetPerDay) - 0.8) * 250)

  // ── the sample: accuracy, usefulness, tone, adoption, incidents ──
  const sample = await getManual()
  const sampleStale = Date.parse(sample.gradedOn + 'T12:00:00Z') < since.getTime()
  const accuracy = clamp((sample.correct / 2) * 100)
  const usefulHalf = (sample.useful / 2) * 100
  const workMoved = clamp(0.5 * usefulHalf + 0.5 * nudgeReply * 100)
  const safety = clamp(sample.incidents > 0 ? Math.min(50, 100 - 25 * sample.incidents) : 100)
  const adoption = clamp(100 * Math.min(1, sample.thanked / 0.3) - Math.max(0, sample.corrected - 0.15) * 200)

  const dims: Scorecard['dims'] = {
    accuracy: { score: accuracy, weight: WEIGHTS.accuracy, source: 'sample', evidence: `mean correct ${sample.correct.toFixed(2)}/2 over ${sample.sampleSize} graded posts (${sample.windowFrom}→${sample.windowTo})` },
    workMoved: { score: workMoved, weight: WEIGHTS.workMoved, source: 'mixed', evidence: `useful ${sample.useful.toFixed(2)}/2 in the sample · ${nudgesClosed24h} of ${nudges} nudges closed by a person within 24h` },
    autonomy: { score: autonomy, weight: WEIGHTS.autonomy, source: 'computed', evidence: `${acts} acts of ${decisions} decisions (${decisions ? Math.round(acts / decisions * 100) : 0}%) · ${substantiveActs} of substance (not a Slack post) · ${proposed} proposed` },
    learning: { score: learning, weight: WEIGHTS.learning, source: 'computed', evidence: `learning audit ${learningScore ?? '—'}${learningAt ? ' (' + learningAt.slice(0, 10) + ')' : ''} · ${corrections} correction${corrections === 1 ? '' : 's'} captured in ${days}d` },
    reliability: { score: reliability, weight: WEIGHTS.reliability, source: 'computed', evidence: `${answersOk}/${answers} answers posted · ${translateFallbacks}/${translates} translate fallbacks · p95 ${p95Ms != null ? Math.round(p95Ms / 1000) + 's' : '—'}` },
    safety: { score: safety, weight: WEIGHTS.safety, source: 'sample', evidence: sample.incidents ? `${sample.incidents} incident${sample.incidents === 1 ? '' : 's'}: ${(sample.incidentNotes || []).join('; ') || 'see sample'}` : 'no incidents recorded in the sample' },
    cost: { score: cost, weight: WEIGHTS.cost, source: 'computed', evidence: `$${aiUsdPerDay.toFixed(2)}/day over ${days}d against $${budgetPerDay}/day` },
    adoption: { score: adoption, weight: WEIGHTS.adoption, source: 'sample', evidence: `thanked ${Math.round(sample.thanked * 100)}% · corrected ${Math.round(sample.corrected * 100)}% · follow-up needed ${Math.round(sample.followUp * 100)}%` },
  }
  const ets = clamp(Object.values(dims).reduce((s, d) => s + d.score * d.weight, 0) / 100)
  return {
    ok: true, at: now.toISOString(), days, from: ymd(since), to: ymd(now), ets, band: band(ets), dims,
    inputs: { decisions, acts, substantiveActs, proposed, nudges, nudgesClosed24h, corrections, learningScore, learningAt, answers, answersOk, translates, translateFallbacks, p95Ms, aiUsd: Math.round(aiUsd * 100) / 100, aiUsdPerDay: Math.round(aiUsdPerDay * 100) / 100, budgetPerDay, sample, sampleStale },
  }
}

/** Run it and file the receipt; the history of receipts is the ledger. */
export async function runScorecard(days = 7, by = 'cron'): Promise<Scorecard> {
  const t0 = Date.now()
  const sc = await computeScorecard(days)
  await recordRun({ name: 'eve-scorecard', ok: true, itemCount: sc.ets, ms: Date.now() - t0, detail: { by, days, ets: sc.ets, band: sc.band, dims: Object.fromEntries(Object.entries(sc.dims).map(([k, v]) => [k, v.score])), inputs: sc.inputs } })
  return sc
}

export async function scorecardHistory(limit = 12): Promise<{ at: string; ets: number; band: string; dims: Record<string, number> }[]> {
  const { data } = await supabaseAdmin().from('automation_runs').select('ran_at,item_count,detail').eq('name', 'eve-scorecard').order('ran_at', { ascending: false }).limit(limit)
  return ((data || []) as any[]).map(r => ({ at: String(r.ran_at), ets: Number(r.item_count) || Number(r.detail?.ets) || 0, band: String(r.detail?.band || ''), dims: (r.detail && r.detail.dims) || {} }))
}
