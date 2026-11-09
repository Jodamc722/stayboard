// ONE EVE. This is the agent loop — the actual thinking — lifted out of app/api/agent/route.ts so
// that every surface she appears on is the SAME Eve.
//
// WHY THIS FILE EXISTS. On 2026-08-21 we found three Eves: the /eve workspace, a BrainChat pill and
// a BrainConsole, each with its own prompt, its own tools and its own idea of what she remembered.
// Two of them were years behind the third and nobody could tell which one they were talking to.
// That was a UI problem. Putting Telegram on a copy of this loop would have been the same problem
// again, except server-side and invisible — a Telegram Eve quietly missing the tool domain, the
// memory or the money gate that the web Eve got last week.
//
// So: the route is now a thin wrapper around runEve(), Telegram calls the same runEve(), and
// anything added here — a tool, a rule, a memory behaviour — is live on every surface at once.
//
// The ONLY thing a caller varies is WHO is asking (an Access) and WHERE the question came from.
// Permissions, money redaction and memory all follow from the Access, never from the surface.
import 'server-only'
import { canSeeMoney, isSuperadmin } from '@/lib/access'
import type { Access } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildCtx, todayET, daysAgoISO, safe, count as cnt, lc } from './ctx'
import { wireTools, runTool, DOMAIN_KEYS } from './registry'
import { guessDomains } from './domain-guess'
import { loadMemories, renderMemories, touchMemories, scopesForText, saveMemory, memoryHitsFor, recordMemoryHits, STAFF_MAX_WEIGHT } from './memory'
import { teacherFor, identityOfAccess, teacherSource, type Teacher } from './teachers'
import { appAtlas } from './atlas'
import { buildSystemBlocks, getVoiceProfile, nowET } from './prompt'
import { detectLanguage, languageNote, getLingo, lingoNote } from './voice'
import { getOperatingModel, renderOperatingModel } from './operating-model'
import { modelFor, modelPairFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { getAgentSettings, normalizeAgentSettings, renderAgentModeForPrompt, agentAllowed } from './agent-mode'
import { maskMoneyText, scrubStoredText, scrubReleasedInValue, isGuestOrPersonMemory } from './redact'

// MODEL is resolved per request via modelFor('eve') — see lib/ai-models (editable on Users & admin).

// Anthropic's SERVER-SIDE web search. Jon asked Eve to "connect to internet and study trends in
// south florida" — this is the supported way. Verified against the tool reference (Aug 2026):
// type `web_search_20250305`, name `web_search`, NO anthropic-beta header, and it lives in the same
// tools array as our own client tools.
//
// It does NOT emit `tool_use` blocks — it emits `server_tool_use` + `web_search_tool_result` — so
// the dispatch loop below never mistakes a search for one of our tools.
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 6,
  user_location: { type: 'approximate', city: 'Miami', region: 'Florida', country: 'US', timezone: 'America/New_York' },
}
const MAX_TURNS = 16
/**
 * A copy of the conversation with a cache breakpoint on its newest block. The API caches the
 * prefix up to a breakpoint, so marking the LAST block means the entire conversation so far is
 * served from cache on the next turn. Strings become single text blocks; tool_result arrays get
 * the marker on their final entry. The original array is never mutated — it is the loop's state.
 */
let _busy: { at: number; v: boolean } | null = null
async function eveWasBusy(db: any): Promise<boolean> {
  if (_busy && Date.now() - _busy.at < 60_000) return _busy.v
  let v = false
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString()
    const { data } = await db.from('ai_usage').select('id').eq('task', 'eve').gte('at', since).limit(1)
    v = Array.isArray(data) && data.length > 0
  } catch { v = false }
  _busy = { at: Date.now(), v }
  return v
}

function withCacheBreakpoint(convo: any[]): any[] {
  if (!convo.length) return convo
  const out = convo.slice()
  const last = out[out.length - 1]
  if (typeof last.content === 'string') {
    out[out.length - 1] = { ...last, content: [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }] }
  } else if (Array.isArray(last.content) && last.content.length) {
    const blocks = last.content.slice()
    const tail = blocks[blocks.length - 1]
    // Only block types that accept cache_control: text and tool_result. Assistant content that
    // ends in a tool_use block (the previous model turn) is left alone.
    if (tail && (tail.type === 'text' || tail.type === 'tool_result')) {
      blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } }
      out[out.length - 1] = { ...last, content: blocks }
    }
  }
  return out
}

// Tool results are fitted to 9,000 characters in registry.runTool (lib/eve/fit.ts) — whole JSON,
// with a `_cut` note naming each list it shortened — never sliced mid-record here.

/**
 * May this person use Eve at all? Owner, anyone with role=admin, or a DB role explicitly granted
 * `eve` from /users → Roles. ONE definition, because the web route and the Telegram bridge must
 * never disagree about who she talks to.
 *
 * Deliberately NOT the legacy workspace path: a legacy "gm" workspace resolves every page to full,
 * which would hand Eve to people Jon has not switched on. An explicit accessRole is required.
 */
export function canUseEve(access: Access): boolean {
  const byRole = !!access.accessRole && atLeast(access.levels?.eve, 'view')
  return isSuperadmin(access.email) || access.role === 'admin' || byRole
}

export type EveMessage = { role: string; content: any }

export type RunEveInput = {
  access: Access
  messages: EveMessage[]
  /** Domains to pre-open so she does not spend a turn on it (the /eve page does this). */
  domains?: string[]
  /** Where the question came from. Logged, and it slightly changes how she writes. */
  source?: 'web' | 'telegram' | 'slack' | 'api' | 'probe'
  /** Extra situational line for the system prompt (e.g. "you are in a Telegram group"). */
  surfaceNote?: string
  /**
   * NO TOOLS AT ALL — not even open_domain or web search. The learning audit (lib/eve/learning-audit.ts)
   * uses this to ask her what she was TAUGHT: with tools she would look it up, and looking it up
   * proves nothing about whether the memory took. Memory still loads. A 'probe' source is also not
   * logged to eve_chats as a user chat and does not bump memory use counts, so the self-test never
   * pollutes the telemetry it is measuring.
   */
  noTools?: boolean
  /**
   * Tools removed before the model is even told they exist, and refused if a name slips through.
   * Used by the Slack surface, where the room decides what an answer may contain — see
   * lib/eve/slack-tier.ts. Taking a tool away is the only reliable way to stop it being used; an
   * instruction not to use one is a suggestion.
   */
  denyTools?: string[]
  /**
   * Ceiling on the weight a `remember` call may carry from this surface. Staff teaching Eve in Slack
   * is learning and should be allowed (Jon: "make learning and teaching eve to be a co-worker"), but
   * a fact from a channel must never outrank one Jon gave her directly. Jon's answers are 8; a
   * document is 7; a colleague in a channel is 5 at most, and the row says who said it.
   */
  memoryWeightCap?: number
  /** Force money redaction regardless of the person's own permission — a shared room, not a private one. */
  forceNoMoney?: boolean
  /**
   * The Slack tier asking (lib/eve/slack-tier.ts). 'vendor' — an outside company's room, or an
   * asker nobody could identify — strips guest names, contact details, guests' own words and review
   * text from every tool result (registry.runTool redactGuestPII).
   */
  tier?: 'admin' | 'staff' | 'vendor'
  /**
   * The ROOM belongs to a vendor-run area (lib/eve/slack-tier.ts TierGrant.vendorRoom). Whoever is
   * asking — an admin included — every tool result loses guest details, the mind block is left out
   * and no memory about a person or a guest goes into the prompt (2026-09-29 review, N3/N4).
   */
  vendorRoom?: boolean
  /** A vendor grant's buildings: the listing registry is narrowed to them (lib/eve/ctx.ts buildCtx). */
  onlyBuildings?: string[]
  /** The Slack conversation and asker, when source is 'slack' (lib/eve/ctx.ts EveCtx.slack). `how` is
   *  how the asker was matched to a Lighthouse account (lib/slack-identity-rules.ts), null if not at all. */
  slack?: { channel: string; user: string; name?: string | null; how?: string | null; thread?: string | null }
  maxTurns?: number
  /**
   * TEACH MODE (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve").
   * The message is an instruction to keep, not a question: she restates it, picks kind and scope and
   * calls `remember` — no regex gate decides whether it counts.
   */
  teach?: boolean
  /** The server-side conversation this turn belongs to (eve_conversations, migration 171). */
  conversationId?: string | null
}

/** One memory written during a turn, as the chat shows it ("Saved as rule · Botanica · Undo · Edit"). */
export type LearnedItem = {
  id: string; kind: string; text: string; scope: string; scopeLabel: string; weight: number; source: string
  teacher: string | null; via: 'remember' | 'auto' | 'correction' | 'teach'
  /** 'saved' is in force; 'suggested' waits for a teacher's Confirm (a non-teacher's auto-capture). */
  status: 'saved' | 'suggested'
}
export type UsedItem = { id: string; kind: string; text: string; source: string }

export type RunEveOk = {
  ok: true
  reply: string
  /**
   * The reply as it may be STORED (a transcript, a chat log): any door code released to a Direct
   * person in this turn is replaced with a pointer to the audit trail, in any spelling of its digits,
   * and the rest of the text goes through the code redactor (lib/eve/redact.ts scrubStoredText).
   * `reply` keeps the code — the person asked for it — but nothing that is kept or replayed does.
   */
  logReply: string
  chatId: string | null
  conversationId: string | null
  meta: {
    turns: number; ms: number; tools: string[]; domains: string[]; memories: number; moneyRedacted: boolean; webSearch: string
    /** Every memory written this turn (remember, auto-capture, correction) — 2026-11-05. */
    learned: LearnedItem[]
    /** The memories the answer drew on, as text (memoryHits.used, capped at 10) — 2026-11-05. */
    used: UsedItem[]
    /** Was the asker a teacher, and how heavy their word (lib/eve/teachers.ts). */
    teacher: { tier: string | null; maxWeight: number } | null
    conversationId: string | null
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
    /** Which injected memories the answer actually drew on (lib/eve/memory.ts memoryHitsFor). */
    memoryHits: { injected: number; used: string[]; lanes?: Record<string, number>; used_by_lane?: Record<string, number>; reranked?: boolean; rerank?: string }
  }
}
export type RunEveErr = { ok: false; status: number; error: string }
export type RunEveResult = RunEveOk | RunEveErr

/** How she writes in a chat app vs. in the app's own workspace. Content and permissions are identical. */
// SLACK IS A SHARED ROOM, AND THAT IS THE WHOLE CONSTRAINT (Jon, 2026-09-10: "her responses need to
// be slack focused, not super long to not clog up the page"). A long answer in Telegram costs one
// person a scroll. The same answer in #vr-broward costs eleven people a scroll, buries what somebody
// posted before it, and teaches the room to skim past her. So brevity here is not a style preference,
// it is the difference between a colleague and a bot people mute.
const SLACK_NOTE = `WHERE YOU ARE: a Slack channel, in front of the whole team. You are answering in a THREAD, so the channel only shows your first line — make that line the answer, not a preamble.

Length is the hard part: aim for one to three sentences, and treat six as the ceiling. Give the call and the one fact it rests on. If the full picture needs more, say the call, then offer it — "want the breakdown?" — rather than posting it unasked.

No headers, no tables, no bold-everything. A short bullet list only when you are genuinely listing units or people, one line each. Name the unit, the person and the time; never say "several units" when you can say which.

You are in a room with the people you are talking about. Stay honest about the numbers and never single somebody out by name for something that went wrong — say what needs doing, not who failed.

NEVER MAKE THEM ASK A FOLLOW-UP (Jon, 2026-09-30: "sometimes she is vague when she sends messages in Slack, so the team has to ask her follow-up questions"). Every message stands on its own: the unit by building AND number ("Eden 1205", never "1205"), the guest if there is one, what happened, what you checked and found (the Breezeway task by name and number, its status, who has it; the glitch; whether the guest was told), and the one thing you need — from whom, by when. Never "any update?" or "is this still open?" without saying what you already know. If you would expect someone to reply "which one?" or "what task?", answer that in the message. Look before you post: read the thread, the unit's tasks and the glitch board first, so you are telling them something, not asking them to tell you.`

const TELEGRAM_NOTE = `WHERE YOU ARE: Telegram, on a phone. Same you, tighter delivery — the person is probably standing somewhere, not sitting at a desk. Answer in a few short paragraphs. No headers, no tables, no markdown links; a plain bullet list only if you are listing more than three things. If a full answer needs a screen, give the call and the one number it rests on, then offer the detail.`

export async function runEve(input: RunEveInput): Promise<RunEveResult> {
  const { access } = input
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, status: 503, error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }

  // HER EARLIER ANSWERS COME BACK SCRUBBED (2026-09-29 review, N6). The web chat hands the whole
  // thread back, so a code released to a Direct person two turns ago arrived again here — to be
  // re-quoted into a payload, a memory or captureCorrection. Assistant turns lose any code-shaped
  // text on the way in (lib/eve/redact.ts scrubStoredText); a new release goes through door_code_check.
  const messages = (Array.isArray(input.messages) ? input.messages : []).filter(m => m && m.role && m.content).slice(-12)
    .map(m => (m.role === 'assistant' && typeof m.content === 'string' ? { ...m, content: scrubStoredText(m.content) } : m))
  if (!messages.length) return { ok: false, status: 400, error: 'no messages' }

  const startedAt = Date.now()
  // ONE CLOCK PER RUN (audit 2026-10-05). The dynamic system block carried nowET() to the minute and
  // was rebuilt every turn, so a six-turn answer that crossed a minute boundary invalidated its own
  // 5-minute cache and the conversation cache behind it. The time is read once; "remind me in ten
  // minutes" still has a minute-accurate anchor.
  const runNow = nowET()
  // A WALL CLOCK (audit 2026-10-05): Vercel ends the function at its maxDuration regardless, and a
  // run cut off there answers nobody. Past this budget the loop stops asking for more tools and
  // answers with what it has.
  const WALL_MS = 150_000
  let outOfTime = false
  const source = input.source || 'web'
  const noTools = !!input.noTools
  const isProbe = source === 'probe'
  // A ROOM CAN ONLY NARROW THIS, NEVER WIDEN IT. Someone cleared for money in Lighthouse still does
  // not get dollar amounts read out in a channel with eleven other people in it.
  const canMoney = input.forceNoMoney ? false : canSeeMoney(access)
  const deny = (input.denyTools || []).map(t => String(t).trim()).filter(Boolean)
  const allowed = (list: any[]) => (deny.length ? list.filter((t: any) => deny.indexOf(String(t?.name)) < 0) : list)
  const ctx = await buildCtx(access, canMoney, { onlyBuildings: input.tier === 'vendor' ? input.onlyBuildings : undefined })
  if (input.tier) ctx.tier = input.tier
  if (input.slack && input.slack.channel && input.slack.user) ctx.slack = { channel: String(input.slack.channel), user: String(input.slack.user), name: input.slack.name || null, how: input.slack.how || null, thread: input.slack.thread || null }
  // An outside company can read this room: the vendor tier anywhere, or anyone in a vendor room.
  const guestSafe = input.tier === 'vendor' || !!input.vendorRoom
  if (guestSafe) ctx.guestSafe = true
  const db = supabaseAdmin()
  const today = todayET()

  /* WHO IS TEACHING (Jon, 2026-11-05: "She can learn from any CCS agent, she can also learn from
     Roberto, Karla & Bernadette"). One answer from lib/eve/teachers.ts for every surface. A vendor
     tier never teaches, whoever they claim to be. The effective memory ceiling: Jon 10, a named
     teacher 8, CCS 6, anyone else STAFF_MAX_WEIGHT — and a room's cap still narrows a non-teacher. */
  const NOT_TEACHER: Teacher = { teacher: false, tier: null, maxWeight: 0, label: '' }
  const teacher: Teacher = input.tier === 'vendor' || isProbe ? NOT_TEACHER
    : await teacherFor(identityOfAccess(access as any, { slackId: input.slack?.user || null, name: input.slack?.name || null })).catch(() => NOT_TEACHER)
  const roomCap = Number.isFinite(input.memoryWeightCap) ? Number(input.memoryWeightCap) : null
  const isJon = isSuperadmin(ctx.email)
  const effCap = isJon ? (roomCap ?? 10)
    : roomCap === 0 ? 0
    : teacher.teacher ? Math.max(roomCap ?? 0, teacher.maxWeight)
    : Math.min(roomCap ?? STAFF_MAX_WEIGHT, STAFF_MAX_WEIGHT)
  const conversationId = input.conversationId && /^[0-9a-f-]{36}$/i.test(String(input.conversationId)) ? String(input.conversationId) : null
  // Ids written this turn, by how they were written (built into meta.learned at the end).
  const learnedIds: { id: string; via: LearnedItem['via']; status: LearnedItem['status'] }[] = []
  const noteLearned = (id: any, via: LearnedItem['via'], status: LearnedItem['status'] = 'saved') => {
    const k = String(id || ''); if (!k) return
    const at = learnedIds.findIndex(x => x.id === k)
    if (at >= 0) learnedIds[at] = { id: k, via, status }
    else learnedIds.push({ id: k, via, status })
  }

  // --- Light headline snapshot: cheap counts, for instant situational awareness only. ---
  const cutoff60 = daysAgoISO(60)
  // Started now, awaited below with the memory and prompt reads — one wait, not two (F7).
  const headlineP = Promise.all([
    safe(db.from('guesty_reviews').select('listing_id').eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', cutoff60).order('id').limit(500), { data: [] } as any),
    cnt(db.from('guesty_conversations').select('*', { count: 'exact', head: true }).gt('unread_count', 0)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', today)),
    cnt(db.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', today).gt('check_out', today)),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])),
    cnt(db.from('field_requests').select('*', { count: 'exact', head: true }).eq('approval_required', true).neq('approval_status', 'approved')),
  ])

  // --- Memory, scoped to what this question is actually about. ---
  const lastUser = String([...messages].reverse().find(m => m.role === 'user')?.content || '')
  // Filed as the snippet on any proposal this turn makes (core.ts propose_action), so kept code-free.
  ctx.question = scrubStoredText(lastUser).slice(0, 400)
  const wholeThread = messages.map(m => String(m.content || '')).join(' \n ')
  const scopes = scopesForText(wholeThread, ctx.listingMeta)
  ctx.sharedRoom = source === 'slack' || !!input.forceNoMoney
  // A building in play brings its units' memories in too, ranked just below what was named
  // (lib/eve/memory.ts loadMemories, "recall by neighbourhood").
  const nearScopes: string[] = []
  for (const sc of scopes) {
    if (!sc.startsWith('building:')) continue
    const b = sc.slice(9)
    for (const id of Object.keys(ctx.listingMeta)) if (ctx.listingMeta[id].rollup === b) nearScopes.push('unit:' + id)
  }
  // ONE WAIT, NOT SIX (2026-09-28 audit, F7). None of these reads depends on another; awaited one
  // after the other they added up — the memory rerank alone may take its full cap — before the
  // first token of every answer. They run together now; each keeps its own fallback and the
  // rerank keeps its own timeout.
  const [headRows, loadedMemories, mind, voice, lingo, operatingModel, agent] = await Promise.all([
    headlineP,
    // The question rides along so retrieval can rank by RELEVANCE, not just weight — the memories
    // about the thing being asked beat equally-weighted trivia about everything else.
    loadMemories(scopes, ctx.email, 40, lastUser || wholeThread, { nearScopes }),
    // THE LIVING MIND (lib/eve/brain.ts): the dossiers of whatever is in play, last night's reflection
    // and her track record, in her head before she reaches for a tool. Not for a probe: the learning
    // audit tests what she REMEMBERS, and handing her the file would pass it for her. Not in a room
    // an outside company reads either (N3/N4): the dossiers quote reviews and name people.
    isProbe || guestSafe ? Promise.resolve('') : safe(import('./brain').then(m => m.mindForPrompt({ text: wholeThread.slice(-4000), scopes, sharedRoom: ctx.sharedRoom })), ''),
    safe(getVoiceProfile(), ''),
    // How this team writes. Absent until the nightly pass has read enough real messages to have an
    // opinion, and absent is correct — an invented house style is worse than a neutral one.
    safe(getLingo(), null as any),
    // Who does what, per building. Goes in the STABLE block: it only changes when Jon answers a
    // calibration question, and a wrong answer here is the most expensive kind she can give.
    safe(getOperatingModel().then(renderOperatingModel), ''),
    // AGENT MODE, stated to her in one paragraph so she never claims she can or cannot act wrongly.
    // Read fresh (no cache): the switch must be true in the very next answer after Jon flips it.
    safe(getAgentSettings(), normalizeAgentSettings(null)),
  ])
  // NO PERSON OR GUEST MEMORY IN A ROOM AN OUTSIDE COMPANY READS (2026-09-29 review, N3/N4) — people
  // mappings, person- and OTA-channel-scoped rows, anything about a guest or with contact details
  // (lib/eve/redact.ts isGuestOrPersonMemory). The recall tags ride along to the telemetry below.
  let memories = loadedMemories
  if (guestSafe) {
    memories = loadedMemories.filter(m => !isGuestOrPersonMemory(m))
    ;(memories as any).reranked = (loadedMemories as any).reranked
    ;(memories as any).rerank = (loadedMemories as any).rerank
  }
  const [unansweredRows, unreadCount, checkinCount, checkoutCount, inhouseCount, openFW, apprFW] = headRows
  const headline = {
    today,
    unanswered_reviews_60d: ((unansweredRows as any).data || []).filter((r: any) => ctx.reviewable(r.listing_id)).length,
    unread_guest_threads: unreadCount, checkins_today: checkinCount, checkouts_today: checkoutCount,
    in_house_now: inhouseCount, open_field_work: openFW, approvals_waiting: apprFW,
    listings_total: Object.keys(ctx.listingMeta).length,
  }

  // WHAT LANGUAGE TO ANSWER IN, decided here rather than left to the model. Read off the LAST user
  // message, not the whole thread: a supervisor who opens in English and switches to Spanish has
  // switched, and Eve should switch with them mid-conversation rather than at the next question.
  const lang = detectLanguage(lastUser)
  const agentMode = renderAgentModeForPrompt(agent)

  const userName = String((access.profile as any)?.name || '') || (access.email ? access.email.split('@')[0] : '')

  const open: string[] = []
  const preOpen = Array.isArray(input.domains) ? input.domains : []
  for (const d of preOpen) { const k = lc(d); if (DOMAIN_KEYS.indexOf(k) >= 0 && open.indexOf(k) < 0) open.push(k) }
  // THE FIRST TURN SHOULD NOT BE SPENT OPENING A DRAWER (2026-10-01 cost pass). Progressive
  // disclosure keeps the tool list short, and it costs one whole API call — a full prefix — on the
  // first deep question of every thread, and again on every Slack follow-up because a new message is
  // a new run. A question that says "clean", "payout" or "review" has already said which domain it
  // needs. guessDomains (lib/eve/domain-guess, tested) opens at most two before the first call; the
  // model can still open_domain anything else.
  if (!noTools) for (const k of guessDomains(lastUser)) if (DOMAIN_KEYS.indexOf(k) >= 0 && open.indexOf(k) < 0 && open.length < 3) open.push(k)

  // A SCOPE THAT MATCHED NOTHING (2026-09-29 review, N14): the room sees no units at all (buildCtx
  // fails closed), and she says why instead of reporting a quiet day.
  const emptyScope = ctx.scopedBuildings && !Object.keys(ctx.listingMeta).length
    ? `This room's buildings (${ctx.scopedBuildings.join(', ') || 'none set'}) match no units in the portfolio, so from here you can see no units, tasks, issues or claims. Say that plainly — never that nothing is going on — and that a Stay Hospitality admin has to set this room's buildings at /users → Settings → Slack alerts & rules → Areas.`
    : ''
  // THE CLARITY MISSES THE TEAM HAS HAD TO ASK ABOUT (lib/eve/match-lessons voice book): when she is
  // in Slack, the recent ones ride along so she says those things up front next time.
  let voiceLessons = ''
  if (source === 'slack') {
    try { const { voiceLessonsText } = await import('./match-lessons'); const t = await voiceLessonsText(8); if (t) voiceLessons = 'FOLLOW-UPS THE TEAM HAD TO ASK YOU RECENTLY — put these answers in the message up front:\n' + t } catch { /* optional */ }
  }
  /* TEACH MODE (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve"). */
  const teachNote = input.teach && !noTools ? `TEACH MODE IS ON. ${userName || 'The person'} is TEACHING you, not asking. Treat the message as an instruction to keep:
1. Restate it as ONE standalone sentence someone new could follow (keep their numbers, names and exceptions; translate to English if needed, and keep the original wording in "why").
2. Pick the kind: rule (an instruction), preference (how they want it done), decision, person (who someone is / a name mapping), issue (a recurring problem) or correction (you had it wrong).
3. Pick the narrowest scope it is about: portfolio, building:<Name>, unit:<listingId>, channel:<Airbnb|Vrbo|Booking.com|Expedia|Direct> or person:<email>.
4. Call remember with text, kind, scope, why and weight ${Math.max(1, Math.min(effCap || STAFF_MAX_WEIGHT, 8))}${isJon ? ' (up to 10 if they say it is critical)' : ''}; add expires_on if it is time-bound. If it replaces something you already believe, pass supersedes with that memory's id (search_memory first).
5. Reply in one or two lines: what you saved, as what, for where ("Saved as a rule for Botanica: …"). If it is genuinely ambiguous (which building? always or only this week?), ask ONE short question instead of saving.` : ''
  const surface = [source === 'telegram' ? TELEGRAM_NOTE : source === 'slack' ? SLACK_NOTE : '', voiceLessons, input.surfaceNote || '', emptyScope, teachNote].filter(Boolean).join('\n')
  // ORDER IS PRECEDENCE. The prompt tells the model these notes override what came before, so the
  // last word belongs to the narrowest instruction: house vocabulary first, then where she is
  // standing, then Jon's own hand-written voice notes, and the language rule last of all, because
  // getting the language wrong makes every other improvement here invisible.
  const voicePlus = [lingo ? lingoNote(lingo) : '', surface, voice, languageNote(lang.lang)].filter(Boolean).join('\n\n')

  // Token accounting per question, so the improvement loop can see what an answer COST as well as
  // whether it was right. cacheRead is the number that says whether caching is working.
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const convo: any[] = messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 8000) }))
  const toolsUsed: string[] = []
  // Codes door_code_check released to a Direct person this turn — scrubbed from everything stored.
  const released: string[] = []
  // Ten rounds of tools is plenty for a question; agent mode keeps the full sixteen (2026-11-09 cost pass).
  const limit = Math.min(Math.max(Number(input.maxTurns) || (agentMode ? MAX_TURNS : 10), 4), MAX_TURNS)

  try {
    let finalText = ''
    let turns = 0
    let pauses = 0
    // Flipped off permanently for this request if the API rejects the server-side search tool.
    let webOk = true
    // THE ONE-HOUR CACHE ONLY WHEN EVE IS BUSY (cache pass 2026-10-29). The 1h write costs 2x list
    // and only pays when another call arrives inside the hour. The ledger for 22–28 Oct showed Eve
    // writing 1.08M cache tokens and reading 1.22M — almost one write per read — because most of her
    // ~9 calls a day were hours apart and every 1h write expired unread. Now: 1h when she has been
    // called in the last hour (a working session, a tool loop, agent mode), the 1.25x 5-minute kind
    // when she is cold. Inside a tool loop the first turn decides and the rest follow it.
    let longCache = await eveWasBusy(db)
    // THE CHEAP PATH (2026-11-09). Short, plain questions start on 'eve-fast' (the small model); a
    // question that asks for judgement, money, a plan or a report — or agent mode, or a long thread —
    // goes straight to 'eve'. The quick path moves up to 'eve' if it needs more than four rounds.
    const DEEP_RE = /\b(why|compare|comparison|trend|analy[sz]|plan|strategy|forecast|projection|revenue|profit|money|budget|payout|statement|owner report|recommend|should we|what do you think|audit|investigate|root cause|explain|summar|report|draft|write|email|policy|decide|decision)\b/i
    let task: 'eve' | 'eve-fast' = (!agentMode && !input.teach && lastUser.length <= 220 && messages.length <= 6 && !DEEP_RE.test(lastUser)) ? 'eve-fast' : 'eve'
    for (let turn = 0; turn < limit; turn++) {
      turns = turn + 1
      // The atlas rides with the memories: what every page of the app is for, and a live census of
      // her own tool domains — so "where do I…" questions get a real answer, and a tool added in
      // code is in her head on the next deploy without anyone re-teaching her.
      // PROMPT CACHING (2026-09-09). Two breakpoints, the API allows four:
      //   1. the end of the STABLE system block — identity, rules, the full tool map. Identical on
      //      every call until the next deploy, so every turn after the first reads it from cache
      //      at a tenth of the input price. The dynamic block (name, open domains, memories, the
      //      snapshot) sits after it, uncached, and is small.
      //   2. the last block of the conversation so far. Inside a tool loop the messages array only
      //      ever grows, so each turn's prefix is the previous turn's whole conversation — tool
      //      results included, at up to 9k chars each. Moving the breakpoint to the newest block
      //      means turn N pays full price only for what turn N-1 added.
      // Opening a new domain changes the tool list, which invalidates the cache for that one turn.
      // That is fine: a write costs 25% over list once, and every turn after it reads again.
      // THE ATLAS IS STATIC, SO IT GOES IN THE CACHED HALF (2026-09-15). appAtlas() is memoised and
      // derived from the feature and tool registries — byte-identical for the life of the process —
      // and it was being glued onto `memories`, which lands in the UNCACHED block. Every turn paid
      // list price to re-send a string that had not changed since the deploy.
      // MONEY IN MEMORY FOLLOWS THE MONEY GATE (2026-09-28 audit, F9). Only tool outputs were
      // redacted; the memories and the mind block went into the prompt whole, so a staff member in
      // Slack could be read a dollar figure Jon once taught her. Masked here for anyone not cleared.
      const memText = renderMemories(memories)
      const blocks = buildSystemBlocks({ now: runNow, headline, atlas: appAtlas(), memories: canMoney ? memText : maskMoneyText(memText), mind: canMoney ? mind : maskMoneyText(mind), openDomains: open, voice: voicePlus, userName, canMoney, operatingModel, agentMode })
      // TWO BREAKPOINTS, NOT ONE. `stable` survives between conversations while the five-minute
      // window holds; `dynamic` (memories, headline, who is asking) is constant within ONE
      // conversation and different in the next, so it earns its own entry rather than riding free
      // on the first or being re-sent whole. Three of the four allowed breakpoints are now in use —
      // these two plus the rolling one on the newest message.
      // ONE HOUR, NOT FIVE MINUTES, ON THE STABLE HALF (2026-10-01 cost pass). The ledger showed every
      // Eve call writing ~15k tokens of cache and reading ~23k: her questions arrive minutes apart, the
      // default 5-minute cache had expired between them, and the 11.5k-token stable block plus the
      // tool schemas were being re-written at 1.25x list price on most calls. A 1h write costs 2x
      // once; the fifty-odd calls that follow in the hour read it at 0.1x. If the account cannot use
      // the long TTL the API says so once and the loop falls back to the 5-minute kind for the request.
      const system: any[] = [
        { type: 'text', text: blocks.stable, cache_control: longCache ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } },
        { type: 'text', text: blocks.dynamic, cache_control: { type: 'ephemeral' } },
      ]
      // Keep the SAME tools array across the whole conversation. If a resume request drops a server
      // tool the API is still waiting on, it 400s with "but no web_search tool was provided".
      // noTools: the model is never told a tool exists (the only reliable way to keep one from
      // being used), and the tools key is left off the request entirely.
      const toolset: any[] = (noTools || outOfTime) ? [] : allowed(wireTools(open))
      if (webOk && !noTools && !outOfTime) toolset.push(WEB_SEARCH_TOOL as any)
      const messages = withCacheBreakpoint(convo)

      const HEADERS = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-beta': 'extended-cache-ttl-2025-04-11' }
      // RETRY, THEN FALL BACK (audit 2026-10-05). The loop used to return the first 429 or 5xx to the
      // room as "Anthropic 429" and stop. A rate limit or an overloaded model now waits (2s, then 6s)
      // and retries; a third failure goes to the task's fallback model (lib/ai-models) once, so a
      // busy minute costs a slower answer rather than no answer.
      if (task === 'eve-fast' && turn >= 4) { task = 'eve'; toolsUsed.push('_escalated') }
      const pair = await modelPairFor(task)
      const call = async (model: string, body: Record<string, any>) => {
        const rr = await aiFetch(task, { method: 'POST', headers: HEADERS, body: JSON.stringify({ model, ...body }) })
        return { r: rr, d: (await rr.json().catch(() => ({}))) as any }
      }
      const baseBody = { max_tokens: noTools ? 600 : 4096, system, ...(toolset.length ? { tools: toolset } : {}), messages }
      let { r, d } = await call(pair.model, baseBody)
      // THE BUDGET IS NOT A RATE LIMIT (independent audit 2026-10-10): lib/ai-usage answers a spent cap
      // with 429 { type: 'budget_exceeded' }; retrying it three times took 8.5 s and then called it
      // "the Anthropic rate limit". It is said for what it is, at once.
      const budgetStop = (dd: any) => dd?.error?.type === 'budget_exceeded'
      if (!r.ok && budgetStop(d)) return { ok: false, status: 503, error: `AI budget: ${String(d?.error?.message || 'the daily or monthly AI cap is spent').slice(0, 200)} (Settings → AI models → caps).` }
      for (let attempt = 0; !r.ok && !budgetStop(d) && (r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 3; attempt++) {
        if (Date.now() - startedAt > WALL_MS - 20_000) break
        const useFallback = attempt === 2 && !!pair.fallback && pair.fallback !== pair.model
        await new Promise(res => setTimeout(res, useFallback ? 500 : attempt === 0 ? 2000 : 6000))
        ;({ r, d } = await call(useFallback ? pair.fallback : pair.model, baseBody))
        if (useFallback && r.ok) toolsUsed.push('_fallback_model')
      }
      // The long TTL refused (an account or model without it): same request, 5-minute cache.
      if (!r.ok && longCache && /ttl|cache_control|extended-cache/i.test(JSON.stringify(d?.error || ''))) {
        longCache = false
        system[0] = { ...system[0], cache_control: { type: 'ephemeral' } }
        r = await aiFetch('eve', { method: 'POST', headers: HEADERS, body: JSON.stringify({ model: await modelFor('eve'), max_tokens: noTools ? 600 : 4096, system, ...(toolset.length ? { tools: toolset } : {}), messages }) })
        d = await r.json()
      }

      // If this model/account cannot use the server-side search tool, lose the search — not the answer.
      if (!r.ok && webOk && /web_search/i.test(JSON.stringify(d?.error || ''))) {
        webOk = false
        r = await aiFetch('eve', {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ model: await modelFor('eve'), max_tokens: noTools ? 600 : 4096, system, ...(noTools ? {} : { tools: allowed(wireTools(open)) }), messages }),
        })
        d = await r.json()
      }
      if (d?.usage) {
        usage.input += Number(d.usage.input_tokens) || 0
        usage.output += Number(d.usage.output_tokens) || 0
        usage.cacheRead += Number(d.usage.cache_read_input_tokens) || 0
        usage.cacheWrite += Number(d.usage.cache_creation_input_tokens) || 0
      }

      if (!r.ok) {
        const msg = (d?.error?.message || JSON.stringify(d)).slice(0, 240)
        // A 429 here is almost always the org tokens-per-minute ceiling, not a bug. Say so.
        const hint = r.status === 429 ? ' — that is the Anthropic rate limit, not a failure. Give it a minute and ask again.' : ''
        return { ok: false, status: 502, error: `Anthropic ${r.status}: ${msg}${hint}` }
      }
      convo.push({ role: 'assistant', content: d.content })

      // A long web search can be PAUSED mid-turn. The assistant message goes back UNCHANGED and the
      // API carries on. Treating this as terminal (the obvious bug) silently truncates the search.
      if (d.stop_reason === 'pause_turn') { pauses++; if (pauses > 4) break; continue }

      // Over the wall clock with another round of tools asked for: answer from what is known.
      if (d.stop_reason === 'tool_use' && Date.now() - startedAt > WALL_MS && !outOfTime) {
        outOfTime = true
        const results = (d.content || []).filter((b: any) => b?.type === 'tool_use').map((b: any) => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ error: 'Out of time for more lookups. Answer now from what you already have, and say plainly what you could not check.' }) }))
        convo.push({ role: 'user', content: results })
        continue
      }
      if (d.stop_reason === 'tool_use') {
        const results: any[] = []
        for (const block of (d.content || [])) {
          if (block?.type !== 'tool_use') continue
          toolsUsed.push(block.name)
          // Belt and braces: she cannot see a denied tool, but a name that arrives anyway is
          // refused here rather than executed.
          if (deny.indexOf(String(block.name)) >= 0) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'That is not something you can do from here. An admin can.' }) })
            continue
          }
          let args = block.input || {}
          // A CODE RELEASED IN THIS TURN STAYS IN THE REPLY (N6): a propose_action payload, a memory or
          // any other tool call after the release gets the code replaced with the audit-trail pointer.
          if (released.length && block.name !== 'door_code_check') args = scrubReleasedInValue(args, released)
          if (block.name === 'remember') {
            // Nothing the model sends may set the underscore fields — they are stamped here only.
            const clean: any = {}
            for (const k of Object.keys(args || {})) if (!k.startsWith('_')) clean[k] = (args as any)[k]
            args = clean
            /* EVERY SURFACE IS CAPPED NOW, NOT ONLY SLACK (2026-11-05). On the web a colleague's
               `remember` carried whatever weight the model chose; it now carries the asker's ceiling
               (teachers.ts: Jon 10, named teachers 8, CCS 6, anyone else 6). */
            if (!isJon || roomCap != null) {
              const cap = effCap
              args = { ...args, weight: Math.min(cap, Number(args.weight) || cap), _maxWeight: cap }
            }
            if (source === 'slack') {
              // A teacher's word in Slack is theirs ('staff' with their name), not an overheard 'slack' line.
              args = { ...args, _source: teacher.teacher ? undefined : 'slack', why: `${String(args.why || '').slice(0, 200)} [said by ${teacher.label || ctx.email || 'someone'} in Slack]`.trim() }
            }
            args = { ...args, _teacher: teacher.teacher ? teacher.label : undefined, _evidence: { capturedFrom: source, conversationId, ...(input.teach ? { teachMode: true } : {}) } }
          }
          const { output, opened } = await runTool(block.name, args, ctx, open)
          if (block.name === 'remember' && output && (output as any).saved && (output as any).id) noteLearned((output as any).id, input.teach ? 'teach' : 'remember')
          if (opened && open.indexOf(opened) < 0) open.push(opened)
          if (block.name === 'door_code_check' && output && typeof output === 'object') {
            for (const k of ['code', 'previous_code']) if (output[k] != null && String(output[k]).trim()) released.push(String(output[k]).trim())
          }
          // Every turn after this re-sends every tool result, so a 30k-character list costs on every
          // later round. Capped, with a note so she narrows the next call instead of guessing.
          let outStr = JSON.stringify(output)
          if (outStr.length > 7000) outStr = outStr.slice(0, 7000) + '…[TRUNCATED — ' + outStr.length + ' chars. Ask the tool for a narrower slice (one building, fewer days) if you need the rest.]'
          results.push({ type: 'tool_result', tool_use_id: block.id, content: outStr })
        }
        convo.push({ role: 'user', content: results })
        continue
      }
      finalText = (d.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      break
    }

    if (!finalText) finalText = 'I ran out of steps before I got to an answer. Ask me again and narrow it a little — a building, a date range, or one unit.'

    // APPLICATION TELEMETRY (2026-09-21). Which of the injected memories did this answer actually
    // use? Deterministic word overlap, so it costs nothing and runs on every turn. This is the
    // number that separates "she has 300 memories" from "her memories change her answers".
    const usedIds = memoryHitsFor(memories, finalText, lastUser)
    // Which lane each loaded and each used memory came from (lib/eve/memory.ts, three-lane recall,
    // 2026-09-28), so the learning audit can say whether the standing rules, the question-relevant
    // picks or the week's news are the ones that shape answers — and whether the reranker earns
    // its call.
    const laneOf = new Map(memories.map(m => [m.id, String((m as any).lane || 'relevant')]))
    const tally = (ids: string[]) => ids.reduce((acc: Record<string, number>, id) => { const l = laneOf.get(id) || 'relevant'; acc[l] = (acc[l] || 0) + 1; return acc }, {})
    const memoryHits = { injected: memories.length, used: usedIds, lanes: tally(memories.map(m => m.id)), used_by_lane: tally(usedIds), reranked: !!(memories as any).reranked, rerank: String((memories as any).rerank || '') }

    // Log the exchange. This is the substrate the improvement loop runs on; without it a thumbs-down
    // is just a feeling. Never let a logging failure break the answer. A probe (the learning
    // audit's self-test) is not a user chat and is not logged here — it lives in eve_probes.
    let chatId: string | null = null
    // A RELEASED CODE IS NOT KEPT (2026-09-28 audit, B-6). It is in the reply the Direct person reads;
    // the chat log gets a pointer to the audit trail (eve_actions holds the fingerprint) instead —
    // in any spelling of its digits, and the text redactor runs over what is kept (N6). The question
    // is kept the same way: a code somebody typed is not a log line either.
    const logReply = scrubStoredText(finalText, released)
    const row: any = {
      user_email: ctx.email,
      question: scrubStoredText(lastUser).slice(0, 4000),
      answer: logReply.slice(0, 8000),
      tools_used: toolsUsed,
      domains_opened: open,
      turns,
      ms: Date.now() - startedAt,
    }
    if (!isProbe) {
      // `memory_hits` arrived with migration 103, `usage` with 075 and `source` with 055. Before
      // any of them runs, log the exchange with what the table has rather than losing it from the
      // learning loop — each attempt drops the newest column.
      // conversation_id arrived with migration 171 (2026-11-05); before it runs the next shape logs as before.
      const attempts: any[] = [
        ...(conversationId ? [{ ...row, source, usage, memory_hits: memoryHits, conversation_id: conversationId }] : []),
        { ...row, source, usage, memory_hits: memoryHits }, { ...row, source, usage }, { ...row, source }, row,
      ]
      for (const attempt of attempts) {
        try {
          const { data, error } = await db.from('eve_chats').insert(attempt).select('id').maybeSingle()
          if (error) throw error
          chatId = (data as any)?.id || null
          break
        } catch { /* try the next, narrower shape; migration 045 may not be run yet */ }
      }
      touchMemories(memories.map(m => m.id)).catch(() => {})
      recordMemoryHits(usedIds).catch(() => {})
    }

    // "NO, THAT'S WRONG" IS A LESSON (Jon, 2026-09-23: "constantly updating, learning, improving").
    // A thumbs-down with a note was already kept (app/api/eve/feedback). Most corrections are not
    // typed there, though; they are the next message: "no, Eden's crew starts at 11". When the reply
    // pushes back on her previous answer, lib/eve/brain.ts captureCorrection works out what was wrong
    // and what is right, keeps the right thing in that person's name and at their authority, and
    // weakens the beliefs the wrong answer leaned on. Awaited (with a ceiling) because Vercel freezes
    // a function once it has answered; a slow correction costs a few seconds, a lost one costs the lesson.
    try {
      const prevIdx = messages.length - 2
      const prev = prevIdx >= 0 && messages[prevIdx].role === 'assistant' ? String(messages[prevIdx].content || '') : ''
      const prevQ = prevIdx >= 1 ? String(messages[prevIdx - 1].content || '') : ''
      // FROM SLACK TOO (2026-09-30 audit): the team's corrections happen in Slack — "no, that unit is
      // offboarded", "read the whole channel" — and were discarded here, so the same lesson had to be
      // taught twice. A Slack reply now teaches her when the room's tier may hold a rule (memory weight
      // cap ≥ 6: staff and admin rooms, never a vendor room) and the thread carried her previous answer
      // (app/api/slack/events passes it). personSource still caps a colleague's weight at 6.
      // A TEACHER TEACHES FROM SLACK WHATEVER THE ROOM (Jon, 2026-11-05: "She can learn from any CCS
      // agent, she can also learn from Roberto, Karla & Bernadette") — never in a vendor tier (teacherFor
      // is not asked there).
      const slackMayTeach = source === 'slack' && ((Number.isFinite(input.memoryWeightCap) && Number(input.memoryWeightCap) >= 6) || teacher.teacher)
      if (!isProbe && (source !== 'slack' || slackMayTeach) && prev) {
        const { looksLikeCorrection, captureCorrection } = await import('./brain')
        if (looksLikeCorrection(lastUser, !!prev)) {
          const scopeFor = (text: string) => {
            const named = scopesForText(text, ctx.listingMeta).filter(x => x !== 'portfolio')
            const only = (prefix: string) => { const l = named.filter(x => x.startsWith(prefix)); return l.length === 1 ? l[0] : null }
            return only('unit:') || only('building:') || only('channel:') || 'portfolio'
          }
          const who = teacher.teacher ? (() => { const t = teacherSource(teacher, 8); return { ...t, label: teacher.label } })() : undefined
          const got: any = await Promise.race([
            captureCorrection({ email: ctx.email, question: prevQ, answer: prev, correction: lastUser, chatId, memories, scopeFor, who, evidence: { conversationId } }),
            new Promise(res => setTimeout(() => res(null), 9000)),
          ])
          if (got && got.saved && got.id) noteLearned(got.id, 'correction')
        }
      }
    } catch { /* a missed lesson never breaks an answer */ }

    // CONSTANT LEARNING, ZERO CEREMONY (Jon, 2026-08-19: "read and learn and update constantly").
    // When the user speaks in standing-instruction form — always / never / from now on / stop
    // doing / make sure — that sentence IS a preference, whether or not anyone clicks "teach her".
    //
    // NOT FROM A SHARED ROOM (2026-09-18 audit, P0-8). A Slack channel can contain a vendor, and a
    // surface whose tier caps memory weight below 6 is by definition not somebody whose "always…"
    // is a standing rule. Those may still TEACH her explicitly through `remember`, at their capped
    // weight; nothing is captured behind their back and nothing they say is filed as Jon's.
    try {
      const cap = Number.isFinite(input.memoryWeightCap) ? Number(input.memoryWeightCap) : 10
      /* BROADER EARS (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve").
         Besides always / never / from now on: "remember", "our rule is", "going forward", "note that",
         and the Spanish the CCS team writes in — siempre, nunca, a partir de ahora, de ahora en
         adelante, recuerda, nuestra regla. */
      const directive = /\b(always|never|from now on|going forward|moving forward|do not ever|don'?t ever|stop (?:doing|sending|creating|drafting)|make sure (?:to|you|we|it)|remember (?:that|to)|please remember|our (?:rule|policy) is|the rule is|we (?:always|never)|note that|keep in mind)\b|\b(siempre|nunca|a partir de ahora|de ahora en adelante|recuerda|recuerde|nuestra (?:regla|pol[ií]tica) es|la regla es|ten en cuenta|toma nota)\b/i
      const memGate = await agentAllowed('memory_rule')
      //
      // A QUESTION IS NOT AN INSTRUCTION, AND A CAPTURE IS NOT SETTLED (Jon, 2026-09-23 review).
      // "Should we always charge a pet fee?" was being filed as a standing rule. Anything with a
      // question mark, or opening with who/what/why/how/when/where/can/should/do/does/is/are, is
      // not captured. What is captured is scoped to the building, unit or channel it names (the
      // same scopesForText() the prompt uses) instead of always portfolio.
      //
      // A TEACHER'S DIRECTIVE IS A RULE, NOT A SUGGESTION (Jon, 2026-11-05: "She can learn from any CCS
      // agent, she can also learn from Roberto, Karla & Bernadette"). From a teacher it is saved as a
      // rule at their weight, in their name, with no verify question — in Slack too. From anyone else
      // it stays what it was: an insight at weight 5 plus a confirmation question, never from Slack,
      // and the chat shows it as "Suggested — Confirm / Dismiss".
      // TEACH MODE skips this: the model was told to call remember, and a fallback below covers a miss.
      const said = lastUser.trim()
      const asking = said.includes('?') || said.includes('¿') || /^(who|what|why|how|when|where|can|should|do|does|is|are|qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|por qu[eé]|puedes|debemos)\b/i.test(said)
      const scopeOfSaid = () => {
        const named = scopesForText(said, ctx.listingMeta).filter(x => x !== 'portfolio')
        const only = (prefix: string) => { const l = named.filter(x => x.startsWith(prefix)); return l.length === 1 ? l[0] : null }
        return only('unit:') || only('building:') || only('channel:') || 'portfolio'
      }
      const alreadyLearned = learnedIds.length > 0
      const teacherMay = teacher.teacher && (source !== 'slack' || cap > 0)
      if (!isProbe && memGate.mode !== 'observe' && !input.teach && !alreadyLearned && !asking && directive.test(said) && said.length >= 20 && said.length <= 600 && teacherMay) {
        const capScope = scopeOfSaid()
        const t = teacherSource(teacher, 8)
        const saved = await saveMemory({
          text: said, kind: 'rule', scope: capScope, weight: t.weight, maxWeight: t.maxWeight, source: t.source,
          why: `Said by ${teacher.label || ctx.email || 'a teacher'} ${source === 'slack' ? 'in Slack' : source === 'telegram' ? 'on Telegram' : 'in chat'} on ${today} — a teacher's standing instruction`,
          evidence: { chatId, conversationId, capturedFrom: source, teacher: teacher.label || ctx.email || null, directive: true },
          created_by: ctx.email || null, confidence: 1,
        }).catch(() => null)
        if (saved?.ok && saved.id) noteLearned(saved.id, 'auto')
      } else if (!isProbe && memGate.mode !== 'observe' && !input.teach && !alreadyLearned && source !== 'slack' && cap >= 6 && !asking && directive.test(said) && said.length >= 25 && said.length <= 600) {
        const kind = /\b(always|never|siempre|nunca)\b/i.test(said) ? 'rule' : 'preference'
        // The most specific single place the sentence names: one unit, else one building, else one
        // channel. Two buildings (or none) is a portfolio-wide statement.
        const capScope = scopeOfSaid()
        const saved = await saveMemory({
          // FILED AS AN INSIGHT, NOT A RULE (2026-09-28 audit, F15). "The AC in 402 always breaks" is
          // a description, not an instruction, and filed as kind 'rule' from Jon it went straight
          // into her STANDING RULES before he had confirmed anything. It is an insight until he says
          // yes (his answer is a new rule that supersedes this row); the standing lane skips it.
          text: said, kind: 'insight', scope: capScope, weight: 5, maxWeight: cap,
          // Only Jon's own words are filed as Jon's; a colleague's directive is Eve's inference.
          source: isSuperadmin(ctx.email) ? 'jon' : source === 'telegram' ? 'telegram' : 'eve',
          why: source === 'telegram' ? 'said on Telegram — auto-captured, awaiting confirmation' : `said in chat by ${ctx.email || 'someone'} — auto-captured, awaiting confirmation`,
          evidence: chatId ? { chatId, conversationId, autoCaptured: true, proposedKind: kind } : { conversationId, autoCaptured: true, proposedKind: kind }, created_by: ctx.email || null,
        }).catch(() => null)
        if (saved?.ok && saved.id) {
          noteLearned(saved.id, 'auto', 'suggested')
          if (!saved.deduped) {
            const { askQuestion } = await import('./questions')
            const where = capScope === 'portfolio' ? 'everywhere' : capScope.replace(/^building:/, 'at ').replace(/^unit:/, 'for unit ').replace(/^channel:/, 'on ')
            await askQuestion({
              question: `${ctx.email || 'Someone'} told me in chat: "${said.slice(0, 300)}". Should I treat that as a standing ${kind} ${where}?`,
              why: `I have noted it at low weight. If you confirm it I will follow it as a rule; if not, I will drop it instead of acting on a passing remark.`,
              scope: capScope, kind: 'verify', source: 'eve',
              evidence: { memory_ids: [saved.id], chatId, autoCaptured: true },
            }).catch(() => null)
          }
        }
      }
      // TEACH MODE, MODEL DID NOT SAVE: keep the instruction anyway unless she asked a clarifying
      // question back — a teacher who pressed "Teach Eve" should never find nothing was kept.
      if (!isProbe && input.teach && !learnedIds.length && memGate.mode !== 'observe' && effCap > 0 && !/\?\s*$/.test(finalText.trim()) && said.length >= 8) {
        const t = teacherSource(teacher, 8, Math.min(effCap, STAFF_MAX_WEIGHT))
        const saved = await saveMemory({
          text: said.slice(0, 1000), kind: 'rule', scope: scopeOfSaid(), weight: Math.min(t.weight, effCap), maxWeight: Math.min(t.maxWeight, effCap), source: t.source,
          why: `Taught in Teach mode by ${teacher.label || ctx.email || 'someone'} on ${today}`,
          evidence: { chatId, conversationId, capturedFrom: source, teachMode: true, ...(teacher.teacher ? { teacher: teacher.label } : {}) },
          created_by: ctx.email || null, confidence: 1,
        }).catch(() => null)
        if (saved?.ok && saved.id) noteLearned(saved.id, 'teach')
      }
    } catch { /* learning is never worth breaking an answer */ }

    /* SHOW WHAT WAS LEARNED, AND WHAT WAS USED (Jon, 2026-11-05: "EVE chat needs to be a learning
       chat, where we can teach Eve"). Every memory written this turn comes back as a chip the chat
       can Undo or Edit; the memories the answer drew on come back as text for "What I used". Money
       in either is masked for anyone not cleared, like the prompt. */
    const mask = (t: string) => (canMoney ? t : maskMoneyText(t))
    let learned: LearnedItem[] = []
    if (learnedIds.length) {
      try {
        const { data } = await db.from('eve_memory').select('id,kind,text,scope,weight,source,created_by,evidence').in('id', learnedIds.map(x => x.id))
        const byId = new Map(((data as any[]) || []).map(r => [String(r.id), r]))
        learned = learnedIds.map(x => {
          const r: any = byId.get(x.id)
          if (!r) return null
          const sc = String(r.scope || 'portfolio')
          const scopeLabel = sc === 'portfolio' ? 'Everywhere' : sc.startsWith('unit:') ? (ctx.listingMeta[sc.slice(5)]?.name || sc.slice(5)) : sc.replace(/^(building|channel|person):/, '')
          return { id: x.id, kind: String(r.kind), text: mask(String(r.text || '')), scope: sc, scopeLabel, weight: Number(r.weight) || 0, source: String(r.source || ''), teacher: r.evidence?.teacher || null, via: x.via, status: x.status } as LearnedItem
        }).filter(Boolean) as LearnedItem[]
        // A row saved by `remember` before the chat was logged learns which chat taught it.
        if (chatId) await Promise.all(((data as any[]) || []).filter(r => !r.evidence?.chatId).map(r => db.from('eve_memory').update({ evidence: { ...(r.evidence && typeof r.evidence === 'object' ? r.evidence : {}), chatId, conversationId } }).eq('id', r.id))).catch(() => null)
      } catch { learned = [] }
    }
    const usedSet = new Set(usedIds)
    const used: UsedItem[] = memories.filter(m => usedSet.has(m.id)).slice(0, 10).map(m => ({ id: m.id, kind: m.kind, text: mask(String(m.text || '')).slice(0, 400), source: m.source === 'jon' ? 'jon' : (m.evidence?.teacher || (m.created_by ? String(m.created_by) : m.source)) }))
    if (conversationId && !isProbe) {
      try { await db.from('eve_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId) } catch { /* migration 171 not run */ }
    }

    return {
      ok: true,
      reply: finalText,
      logReply,
      chatId,
      conversationId,
      meta: { turns, ms: Date.now() - startedAt, tools: toolsUsed, domains: open, memories: memories.length, moneyRedacted: !canMoney, webSearch: webOk ? 'available' : 'unavailable-on-this-model', usage, memoryHits, learned, used, teacher: teacher.teacher ? { tier: teacher.tier, maxWeight: teacher.maxWeight } : null, conversationId },
    }
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || String(e) }
  }
}
