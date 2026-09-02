// RETIRED 2026-09-02. This was the engine behind the Today-in-Ops "Push" tab: a fixed Audit + PM
// (plus health-score tasks) for EVERY turnover over three days — 114 suggestions on an ordinary
// morning, which nobody worked. The tab is gone (Jon: Grid + Staffing only) and its job — what a
// person should touch next, with evidence and one action — lives in lib/command-day.ts behind
// /api/command/day. The route stays as a 410 so nothing that still calls it gets a quiet 404.
// /api/ops-plan/generate and /api/ops-plan/item are UNRELATED (the saved ops plans on /plan/[id])
// and are untouched.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: false, retired: true, error: 'Retired 2026-09-02 — the daily suggestion queue moved to /api/command/day ("Do next").' }, { status: 410 })
}
