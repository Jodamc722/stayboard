// WHICH MODEL DOES WHICH JOB — one registry, editable from Users & admin without a deploy.
//
// Jon, 2026-09-09: "create a setting where we can update the model that performs this task."
//
// Every AI call in the app is one of the TASKS below. Each task has a default (what the cost pass
// on 2026-09-09 chose) and can be overridden in app_settings under AI_MODELS_KEY. Code asks
// `modelFor('sentiment')` and gets the override if there is one, the default if not. The read is
// cached in memory for a minute per server instance, so a change on the settings page reaches every
// call within about a minute and costs nothing per request.
//
// The tiers, so the setting page can say what a change means:
//   fable   — Fable 5.1. The Mythos-class tier above Opus; the judgement calls (Jon, 2026-09-09:
//             "make sure the suggestions use fable to determine real things to focus on"). Price
//             below is a placeholder until the console confirms it — treat it as at-least-Opus.
//   opus    — Opus 4.8. Deepest reasoning. $5 in / $25 out per million tokens.
//   sonnet  — Sonnet 5. Newer generation, very strong, 2.5x cheaper than Opus. $2 / $10.
//   sonnet-prev — Sonnet 4.6. What most of the app ran on before 2026-09-09. $3 / $15.
//   haiku   — Haiku 4.5. Fast and cheap for classification and short answers. $1 / $5.
//
// RULE FOR CHOOSING: put the money where a miss has a cost. A flagged guest, a review reply, the
// words on a listing, an owner report — those are read by someone who decides something. A reworded
// task title is not. Eve is the exception in both directions: she reasons across tools for many
// turns, so she gets the deepest model AND the prompt cache that makes it affordable.
import 'server-only'
import { getSetting } from '@/lib/app-settings'

export const AI_MODELS_KEY = 'ai_models'

export type ModelTier = 'fable' | 'opus' | 'sonnet' | 'sonnet-prev' | 'haiku'
export const MODEL_IDS: Record<ModelTier, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  'sonnet-prev': 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
}
export const MODEL_LABEL: Record<ModelTier, string> = {
  fable: 'Fable 5.1', opus: 'Opus 4.8', sonnet: 'Sonnet 5', 'sonnet-prev': 'Sonnet 4.6', haiku: 'Haiku 4.5',
}
/** $ per million tokens, in / out — for the settings page to show what a change costs. */
export const MODEL_PRICE: Record<ModelTier, { in: number; out: number }> = {
  fable: { in: 5, out: 25 }, opus: { in: 5, out: 25 }, sonnet: { in: 2, out: 10 }, 'sonnet-prev': { in: 3, out: 15 }, haiku: { in: 1, out: 5 },
}
/** If the account cannot see a tier's model id, the call retries once on this one (lib/anthropic-call). */
export const MODEL_FALLBACK: Record<ModelTier, string> = {
  fable: MODEL_IDS.opus, opus: MODEL_IDS['sonnet-prev'], sonnet: MODEL_IDS['sonnet-prev'], 'sonnet-prev': MODEL_IDS.sonnet, haiku: MODEL_IDS['sonnet-prev'],
}

export type AiTask = {
  key: string
  title: string
  what: string          // what the model is asked to do
  matters: string       // who reads the output, and what a bad one costs
  def: ModelTier
  group: 'Guests' | 'Eve' | 'Listings & reports' | 'Operations' | 'Background'
  /** true = the call runs on a schedule with nobody watching; cost per day, not per click */
  background?: boolean
}

export const AI_TASKS: AiTask[] = [
  // ── Eve ──
  { key: 'eve', title: 'Eve — chat & Telegram', group: 'Eve', def: 'opus',
    what: 'Answers questions by reasoning across up to sixteen tool calls: reservations, tasks, money, Slack, the web.',
    matters: 'Jon and the managers act on what she says. Prompt caching keeps the big model affordable here.' },
  { key: 'eve-vision', title: 'Eve — reading photos', group: 'Eve', def: 'sonnet-prev',
    what: 'Looks at unit photos and describes condition, damage, staging.',
    matters: 'Feeds inspection notes; a wrong read sends a cleaner back for nothing.' },
  { key: 'learn', title: 'Eve — nightly learning pass', group: 'Background', def: 'sonnet-prev', background: true,
    what: 'Summarises 30 days of guest messages and reviews into FAQs and complaint themes.',
    matters: 'Shapes what Eve knows tomorrow. Runs once a night.' },
  // ── Guests ──
  { key: 'sentiment', title: 'Guest sentiment scan', group: 'Background', def: 'sonnet', background: true,
    what: 'Rates each guest thread 1-5 and flags dissatisfaction. Every 30 minutes, guest messages only.',
    matters: 'A frustrated guest nobody flagged becomes a review. Keep this on a full-size model.' },
  { key: 'review-reply', title: 'Review replies', group: 'Guests', def: 'opus',
    what: 'Drafts the public reply to a guest review in the house voice.',
    matters: 'Published under our name; the next prospect reads it before booking.' },
  { key: 'glitch-advise', title: 'Guest issue advice', group: 'Guests', def: 'opus',
    what: 'Recommends how to handle a reported glitch — compensation, wording, next steps.',
    matters: 'Drives a refund or an apology; a bad call costs money or a guest.' },
  { key: 'guidebook', title: 'Guidebooks — write & revise', group: 'Guests', def: 'opus',
    what: 'Writes and rewrites building guidebooks; suggests local recommendations.',
    matters: 'Guests read these on arrival. Long-form, published.' },
  { key: 'guide-activations', title: 'Guide activation emails', group: 'Background', def: 'sonnet-prev', background: true,
    what: 'Drafts the daily guide-activation message. Once a day.',
    matters: 'Guest-facing, but short and templated.' },
  // ── Listings & reports ──
  { key: 'listing-copy', title: 'Listing copy & photos', group: 'Listings & reports', def: 'opus',
    what: 'Rewrites titles, descriptions and amenities; scores and captions photos for the optimizer.',
    matters: 'This is the listing. Ranking and conversion follow the words.' },
  { key: 'photos', title: 'Photo captions, focus, enhance prompts', group: 'Listings & reports', def: 'sonnet-prev',
    what: 'Short captions, focal-point picks and enhance instructions per photo.',
    matters: 'Cosmetic; a weak caption is fixed in a click.' },
  { key: 'reports', title: 'Owner reports', group: 'Listings & reports', def: 'opus',
    what: 'Writes and edits the narrative in owner reports; reads attachments.',
    matters: 'Owners read these. This is the relationship on paper.' },
  { key: 'polish', title: 'Polish wording (everywhere)', group: 'Operations', def: 'sonnet',
    what: 'Rewords a sentence or a description wherever the Polish button appears.',
    matters: 'Internal and quick; the person is still editing.' },
  // ── Operations ──
  { key: 'ops-focus', title: 'Today in Ops — Focus', group: 'Operations', def: 'fable',
    what: 'Reads today\'s crew, cleans and every candidate job (cadence suggestions, waiting backlog, duplicates) and picks the few worth doing today, each with a reason; parks the rest under Review.',
    matters: 'This is the plan the coordinator works from. A weak pick sends a person across the county for nothing. Cached for two hours per market; a handful of calls a day.' },
  { key: 'audit', title: 'Audits & walkthroughs', group: 'Operations', def: 'opus',
    what: 'Organises audit findings, suggests items, analyses walkthrough photos and notes.',
    matters: 'Becomes the punch list a crew works from.' },
  { key: 'onboard', title: 'Onboarding — rooms to inventory', group: 'Operations', def: 'sonnet-prev',
    what: 'Turns room answers and photos into the inventory list for a new unit.',
    matters: 'Seeds a unit\'s inventory; errors are caught on the desk before ordering.' },
  { key: 'orders', title: 'Orders — brief & estimate', group: 'Operations', def: 'opus',
    what: 'Writes the owner-facing order brief and estimates costs.',
    matters: 'Owners approve money off this. Long-form.' },
  { key: 'order-suggest', title: 'Orders — product suggestions', group: 'Operations', def: 'sonnet',
    what: 'Names two or three products for a need and builds retailer search links.',
    matters: 'A starting point for a person who then picks.' },
  { key: 'billing', title: 'Billable hours — titles & translation', group: 'Operations', def: 'sonnet',
    what: 'Tidies task titles for owner statements; translates descriptions.',
    matters: 'Wording on a statement line; the numbers come from elsewhere.' },
]

const TASK_KEYS = new Set(AI_TASKS.map(t => t.key))
const TIERS: ModelTier[] = ['fable', 'opus', 'sonnet', 'sonnet-prev', 'haiku']
export const isTier = (v: any): v is ModelTier => TIERS.indexOf(v) >= 0

// One-minute in-memory cache per server instance. A settings change reaches every route within a
// minute; a Supabase hiccup never blocks a model call — it just uses the last known or the default.
let _cache: { at: number; map: Record<string, ModelTier> } | null = null
async function overrides(): Promise<Record<string, ModelTier>> {
  if (_cache && Date.now() - _cache.at < 60_000) return _cache.map
  try {
    const raw = await getSetting<Record<string, any>>(AI_MODELS_KEY, {})
    const map: Record<string, ModelTier> = {}
    for (const [k, v] of Object.entries(raw || {})) if (TASK_KEYS.has(k) && isTier(v)) map[k] = v
    _cache = { at: Date.now(), map }
    return map
  } catch {
    return _cache?.map || {}
  }
}
export function bustAiModelsCache() { _cache = null }

/** The tier a task runs on right now — override if set, else the task's default. */
export async function tierFor(task: string): Promise<ModelTier> {
  const t = AI_TASKS.find(x => x.key === task)
  const ov = (await overrides())[task]
  return ov || t?.def || 'sonnet'
}
/** The model id to send to the API for a task. */
export async function modelFor(task: string): Promise<string> {
  return MODEL_IDS[await tierFor(task)]
}
/** Model id + the one to retry on if the account cannot see it. */
export async function modelPairFor(task: string): Promise<{ model: string; fallback: string }> {
  const tier = await tierFor(task)
  return { model: MODEL_IDS[tier], fallback: MODEL_FALLBACK[tier] }
}
/** The whole current table, for the settings page. */
export async function aiModelTable(): Promise<{ key: string; tier: ModelTier; overridden: boolean }[]> {
  const ov = await overrides()
  return AI_TASKS.map(t => ({ key: t.key, tier: ov[t.key] || t.def, overridden: !!ov[t.key] }))
}
