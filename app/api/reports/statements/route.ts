// Statement picker feed for the report generator: which real Guesty owner statements exist
// for a scope, and what each one is worth on the recognised-ledger basis.
//
//   GET /api/reports/statements?buildings=17WEST,906
//   GET /api/reports/statements?listingIds=abc,def
//
// Returns statements newest first with `net` (recognised earnings) and `paid` (actual payout)
// alongside the printed `dueToOwner`. `net` is null when the mirror has not yet swept that
// month — the UI shows those as "not synced" rather than pretending to a figure.
import { NextRequest, NextResponse } from 'next/server'
import { hasEditCookie } from '@/lib/edit-access'
import { resolveScope } from '@/lib/owner-report'
import { listStatements } from '@/lib/owner-statements'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'

const csv = (v: string | null) => (v || '').split(',').map(s => s.trim()).filter(Boolean)

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok && !hasEditCookie()) return gate.res
  const user = gate.access.user

  const qs = new URL(req.url).searchParams
  const buildings = csv(qs.get('buildings'))
  const listingIdsIn = csv(qs.get('listingIds'))

  try {
    const { listings, scopeLabel } = await resolveScope(listingIdsIn, buildings)
    const ids = listings.map(l => l.id)
    const statements = await listStatements(ids, 60)
    return NextResponse.json({ ok: true, scopeLabel, listings: ids.length, statements })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
