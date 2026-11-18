// Hourly: pull new projections from the sales team's Drive folder into the projections library, as "not approved
// yet" (lib/sales-drive-sync). The scheduler's bearer, or a signed-in admin pressing it.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runDriveSync } from '@/lib/sales-drive-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const g = await requireCron(req); if (!g.ok) return g.res!
  const r = await runDriveSync(g.access?.email || 'cron')
  return NextResponse.json({ ok: r.ok, error: r.error, listed: r.listed, added: r.added, updated: r.updated, failed: r.failed, left: r.left })
}
