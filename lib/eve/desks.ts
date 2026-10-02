// EVE'S DESKS — one face, five workers (Jon, 2026-09-30: "Should Eve have independent bots, or is
// Eve just a head bot? … whatever you think is best").
//
// The answer taken: ONE identity in Slack — the team tags Eve, thanks Eve, corrects Eve — and, inside
// her, five desks that each own a job, a budget, a receipt, a model tier and a lane on the scorecard.
// The audit found her jobs colliding, not her judgement failing: translation queued behind 16-turn
// answers, five watchers nudging with five memories, a chat test question becoming a channel alert.
// A desk is how those get separated without giving the team five names to learn.
//
// This file is the map: which automation receipts, AI tasks, action sources and Slack surfaces belong
// to which desk. It has no JSX and no imports so tests, the scorecard and the Health page can all read
// it. The desks do not (yet) change what runs — they change how it is metered, deduplicated (lib/eve/
// said.ts: one registry of what has already been said, consulted before any desk posts) and scored
// (lib/eve/scorecard.ts: a lane per desk). Adam, the Garden Hotel agent, is a separate identity on
// purpose — one agent per business, not one per function.
export type DeskKey = 'interpreter' | 'answer' | 'watch' | 'investigator' | 'planner' | 'reviewer'

export type Desk = {
  key: DeskKey
  label: string
  /** One line: the job. */
  blurb: string
  /** automation_runs names this desk writes. */
  receipts: string[]
  /** ai_usage task keys this desk spends (lib/ai-models.ts). */
  aiTasks: string[]
  /** `by` prefixes in eve_agent_log / proposals that belong to this desk (prefix match). */
  sources: string[]
  /** What the desk is allowed to DO on its own, in words — the rung still decides. */
  hands: string
  /** The scorecard lane it feeds. */
  lane: 'translation' | 'qa' | 'monitoring' | 'execution' | 'planning' | 'review'
}

export const DESKS: Desk[] = [
  {
    key: 'interpreter', label: 'Interpreter', lane: 'translation',
    blurb: 'A tag at the end of a message: Spanish becomes English, English becomes Spanish, nothing else.',
    receipts: ['slack-translate'], aiTasks: ['translate'], sources: ['translate'],
    hands: 'Posts the translation in the thread. Never reasons, never acts, never asks a question.',
  },
  {
    key: 'answer', label: 'Answer', lane: 'qa',
    blurb: 'A tag at the front, a thread under her answer, the web chat or Telegram: she reads the records and answers.',
    receipts: ['slack-eve', 'eve-ask'], aiTasks: ['eve', 'eve-vision', 'eve-correction'], sources: ['chat', 'slack', 'telegram', 'cron:eve-ask'],
    hands: 'Answers; any side effect goes through propose_action and its rung. A channel post from a conversation needs a task, glitch, booking or Slack message behind it.',
  },
  {
    key: 'watch', label: 'Watch', lane: 'monitoring',
    blurb: 'The one monitor: open loops in Slack, on-watch gaps, the day board digests, guest asks, no-show risk, the CCS handoff.',
    receipts: ['slack-watch', 'on-watch', 'ops-desk', 'ccs-desk', 'scheduler-shadow', 'eve-deferred', 'schedule-check', 'eve-reminders'], aiTasks: ['slack-watch', 'ops-focus'],
    sources: ['cron:slack-watch', 'cron:on-watch', 'cron:ops-desk', 'cron:pm-recurrence', 'watch:', 'cron:scheduler-shadow', 'cron:schedule-check', 'desk', 'slack-watch'],
    hands: 'Posts nudges and digests via the slack_post rung, once per subject per day across every watcher (lib/eve/said.ts). Never a fact it cannot link.',
  },
  {
    key: 'investigator', label: 'Investigator', lane: 'execution',
    blurb: 'Ties a Slack report to its Breezeway task or glitch, and — within its rung — creates, assigns and notes tasks.',
    receipts: ['eve-outcomes'], aiTasks: ['eve-investigate'], sources: ['investigate'],
    hands: 'task_create, task_assign, task_note at their rungs; the never-assign list and the daily action cap are the guards. Confidence under 0.7 is a suggestion, never a pin.',
  },
  {
    key: 'planner', label: 'Planner', lane: 'planning',
    blurb: 'Plan with Eve: a brief becomes a project with phases, owners, weeks and the field tasks in Breezeway; the weekly plan and the morning plan post.',
    receipts: ['weekly-planner'], aiTasks: ['project-plan'], sources: ['plan'],
    hands: 'Drafts; a person creates. Field tasks land in Breezeway only on Create.',
  },
  {
    key: 'reviewer', label: 'Reviewer', lane: 'review',
    blurb: 'The Monday review, the quality audit, the expectations desk, the nightly learning audit and the Team-Member Score itself.',
    receipts: ['eve-review', 'quality-audit', 'expectations', 'eve-learn', 'eve-metrics', 'eve-audit', 'eve-scorecard', 'learn'], aiTasks: ['eve-review', 'quality-audit', 'expectations', 'learn', 'eve-brain', 'learning-probe', 'learning-judge'],
    sources: ['cron:eve-review', 'nightly', 'eve-sleep', 'coverage', 'system'],
    hands: 'Files plans and questions to the ledger; posts a short version to #leadership via the slack_post rung. Grades nothing of its own as worked.',
  },
]

export const DESK_BY_KEY: Record<DeskKey, Desk> = Object.fromEntries(DESKS.map(d => [d.key, d])) as Record<DeskKey, Desk>

/** Which desk a `by` / source string belongs to. Unknown sources are the Watch desk's if they post from a cron, else the Answer desk's. */
export function deskForSource(by: string | null | undefined): DeskKey {
  const s = String(by || '').trim().toLowerCase()
  if (!s) return 'answer'
  for (const d of DESKS) for (const p of d.sources) if (s === p || s.startsWith(p)) return d.key
  if (s.startsWith('cron:')) return 'watch'
  return 'answer'
}
export function deskForReceipt(name: string | null | undefined): DeskKey | null {
  const s = String(name || '').trim().toLowerCase()
  for (const d of DESKS) if (d.receipts.includes(s)) return d.key
  return null
}
export function deskForAiTask(task: string | null | undefined): DeskKey | null {
  const s = String(task || '').trim().toLowerCase()
  for (const d of DESKS) if (d.aiTasks.includes(s)) return d.key
  return null
}
