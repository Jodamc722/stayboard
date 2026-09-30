// AUTO ARRIVAL INSPECTIONS — cron runner + signed-in preview.
//
//   GET                → run: create + assign inspections for firing arrivals (cron or signed-in)
//   GET ?preview=1     → dry run: list what WOULD fire, touch nothing (signed-in)
//
// Runs hourly-ish via vercel.json; exactly-once is enforced by auto_inspections.reservation_id,
// so the schedule can be aggressive without ever double-tasking an inspector. See
// lib/auto-inspections.ts for the rules (big arrival / VIP / owner stay / arrival into a unit with a
// bad review / a new low review) and who gets assigned.
import { NextRequest, NextResponse } from 'next/server'
import { runAutoInspections, runArrivalFeedbackInspections, runLowReviewInspections, retireArrivalInspections } from '@/lib/auto-inspections'
import { runPmRecurrence, pmRecurrenceRanWithin } from '@/lib/pm-recurrence'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// RECEIPT (2026-09-28): one row per real run (a preview writes none), counting inspections created.
const receipted = withRouteReceipt<NextRequest>('auto-inspections', run, {
  skipWhen: (req) => new URL(req.url).searchParams.get('preview') === '1',
  count: (b) => (typeof b.created === 'number' ? b.created + (Number(b.arrivalFeedback?.created) || 0) : undefined),
})
export async function GET(req: NextRequest) { return receipted(req) }

async function run(req: NextRequest) {
  // The scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron). The spoofable
  // `x-vercel-cron` leniency is gone.
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const preview = sp.get('preview') === '1'

  // PREVIEW IS FOR SIGNED-IN HUMANS, FULL STOP. It returns guest names and reservation values.
  if (preview && !gate.access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const out = await runAutoInspections({ dryRun: preview })
    // Arrivals into a unit with a bad review (Jon, 2026-09-30: "quality inspection should be
    // auto-generated. It shouldn't be required or asked for"). AFTER the arrival inspections, so a
    // big/VIP/owner walk just filed for the same stay counts as the open inspection that covers it;
    // BEFORE the low-review rule, so a review this files is not filed a second time there. Own try.
    let arrivalFeedback: any = null
    try { arrivalFeedback = await runArrivalFeedbackInspections({ dryRun: preview }) } catch (e: any) { arrivalFeedback = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    // Low-review inspections ride the same cron (Jon, 2026-08-25): bad reviews fire a quality
    // inspection on the unit's next checkout, and unfinished ones roll forward. Its own try —
    // a review hiccup never blocks the arrival inspections.
    let lowReviews: any = null
    try { lowReviews = await runLowReviewInspections({ dryRun: preview }) } catch (e: any) { lowReviews = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    // Arrival inspections that were never walked are retired the morning after the arrival
    // (Jon, 2026-09-28: time-sensitive — "if not completed, delete the task"). Own try, same reason.
    let retired: any = null
    try { retired = await retireArrivalInspections({ dryRun: preview }) } catch (e: any) { retired = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    // PM RECURRENCE rides this line too (Jon, 2026-09-28: a completed cadence task books the next
    // one). Heavier than the rest — it reads a year of task history — so at most every six hours,
    // and never on a preview. Own try.
    let pm: any = null
    if (!preview) {
      try { pm = (await pmRecurrenceRanWithin(6)) ? { skipped: 'ran within 6h' } : await runPmRecurrence() } catch (e: any) { pm = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    }
    // The cron's own response carries counts only — no guest data on the scheduler's path.
    if (!preview && !gate.access) {
      return NextResponse.json({
        ok: out.ok, enabled: out.enabled !== false, scanned: out.scanned, created: out.created, failed: out.failed, skippedNoBreezeway: out.skippedNoBreezeway, candidates: out.candidates.length,
        arrivalFeedback: arrivalFeedback ? { ok: arrivalFeedback.ok, created: arrivalFeedback.created, covered: arrivalFeedback.covered, movedForward: arrivalFeedback.movedForward, failed: arrivalFeedback.failed, error: arrivalFeedback.error } : null,
        lowReviews: lowReviews ? { ok: lowReviews.ok, created: lowReviews.created, movedForward: lowReviews.movedForward, alreadyCovered: lowReviews.alreadyCovered, waitingForCheckout: lowReviews.waitingForCheckout, failed: lowReviews.failed } : null,
        retiredArrivalInspections: retired ? { ok: retired.ok, found: retired.found, retired: (retired.retired || []).length, failed: (retired.failed || []).length } : null,
        pmRecurrence: pm ? { ok: pm.ok, skipped: pm.skipped, created: pm.created, proposed: pm.proposed, moved: pm.moved, error: pm.error } : null,
      })
    }
    return NextResponse.json({ ...out, arrivalFeedback, lowReviews, retiredArrivalInspections: retired, pmRecurrence: pm })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
