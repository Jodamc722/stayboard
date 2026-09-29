// ── WHAT COUNTS AS A DONE BREEZEWAY TASK ────────────────────────────────────
//
// Its own module, and deliberately a tiny one with no imports, because both sides of the app
// need this answer and they cannot share a file: lib/billing builds the invoice with
// supabaseAdmin (service credentials), and components/BillingReview is a 'use client' component.
// Importing the first into the second to reuse one regex would pull an admin Supabase client
// toward the browser bundle. So the rule lives here, where either side can have it, and
// lib/billing re-exports it so existing imports keep working.
//
// Breezeway's real statuses, measured across the last 180 days:
//   finished 11,836 · deleted 2,002 · created 1,514 · closed 622 · in_progress 27 · cancelled 1
// So 'finished' and 'closed' are the done ones, and NEITHER is spelled "completed".
//
// ONE RULE, NOT TWO (2026-09-28 audit, P2-2). This file used to carry its own looser regex,
// /complet|close|approv|finish/, which also matches "incomplete" and "unfinished" — while the board,
// the briefs and the cadence engines used lib/task-categories' strict /\b(complete|finish|close|approv)/.
// On today's statuses the two agree; the day Breezeway sends "incomplete" they would not. The strict
// rule is the right one everywhere, so this module now re-exports it. lib/task-categories has no
// imports either, so the client-bundle reason above still holds.
export { TASK_DONE_RE, isTaskDone } from './task-categories'
