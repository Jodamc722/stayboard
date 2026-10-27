// APPROVED CATALOG API (Jon, 2026-10-20): the 17 West review-and-approve page.
//
//   GET  ?property=17-west                              → the catalog + every decision so far
//   POST { property, itemKey, approved[], rejected, note } → save one item's decision (overwrites)
//
// Lives under the FF&E feature key: anyone who can view the audit can read the catalog; approving
// is 'edit', the same level that builds an order.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { getCatalog, readDecisions, writeDecision, applySuppliers, SUPPLIERS } from '@/lib/ffe-approved-catalog'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

export async function GET(req: NextRequest) {
  const g = await requireLevel('ffe', 'view')
  if (!g.ok) return g.res
  const property = str(req.nextUrl.searchParams.get('property')) || '17-west'
  const full = await getCatalog(property)
  if (!full) return NextResponse.json({ ok: false, error: 'No catalog for that property.' }, { status: 404 })
  // The review shows only options from suppliers on the catalog's pick list; the Manage tab sees everything.
  const catalog = req.nextUrl.searchParams.get('all') === '1' ? full : applySuppliers(full)
  const decisions = await readDecisions(property)
  return NextResponse.json({ ok: true, catalog, decisions, suppliers: SUPPLIERS, canEdit: atLeast(g.access.levels['ffe'], 'edit') })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ffe', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const property = str(b.property) || '17-west'
  const itemKey = str(b.itemKey)
  if (!itemKey) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })
  const r = await writeDecision(property, itemKey, { approved: b.approved, rejected: b.rejected, note: b.note }, String(g.access.email || ''))
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'That did not save.' }, { status: 400 })
  return NextResponse.json(r)
}
