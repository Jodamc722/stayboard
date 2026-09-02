// AUTO ARRIVAL INSPECTIONS — cron runner + signed-in preview.
//
//   GET                → run: create + assign inspections for firing arrivals (cron or signed-in)
//   GET ?preview=1     → dry run: list what WOULD fire, touch nothing (signed-in)
//
// Runs hourly-ish via vercel.json; exactly-once is enforced by auto_inspections.reservation_id,
// so the schedule can be aggressive without ever double-tasking an inspector. See
// lib/auto-inspections.ts for the rules (big arrival / VIP / owner stay) and who gets assigned.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runAutoInspections, runLowReviewInspections } from '@/lib/auto-inspections'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  // ANONYMOUS CALLERS ARE NOT CRON (2026-09-02). This read `|| auth === ''`, and an anonymous
  // request sends no Authorization header — so `auth` IS '' and the clause was true for exactly the
  // caller it was meant to exclude. CRON_SECRET has never been set on this project, so that branch
  // was the live one. Vercel's scheduler stamps `x-vercel-cron` on every call; that header is the
  // whole of the leniency it needs. Same shape as app/api/cron/suggestions.
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron')
  const sp = new URL(req.url).searchParams
  const preview = sp.get('preview') === '1'

  // PREVIEW IS FOR SIGNED-IN HUMANS, FULL STOP. It returns guest names and reservation values,
  // and the lenient no-CRON_SECRET cron heuristic must never open that to an anonymous caller —
  // that heuristic exists so Vercel's scheduler can RUN the job, not so strangers can read it.
  if (preview) {
    if (!(await signedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else if (!isCron && !(await signedIn())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const out = await runAutoInspections({ dryRun: preview })
    // Low-review inspections ride the same cron (Jon, 2026-08-25): bad reviews fire a quality
    // inspection on the unit's next checkout, and unfinished ones roll forward. Its own try —
    // a review hiccup never blocks the arrival inspections.
    let lowReviews: any = null
    try { lowReviews = await runLowReviewInspections({ dryRun: preview }) } catch (e: any) { lowReviews = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    // The cron's own response carries counts only — no guest data on the unauthenticated path.
    if (!preview && isCron && !(await signedIn())) {
      return NextResponse.json({
        ok: out.ok, enabled: out.enabled !== false, scanned: out.scanned, created: out.created, failed: out.failed, skippedNoBreezeway: out.skippedNoBreezeway, candidates: out.candidates.length,
        lowReviews: lowReviews ? { ok: lowReviews.ok, created: lowReviews.created, movedForward: lowReviews.movedForward, waitingForCheckout: lowReviews.waitingForCheckout, failed: lowReviews.failed } : null,
      })
    }
    return NextResponse.json({ ...out, lowReviews })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
