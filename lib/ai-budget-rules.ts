// THE BUDGET RULES, WITH NOTHING ELSE IN THE FILE (2026-11-10).
//
// lib/ai-budget.ts reads the ledger and the setting; this file decides. It imports nothing, so the
// decision — which call stops at which cap — can be tested with plain numbers
// (lib/__tests__/ai-budget-rules.test.mjs) instead of being trusted. lib/ai-budget.ts re-exports
// everything here, so callers keep importing from '@/lib/ai-budget'.

export type AiBudget = {
  automaticUsd: number; totalUsd: number; monthUsd: number; on: boolean
  /** THE PAUSE BUTTON (Jon, 2026-10-07): true = no AI call leaves Lighthouse, whatever the spend. */
  paused: boolean
  /** THE RUNAWAY BRAKE: most calls one feature may make in an hour (Eve's chat gets 3x). The 10-07
   *  translate loop made ~284 calls in a day; nothing legitimate needs this many in an hour. */
  perTaskHour: number
  /**
   * THE NIGHT SHIFT'S SHARE (2026-11-10). The nightly learning jobs (NIGHTLY below) run between 1am
   * and 6am Eastern and draw on the same automatic allowance as the daytime Slack reader and the
   * sentiment scan — whoever runs first spends it. This is the most of `automaticUsd` the night shift
   * may use (0.5 = half); the rest is kept for the day. 0, or 1 and above, switches the reserve off.
   * Optional: a stored budget without it uses DEFAULT_BUDGET's.
   */
  nightlyShare?: number
}
export const DEFAULT_BUDGET: AiBudget = { automaticUsd: 5, totalUsd: 9, monthUsd: 250, on: true, paused: false, perTaskHour: 40, nightlyShare: 0.5 }

// REVIEW REPLIES ARE NEVER CAPPED (Jon, 2026-11-09: "never not let me respond to reviews"). A reply
// costs a fraction of a cent; a review left unanswered costs bookings. Only the manual Pause stops
// them — no daily, monthly or hourly cap does.
// SLACK TRANSLATION IS NEVER CAPPED EITHER (Jon, 2026-11-10: "fix the translation feature in slack —
// super important"). A teammate who can't read the room can't work; a translation costs well under a
// cent. Guidebook bulk builds were spending the whole daily cap and silently switching it off.
export const NEVER_CAPPED: ReadonlySet<string> = new Set(['review-reply', 'translate'])

// THE WEEKLY REVIEW RUNS EVEN ON A DAY THE DAILY CAP IS SPENT (audit 2026-11-09: the Monday operator
// review failed at 5:30am because Sunday night's jobs had used the day). One or two calls a week; the
// monthly cap still applies to them.
export const WEEKLY_EXEMPT: ReadonlySet<string> = new Set(['eve-review', 'quality-audit'])

// Typed by a person, on the spot — the only calls that keep going after the automatic cap.
// 'translate' is a person tagging Eve in a thread and waiting (Jon, 2026-10-01: "100% of the time") —
// interactive, never paused by the automatic cap (independent audit 2026-10-10).
//
// 'memory-recall' IS PART OF THE ANSWER (2026-11-10). It is the one short call that picks which of
// her memories matter for the question a person just asked (lib/eve/memory rerankByQuestion). It was
// missing from this list, so once the background jobs had spent the automatic allowance Eve's chat
// kept answering but quietly lost that pass and fell back to word overlap — she got more forgetful
// every afternoon. It stops at the total cap with the chat it serves, not before.
//
// THE SAME WORK FROM A CRON HAS ITS OWN KEY (2026-11-10). 'guest-reply', 'expectations' and
// 'eve-investigate' are on this list because a person presses a button and waits. The watches, the
// Monday desk and the hourly Slack pass did the same work under the same keys with nobody waiting,
// so their spend skipped the automatic cap and ate the headroom kept for chat. Those callers now use
// AUTO_TWIN's keys, which are NOT on this list and so stop at the automatic cap like any other job.
export const INTERACTIVE: ReadonlySet<string> = new Set(['eve', 'eve-fast', 'eve-vision', 'eve-investigate', 'listing-copy', 'review-reply', 'reports', 'guidebook', 'project-plan', 'expectations', 'guest-reply', 'translate', 'memory-recall'])

/** A person's task key → the key its scheduled caller bills under. Each twin runs on its parent's model (lib/ai-models `inherit`). */
export const AUTO_TWIN: Readonly<Record<string, string>> = { 'guest-reply': 'guest-reply-auto', 'eve-investigate': 'eve-investigate-auto', expectations: 'expectations-auto' }

/** The nightly learning jobs the reserve applies to: the learning pass, the reflection and its corrections, the learning audit's probes. */
export const NIGHTLY: ReadonlySet<string> = new Set(['learn', 'eve-brain', 'eve-correction', 'probe-writer', 'probe-judge'])

/** Dollars of the automatic allowance the night shift may use today; 0 when the reserve is off. */
export function nightlyAllowance(b: AiBudget): number {
  const share = Number(b.nightlyShare ?? DEFAULT_BUDGET.nightlyShare)
  const auto = Number(b.automaticUsd)
  if (!Number.isFinite(share) || !Number.isFinite(auto) || share <= 0 || share >= 1 || auto <= 0) return 0
  return auto * share
}

/**
 * THE ANSWER CHECK IS AUTOMATIC (2026-11-10, lib/eve/evals.ts). 'eval-run' (Eve's own loop asking the
 * approved questions) and 'eval-judge' are deliberately NOT on INTERACTIVE: nobody is waiting, so they
 * stop at the automatic daily cap like any background job, and the runner asks before every question
 * and stops politely. They are not NIGHTLY either — the check is weekly and on demand, not a learning
 * job. 'eval-run' is a full Eve loop (several model calls per question, up to twenty questions), so it
 * gets Eve's chat room in the hourly brake rather than tripping it as a "loop".
 */
export const EVAL_TASKS: ReadonlySet<string> = new Set(['eval-run', 'eval-judge'])

/** Most calls one task may make in an hour (Eve's chat and the answer check's Eve loop get 3x). */
export function hourLimit(task: string, b: AiBudget): number {
  return (task === 'eve' || task === 'eval-run' ? 3 : 1) * (Number(b.perTaskHour) || 40)
}

export type SpendState = {
  day: number; month: number; budget: AiBudget; hour: Record<string, number>
  /** Today's spend by the NIGHTLY tasks only. Absent (an old cache entry) = the reserve does not apply. */
  nightly?: number
}
export type BudgetVerdict = {
  /** Null when the call may go; otherwise the sentence the caller is given. */
  blocked: string | null
  /** Set when the runaway brake is what stopped it — the caller warns the admins once. */
  brake?: { count: number; limit: number }
}

/** The whole decision, in the order the caps apply. Pure: same numbers in, same answer out. */
export function decideBudget(task: string, s: SpendState): BudgetVerdict {
  const b = s.budget
  if (b.paused) return { blocked: 'AI is paused in Lighthouse (Settings → AI models → Pause all AI).' }
  if (NEVER_CAPPED.has(task)) return { blocked: null }
  if (!b.on) return { blocked: null }
  if (s.month >= b.monthUsd) return { blocked: `Lighthouse's monthly AI budget ($${b.monthUsd}) is used up — AI is paused until the 1st.` }
  if (WEEKLY_EXEMPT.has(task)) return { blocked: null }
  if (s.day >= b.totalUsd) return { blocked: `Lighthouse's daily AI budget ($${b.totalUsd}) is used up — AI is paused until midnight.` }
  if (!INTERACTIVE.has(task) && s.day >= b.automaticUsd) return { blocked: `Automatic AI jobs hit today's $${b.automaticUsd} cap — paused until midnight.` }
  const night = nightlyAllowance(b)
  if (night > 0 && NIGHTLY.has(task) && Number(s.nightly) >= night) {
    return { blocked: `Nightly learning used its share of today's automatic AI allowance ($${night.toFixed(2)} of $${b.automaticUsd}) — the rest is kept for the daytime jobs.` }
  }
  const lim = hourLimit(task, b)
  const count = s.hour[task] || 0
  if (count >= lim) return { blocked: `"${task}" made ${count} AI calls in the last hour — paused for the hour so a loop can't run up the bill.`, brake: { count, limit: lim } }
  return { blocked: null }
}
