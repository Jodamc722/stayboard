// RETIRED (2026-08-22). The Monday payroll brief merged into /api/cron/labor-trueup on
// 2026-08-18 (Jon: "one email... instead of 3 different emails") and its cron was removed from
// vercel.json on 2026-08-20 — but the route stayed live and callable. The 2026-08-22 Daily
// Briefs audit closed it: this is now a pointer, nothing more. Its settings key
// (app_settings 'labor_weekly') is still honoured — labor-trueup reads recipients from it, and
// the week-by-week view lives on at /labor (Weekly) via /api/labor/weekly.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: false,
    retired: true,
    reason: 'This email merged into the Daily Labor email. Use /api/cron/labor-trueup, or /labor → Weekly in the app.',
  }, { status: 410 })
}
