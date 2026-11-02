// Rebuild the price book (lib/billing-pricebook) from the last four months of approved jobs.
// The review desk calls this when GET /api/billing/review says the book is stale (older than 3 days).
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildPricebook, readPricebook, pricebookStale } from '@/lib/billing-pricebook'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** THE RATE STUDY: every type and the commonest jobs, with what they bill and what we recommend. */
export async function GET() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const b = await readPricebook()
  if (!b) return NextResponse.json({ ok: true, builtAt: null, types: [], jobs: [] })
  const rows = (m: Record<string, any>) => Object.entries(m || {}).map(([key, e]) => ({ key, ...e }))
  const all = rows(b.categories || {})
  const timedBilled = all.reduce((s, e: any) => s + (e.perHour && e.avgHours ? e.perHour * e.avgHours * e.n : 0), 0)
  const timedHours = all.reduce((s, e: any) => s + (e.perHour && e.avgHours ? e.avgHours * e.n : 0), 0)
  return NextResponse.json({
    ok: true, builtAt: b.builtAt, months: b.months, houseRate: b.houseRate || 40,
    overallPerHour: timedHours > 0 ? Math.round(timedBilled / timedHours * 100) / 100 : null,
    types: all.sort((a: any, z: any) => z.n - a.n),
    jobs: rows(b.kinds).filter((e: any) => e.n >= 3).sort((a: any, z: any) => z.n - a.n).slice(0, 80),
  })
}

export async function POST(req: Request) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const cur = await readPricebook()
  const force = new URL(req.url).searchParams.get('force') === '1'
  if (!force && !pricebookStale(cur)) return NextResponse.json({ ok: true, rebuilt: false, kinds: Object.keys(cur!.kinds).length })
  try {
    const b = await buildPricebook(gate.access.email || 'billing')
    return NextResponse.json({ ok: true, rebuilt: true, kinds: Object.keys(b.kinds).length, months: b.months })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
