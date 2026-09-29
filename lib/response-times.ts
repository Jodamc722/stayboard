// HOW FAST DID WE ACTUALLY ANSWER THE GUEST.
//
// Jon, 2026-08-26, asked Eve to understand "response time". She could not: the number existed in
// exactly one place — a `computeKpis()` closure inside app/messages/page.tsx, recomputed from the
// last 4,000 messages on every page load, never written down, reachable by no tool and no report.
//
// This is that math, moved somewhere both the page and Eve can reach, and materialised per
// conversation so a question about last month does not mean re-reading the message table.
// (2026-09-28: the page's closure is gone — its header now reads this table too.)
//
// TWO NUMBERS, AND THE GAP BETWEEN THEM IS THE POINT.
//   first_ms       — guest asks, first host reply lands. What the old page measured.
//   human_first_ms — the same, ignoring replies we can prove were automated.
// Guesty fires template messages AS the host. Counting those as "we answered in 40 seconds" is
// how a team congratulates itself on a robot's reflexes. Where we cannot tell (is_automated is
// null, the common case for old rows), human_first_ms is left NULL rather than assumed human:
// an honest gap beats a flattering guess, and the tools say which is which.
//
// A REPLY THAT NEVER CAME IS NOT A FAST REPLY. If the guest speaks again before we do, the clock
// keeps running on the FIRST question — it does not reset — and a thread whose last word is the
// guest's counts as awaiting, never as answered.
//
// ONE "WAITING ON US" RULE (2026-09-28 audit, D3/D4/D5). There were five: the inbox (last message
// is the guest's, templates count as answers), this table (any host row answers), Eve's watch
// (this table + a daytime window), the sentiment scan (frozen at scan time) and the Command
// Center (Guesty's unread flag). The inbox pill, the Needs-reply tab, the Command Center and Eve
// disagreed about the same guest. Now there is one, defined here and stored here:
//   · AWAITING — the guest has written since the last host reply a PERSON could have sent. A reply
//     proven automated (is_automated true: a Guesty template) does not answer anyone; an
//     unclassified one (null) is given the benefit of the doubt, so this never cries wolf.
//     Guesty's internal entries (log, note, …) are neither question nor answer.
//   · AWAITING_SINCE — the first guest message of that unanswered run. The clock does not reset
//     when the guest follows up.
//   · SLA_DUE_AT — a reply is due 60 minutes later when the message came in between 08:00 and
//     22:00 ET, or on the guest's arrival day at any hour; overnight messages are due at 08:00 ET.
// awaitingSet() below is the one reader: the /messages pills and Needs-reply tab use it, and the
// Command Center and Eve are meant to (see the build report).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'
import { pageRows } from './db-page'

export type ConversationResponse = {
  conversation_id: string
  reservation_id: string | null
  listing_id: string | null
  building: string | null
  channel: string | null
  first_ms: number | null
  human_first_ms: number | null
  replies: number
  guest_msgs: number
  awaiting: boolean
  /** First guest message nobody (a person, or someone we cannot rule out) has answered. Migration 134. */
  awaiting_since: string | null
  /** When a reply is due under the SLA rule above. Null when nobody is waiting. Migration 134. */
  sla_due_at: string | null
  last_guest_at: string | null
  last_host_at: string | null
  last_responder: string | null
}

type Msg = { conversation_id: string; sender: string; sender_name: string | null; sent_at: string; is_automated: boolean | null; module?: string | null }

// NOT EVERY "host" ROW IS A REPLY. Guesty files its own activity entries into the same thread —
// `log` ("New guest inquiry") and `note` (an internal note nobody outside ever saw). There are
// thousands of them and none was typed to a guest, so counting one as our answer would have shown
// a portfolio replying in seconds while a real person had not looked yet. They are skipped
// entirely, exactly like a `system` row: neither a question nor an answer. Same set as Eve's
// watches (lib/eve/watches.ts INTERNAL_MODULES), so the two can never disagree about a note.
const NOT_A_MESSAGE = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])

// ---- The reply SLA ---------------------------------------------------------------------------------
export const SLA_REPLY_MINUTES = 60
export const SLA_DAY_START_H = 8
export const SLA_DAY_END_H = 22
/** How far back a waiting guest still counts as waiting. A "thanks!" from last week is not a queue. */
export const AWAITING_HORIZON_H = 72
/** One line for hovers, so every surface explains the rule the same way. */
export const SLA_RULE_TEXT = 'a reply is due within 1h of a message sent 8am–10pm ET or on the guest’s arrival day; overnight messages are due by 8am'

const ET_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function etParts(ms: number): { ymd: string; hour: number } {
  const p: Record<string, string> = {}
  for (const x of ET_PARTS.formatToParts(new Date(ms))) p[x.type] = x.value
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}
/** Epoch ms of HH:00 ET on an ET calendar date. DST-safe: the offset is read at noon UTC that day. */
function etWallMs(ymd: string, hour: number): number {
  const offsetH = 12 - etParts(Date.parse(ymd + 'T12:00:00Z')).hour   // 4 in EDT, 5 in EST
  return Date.parse(ymd + 'T00:00:00Z') + (hour + offsetH) * 3600_000
}
function nextYmd(ymd: string): string {
  return new Date(Date.parse(ymd + 'T12:00:00Z') + 86400_000).toISOString().slice(0, 10)
}

/**
 * When is a reply to a guest message sent at `since` due? `checkIn` is the reservation's check-in
 * date (YYYY-MM-DD) — on arrival day every message is on the 60-minute clock, whatever the hour.
 */
export function slaDueAt(since: string | null | undefined, checkIn?: string | null): string | null {
  const t = since ? Date.parse(since) : NaN
  if (!Number.isFinite(t)) return null
  const p = etParts(t)
  const arrivalDay = !!checkIn && String(checkIn).slice(0, 10) === p.ymd
  if ((p.hour >= SLA_DAY_START_H && p.hour < SLA_DAY_END_H) || arrivalDay) return new Date(t + SLA_REPLY_MINUTES * 60_000).toISOString()
  // Overnight: 08:00 ET — the same morning when it came in before 8, the next one after 10pm.
  const day = p.hour < SLA_DAY_START_H ? p.ymd : nextYmd(p.ymd)
  return new Date(etWallMs(day, SLA_DAY_START_H)).toISOString()
}

/**
 * Walk one thread in time order and pull out the response facts.
 * Exported so the messages page and any future report share ONE definition of "first response" —
 * two subtly different definitions of the same KPI is how two dashboards end up disagreeing in a
 * meeting. `ctx.checkIn` (the booking's check-in date) only feeds the arrival-day SLA exception.
 */
export function analyseThread(sorted: Msg[], ctx: { checkIn?: string | null } = {}): Omit<ConversationResponse, 'conversation_id' | 'reservation_id' | 'listing_id' | 'building' | 'channel'> {
  let firstMs: number | null = null
  let humanMs: number | null = null
  let firstPairDone = false
  // The human clock starts at the thread's first guest message and stops once (see below).
  let humanOpenAt: number | null = null
  let humanDone = false
  let replies = 0
  let guestMsgs = 0
  let lastGuestAt: string | null = null
  let lastHostAt: string | null = null
  let lastResponder: string | null = null

  // The open guest question we are still waiting to answer, if any (any host reply closes it —
  // this is what first_ms measures).
  let openGuestAt: number | null = null
  // THE WAITING RUN (the one rule above): opened by the first guest message after the last reply a
  // person could have sent, closed only by such a reply. A template does not close it.
  let waitingIso: string | null = null

  for (const m of sorted) {
    const t = new Date(m.sent_at).getTime()
    if (!Number.isFinite(t)) continue
    if (m.module && NOT_A_MESSAGE.has(String(m.module).toLowerCase())) continue
    if (m.sender === 'guest') {
      guestMsgs++
      lastGuestAt = m.sent_at
      // Only the FIRST unanswered question starts the clock. A guest who follows up twice while
      // waiting has not reset our stopwatch.
      if (openGuestAt === null) openGuestAt = t
      if (humanOpenAt === null) humanOpenAt = t
      if (waitingIso === null) waitingIso = m.sent_at
    } else if (m.sender === 'host') {
      // human_first_ms: the SAME first guest message, to the first reply a person typed. Known
      // template replies (is_automated true) are skipped — the clock keeps running past them, which
      // is the whole point of the second number. The first reply we cannot classify (null) ends it
      // with no number: it may have been the human answer, and we will not guess which.
      if (humanOpenAt !== null && !humanDone && m.is_automated !== true) {
        const hg = t - humanOpenAt
        if (hg >= 0 && m.is_automated === false) humanMs = hg
        humanDone = true
      }
      // A template is not an answer to the guest who is waiting.
      if (m.is_automated !== true) waitingIso = null
      replies++
      lastHostAt = m.sent_at
      lastResponder = m.sender_name || 'Team'
      if (openGuestAt !== null) {
        const gap = t - openGuestAt
        // THE FIRST RESPONSE IS THE FIRST ONE, NOT THE FASTEST (Jon, 2026-09-23 review). This kept
        // `gap < firstMs` — the quickest of every guest→host exchange in the thread — so a guest who
        // waited nine hours for a first answer and later got a two-minute reply was filed as a
        // two-minute thread. first_ms is now the first guest message → the first host reply after
        // it, set once and never lowered.
        if (gap >= 0 && !firstPairDone) { firstMs = gap; firstPairDone = true }
        openGuestAt = null
      }
    }
    // 'system' messages are Guesty's own notices. They are neither a question nor an answer.
  }

  return {
    first_ms: firstMs,
    human_first_ms: humanMs,
    replies,
    guest_msgs: guestMsgs,
    awaiting: waitingIso !== null,
    awaiting_since: waitingIso,
    sla_due_at: slaDueAt(waitingIso, ctx.checkIn),
    last_guest_at: lastGuestAt,
    last_host_at: lastHostAt,
    last_responder: lastResponder,
  }
}

/** Is this PostgREST error "the migration 134 columns are not there yet"? */
function missingSlaColumns(err: any): boolean {
  const code = String(err?.code || '')
  return code === '42703' || code === 'PGRST204' || /awaiting_since|sla_due_at/i.test(String(err?.message || ''))
}
function stripSla<T extends Record<string, any>>(row: T): T {
  const out: any = { ...row }
  delete out.awaiting_since
  delete out.sla_due_at
  return out as T
}

type ConvRow = { id: string; reservation_id: string | null; listing_id: string | null; channel: string | null }
export type StoreOut = { written: number; skipped: number; slaColumns: boolean; error?: string }

/** Recompute and upsert response stats for these conversations. Shared by the cron and single sends. */
async function storeStats(db: any, list: ConvRow[]): Promise<StoreOut> {
  const out: StoreOut = { written: 0, skipped: 0, slaColumns: true }
  if (!list.length) return out

  // Name/building resolution, for this batch only.
  const meta: Record<string, { building: string }> = {}
  const lids = Array.from(new Set(list.map(c => String(c.listing_id || '')).filter(Boolean)))
  for (let i = 0; i < lids.length; i += 200) {
    try {
      const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').in('id', lids.slice(i, i + 200))
      for (const l of ((ls as any[]) || [])) meta[String(l.id)] = { building: rollupBuilding(String(l.building || ''), l.nickname || l.title || '') }
    } catch { /* building slicing degrades, the numbers do not */ }
  }

  // Check-in dates, for the arrival-day SLA exception. Best effort: without them the daytime rule
  // still applies.
  const checkIn: Record<string, string> = {}
  const rids = Array.from(new Set(list.map(c => String(c.reservation_id || '')).filter(Boolean)))
  for (let i = 0; i < rids.length; i += 200) {
    try {
      const { data: rs } = await db.from('guesty_reservations').select('id,check_in').in('id', rids.slice(i, i + 200))
      for (const r of ((rs as any[]) || [])) if (r.check_in) checkIn[String(r.id)] = String(r.check_in).slice(0, 10)
    } catch { /* see above */ }
  }

  const rows: any[] = []
  // Chunked .in() — PostgREST chokes on very long id lists.
  for (let i = 0; i < list.length; i += 40) {
    const slice = list.slice(i, i + 40)
    const ids = slice.map(c => String(c.id))
    // PAGED (2026-09-28 audit, 05 P1-10). This was `.limit(4000)`, which PostgREST caps at 1,000:
    // forty long threads ran past it and lost their NEWEST messages, so `awaiting` and the last
    // host reply came out wrong for the tail of every batch. A chunk that still does not fit is
    // skipped this run — a stale row is better than a wrong one.
    const page = await pageRows<Msg & { id?: string }>((a, b) => db.from('guesty_messages')
      .select('id,conversation_id,sender,sender_name,sent_at,is_automated,module')
      .in('conversation_id', ids)
      .order('sent_at', { ascending: true }).order('id', { ascending: true })
      .range(a, b))
    if (page.truncated) { out.skipped += slice.length; continue }

    const byConv: Record<string, Msg[]> = {}
    for (const m of page.rows) {
      const cid = String(m.conversation_id)
      ;(byConv[cid] = byConv[cid] || []).push(m as Msg)
    }
    for (const c of slice) {
      const cid = String(c.id)
      const thread = byConv[cid]
      if (!thread || !thread.length) continue
      const a = analyseThread(thread, { checkIn: c.reservation_id ? checkIn[String(c.reservation_id)] || null : null })
      const lm = meta[String(c.listing_id)] || null
      rows.push({
        conversation_id: cid,
        reservation_id: c.reservation_id || null,
        listing_id: c.listing_id || null,
        building: lm?.building || null,
        channel: c.channel || null,
        ...a,
        computed_at: new Date().toISOString(),
      })
    }
  }

  // Upsert in batches; one oversized payload is how this kind of job starts timing out at 3am.
  // BEFORE MIGRATION 134 the two SLA columns do not exist: the first refusal drops them for the rest
  // of the run, and everything else is written exactly as before.
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    let { error } = await db.from('conversation_response').upsert(out.slaColumns ? batch : batch.map(stripSla), { onConflict: 'conversation_id' })
    if (error && out.slaColumns && missingSlaColumns(error)) {
      out.slaColumns = false
      ;({ error } = await db.from('conversation_response').upsert(batch.map(stripSla), { onConflict: 'conversation_id' }))
    }
    if (!error) out.written += batch.length
    else out.error = String(error.message || error).slice(0, 200)
  }
  return out
}

/**
 * Recompute and store response stats for conversations that have moved.
 * Called at the end of the guest-comms sync, so the numbers are never more stale than the
 * messages they are made of.
 */
export async function refreshResponseStats(opts: { sinceHours?: number; limit?: number } = {}): Promise<{ conversations: number; written: number; skipped?: number; slaColumns?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const sinceHours = Math.min(Math.max(opts.sinceHours ?? 48, 1), 24 * 90)
  const limit = Math.min(Math.max(opts.limit ?? 400, 1), 2000)
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString()

  try {
    // RULE 2 (lib/eve/ctx.ts): order before limit, always. Unordered paging on PostgREST silently
    // duplicates and skips rows, and a response-time table built on skipped rows is worse than none.
    // Paged, so the `convos=2000` backfill lever is not quietly cut at 1,000.
    const convPage = await pageRows<any>((a, b) => db.from('guesty_conversations')
      .select('id,reservation_id,listing_id,channel,last_message_at')
      .gte('last_message_at', since)
      .order('last_message_at', { ascending: false }).order('id', { ascending: true })
      .range(a, Math.min(b, limit - 1)), Math.ceil(limit / 1000))
    const list = (convPage.rows as ConvRow[]).slice(0, limit)
    if (!list.length) return convPage.truncated ? { conversations: 0, written: 0, error: 'could not read conversations' } : { conversations: 0, written: 0 }
    const r = await storeStats(db, list)
    return { conversations: list.length, written: r.written, skipped: r.skipped || undefined, slaColumns: r.slaColumns, error: r.error }
  } catch (e: any) {
    return { conversations: 0, written: 0, error: String(e?.message || e) }
  }
}

/**
 * Recompute ONE conversation now — after a reply is sent from the app, so the thread leaves the
 * Needs-reply queue on the next page load instead of at the next guest-comms run.
 */
export async function refreshConversationStats(conversationId: string): Promise<StoreOut | null> {
  const id = String(conversationId || '').trim()
  if (!id) return null
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('guesty_conversations').select('id,reservation_id,listing_id,channel').eq('id', id).maybeSingle()
    if (error || !data) return null
    return await storeStats(db, [data as ConvRow])
  } catch { return null }
}

// ---- THE ONE READER --------------------------------------------------------------------------------

export type AwaitingRow = {
  conversation_id: string
  reservation_id: string | null
  listing_id: string | null
  channel: string | null
  last_guest_at: string | null
  awaiting_since: string | null
  sla_due_at: string | null
  overdue: boolean
}
export type AwaitingSet = {
  rows: AwaitingRow[]
  /** Conversation ids, in the same order (newest guest message first). */
  ids: string[]
  /** How many are past their reply-by time. */
  overdue: number
  /** False until migration 134 has run: rows have no SLA, only "waiting". */
  slaKnown: boolean
  /** True if the read hit the 1,000-row page — say so rather than show a short count as complete. */
  truncated: boolean
  error?: string
}

const isoNoMs = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z'

/**
 * Every guest waiting on us right now, by the one rule above: awaiting, and the wait started within
 * the last AWAITING_HORIZON_H hours. `overdue` is past sla_due_at.
 *
 * Rows computed before migration 134 (or before their thread moved again) carry no awaiting_since;
 * they fall back to last_guest_at for the horizon and simply have no reply-by time.
 */
export async function awaitingSet(opts: { db?: any; now?: number; horizonHours?: number } = {}): Promise<AwaitingSet> {
  const db = opts.db || supabaseAdmin()
  const now = opts.now ?? Date.now()
  const from = isoNoMs(now - (opts.horizonHours ?? AWAITING_HORIZON_H) * 3600_000)
  const cols = 'conversation_id,reservation_id,listing_id,channel,last_guest_at'
  let slaKnown = true
  let res: any = await db.from('conversation_response').select(cols + ',awaiting_since,sla_due_at')
    .eq('awaiting', true)
    .or(`awaiting_since.gte.${from},and(awaiting_since.is.null,last_guest_at.gte.${from})`)
    .order('last_guest_at', { ascending: false }).order('conversation_id', { ascending: true })
    .limit(1000)
  if (res.error && missingSlaColumns(res.error)) {
    slaKnown = false
    res = await db.from('conversation_response').select(cols)
      .eq('awaiting', true).gte('last_guest_at', from)
      .order('last_guest_at', { ascending: false }).order('conversation_id', { ascending: true })
      .limit(1000)
  }
  if (res.error) return { rows: [], ids: [], overdue: 0, slaKnown: false, truncated: false, error: String(res.error.message || res.error).slice(0, 200) }
  const data: any[] = res.data || []
  const rows: AwaitingRow[] = data.map(r => {
    const due = slaKnown && r.sla_due_at ? String(r.sla_due_at) : null
    return {
      conversation_id: String(r.conversation_id),
      reservation_id: r.reservation_id || null,
      listing_id: r.listing_id || null,
      channel: r.channel || null,
      last_guest_at: r.last_guest_at || null,
      awaiting_since: slaKnown && r.awaiting_since ? String(r.awaiting_since) : null,
      sla_due_at: due,
      overdue: !!due && Date.parse(due) <= now,
    }
  })
  return {
    rows,
    ids: rows.map(r => r.conversation_id),
    overdue: rows.filter(r => r.overdue).length,
    slaKnown,
    truncated: data.length >= 1000,
  }
}

export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null
  const m = ms / 60000
  if (m < 1) return `${Math.round(ms / 1000)}s`
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function median(list: number[]): number | null {
  const a = list.filter(n => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2)
}
