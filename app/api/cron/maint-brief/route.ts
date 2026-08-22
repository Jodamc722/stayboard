// RETIRED (2026-08-22, Jon's call in the Morning System consolidation). The two standalone
// maintenance emails merged into the single Ops Command brief (the ops manager variant of
// /api/cron/ops-brief) — Miami and Broward maintenance now render side by side there, built from
// the same data module (lib/maint-brief.ts, now data-only). This route is a pointer, nothing
// more, so it can never send a parallel email or sit callable-but-forgotten the way the retired
// labor routes once did. Its cron entry is removed from vercel.json in the same change.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: false,
    retired: true,
    reason: 'The maintenance briefs merged into Ops Command. Preview with /api/cron/ops-brief?preview=full.',
  }, { status: 410 })
}
