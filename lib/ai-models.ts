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
//   sonnet-prev — Sonnet 4.6. What most of the app ran on before 2026-09-09. $3 / $15. NOTHING
//             defaults here any more: Sonnet 5 is both newer and cheaper ($2/$10), so every task
//             that sat on 4.6 moved up and down at the same time. Kept as an option only because
//             an account that cannot see Sonnet 5 falls back to it.
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
  group: 'Guests' | 'Eve' | 'Listings & reports' | 'Operations' | 'Background' | 'Garden Hotel'
  /** true = the call runs on a schedule with nobody watching; cost per day, not per click */
  background?: boolean
  /** Until this task has a tier of its own set here, it runs on this other task's tier. */
  inherit?: string
}

export const AI_TASKS: AiTask[] = [
  // ── Eve ──
  // THE COST PASS OF 2026-09-15. Eve was the Anthropic bill, and not because she is used a lot —
  // she is used about four times a day and averages 2.6 turns. She was the bill because each call
  // is roughly 100,000 tokens (tool schemas, the atlas, memories, tool results) and it was ALL
  // paying Opus list price.
  //
  // The reason the prompt cache was not saving us: it lives for five minutes. Four conversations
  // spread across a working day means nearly every call is a cache MISS, writing a fresh 100k
  // prefix at full price and never reading it back. Caching is a real win inside one conversation
  // and does nothing at all between them, which is exactly the pattern Eve has.
  //
  // So the lever is price per token, not calls and not turns. Sonnet 5 is $2/$10 against Opus
  // 4.8's $5/$25 for the same 100k — and orchestrating tools and summarising what they return is
  // what Sonnet is good at. Reverse it in Users & admin in ten seconds if her judgement slips.
  { key: 'eve', title: 'Eve — chat & Telegram', group: 'Eve', def: 'sonnet',
    what: 'Answers questions by reasoning across up to sixteen tool calls: reservations, tasks, money, Slack, the web.',
    matters: 'Jon and the managers act on what she says. Every call is large, so the tier is where the money is.' },
  // ── The Garden Hotel ── (Jon, 2026-09-28: "new business, new model"). Adam is the hotel's own
  // agent with his own memory and chat log; he starts on the newest Sonnet, changeable here.
  { key: 'adam', title: 'Adam — the Garden Hotel\'s agent', group: 'Garden Hotel', def: 'sonnet',
    what: 'Answers hotel questions from the garden_* tables (today, rooms, cleans, calls, verifications, reports) and remembers what he is taught about the hotel.',
    matters: 'The hotel team acts on what he says. Separate brain from Eve by design.' },
  { key: 'eve-review', title: "Eve — the operator's review", group: 'Eve', def: 'fable',
    what: 'Once a week (and on demand from chat or the Review tab) reads one evidence pack — the week\'s KPI tiles vs last week, anomalies, sweep findings, open audits, Slack items, glitches, low reviews, checklist ticks, app usage, her own track record — and writes what moved and why, three to six ranked plans, critiques of checklists, pages and automations, and at most four questions the data cannot answer.',
    matters: 'This is the plan Jon reads on Monday morning and the plans he accepts get graded. One large call a week; the top tier is where the reasoning lives, and a weak review is a wasted week.' },
  // THE MONDAY QUALITY AUDIT (2026-09-29, 04 F42b). lib/eve/quality-audit billed as `eve-review`, so its
  // cost hid inside the operator review's row. Its own key, same pattern as `slack-watch`: until a tier
  // is set for it here it runs on whatever `eve-review` runs on, exactly as before.
  { key: 'quality-audit', title: 'Eve — Monday quality audit', group: 'Eve', def: 'fable', inherit: 'eve-review',
    what: 'Rides the Monday review: one call over a 90-day quality pack that names the three weaknesses costing reviews, each with evidence, a root cause, an action and a metric.',
    matters: 'Its plans are graded in 21 days. Runs on the operator review\'s model until a tier is set here.' },
  { key: 'eve-vision', title: 'Eve — reading photos', group: 'Eve', def: 'sonnet',
    what: 'Looks at unit photos and describes condition, damage, staging.',
    matters: 'Feeds inspection notes; a wrong read sends a cleaner back for nothing.' },
  { key: 'learn', title: 'Eve — nightly learning pass', group: 'Background', def: 'sonnet', background: true,
    what: 'Summarises 30 days of guest messages and reviews into FAQs and complaint themes.',
    matters: 'Shapes what Eve knows tomorrow. Runs once a night.' },
  // THE SLACK READER (2026-09-28 audit, F41). The hourly pass over the team rooms (lib/eve/slack-watch)
  // billed as `learn`, so its cost hid inside the nightly row. It has its own key now; until a tier is
  // set for it here it runs on whatever `learn` runs on, exactly as before.
  { key: 'slack-watch', title: 'Eve — reading the Slack rooms', group: 'Background', def: 'sonnet', background: true, inherit: 'learn',
    what: 'Every hour, reads what was said in the team rooms since the last pass (only messages a free filter kept) and returns the open loops — promises, problems, questions, guest asks — and the facts worth keeping. Up to eight calls an hour.',
    matters: 'This is the open-loops list and what she learns from the rooms. A weak model misses loops or invents them; the cost is per hour, not per question.' },
  // THE LEARNING AUDIT (2026-09-21). Jon: "how do we audit and ensure Eve is really learning?"
  // Two tiny calls per taught fact: one turns the memory into a question with an expected answer
  // when it is filed, one judges her tool-less answer against it when the probe comes due. Both
  // are classification-sized; the expensive part (her own answer) is billed to 'eve'.
  { key: 'probe-writer', title: 'Eve — learning probe writer', group: 'Background', def: 'haiku', background: true,
    what: 'Turns a memory Jon taught her into one test question and the answer it should get ("Who cleans Park Towers?" → "an outside vendor crew, not our roster").',
    matters: 'One call per taught fact, a few hundred tokens. A weak question makes a probe too easy; nothing reaches a person.' },
  { key: 'probe-judge', title: 'Eve — learning probe judge', group: 'Background', def: 'haiku', background: true,
    what: 'Reads her tool-less answer to a probe next to the expected answer and says pass or fail, with one line why.',
    matters: 'Decides the retention number on the Learning tab. Up to fifteen calls a night, each a few hundred tokens.' },
  // THE LIVING MIND (2026-09-23, lib/eve/brain.ts). Jon: "operate like a neural network … constantly
  // updating, learning, improving." Two or three calls a night: the reflection on yesterday, today's
  // checkable predictions, and one read of every building for the dossiers.
  { key: 'eve-brain', title: 'Eve — nightly reflection & predictions', group: 'Background', def: 'sonnet', background: true,
    what: 'Each night reads a digest of yesterday next to the beliefs it touches and writes her journal, the patterns worth keeping, which beliefs the day bore out or contradicted; makes today\'s checkable calls (late cleans, guest issues) against the base rate; and writes a two-line read of each building for the dossiers.',
    matters: 'This is how her confidence in what she believes moves. Three calls a night; a weak model here learns the wrong lessons slowly.' },
  // RECALL (2026-09-28, lib/eve/memory.ts rerankByQuestion). Before an answer, reads the question
  // next to the thirty-odd memories that share words with it and picks the ones a colleague would
  // want in mind. Word overlap alone loaded the same sixty heavy lines every turn; 0.4% were used.
  { key: 'memory-recall', title: 'Eve — choosing what to remember for a question', group: 'Background', def: 'haiku', background: true,
    what: 'Given the question and up to 36 candidate memories, returns the numbers of the ones that would change or sharpen the answer. Runs once per turn, capped at six seconds; if it fails the word-overlap order stands.',
    matters: 'A few hundred tokens per turn. This is what turns 300 stored memories into the three that matter right now; a weak model here makes her forgetful, not wrong.' },
  // THE EXPECTATIONS DESK (2026-09-28, lib/eve/expectations.ts). Reads 45 days of reviews, guest
  // messages and flagged threads per building and writes the notes for CS and admin: what guests
  // keep being surprised by, and the sentence for the listing, rules or pre-arrival message that
  // would have spared them.
  { key: 'expectations', title: 'Eve — expectation notes for CS and admin', group: 'Eve', def: 'sonnet', background: true,
    what: 'One call a week over the evidence pack (reviews of every rating, inbound guest messages that ask or complain about things upfront copy should cover, unhappy threads). Returns up to twelve notes: building, theme, what guests hit, their words, the gap, where the fix belongs and the proposed copy.',
    matters: 'The copy it proposes is what a person pastes into the listing or the pre-arrival message. A weak model writes vague notes nobody acts on; nothing reaches a guest without a person.' },
  // FILE READING (2026-09-29, lib/files/extract.ts). Jon: "Adam and Eve should have file upload…
  // for learning or reference for handbooks, SOPs". A PDF (typed or scanned) or a photo of a page
  // is transcribed to text once, at upload, so the agents can search and quote it.
  { key: 'file-read', title: 'Adam & Eve — reading uploaded files', group: 'Background', def: 'sonnet', background: true,
    what: 'Transcribes an uploaded PDF or image of a document into faithful markdown (headings, lists, tables kept) so it can be filed, searched and learned from.',
    matters: 'What the agents quote as written policy is this transcription. A weak model drops lines; a missing line in an SOP is a rule nobody follows. One call per upload.' },
  // And what Adam takes from a document: the rules he files as memories.
  { key: 'adam-study', title: 'Adam — learning from an uploaded file', group: 'Garden Hotel', def: 'sonnet', background: true,
    what: 'Reads one uploaded hotel document and lists the rules and facts it states, which become Adam\'s memories.',
    matters: 'These become what Adam believes about the hotel. One call per upload.' },
  // INVESTIGATION (2026-09-30, lib/eve/investigate.ts). Jon: "Eve needs more human-like thinking than
  // this triggers, this triggers". Reads a Slack report with its thread, every Breezeway task and glitch
  // on every unit it could mean, and the guest in the unit, and says which task / glitch / unit belong
  // to it and why. A linked task in the message never reaches the model.
  { key: 'eve-investigate', title: 'Eve — tying a Slack report to its task and glitch', group: 'Eve', def: 'sonnet', background: true,
    what: 'For an open Slack report with no link in it: reads the thread, the tasks and glitches on every unit the report could mean, and the lessons the team has taught her about matching, and returns the matching task / glitch / unit with a confidence and the reasoning. At most six a sweep, and never twice on the same candidate set.',
    matters: 'This is how a report closes itself when the fix is done, and what her nudges say about where things stand. A weak model links the wrong task; below 0.7 confidence it is only a suggestion.' },
  // PLAN WITH EVE (2026-09-30, app/api/projects/plan). Jon: "help us just communicate what we want,
  // and then you organize it, structure it, and then plan it." One call per brief, a person watching.
  { key: 'project-plan', title: 'Eve — turning a brief into a project plan', group: 'Eve', def: 'sonnet',
    what: 'Reads a few lines from Jon ("exterior walkthrough at Pelican: inspect every unit, quotes for…") with the buildings, roster and categories that exist, and returns phases, one-action tasks with an owner and a week, the quotes to chase, and the questions it would ask first.',
    matters: 'This is the project the team then works from, week by week. A weak model writes vague tasks or invents people; the plan is reviewed by hand before it is created, so a miss costs a minute, not a week.' },
  { key: 'eve-correction', title: 'Eve — catching corrections in chat', group: 'Background', def: 'haiku', background: true,
    what: 'When someone replies "no, that\'s wrong…" to one of her answers, works out what was wrong and what is right, so the right thing is kept and the beliefs behind the wrong answer are weakened.',
    matters: 'A few hundred tokens, only when a reply pushes back. A miss loses one lesson; nothing reaches anyone.' },
  // ── Guests ──
  // Translating a Spanish Slack post into English when Eve is tagged on it (2026-09-22). It is a
  // translation and nothing else -- no reasoning, no tools, no judgement -- so it is the cheapest
  // tier there is, and it runs instead of a full Eve turn rather than on top of one.
  { key: 'translate', title: 'Spanish → English in Slack', group: 'Eve', def: 'haiku', background: true,
    what: 'Translates a Spanish message into English when Eve is tagged on it in Slack. Translation only, never an answer.',
    matters: 'The field team writes in Spanish and the office reads English. A wrong unit number or time here is a missed job.' },
  { key: 'sentiment', title: 'Guest sentiment scan', group: 'Background', def: 'sonnet', background: true,
    what: 'Rates each guest thread 1-5 and flags dissatisfaction. Every 30 minutes, guest messages only.',
    matters: 'A frustrated guest nobody flagged becomes a review. Keep this on a full-size model.' },
  { key: 'hk-damage', title: 'HK damage reports → claims', group: 'Guests', def: 'haiku', background: true,
    what: 'Reads each new post in #vr-hkdamagereports: which unit, what was found (itemised), and whether it looks claimable. Every 15 minutes, new posts only.',
    matters: 'A person still decides — Autofill claim or Not claimable. Haiku is enough to sort a line of text; move it up if units get mismatched.' },
  { key: 'call-notes', title: 'Call notes from recordings', group: 'Guests', def: 'haiku', background: true,
    what: 'Reads the transcript of a recorded guest call and writes the two-line note that lands on the booking and in Guesty — plus what was asked, what we promised, and how it went.',
    matters: 'Runs on every recorded call, so the tier is the cost. Haiku is enough to summarise a phone call; move it up if the notes read thin.' },
  { key: 'guest-reply', title: 'Eve — guest reply drafts', group: 'Guests', def: 'sonnet',
    what: 'Drafts a reply to a guest who is past the reply-by time (the guest_unanswered_1h watch) from the thread and the booking. Saved as a draft; a person presses Send.',
    matters: 'Nothing reaches the guest without a person. A weak draft costs a rewrite, not a guest.' },
  { key: 'review-reply', title: 'Review replies', group: 'Guests', def: 'opus',
    what: 'Drafts the public reply to a guest review in the house voice.',
    matters: 'Published under our name; the next prospect reads it before booking.' },
  { key: 'glitch-advise', title: 'Guest issue advice', group: 'Guests', def: 'opus',
    what: 'Recommends how to handle a reported glitch — compensation, wording, next steps.',
    matters: 'Drives a refund or an apology; a bad call costs money or a guest.' },
  { key: 'guidebook', title: 'Guidebooks — write & revise', group: 'Guests', def: 'opus',
    what: 'Writes and rewrites building guidebooks; suggests local recommendations.',
    matters: 'Guests read these on arrival. Long-form, published.' },
  { key: 'guide-activations', title: 'Guide activation emails', group: 'Background', def: 'sonnet', background: true,
    what: 'Drafts the daily guide-activation message. Once a day.',
    matters: 'Guest-facing, but short and templated.' },
  // ── Listings & reports ──
  { key: 'listing-copy', title: 'Listing copy & photos', group: 'Listings & reports', def: 'opus',
    what: 'Rewrites titles, descriptions and amenities; scores and captions photos for the optimizer.',
    matters: 'This is the listing. Ranking and conversion follow the words.' },
  { key: 'photos', title: 'Photo captions, focus, enhance prompts', group: 'Listings & reports', def: 'sonnet',
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
  { key: 'onboard', title: 'Onboarding — rooms to inventory', group: 'Operations', def: 'sonnet',
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
  { key: 'links-draft', title: 'Share links — describe to create', group: 'Operations', def: 'sonnet',
    what: 'Turns "a link for the Pompano cleaners, today and tomorrow, no guest names, expires Sunday" into a filled-in link form: kind, audience, scope, expiry. One forced tool call, a few hundred tokens.',
    matters: 'Nothing is created by the model — a person reviews the form and clicks Create. A wrong guess costs one correction.' },
  { key: 'billing-judge', title: 'Billable review — unit checks & strips', group: 'Operations', def: 'fable',
    what: 'Reads a unit check or strip whose description is not the template and says whether real chargeable work happened, with a suggested amount and a reason.',
    matters: 'Decides whether a routine visit reaches an owner statement. Called once per task, a couple of dozen a month; a human still approves every dollar.' },
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
  if (ov) return ov
  // A task that inherits follows its parent's tier until it has one of its own.
  if (t?.inherit && t.inherit !== task) return tierFor(t.inherit)
  return t?.def || 'sonnet'
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
  const parentTier = (k: string): ModelTier => ov[k] || AI_TASKS.find(x => x.key === k)?.def || 'sonnet'
  return AI_TASKS.map(t => ({ key: t.key, tier: ov[t.key] || (t.inherit ? parentTier(t.inherit) : t.def), overridden: !!ov[t.key] }))
}
