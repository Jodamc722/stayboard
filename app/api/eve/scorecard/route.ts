// THE EVE TEAM-MEMBER SCORE (lib/eve/scorecard.ts) — pulled, not assembled.
//
//   GET  /api/eve/scorecard?days=7        → this window's score, every dimension with its evidence, and
//                                           the last 12 filed runs (admins who may use Eve)
//   GET  /api/eve/scorecard?days=7&file=1 → the same, and files it as a receipt (a manual run of the ledger)
//   POST /api/eve/scorecard {manual}      → enter the graded Slack sample: {correct, useful, tone (0–2),
//                                           thanked, corrected, followUp (0–1), incidents, incidentNotes[],
//                                           sampleSize, windowFrom, windowTo, note}. Entered by a person;
//                                           the model never grades itself here.
// The Monday review cron (app/api/cron/eve-review) files a run every week.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { computeScorecard, runScorecard, scorecardHistory, setManual, getManual, WEIGHTS } from '@/lib/eve/scorecard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await eveGate()
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const days = Math.max(1, Math.min(90, Number(sp.get('days')) || 7))
  try {
    const sc = sp.get('file') === '1' ? await runScorecard(days, String(g.access.email || 'manual')) : await computeScorecard(days)
    const history = await scorecardHistory(12)
    return NextResponse.json({ ...sc, weights: WEIGHTS, history })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await eveGate()
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const m = b && typeof b.manual === 'object' ? b.manual : b
  const num = (v: any, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined }
  const patch: any = {}
  for (const k of ['correct', 'useful', 'tone'] as const) { const n = num(m[k], 0, 2); if (n !== undefined) patch[k] = n }
  for (const k of ['thanked', 'corrected', 'followUp'] as const) { const n = num(m[k], 0, 1); if (n !== undefined) patch[k] = n }
  const inc = num(m.incidents, 0, 50); if (inc !== undefined) patch.incidents = Math.round(inc)
  const size = num(m.sampleSize, 1, 1000); if (size !== undefined) patch.sampleSize = Math.round(size)
  for (const k of ['windowFrom', 'windowTo', 'gradedOn'] as const) if (/^\d{4}-\d{2}-\d{2}$/.test(String(m[k] || ''))) patch[k] = String(m[k])
  if (Array.isArray(m.incidentNotes)) patch.incidentNotes = m.incidentNotes.map((x: any) => String(x).slice(0, 200)).slice(0, 20)
  if (typeof m.note === 'string') patch.note = m.note.slice(0, 600)
  if (typeof m.grader === 'string') patch.grader = m.grader.slice(0, 120)
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'nothing to save — send the sample means and shares', current: await getManual() }, { status: 400 })
  const saved = await setManual(patch, String(g.access.email || ''))
  const sc = await runScorecard(7, String(g.access.email || 'manual'))
  return NextResponse.json({ ok: true, manual: saved, scorecard: sc })
}
