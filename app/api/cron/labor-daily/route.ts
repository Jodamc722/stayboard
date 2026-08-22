// RETIRED (2026-08-22). The daily labor report merged into /api/cron/labor-trueup on 2026-08-18
// (Jon: "one email... instead of 3 different emails") and this cron was removed from vercel.json
// on 2026-08-20 — but the route itself stayed live, defaulted ENABLED with the owner as its
// recipient, and (with CRON_SECRET unset) would email payroll figures to anyone who happened to
// GET it. The 2026-08-22 Daily Briefs audit closed that: this is now a pointer, nothing more.
// Its recipient list (app_settings 'labor_daily') is still honoured — labor-trueup reads it.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: false,
    retired: true,
    reason: 'This email merged into the Daily Labor email. Use /api/cron/labor-trueup (preview with ?preview=1).',
  }, { status: 410 })
}
