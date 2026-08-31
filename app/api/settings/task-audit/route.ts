// THE AUDIT, BEFORE ANYTHING ACTS ON IT.
//
// Jon, 2026-08-31: "There should be an audit of that."
//
// One read, two questions: what got done twice, and which inspections are strays. Both are
// read-only here — the stray closer is called with dryRun, so opening this page can never change a
// single record. Owner-only, because it names units, dates and the people whose name is on the
// duplicate.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { auditDuplicates, closeStrayInspections } from '@/lib/task-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'owner only' }, { status: 403 })
  const days = Math.min(180, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30))
  try {
    const [dupes, strays] = await Promise.all([
      auditDuplicates({ days }),
      closeStrayInspections({ dryRun: true }),
    ])
    return NextResponse.json({ ok: true, days, dupes, strays })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
