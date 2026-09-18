// ── WHAT COUNTS AS A DONE BREEZEWAY TASK ────────────────────────────────────
//
// Its own module, and deliberately a tiny one with no imports, because both sides of the app
// need this answer and they cannot share a file: lib/billing builds the invoice with
// supabaseAdmin (service credentials), and components/BillingReview is a 'use client' component.
// Importing the first into the second to reuse one regex would pull an admin Supabase client
// toward the browser bundle. So the rule lives here, where either side can have it, and
// lib/billing re-exports it so existing imports keep working.
//
// ONE DEFINITION, because there were four. This test was written out separately in the billing
// flag loop, in lib/maint-brief and twice in components/BillingReview, each with its own
// spelling -- 'complet' in one, 'complete' in another -- which is how a rule quietly stops
// meaning the same thing in two places.
//
// Breezeway's real statuses, measured across the last 180 days:
//   finished 11,836 · deleted 2,002 · created 1,514 · closed 622 · in_progress 27 · cancelled 1
// So 'finished' and 'closed' are the done ones, and NEITHER is spelled "completed" -- matching
// on that literal word, which is the word everyone says out loud, would have failed on every
// task we have. 'deleted' and 'cancelled' match nothing here, which is correct; deleted rows are
// dropped upstream anyway.
export const TASK_DONE_RE = /complet|close|approv|finish/i

/** Done means Breezeway says so: a done-ish status, or a finish timestamp on the task. */
export function isTaskDone(status: unknown, finishedAt: unknown): boolean {
  return TASK_DONE_RE.test(String(status || '')) || !!finishedAt
}
