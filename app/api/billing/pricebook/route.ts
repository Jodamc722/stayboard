// Rebuild the price book (lib/billing-pricebook) from the last four months of approved jobs.
// The review desk calls this when GET /api/billing/review says the book is stale (older than 3 days).
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildPricebook, readPricebook, pricebookStale } from '@/lib/billing-pricebook'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const cur = await readPricebook()
  if (!pricebookStale(cur)) return NextResponse.json({ ok: true, rebuilt: false, kinds: Object.keys(cur!.kinds).length })
  try {
    const b = await buildPricebook(gate.access.email || 'billing')
    return NextResponse.json({ ok: true, rebuilt: true, kinds: Object.keys(b.kinds).length, months: b.months })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
