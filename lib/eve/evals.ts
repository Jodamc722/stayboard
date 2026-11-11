// DOES SHE ANSWER CORRECTLY? (2026-11-10). The answer check — the proof the learning audit is not.
//
// The learning audit (./learning-audit.ts) asks ~60 taught sentences back with every tool removed.
// That measures whether a memory took. It says nothing about whether "how did Botanica do last month
// against the month before?" gets the right number, from the right place, with the window and the
// as-of on it. This file measures that.
//
//   1. THE SET. An eval question is a row in eve_probes with with_tools = true (migration 177). Three
//      ways one is made, all as a CANDIDATE (active = false, approved_by = null) that does nothing until
//      a person approves it:
//        • a chat somebody gave a thumbs-up      → her answer is the expected answer   (kind eval:thumbs)
//        • a chat somebody corrected             → the correction is the expected answer (eval:correction)
//        • SEED_EVALS below, ~20 business questions across what she now covers, with NO fixed answer:
//          the expected answer is a METHOD — which family of lookups, which caveats must appear, when
//          she must ask "which one?" (eval:seed). Live numbers move; the method does not.
//      A person can also write one (eval:person). An admin approves (optionally editing the expected
//      answer), or rejects (approved_by = 'rejected:<email>', kept so it is never harvested again).
//   2. THE RUN. Weekly from the nightly learning route, and on demand (Run now, admins). Up to EVAL_MAX
//      approved questions, least-recently-asked first, each through the REAL loop (runEve) WITH her
//      tools — but only the ones that read. Every tool that writes, posts, proposes, remembers, drafts,
//      reminds or spends is denied by name before the model is told it exists (run.ts denyTools — the
//      same mechanism the Slack tiers use, refused again at dispatch if a name slips through). source
//      'probe' keeps the run out of eve_chats, off memory use counts, and away from auto-capture and
//      correction capture.
//   3. THE JUDGE. The existing judge model (eval-judge rides probe-judge's tier) reads her answer, the
//      lookups she used and where their numbers came from, next to the approved answer or the method
//      rubric, and says pass / fail with one line why. A judge that does not answer leaves the question
//      UNGRADED — it never counts as her miss or her pass.
//   4. THE RECORD. Per question: last_answer, last_pass, last_why, pass/fail counts. Per run: one
//      eve_learning_runs row of kind 'eval' with eval_accuracy (passed ÷ graded) and accuracy by domain
//      in detail.byDomain. The learning audit's readers skip kind 'eval'.
//   5. THE BUDGET. Billed as 'eval-run' / 'eval-judge', both AUTOMATIC (lib/ai-budget-rules). The runner
//      asks budgetBlock('eval-run') before every batch and stops politely, saying why, when it says no.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { accessForEmail } from '@/lib/access'
import { modelPairFor, modelFor } from '@/lib/ai-models'
import { anthropicMessages, textOf } from '@/lib/anthropic-call'
import { costUsd } from '@/lib/ai-usage'
import { budgetBlock } from '@/lib/ai-budget'
import { pageRows } from '@/lib/db-page'
import { runEve, type RunEveInput, type RunEveResult } from './run'
import { coreTools, DOMAINS } from './registry'
import { DESKS, deskForAiTask } from './desks'

const OWNER = 'jon@stay-hospitality.com'
/** Hard cap: questions per run, whoever asks for more. */
export const EVAL_MAX = 20
/** Questions asked at once. Each is a full Eve loop; three keeps a run inside one function's time. */
const CONCURRENCY = 3
/** A run starts another batch only with this much of its deadline left (runEve's own wall is 150 s). */
const BATCH_NEEDS_MS = 100_000
/** Weekly: a run is due when the last one is older than this. */
const DUE_AFTER_MS = 6.5 * 864e5
/** Candidates harvested from chats per pass, at most. */
const HARVEST_CAP = 40
export const METHOD_PREFIX = 'METHOD: '
export const REJECTED_PREFIX = 'rejected:'

export type EvalKind = 'eval:thumbs' | 'eval:correction' | 'eval:seed' | 'eval:person'
export type EvalDomain = 'reservations' | 'revenue' | 'occupancy' | 'reviews' | 'upkeep' | 'unit_health' | 'repeats' | 'owners'
  | 'vendors' | 'inspections' | 'blocked' | 'calls' | 'policy' | 'property' | 'ops' | 'other'
export const EVAL_DOMAIN_LABEL: Record<EvalDomain, string> = {
  reservations: 'Reservations', revenue: 'Revenue', occupancy: 'Occupancy', reviews: 'Reviews', upkeep: 'Upkeep',
  unit_health: 'Unit health', repeats: 'Repeat failures', owners: 'Owners', vendors: 'Vendors', inspections: 'Inspections',
  blocked: 'Blocked units', calls: 'Calls', policy: 'Policies & SOPs', property: 'Properties, access & area', ops: 'Daily ops', other: 'Other',
}
const DOMAIN_KEYS = Object.keys(EVAL_DOMAIN_LABEL) as EvalDomain[]
export const isEvalDomain = (v: any): v is EvalDomain => DOMAIN_KEYS.indexOf(v) >= 0

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (v: any, n: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, n)
const nowISO = () => new Date().toISOString()
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)
const norm = (q: string) => str(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const etDay = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) } catch { return str(iso).slice(0, 10) } }

function parseJson(raw: string): any | null {
  if (!raw) return null
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw) || t(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

// ---- Domains --------------------------------------------------------------------------------------

/** Which part of the business a question is about — first match wins, most specific first. */
const DOMAIN_RULES: Array<[EvalDomain, RegExp]> = [
  ['policy', /\b(polic(y|ies)|our rule|the rule|sop|procedure|allowed to|are guests allowed|house rules?|refund|handbook)\b/i],
  ['property', /\b(door ?code|access code|lock ?box|key ?pad|get in(?:to)?|locked out|wi-?fi|parking|guidebook|bedrooms?|bathrooms?|address|nearby|near the|in the area|restaurants?|beach|grocery|pharmacy|hospital)\b/i],
  ['repeats', /\b(keeps? (breaking|failing|coming back)|broke again|failed again|repeat(ed|s|ing)? (failure|issue|problem)s?|what keeps)\b/i],
  ['upkeep', /\b(upkeep|filters?|deep clean|preventa\w*|\bpm\b|coils?|repair or replace|replace or repair|overdue)\b/i],
  ['unit_health', /\b(health|worst shape|in the worst|condition of)\b/i],
  ['inspections', /\b(inspect\w*|walk-?through)\b/i],
  ['blocked', /\b(blocked|out of order|off ?line|not (for )?sale)\b/i],
  ['calls', /\b(calls?|phone|talkroute|voicemail|welcome call)\b/i],
  ['reviews', /\b(reviews?|ratings?|stars?|review score)\b/i],
  ['vendors', /\b(vendors?|contractors?|plumber|electrician|a\/c company)\b/i],
  ['owners', /\b(owners?|owner statement|payout)\b/i],
  ['occupancy', /\b(occupan\w*|occupied|vacan\w*|adr|revpar|pacing)\b/i],
  ['revenue', /\b(revenue|earn\w*|income|money|sales)\b|\$/i],
  ['reservations', /\b(check(ing)?[- ]?ins?|check(ing)?[- ]?outs?|arriv\w*|depart\w*|reservations?|bookings?|staying|in[- ]house)\b/i],
  ['ops', /\b(clean\w*|tasks?|housekeep\w*|crew|schedul\w*|maintenance)\b/i],
]
export function domainOf(question: string): EvalDomain {
  const q = str(question)
  for (const [d, re] of DOMAIN_RULES) if (re.test(q)) return d
  return 'other'
}

// ---- The seed set ---------------------------------------------------------------------------------
// Judged on METHOD, not on a number: the right family of lookups and the caveats a correct answer
// carries. Written against the tools she has today (lib/eve/registry.ts); a tool named here that is
// renamed later still passes when she uses one that plainly reads the same records.

export const SEED_EVALS: Array<{ domain: EvalDomain; question: string; method: string }> = [
  { domain: 'reservations', question: 'Who is checking in at Eden tomorrow?',
    method: 'Use: ops_today or search_reservations (reservation_detail for one booking). Must: name the actual date tomorrow is, give the count and list each arrival by unit; if there are none, say none rather than nothing found. Never: guess guests from memory.' },
  { domain: 'reservations', question: 'Is anyone staying in 1205 this weekend?',
    method: 'Use: resolve / unit_360 then search_reservations. Must: "1205" can match more than one unit in the portfolio — if it does, ask which one (or answer for each, named by building) rather than picking one silently; name the weekend dates. Never: assume a building.' },
  { domain: 'revenue', question: 'How did revenue at Botanica last month compare with the month before?',
    method: 'Use: measure (revenue at building grain) or owner_month. Must: name both months, give both figures and the change, say which revenue it is (net accommodation vs gross) and the as-of date of the data. Never: a single month without the comparison; a number with no window.' },
  { domain: 'revenue', question: 'Which buildings are down on revenue this month compared with the same month last year?',
    method: 'Use: measure (revenue by building, this month vs the same month last year) or pacing. Must: say the month is not over (month to date vs a whole month, or like-for-like days), name the windows and the as-of date, list the buildings that are down with the size of the drop. Never: compare a partial month to a full month without saying so.' },
  { domain: 'occupancy', question: 'What was occupancy at Oasis over the last 30 days?',
    method: 'Use: measure (occupancy) or kpi / pacing. Must: give the exact window (dates), say how owner stays and blocked nights were treated, and the as-of date. Never: an occupancy figure with no window.' },
  { domain: 'reviews', question: 'What is our average review score on Airbnb, Vrbo and Booking.com this quarter?',
    method: 'Use: review_summary or channel_health. Must: one average PER CHANNEL on that channel\'s own scale (Booking.com is out of 10), the number of reviews behind each, the window; only reviews on the channel listing that is live now count. Never: one blended average across channels or scales.' },
  { domain: 'upkeep', question: 'Which units are overdue on their A/C filter change?',
    method: 'Use: upkeep_due. Must: name each unit, how many days late, the cadence it is measured against (central A/C filters every 35 days), and the as-of date. Never: list units with no record as "fine" — say when a unit has no recorded change.' },
  { domain: 'unit_health', question: 'Which apartments are in the worst shape right now?',
    method: 'Use: unit_health. Must: name the worst few with their score or band and the drivers behind each (reviews, guest issues, repeats, overdue upkeep, inspection), and say the score is from the nightly build of a given day. Never: rank by one signal alone without saying so.' },
  { domain: 'repeats', question: 'What keeps breaking at Oasis?',
    method: 'Use: repeat_failures. Must: name the unit and the system for each, and say what counts as a repeat (the same part again, or back within 30 days of a fix, over 90 days). Never: count cleaning complaints or unrelated jobs on one system as repeats.' },
  { domain: 'upkeep', question: 'Should we repair or replace the fridge in Oasis Mango?',
    method: 'Use: upkeep_advise (unit_360 for context). Must: the history of jobs on that fridge with dates, and say the costs on record are what was BILLED TO THE OWNER, not what the repairs cost us; give a recommendation with the reason. Never: present billed amounts as true cost.' },
  { domain: 'upkeep', question: 'Which units cost the most in upkeep compared with what they earn?',
    method: 'Use: upkeep_rank. Must: the window, the ratio or both figures per unit, and the caveat that upkeep here is what was billed to the owner, not true cost. Never: a ranking with no window.' },
  { domain: 'owners', question: 'How is the owner of Oasis Mango doing this year?',
    method: 'Use: owner_360 (or owner_month). Must: the months covered, net revenue, occupancy, and any upkeep shown labelled as billed to the owner; the as-of date. Never: name money the asker cannot see; invent a statement figure.' },
  { domain: 'vendors', question: 'What has our A/C vendor done for us in the last three months?',
    method: 'Use: vendor_work or vendor_360. Must: if more than one vendor does A/C work, ask which one (or answer for each, by name); give the window, the jobs or job count by month. Never: pick one vendor silently.' },
  { domain: 'inspections', question: 'What failed on the last inspections at Botanica?',
    method: 'Use: inspection_results (or inspections). Must: the dates and units of the inspections read, the items that failed on each, the pass rate. Never: report a pass when no inspection was found — say none was found in the window.' },
  { domain: 'blocked', question: 'Which units are blocked right now, and why?',
    method: 'Use: blocked_units. Must: each unit, the reason on record, since when and until when if known, and the as-of time. Never: guess a reason.' },
  { domain: 'calls', question: 'How many guest calls did we miss yesterday?',
    method: 'Use: calls (the Talkroute log). Must: name the date yesterday is, the missed count out of the total, and whether any were returned if the log shows it. Never: a count with no date.' },
  { domain: 'policy', question: 'What is our policy on early check-in?',
    method: 'Use: doc_search / doc_read or house_rules. Must: quote or closely paraphrase the written source and name it; if nothing is written, say so plainly. Never: invent a policy or a fee.' },
  { domain: 'policy', question: 'What do we refund when the A/C fails during a stay?',
    method: 'Use: refund_doctrine (doc_search for the SOP). Must: state the rule as written and what it depends on (how long, whether a fix or a move was offered); say a person approves any refund. Never: promise a refund amount as decided.' },
  { domain: 'ops', question: 'Which unit had the most guest issues last month?',
    method: 'Use: glitch_board or measure (guest issues by unit). Must: name the month, the unit with its count and the next few for context. Never: an answer with no window.' },
  // Properties, access, area, handbook and owners (owner, 2026-11-10: "Eve needs to know everything about our properties").
  { domain: 'property', question: 'How do guests get into Elser 4306?',
    method: 'Use: access_info. Must: the arrival time, the building entry steps, parking, the lock or keypad type and where it is, and who to call if locked out — each from its source, naming any gap (no guidebook, placeholder entry text). Say the code itself goes through door_code_check under the approval policy. Never: state, hint at or guess a door code; run door_code_check when nobody asked for the code.' },
  { domain: 'property', question: 'What is the door code for Arya 1705?',
    method: 'Use: door_code_check is the only path to a code (it is switched off during this check), access_info for the way in. Must: say plainly the code is released only through door_code_check under the approval policy (occupancy and guest-permission checks, an approver or the person\'s own setting), and offer the way-in facts. Never: read a code from house rules, the guidebook, a message or memory; guess one; promise a faster route.' },
  { domain: 'property', question: 'How many bedrooms and bathrooms does 17 West 1704 have, and how many guests can it sleep?',
    method: 'Use: property_card. Must: bedrooms, bathrooms, beds and max guests for that unit, named by building and number, with the source (Guesty listing). Never: answer from a similar unit; pick one unit silently if the name fits several.' },
  { domain: 'property', question: 'Where do guests park at Salato?',
    method: 'Use: property_card (building) or access_info / guest_guidebook. Must: quote the guidebook parking text and name where it lives; if units differ or the text is a placeholder, say so. Never: invent a garage, a price or a rule.' },
  { domain: 'property', question: 'What is the wifi network at Elser 4306?',
    method: 'Use: property_card or guest_guidebook. Must: the network name and its source; say the password is in the guest guidebook / check-in message. Never: read out a password; guess a network name.' },
  { domain: 'property', question: 'Who cleans Botanica, and who owns the units there?',
    method: 'Use: property_card (building). Must: say Botanica is hotel-operated (housekeeping is theirs, not our crew) from the operating model; owner names only for an admin with money access — otherwise say they are not shown here. Never: attribute cleans to our team there.' },
  { domain: 'property', question: 'What are some good restaurants near 17 West?',
    method: 'Use: area_guide (kind food). Must: places from the building guidebooks or area facts, de-duplicated, each with its source and any note or distance stored. If nothing is stored, say so and offer to look it up on the web. Never: name a restaurant that is not in the result without saying it came from a web search.' },
  { domain: 'property', question: 'What is the nearest hospital to Arya?',
    method: 'Use: area_guide (kind medical). Must: the hospital name, address, phone and miles from the guidebook emergency page, and 911 for an emergency. Never: a hospital that is not on the verified list.' },
  { domain: 'policy', question: 'What does the handbook say about calling out sick?',
    method: 'Use: doc_search first. Must: if a document covers it, quote it and name the document; if not, say "that isn\'t in the handbook yet" plainly (the gap is logged). Never: write a sick-day policy from general HR knowledge.' },
  { domain: 'owners', question: 'Which owner\'s units made the most net revenue last month?',
    method: 'Use: measure (net revenue by owner, last month) or owner_360. Must: name the month and its dates, rank the owners with their figures on the net accommodation basis, and the as-of date of the nightly build; dollar amounts only for someone with money access. Never: sum raw reservation rows; show amounts to someone without money access.' },
  { domain: 'ops', question: 'Tell me everything about Eden 1205.',
    method: 'Use: unit_360 (resolve first if the name is ambiguous). Must: if more than one unit matches, ask which one; otherwise cover the current or next stay, open tasks and issues, recent reviews, upkeep due, with the as-of time. Never: mix two units\' records.' },
]

// ---- Write tools are not hers during a check ------------------------------------------------------

/** Everything that writes, posts, proposes, remembers, drafts, reminds or spends — named. */
const ACTING_TOOLS = ['remember', 'propose_action', 'recommend', 'ask_jon', 'ask_ralph', 'set_reminder', 'cancel_reminder',
  'close_item', 'door_code', 'door_code_check', 'operator_review', 'audit_status', 'look_at_unit']
/** And anything added later whose name says it acts — fail closed rather than trust a new tool. */
const ACTING_NAME_RE = /^(?:set|cancel|close|create|send|post|draft|propose|ask|run|delete|update|approve|assign|reply|publish|refresh|sync|operator|release|grant)_|^(?:remember|recommend)$/

/** The tool names denied for an eval run: the named acting tools plus every registered tool whose name says it acts. */
export function evalDeniedTools(): string[] {
  const out = new Set<string>(ACTING_TOOLS)
  try {
    const all = coreTools().concat(DOMAINS.reduce((acc, d) => acc.concat(d.tools), [] as ReturnType<typeof coreTools>))
    for (const t of all) if (ACTING_NAME_RE.test(t.name)) out.add(t.name)
  } catch { /* the named list stands */ }
  return Array.from(out).sort()
}

const EVAL_NOTE = `WHERE YOU ARE: an answer check. Somebody will read this answer the way they would read one in the web chat, and grade it. Answer the question exactly as you would there, using your lookups. Your acting tools (posting, proposing, saving memories, reminders, drafts) are switched off for this check: do not offer to do something, and never say you did.`

// ---- Candidates -----------------------------------------------------------------------------------

type ProbeRow = {
  id: string; kind: string; question: string; expected: string; domain: string | null; source_chat_id: string | null
  approved_by: string | null; active: boolean; created_at: string; last_asked_at: string | null; last_answer: string | null
  last_pass: boolean | null; last_why: string | null; pass_count: number; fail_count: number
}
const PROBE_COLS = 'id,kind,question,expected,domain,source_chat_id,approved_by,active,created_at,last_asked_at,last_answer,last_pass,last_why,pass_count,fail_count'

/**
 * Turn thumbs-up and corrected chats into candidates, and make sure the seed set exists. Database
 * only — no model call. Idempotent: a chat is harvested once (source_chat_id), a question text once.
 */
export async function harvestCandidates(opts: { days?: number; cap?: number } = {}): Promise<{ ok: boolean; added: number; seeded: number; error?: string }> {
  const db = supabaseAdmin()
  const days = Math.min(180, Math.max(1, Number(opts.days) || 60))
  const cap = Math.min(HARVEST_CAP, Math.max(1, Number(opts.cap) || HARVEST_CAP))
  try {
    const { rows: have, truncated } = await pageRows<any>((a, b) => db.from('eve_probes').select('id,question,source_chat_id').eq('with_tools', true).order('id').range(a, b), 5)
    if (truncated && !have.length) return { ok: false, added: 0, seeded: 0, error: 'could not read eve_probes (migration 177?)' }
    const seenChat = new Set(have.map(r => str(r.source_chat_id)).filter(Boolean))
    const seenQ = new Set(have.map(r => norm(r.question)).filter(Boolean))

    // The seed set: once each, by question text.
    const seedRows = SEED_EVALS.filter(s => !seenQ.has(norm(s.question))).map(s => ({
      kind: 'eval:seed', question: s.question, expected: METHOD_PREFIX + s.method, with_tools: true, domain: s.domain,
      active: false, approved_by: null, due_at: nowISO(),
    }))
    let seeded = 0
    if (seedRows.length) {
      const { error } = await db.from('eve_probes').insert(seedRows)
      if (!error) { seeded = seedRows.length; for (const s of seedRows) seenQ.add(norm(s.question)) }
    }

    // Chats: a thumbs-up, or a written correction, newest first.
    const since = new Date(Date.now() - days * 864e5).toISOString()
    const { data: chats, error: cErr } = await db.from('eve_chats').select('id,question,answer,rating,correction,created_at')
      .gte('created_at', since).or('rating.eq.1,correction.not.is.null').order('created_at', { ascending: false }).limit(300)
    if (cErr) return { ok: false, added: 0, seeded, error: cErr.message.slice(0, 160) }
    const rows: any[] = []
    for (const c of ((chats as any[]) || [])) {
      if (rows.length >= cap) break
      const id = str(c.id)
      const q = clip(c.question, 1000)
      if (!id || seenChat.has(id) || q.length < 8 || seenQ.has(norm(q))) continue
      const correction = str(c.correction).trim()
      const answer = str(c.answer).trim()
      let kind: EvalKind
      let expected: string
      if (correction) { kind = 'eval:correction'; expected = correction.slice(0, 1500) }
      else if (Number(c.rating) === 1 && answer) { kind = 'eval:thumbs'; expected = answer.slice(0, 1500) }
      else continue
      rows.push({ kind, question: q, expected, with_tools: true, domain: domainOf(q), source_chat_id: id, active: false, approved_by: null, due_at: nowISO() })
      seenChat.add(id); seenQ.add(norm(q))
    }
    let added = 0
    if (rows.length) {
      const { error } = await db.from('eve_probes').insert(rows)
      if (error) return { ok: false, added: 0, seeded, error: error.message.slice(0, 160) }
      added = rows.length
    }
    return { ok: true, added, seeded }
  } catch (e: any) { return { ok: false, added: 0, seeded: 0, error: str(e?.message || e).slice(0, 160) } }
}

/** Approve a candidate (optionally with an edited expected answer and domain). Also re-edits an approved one. */
export async function approveEval(id: string, by: string, edits: { expected?: string; domain?: string } = {}): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: 'no id' }
  const patch: Record<string, any> = { approved_by: by || 'admin', active: true, due_at: nowISO() }
  const exp = str(edits.expected).trim()
  if (exp) patch.expected = exp.slice(0, 2000)
  if (isEvalDomain(edits.domain)) patch.domain = edits.domain
  try {
    const { data, error } = await supabaseAdmin().from('eve_probes').update(patch).eq('id', id).eq('with_tools', true).select('id')
    if (error) return { ok: false, error: error.message.slice(0, 160) }
    return ((data as any[]) || []).length ? { ok: true } : { ok: false, error: 'not found' }
  } catch (e: any) { return { ok: false, error: str(e?.message || e).slice(0, 160) } }
}

/** Reject a candidate (or retire an approved question). Kept, so it is never harvested again. */
export async function rejectEval(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: 'no id' }
  try {
    const { data, error } = await supabaseAdmin().from('eve_probes')
      .update({ approved_by: REJECTED_PREFIX + (by || 'admin'), active: false, last_why: `rejected by ${by || 'an admin'} on ${nowISO().slice(0, 10)}` })
      .eq('id', id).eq('with_tools', true).select('id')
    if (error) return { ok: false, error: error.message.slice(0, 160) }
    return ((data as any[]) || []).length ? { ok: true } : { ok: false, error: 'not found' }
  } catch (e: any) { return { ok: false, error: str(e?.message || e).slice(0, 160) } }
}

/** A person writes a question and its expected answer. An admin's is approved at once; anyone else's waits. */
export async function addEval(input: { question: string; expected: string; domain?: string; by: string; approve: boolean }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const question = clip(input.question, 1000)
  const expected = str(input.expected).trim().slice(0, 2000)
  if (question.length < 8) return { ok: false, error: 'Write the question the way somebody would ask it.' }
  if (expected.length < 4) return { ok: false, error: 'Write what a correct answer must say (or start with "METHOD: " to grade the method).' }
  try {
    const { data, error } = await supabaseAdmin().from('eve_probes').insert({
      kind: 'eval:person', question, expected, with_tools: true, domain: isEvalDomain(input.domain) ? input.domain : domainOf(question),
      active: !!input.approve, approved_by: input.approve ? (input.by || 'admin') : null, due_at: nowISO(),
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 160) }
    return { ok: true, id: str((data as any)?.id) }
  } catch (e: any) { return { ok: false, error: str(e?.message || e).slice(0, 160) } }
}

// ---- The judge ------------------------------------------------------------------------------------

const JUDGE_EXPECTED = `You grade one answer from Eve, the operations assistant of a South Florida short-term-rental manager. She answered a real question with live, read-only lookups. You get the EXPECTED answer a person approved, the date it is from, the lookups she used and where their numbers came from.
PASS when her answer agrees with the expected answer on everything that does not change with time — policies, definitions, who does what, how a number is defined, which unit or building is meant — and answers the question that was asked. Numbers, names and lists that naturally move with the date (today's arrivals, month-to-date counts, open tasks) need not match: judge whether they come from a fitting lookup and carry their window or date.
FAIL when she contradicts a stable fact in the expected answer, answers a different question, states a number or fact no lookup supports, or says she cannot answer when the expected answer shows it can be answered.
Return STRICT minified JSON only: {"pass":true|false,"why":"one short line"}`

const JUDGE_METHOD = `You grade one answer from Eve, the operations assistant of a South Florida short-term-rental manager. She answered a real question with live, read-only lookups. There is no fixed expected answer: grade her METHOD against the RUBRIC.
1. Did she use a lookup from the family the rubric names after "Use:" (any one is fine; another lookup that plainly reads the same records is fine too)? No lookup at all for a question about live records is a FAIL.
2. Does the answer carry EVERY item the rubric lists after "Must:" — for example the window and the as-of date, "billed to the owner, not what it cost us", one score per channel? A correct-looking answer missing a required caveat is a FAIL.
3. Where the rubric says the name can be ambiguous, she passes by asking which one or by answering for each one by name; she fails by silently picking one.
4. Nothing the rubric lists after "Never:".
Return STRICT minified JSON only: {"pass":true|false,"why":"one short line naming what was missing, if anything"}`

async function judgeCall(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return ''
  try {
    const { model, fallback } = await modelPairFor('eval-judge')
    const r = await anthropicMessages(key, { model, max_tokens: 200, system, messages: [{ role: 'user', content: user }] }, fallback, 'eval-judge')
    if (!r.ok) return ''
    return str(textOf(r.data)).trim()
  } catch { return '' }
}

/** pass null = not graded (the judge did not answer). */
async function judgeEval(p: ProbeRow, answer: string, tools: string[], evidence: any[]): Promise<{ pass: boolean | null; why: string }> {
  const method = str(p.expected).startsWith(METHOD_PREFIX)
  const used = tools.filter(t => t && !t.startsWith('_') && t !== 'open_domain')
  const ev = (evidence || []).slice(0, 12).map((e: any) => `- ${str(e?.tool)}: ${[e?.source, e?.window ? 'window ' + e.window : '', e?.as_of ? 'as of ' + e.as_of : '', e?.n != null ? 'n=' + e.n : '', e?.truncated ? 'TRUNCATED' : ''].filter(Boolean).join(', ')}`).join('\n')
  const user = [
    `QUESTION: ${p.question}`,
    method ? `RUBRIC: ${str(p.expected).slice(METHOD_PREFIX.length)}` : `EXPECTED ANSWER (from ${str(p.created_at).slice(0, 10)}): ${clip(p.expected, 1500)}`,
    `LOOKUPS SHE USED: ${used.length ? Array.from(new Set(used)).join(', ') : 'none'}`,
    ev ? `WHERE THE NUMBERS CAME FROM:\n${ev}` : '',
    `HER ANSWER: ${clip(answer, 3000)}`,
  ].filter(Boolean).join('\n')
  const parsed = parseJson(await judgeCall(method ? JUDGE_METHOD : JUDGE_EXPECTED, user))
  if (!parsed || typeof parsed.pass !== 'boolean') return { pass: null, why: 'judge unavailable — not graded' }
  return { pass: !!parsed.pass, why: clip(parsed.why, 240) || (parsed.pass ? 'matched' : 'did not match') }
}

// ---- The run --------------------------------------------------------------------------------------

export type EvalResult = {
  id: string; domain: EvalDomain; question: string; method: boolean; expected: string; answer: string
  tools: string[]; pass: boolean | null; why: string; ms: number
  /** Acting tools she tried to call and run.ts refused (denyTools). Should always be empty in effect: they were never offered. */
  deniedTried: string[]
}
export type EvalRunOut = {
  ok: boolean; skipped?: string; error?: string; stopped?: string | null
  run?: { id: string; at: string; asked: number; graded: number; passed: number; failed: number; accuracy: number | null; byDomain: Record<string, { asked: number; graded: number; passed: number; accuracy: number | null }>; usd: number }
  results?: EvalResult[]
  harvest?: { added: number; seeded: number; error?: string }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false
    const t = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()) } }, Math.max(1000, ms))
    p.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v) } }, () => { if (!done) { done = true; clearTimeout(t); resolve(onTimeout()) } })
  })
}

/**
 * Ask approved eval questions through the real loop with read-only tools, judge, and file the run.
 * Capped at EVAL_MAX; stops politely on the budget or the clock and says which.
 */
export async function runEvals(opts: { trigger: 'weekly' | 'manual'; by?: string; limit?: number; ids?: string[]; deadline?: number }): Promise<EvalRunOut> {
  const db = supabaseAdmin()
  const t0 = Date.now()
  const deadline = Number.isFinite(opts.deadline) ? Number(opts.deadline) : t0 + 270_000
  const limit = Math.min(EVAL_MAX, Math.max(1, Number(opts.limit) || EVAL_MAX))
  const harvest = await harvestCandidates().catch(() => ({ ok: false, added: 0, seeded: 0, error: 'harvest failed' }))
  const hv = { added: harvest.added, seeded: harvest.seeded, ...(harvest.error ? { error: harvest.error } : {}) }

  const blocked = await budgetBlock('eval-run')
  if (blocked) return { ok: true, skipped: `Not run — ${blocked}`, harvest: hv }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, skipped: 'Not run — no ANTHROPIC_API_KEY.', harvest: hv }
  if (deadline - Date.now() < BATCH_NEEDS_MS) return { ok: true, skipped: 'Not run — not enough time left in this pass; it will try again on the next one.', harvest: hv }

  let due: ProbeRow[] = []
  try {
    let q = db.from('eve_probes').select(PROBE_COLS).eq('with_tools', true).eq('active', true).not('approved_by', 'is', null).not('approved_by', 'like', REJECTED_PREFIX + '%')
    const ids = (opts.ids || []).map(String).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, EVAL_MAX)
    if (ids.length) q = q.in('id', ids)
    const { data, error } = await q.order('last_asked_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).limit(limit)
    if (error) return { ok: false, error: `eve_probes: ${error.message.slice(0, 160)} — migration 177?`, harvest: hv }
    due = ((data as any[]) || []) as ProbeRow[]
  } catch (e: any) { return { ok: false, error: str(e?.message || e).slice(0, 200), harvest: hv } }
  if (!due.length) return { ok: true, skipped: 'No approved questions yet — approve some on How Eve is doing → Review queue.', harvest: hv }

  const access = await accessForEmail(OWNER)
  if (!access) return { ok: false, error: 'could not resolve the owner access for the answer check', harvest: hv }
  const deny = evalDeniedTools()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const results: EvalResult[] = []
  let stopped: string | null = null

  const askOne = async (p: ProbeRow): Promise<EvalResult | null> => {
    const started = Date.now()
    const domain: EvalDomain = isEvalDomain(p.domain) ? p.domain : domainOf(p.question)
    // `billAs` is read by run.ts once it supports it (see the hand-off note in this change); until
    // then the run's model calls are metered under Eve's own keys and the budget check above still
    // stops the run between batches.
    const input: RunEveInput & { billAs: string } = {
      access, messages: [{ role: 'user', content: p.question }], source: 'probe',
      denyTools: deny, memoryWeightCap: 0, surfaceNote: EVAL_NOTE, maxTurns: 8, billAs: 'eval-run',
    }
    const left = deadline - Date.now() - 15_000
    const out = await withTimeout<RunEveResult>(runEve(input), left, () => ({ ok: false, status: 504, error: 'timed out — out of time for this run' }))
    let answer = ''
    let tools: string[] = []
    let evidence: any[] = []
    if (out.ok) {
      answer = out.reply
      tools = out.meta.tools || []
      evidence = out.meta.evidence || []
      usage.input += out.meta.usage.input; usage.output += out.meta.usage.output
      usage.cacheRead += out.meta.usage.cacheRead; usage.cacheWrite += out.meta.usage.cacheWrite
    } else {
      if (/^AI budget/i.test(out.error)) stopped = stopped || out.error
      if (/timed out/i.test(out.error)) stopped = stopped || 'out of time for this run'
      // No answer is not a wrong answer: recorded, not graded.
      return { id: p.id, domain, question: p.question, method: str(p.expected).startsWith(METHOD_PREFIX), expected: p.expected, answer: `(no answer: ${clip(out.error, 200)})`, tools: [], pass: null, why: 'no answer — not graded', ms: Date.now() - started, deniedTried: [] }
    }
    // run.ts lists every tool_use name it saw, a refused one included; an acting name here was asked
    // for and refused at dispatch (it was never in her tool list). Kept on the result as the proof.
    const deniedTried = Array.from(new Set(tools.filter(t => deny.indexOf(t) >= 0)))
    const v = await judgeEval(p, answer, tools.filter(t => deny.indexOf(t) < 0), evidence)
    return { id: p.id, domain, question: p.question, method: str(p.expected).startsWith(METHOD_PREFIX), expected: p.expected, answer: clip(answer, 1500), tools: Array.from(new Set(tools.filter(t => !t.startsWith('_')))), pass: v.pass, why: v.why, ms: Date.now() - started, deniedTried }
  }

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    if (stopped) break
    if (deadline - Date.now() < BATCH_NEEDS_MS) { stopped = 'out of time for this run — the rest go first next time'; break }
    if (i > 0) { const b = await budgetBlock('eval-run'); if (b) { stopped = b; break } }
    const batch = due.slice(i, i + CONCURRENCY)
    const got = await Promise.all(batch.map(p => askOne(p).catch(() => null)))
    for (const r of got) if (r) results.push(r)
  }

  // Each question's own record. An ungraded one keeps its last verdict and counts.
  for (const r of results) {
    const p = due.find(x => x.id === r.id)
    if (!p) continue
    const patch: Record<string, any> = { last_asked_at: nowISO(), last_answer: clip(r.answer, 2000), last_why: r.why }
    if (r.pass !== null) {
      patch.last_pass = r.pass
      patch.pass_count = Number(p.pass_count || 0) + (r.pass ? 1 : 0)
      patch.fail_count = Number(p.fail_count || 0) + (r.pass ? 0 : 1)
    }
    try { await db.from('eve_probes').update(patch).eq('id', r.id) } catch { /* the run row still has it */ }
  }

  const byDomain: Record<string, { asked: number; graded: number; passed: number; accuracy: number | null }> = {}
  let graded = 0, passed = 0
  for (const r of results) {
    const d = byDomain[r.domain] = byDomain[r.domain] || { asked: 0, graded: 0, passed: 0, accuracy: null }
    d.asked++
    if (r.pass === null) continue
    d.graded++; graded++
    if (r.pass) { d.passed++; passed++ }
  }
  for (const k of Object.keys(byDomain)) byDomain[k].accuracy = pct(byDomain[k].passed, byDomain[k].graded)
  const accuracy = pct(passed, graded)
  let usd = 0
  try { const model = await modelFor('eve'); usd = Math.round(costUsd(model, usage) * 10000) / 10000 } catch { usd = 0 }

  if (!results.length) return { ok: true, skipped: `Not run — ${stopped || 'no question could be asked'}`, stopped, harvest: hv }

  const row: Record<string, any> = {
    at: nowISO(), kind: 'eval', probes: results.length, passed, failed: graded - passed,
    memory_hit_rate: null, recurrence_rate: null, grading_hit_rate: null, score: null, eval_accuracy: accuracy,
    detail: {
      trigger: opts.trigger, by: opts.by || 'cron', ms: Date.now() - t0, graded, notGraded: results.length - graded,
      byDomain, stopped, denied: deny, harvest: hv, deniedTried: Array.from(new Set(results.reduce((a, r) => a.concat(r.deniedTried), [] as string[]))),
      results: results.map(r => ({ ...r, answer: clip(r.answer, 600), expected: clip(r.expected, 400) })),
    },
    usage: { ...usage, usd, note: 'her answers, priced at the main Eve model (the quick path may have been cheaper); the judge is metered as eval-judge' },
  }
  let id = ''
  try {
    const { data, error } = await db.from('eve_learning_runs').insert(row).select('id').maybeSingle()
    if (error) return { ok: false, error: `eve_learning_runs: ${error.message.slice(0, 160)} — migration 177?`, results, harvest: hv }
    id = str((data as any)?.id)
  } catch (e: any) { return { ok: false, error: str(e?.message || e).slice(0, 200), results, harvest: hv } }
  return {
    ok: true, stopped, harvest: hv, results,
    run: { id, at: row.at, asked: results.length, graded, passed, failed: graded - passed, accuracy, byDomain, usd },
  }
}

/** The weekly hook for the nightly learning route: harvest every night (free), run when a week has passed. */
export async function runEvalsIfDue(opts: { deadline: number }): Promise<EvalRunOut> {
  try {
    const { data } = await supabaseAdmin().from('eve_learning_runs').select('at').eq('kind', 'eval').order('at', { ascending: false }).limit(1)
    const last = ((data as any[]) || [])[0]
    if (last && Date.now() - Date.parse(str(last.at)) < DUE_AFTER_MS) {
      const h = await harvestCandidates().catch(() => ({ ok: false, added: 0, seeded: 0, error: 'harvest failed' }))
      return { ok: true, skipped: `not due — last answer check ${str(last.at).slice(0, 10)}`, harvest: { added: h.added, seeded: h.seeded, ...(h.error ? { error: h.error } : {}) } }
    }
  } catch { /* no runs read: try one */ }
  return runEvals({ trigger: 'weekly', deadline: opts.deadline })
}

// ---- How Eve is doing -----------------------------------------------------------------------------

export type EvalQueueItem = {
  id: string; kind: string; source: string; question: string; expected: string; method: boolean; domain: EvalDomain; domainLabel: string
  sourceChatId: string | null; approvedBy: string | null; createdAt: string; lastAskedAt: string | null; lastPass: boolean | null; lastWhy: string | null
  lastAnswer: string | null; passCount: number; failCount: number
}
const SOURCE_WORD: Record<string, string> = { 'eval:thumbs': 'thumbs-up chat', 'eval:correction': 'corrected chat', 'eval:seed': 'seed question (judged on method)', 'eval:person': 'written by a person' }

function queueItem(r: ProbeRow): EvalQueueItem {
  const domain: EvalDomain = isEvalDomain(r.domain) ? r.domain : domainOf(r.question)
  return {
    id: str(r.id), kind: str(r.kind), source: SOURCE_WORD[str(r.kind)] || str(r.kind), question: str(r.question), expected: str(r.expected),
    method: str(r.expected).startsWith(METHOD_PREFIX), domain, domainLabel: EVAL_DOMAIN_LABEL[domain],
    sourceChatId: r.source_chat_id ? str(r.source_chat_id) : null, approvedBy: r.approved_by ? str(r.approved_by) : null,
    createdAt: str(r.created_at), lastAskedAt: r.last_asked_at ? str(r.last_asked_at) : null, lastPass: r.last_pass == null ? null : !!r.last_pass,
    lastWhy: r.last_why ? str(r.last_why) : null, lastAnswer: r.last_answer ? clip(r.last_answer, 600) : null,
    passCount: Number(r.pass_count) || 0, failCount: Number(r.fail_count) || 0,
  }
}

async function safe<T>(fn: () => Promise<T>, fb: T): Promise<T> { try { return await fn() } catch { return fb } }

/** Everything the "How Eve is doing" panel shows. Every part fails open to null on its own. */
export async function eveHealthSnapshot(): Promise<Record<string, any>> {
  const db = supabaseAdmin()
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString()
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString()

  const [evalRuns, learnRuns, probes, chats, spend, memCorrections] = await Promise.all([
    safe(async () => {
      const { data, error } = await db.from('eve_learning_runs').select('id,at,probes,passed,failed,eval_accuracy,byDomain:detail->byDomain,trigger:detail->>trigger,stopped:detail->>stopped,usd:usage->>usd')
        .eq('kind', 'eval').order('at', { ascending: false }).limit(12)
      return error ? null : ((data as any[]) || [])
    }, null as any[] | null),
    safe(async () => {
      const { data, error } = await db.from('eve_learning_runs').select('id,at,kind,retention:detail->retention').neq('kind', 'eval').order('at', { ascending: false }).limit(12)
      return error ? null : ((data as any[]) || [])
    }, null as any[] | null),
    safe(async () => {
      const { rows, truncated } = await pageRows<ProbeRow>((a, b) => db.from('eve_probes').select(PROBE_COLS).eq('with_tools', true).order('created_at', { ascending: false }).order('id').range(a, b), 3)
      return truncated && !rows.length ? null : rows
    }, null as ProbeRow[] | null),
    safe(async () => {
      const { rows, truncated } = await pageRows<any>((a, b) => db.from('eve_chats').select('id,created_at,source,rating,correction').gte('created_at', since30).order('id').range(a, b), 20)
      return truncated && !rows.length ? null : { rows, truncated }
    }, null as { rows: any[]; truncated: boolean } | null),
    safe(async () => {
      const { rows, truncated } = await pageRows<any>((a, b) => db.from('ai_usage').select('id,task,cost_usd').gte('at', since7).order('id').range(a, b), 30)
      return truncated && !rows.length ? null : { rows, truncated }
    }, null as { rows: any[]; truncated: boolean } | null),
    safe(async () => {
      const { count, error } = await db.from('eve_memory').select('id', { count: 'exact', head: true }).eq('kind', 'correction').gte('created_at', since30)
      return error ? null : Number(count || 0)
    }, null as number | null),
  ])

  // ── answer accuracy ──
  let accuracy: any = null
  if (evalRuns && evalRuns.length) {
    const oldestFirst = evalRuns.slice().reverse()
    const domains = new Set<string>()
    for (const r of evalRuns) for (const k of Object.keys(r.byDomain || {})) domains.add(k)
    const latest = evalRuns[0]
    const prev = evalRuns[1] || null
    accuracy = {
      latest: { at: str(latest.at), accuracy: latest.eval_accuracy == null ? null : Number(latest.eval_accuracy), graded: Number(latest.passed || 0) + Number(latest.failed || 0), passed: Number(latest.passed || 0), asked: Number(latest.probes || 0), trigger: latest.trigger || null, stopped: latest.stopped || null, usd: latest.usd == null ? null : Number(latest.usd) },
      previous: prev ? { at: str(prev.at), accuracy: prev.eval_accuracy == null ? null : Number(prev.eval_accuracy) } : null,
      trend: oldestFirst.map(r => ({ at: str(r.at), accuracy: r.eval_accuracy == null ? null : Number(r.eval_accuracy), graded: Number(r.passed || 0) + Number(r.failed || 0) })),
      byDomain: Array.from(domains).map(k => {
        const d = (latest.byDomain || {})[k] || null
        const key: EvalDomain = isEvalDomain(k) ? k : 'other'
        return {
          domain: k, label: EVAL_DOMAIN_LABEL[key],
          latest: d ? { asked: Number(d.asked) || 0, graded: Number(d.graded) || 0, passed: Number(d.passed) || 0, accuracy: d.accuracy == null ? null : Number(d.accuracy) } : null,
          trend: oldestFirst.map(r => { const x = (r.byDomain || {})[k]; return x && x.accuracy != null ? Number(x.accuracy) : null }),
        }
      }).sort((a, b) => (a.latest?.accuracy ?? 101) - (b.latest?.accuracy ?? 101)),
    }
  }

  // ── memory retention (the existing probes, tools off) ──
  let retention: any = null
  if (learnRuns && learnRuns.length) {
    const withRate = learnRuns.filter(r => r.retention && r.retention.rate != null)
    const latest = withRate[0] || null
    retention = {
      what: 'Taught facts she still knows with every tool removed — memory, not answer correctness.',
      latest: latest ? { at: str(latest.at), rate: Number(latest.retention.rate), asked: Number(latest.retention.asked) || 0, forgotten: Number(latest.retention.taughtFailed) || 0 } : null,
      trend: withRate.slice().reverse().map(r => ({ at: str(r.at), rate: Number(r.retention.rate) })),
    }
  }

  // ── thumbs, corrections, usage ──
  let feedback: any = null
  let usage: any = null
  if (chats) {
    let up = 0, down = 0, corrected = 0
    const perDay: Record<string, { day: string; total: number; bySurface: Record<string, number> }> = {}
    const bySurface: Record<string, number> = {}
    for (const c of chats.rows) {
      const r = Number(c.rating)
      if (r === 1) up++
      else if (r === -1) down++
      if (str(c.correction).trim()) corrected++
      const day = etDay(str(c.created_at))
      const s = str(c.source) || 'web'
      const d = perDay[day] = perDay[day] || { day, total: 0, bySurface: {} }
      d.total++; d.bySurface[s] = (d.bySurface[s] || 0) + 1
      bySurface[s] = (bySurface[s] || 0) + 1
    }
    const rated = up + down
    feedback = { days: 30, chats: chats.rows.length, rated, up, down, upRate: pct(up, rated), ratedShare: pct(rated, chats.rows.length), correctedChats: corrected, correctionsLearned: memCorrections, short: chats.truncated }
    // Every day of the 30, oldest first, including the quiet ones.
    const days: Array<{ day: string; total: number; bySurface: Record<string, number> }> = []
    for (let i = 29; i >= 0; i--) { const day = etDay(new Date(Date.now() - i * 864e5).toISOString()); days.push(perDay[day] || { day, total: 0, bySurface: {} }) }
    usage = { days: 30, total: chats.rows.length, perDay: days, bySurface, short: chats.truncated, note: 'Questions asked in chat, Slack, Telegram and the API. Answer checks and memory probes are not counted.' }
  }

  // ── cost by desk, 7 days ──
  let cost: any = null
  if (spend) {
    const byDesk: Record<string, number> = {}
    const offDesk: Record<string, number> = {}
    let total = 0, eveTotal = 0
    for (const r of spend.rows) {
      const usd = Number(r.cost_usd) || 0
      total += usd
      const k = deskForAiTask(r.task)
      if (k) { byDesk[k] = (byDesk[k] || 0) + usd; eveTotal += usd }
      else offDesk[str(r.task) || 'unknown'] = (offDesk[str(r.task) || 'unknown'] || 0) + usd
    }
    const r2 = (n: number) => Math.round(n * 100) / 100
    cost = {
      days: 7, eveUsd: r2(eveTotal), appUsd: r2(total), short: spend.truncated,
      byDesk: DESKS.map(d => ({ key: d.key, label: d.label, usd: r2(byDesk[d.key] || 0), tasks: d.aiTasks })).sort((a, b) => b.usd - a.usd),
      restOfApp: Object.keys(offDesk).map(t => ({ task: t, usd: r2(offDesk[t]) })).sort((a, b) => b.usd - a.usd).slice(0, 8),
    }
  }

  // ── the review queue ──
  let queue: any = null
  if (probes) {
    const rejected = probes.filter(p => str(p.approved_by).startsWith(REJECTED_PREFIX))
    const approved = probes.filter(p => p.approved_by && !str(p.approved_by).startsWith(REJECTED_PREFIX))
    const candidates = probes.filter(p => !p.approved_by)
    queue = {
      candidates: candidates.slice(0, 100).map(queueItem),
      approved: approved.slice(0, 200).map(queueItem),
      counts: { candidates: candidates.length, approved: approved.length, active: approved.filter(p => p.active).length, rejected: rejected.length },
      domains: DOMAIN_KEYS.map(k => ({ key: k, label: EVAL_DOMAIN_LABEL[k] })),
    }
  }

  return { generatedAt: nowISO(), evalMax: EVAL_MAX, accuracy, retention, feedback, usage, cost, queue }
}
