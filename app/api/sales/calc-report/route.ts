// THE TEAM'S PROJECTION PAGES (lib/calc-report). Sales → Projections library makes them; the page at
// /r/<code> edits them in place.
//   GET                        → the recent pages
//   POST { input, preparedFor, title } → runs the projections calculator and saves a page → { code }
//   PATCH { code, edits }      → the look, title, who it is for, figures, sections and note
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cleanInput, type IncomeFull, type IncomeInput } from '@/lib/free-tools'
import { runTool } from '@/lib/free-tools-server'
import { createCalcReport, readCalcReport, saveCalcReport, listCalcReports } from '@/lib/calc-report-server'
import { applyEdits } from '@/lib/calc-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const g = await requireLevel('sales', 'view'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, pages: await listCalcReports(30).catch(() => []) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const input = cleanInput('income', b?.input) as IncomeInput
  const full = await runTool('income', input) as IncomeFull
  if (!full.found) return NextResponse.json({ ok: false, error: 'There are not enough projections or comparables for this home yet. Add the building to the Projections library first.' }, { status: 400 })
  const ow = b?.owner || {}
  const r = await createCalcReport({ input, full, source: 'team', by: g.access.email || null, preparedFor: String(ow.name || b?.preparedFor || ''), title: String(b?.title || ''), owner: { name: String(ow.name || ''), email: String(ow.email || ''), phone: String(ow.phone || ''), unit: String(ow.unit || '') } })
  return r.ok ? NextResponse.json({ ok: true, code: r.code }) : NextResponse.json(r, { status: 500 })
}

export async function PATCH(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const rep = await readCalcReport(String(b?.code || ''))
  if (!rep) return NextResponse.json({ ok: false, error: 'No such projection page.' }, { status: 404 })
  const next = applyEdits(rep.content, b?.edits)
  const w = await saveCalcReport(rep.code, next)
  return w.ok ? NextResponse.json({ ok: true, content: next }) : NextResponse.json(w, { status: 500 })
}
