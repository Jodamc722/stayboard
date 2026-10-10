// THE EYES (2026-09-21). Eight standing watches, each a deterministic trigger over the same day
// picture the boards read, each producing a PREPARED action — the full executor payload plus a
// one-line ask — that goes through the same agentAllowed → stepDown path as everything else. So the
// rungs, quiet hours and budgets apply exactly as they do to anything Eve does from chat: at rung 3
// the watch acts and logs an undo; at rung 2 it asks on Telegram; at rung 1 it drafts; OFF it only
// observes and spends nothing.
//
// Jon: "Continue to improve Eve's agentic abilities… long-term goal is for her to be a real team
// member." A team member notices. These are the things a good coordinator notices without being
// asked: a guest waiting, a late clean with nobody on it, a big arrival nobody has walked, a bad
// review that just landed, a listing that fell off Airbnb, a glitch past due with no task, the
// snack cupboard running low, a guest arriving today who has never answered.
//
// NEVER THE SAME ASK TWICE. eve_watch_fires keys (watch, subject) — a unit, a thread, a task — and
// the watch's cooldown decides how long that subject is quiet. A watch also fires at most FIVE
// subjects per run, so a bad morning is five asks, not fifty.
//
// eve_watches (migration 045, undriven until migration 102) holds the switch, the cooldown, the
// receipts and an optional rung override per watch; the trigger functions live here, keyed by
// `key`. If migration 102 has not run the runner does nothing and says so.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { agentAllowed, stepDown, getAgentSettings, logAgent, OWNER, type ActionType, type AgentSettings, type AgentVerdict, type Mode } from './agent-mode'
import type { CommandDay } from '@/lib/command-day'
import type { DayPicture } from '@/lib/capacity-day'
import { shapeOf, recordThought } from './thoughts'
import { awaitingSet, slaDueAt } from '@/lib/response-times'
import { GUEST_REPLY_SYSTEM } from '@/lib/guest-reply-draft'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const hourET = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(d)) % 24
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400_000))
const MAX_PER_WATCH = 5
/** The watches that still run outside 07:00–22:00 ET (F43): a guest waiting, a silent arrival. */
const NIGHT_WATCHES = ['guest_unanswered_1h', 'no_show_risk']
/**
 * The never-assign list (lib/never-assign, Jon 2026-09-30): a watch never proposes one of those people.
 * Fails open to "nobody blocked" — the executors and lib/breezeway still refuse them at write time.
 */
async function neverAssign(): Promise<{ blocks: (p: any) => boolean }> {
  try { const { neverAssignGuard } = await import('@/lib/never-assign'); return await neverAssignGuard() } catch { return { blocks: () => false } }
}
/** Guesty activity logs and internal notes (the `module` on guesty_messages) — never sent to a guest. */
const INTERNAL_MODULES = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])

export type WatchKey =
  | 'guest_unanswered_1h' | 'clean_late' | 'big_arrival_uninspected' | 'bad_review_in'
  | 'channel_broken' | 'glitch_overdue' | 'stock_low' | 'no_show_risk'

/** One thing a watch found, with everything the executor needs — or a `prepare` that builds it. */
export type Prepared = {
  /** Cooldown key: a unit, a thread, a task, a review. */
  subject: string
  action: ActionType
  /** The one-line ask — this is what Telegram shows after "Eve wants to:". */
  ask: string
  why: string
  /** The executor payload, or a function that builds it (AI drafts are built only when the rung is above observe). */
  exec: any | (() => Promise<any | null>)
  metric?: string
  usd?: number
  /** A flag, not an action: recorded on the Thinking tab and never carried out, whatever the rung. */
  observeOnly?: boolean
  /** The unit this is about, so a decline is remembered per BUILDING, not per watch (lib/eve/thoughts shapeOf). */
  unit?: string | null
}

export type WatchDef = {
  key: WatchKey
  title: string
  what: string
  action: ActionType
  /** Default cooldown (hours) when the row has none. */
  cooldownHours: number
  /** Never above this mode whatever the rung says (channel_broken proposes, always). */
  maxMode?: 'propose'
  trigger: (env: WatchEnv) => Promise<Prepared[]>
}

/** Lazily-built shared reads, so eight watches do not build the day picture eight times. */
export type WatchEnv = {
  today: string
  now: Date
  settings: AgentSettings
  commandDay: () => Promise<CommandDay | null>
  dayPicture: () => Promise<DayPicture | null>
  automation: () => Promise<any>
  db: ReturnType<typeof supabaseAdmin>
  /**
   * The last five reasons Jon gave when he declined this SHAPE of proposal (lib/eve/thoughts.ts
   * shapeOf; lib/eve/learning-audit.ts declinedShapes). Empty means never declined. A trigger
   * that drafts with a model can read these into its prompt; the run loop below also skips a
   * declined shape outright and records the skip as a thought, so the correction is visible.
   */
  declinedReasons: (shape: string) => string[]
}

function makeEnv(settings: AgentSettings, declined: Record<string, { reasons: string[] }> = {}): WatchEnv {
  let cd: Promise<CommandDay | null> | null = null
  let dp: Promise<DayPicture | null> | null = null
  let au: Promise<any> | null = null
  return {
    today: ymdET(), now: new Date(), settings, db: supabaseAdmin(),
    declinedReasons: (shape: string) => (declined[shape]?.reasons || []).slice(0, 5),
    // money: true — a cron has no viewer to look up, and no watch reads the refund rows it would hide.
    commandDay: () => cd || (cd = import('@/lib/command-day').then(m => m.buildCommandDay({ money: true })).catch(() => null)),
    dayPicture: () => dp || (dp = import('@/lib/capacity-day').then(m => m.buildDayPicture(ymdET())).catch(() => null)),
    automation: () => au || (au = import('@/lib/auto-inspections').then(m => m.getTaskAutomation()).catch(() => null)),
  }
}

// ---- AI drafts (aiFetch, task keys in AI_TASKS) ----------------------------------------------------

async function askModel(task: string, system: string, user: string, maxTokens = 400): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return ''
  try {
    const { modelPairFor } = await import('@/lib/ai-models')
    const { anthropicMessages, textOf } = await import('@/lib/anthropic-call')
    const { model, fallback } = await modelPairFor(task)
    const r = await anthropicMessages(key, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, fallback, task)
    if (!r.ok) { console.error('[watches] model call failed', task, r.status, JSON.stringify(r.data).slice(0, 300)); return '' }
    return str(textOf(r.data)).trim()
  } catch (e: any) { console.error('[watches] model call threw', task, String(e?.message || e)); return '' }
}

// GUEST_REPLY_SYSTEM is lib/guest-reply-draft's — the one voice, whether this watch or a person's
// "Draft with Eve" on the thread asked for the draft.

const REVIEW_REPLY_SYSTEM = `You write short PUBLIC replies to guest reviews for "Stay Hospitality". We are the team ("we", "our team"), never "the host". Always English. 2-3 sentences, 45 words or fewer, warm and plain. Respond to the feeling, not the specific defect: do not admit fault, restate or concede the problem, and do not promise refunds. No filler phrases, no idioms, no emojis, no unit or building names. Output only the reply.`

// ---- The eight ------------------------------------------------------------------------------------

// THE ONE "WAITING ON US" RULE (lib/response-times, 2026-09-28 audit D3–D5). This watch kept its own
// window — the guest's last message over an hour old, 8am–10pm ET, any hour for today's arrivals —
// so Eve, the inbox and the Command Center could disagree about the same guest. It now takes the
// inbox's own waiting set and raises a thread once it is past its reply-by time: 60 minutes for a
// message sent 8am–10pm ET or on the guest's arrival day, 8am for one sent overnight.
async function guestUnanswered(env: WatchEnv): Promise<Prepared[]> {
  const db = env.db
  const nowMs = env.now.getTime()
  const set = await awaitingSet({ db, now: nowMs })
  if (set.error) throw new Error('could not read who is waiting: ' + set.error)
  // Past its stored reply-by time — or with none stored yet (a row computed before migration 134, or
  // before its thread moved again), decided below by the same rule once its check-in is known.
  const cands = set.rows.filter(r => r.overdue || !r.sla_due_at)
  if (!cands.length) return []
  const resIds = cands.map(r => str(r.reservation_id)).filter(Boolean)
  const resById: Record<string, any> = {}
  if (resIds.length) {
    const { data: rs } = await db.from('guesty_reservations').select('id,guest_name,listing_name,check_in,check_out,nights,status').in('id', resIds.slice(0, 200))
    for (const r of ((rs as any[]) || [])) resById[str(r.id)] = r
  }
  const out: Prepared[] = []
  for (const r of cands) {
    const res = resById[str(r.reservation_id)]
    const due = r.sla_due_at || slaDueAt(r.awaiting_since || r.last_guest_at, res ? str(res.check_in).slice(0, 10) : null)
    if (!due || Date.parse(due) > nowMs) continue
    if (res && /cancel|declin|inquir/i.test(str(res.status))) continue
    if (out.length >= 30) break
    const arrivesToday = !!res && str(res.check_in).slice(0, 10) === env.today
    const convId = str(r.conversation_id)
    const waitedMs = nowMs - Date.parse(str(r.awaiting_since || r.last_guest_at))
    const waited = !Number.isFinite(waitedMs) ? 'a while' : waitedMs < 3600_000 ? `${Math.max(1, Math.round(waitedMs / 60_000))}m` : `${Math.round(waitedMs / 3600_000)}h`
    const guest = str(res?.guest_name) || 'the guest'
    const unit = str(res?.listing_name) || ''
    out.push({
      subject: `thread:${convId}`, action: 'guest_reply_draft', metric: 'sentiment_negative', unit: unit || null,
      ask: `draft a reply to ${guest}${unit ? ` (${unit})` : ''} — waiting ${waited} on ${str(r.channel) || 'their thread'}${arrivesToday ? ', arriving TODAY' : ''}? (it waits on the thread for Send; nothing reaches the guest yet)`,
      why: `The guest has waited ${waited} with no answer — past the reply-by time.`,
      exec: async () => {
        // INTERNAL ENTRIES ARE NOT THE CONVERSATION (Jon, 2026-09-23 review). Guesty files activity
        // logs and internal team notes into the same thread. They were fed to the model as "US:"
        // lines — so a note like "owner says no refund" could be paraphrased to the guest — and a
        // note typed AFTER the guest's message counted as our reply and suppressed the draft
        // altogether. Rows whose module is a log / note / internal entry are dropped before either
        // test (older rows can carry a log module under 'host' or 'guest', so the module decides,
        // not the sender). Read deeper than we show so a run of notes cannot empty the window.
        const { data: msgs } = await db.from('guesty_messages').select('sender,sender_name,body,sent_at,module,is_automated').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(40)
        const all = ((msgs as any[]) || []).filter(m => !INTERNAL_MODULES.has(str(m.module).toLowerCase())).slice(0, 12)
        // conversation_response is refreshed by the guest-comms cron; the mirror is fresher. If we
        // (or Eve, via Send) have answered since, there is nothing to draft. A GUESTY TEMPLATE IS NOT
        // AN ANSWER (2026-09-28 audit, F18): Guesty sends its automations as the host, so a check-in
        // template after the guest's question used to read as "we replied" and suppress the draft.
        const lastReal = all.find(m => m.sender === 'guest' || (m.sender === 'host' && m.is_automated !== true))
        if (!lastReal || lastReal.sender !== 'guest') return null
        const thread = all.filter(m => m.sender === 'guest' || m.sender === 'host').slice().reverse().map(m => `${m.sender === 'guest' ? 'GUEST' : 'US'}: ${str(m.body).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
        if (!thread) return null
        const facts = res ? `Guest: ${guest}. Unit: ${unit}. Stay: ${str(res.check_in).slice(0, 10)} to ${str(res.check_out).slice(0, 10)} (${res.nights || '?'} nights). Channel: ${str(r.channel)}.` : `Channel: ${str(r.channel)}.`
        const draft = await askModel('guest-reply', GUEST_REPLY_SYSTEM, `${facts}\n\nTHREAD (oldest first):\n${thread}\n\nWrite our reply to the guest's last message.`)
        if (!draft) return null
        return { conversationId: convId, draft, guest, unit, channel: str(r.channel), why: `Guest waited ${waited} with no answer.` }
      },
    })
  }
  return out
}

async function cleanLate(env: WatchEnv): Promise<Prepared[]> {
  const cd = await env.commandDay()
  if (!cd) return []
  // FROM THE MORNING, NOT AT 2PM (independent audit 2026-10-10): a same-day turn with nobody on it was
  // proposed only once it was already "at risk" (two hours before the guest), so the first ask landed
  // around 2:20pm for a clean that takes two. An unassigned same-day turn is a gap the moment the day
  // starts; it is proposed then, to whoever has headroom.
  const late = cd.tiles.cleans.rows.filter(c => (c.status === 'late' || c.status === 'atRisk' || (c.sameDay && c.status === 'open')) && !str(c.who).trim())
  if (!late.length) return []
  const dp = await env.dayPicture()
  if (!dp) return []
  // Each person's market is where their stops are; headroom is the capacity model's own number.
  const people = dp.people.map(p => {
    const counts: Record<string, number> = {}
    for (const s of p.ordered || []) { const m = str(s.market); if (m) counts[m] = (counts[m] || 0) + 1 }
    const market = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null
    return { name: p.person, market, headroom: Number(p.headroomCleans) || 0, verdict: p.verdict }
  }).filter(p => p.headroom > 0 && p.verdict !== 'implausible')
  const never = await neverAssign()
  const pool = people.filter(p => !never.blocks(p.name))
  const out: Prepared[] = []
  const taken: Record<string, number> = {}
  for (const c of late) {
    const fit = pool
      .filter(p => !c.market || !p.market || p.market === c.market)
      .sort((a, b) => (b.market === c.market ? 1 : 0) - (a.market === c.market ? 1 : 0) || (b.headroom - (taken[b.name] || 0)) - (a.headroom - (taken[a.name] || 0)))
      .find(p => p.headroom - (taken[p.name] || 0) > 0)
    if (!fit) continue
    taken[fit.name] = (taken[fit.name] || 0) + 1
    out.push({
      subject: `task:${c.taskId}`, action: 'task_assign', metric: 'cleans_unassigned', unit: c.unit || null,
      ask: `put ${fit.name} on the ${c.status === 'late' ? 'late' : c.status === 'atRisk' ? 'at-risk' : 'same-day'} clean at ${c.unit}${c.arrivingAt ? ` (guest lands ${c.arrivingAt})` : ''}?`,
      why: `${c.unit} is ${c.status === 'late' ? 'late' : c.status === 'atRisk' ? 'at risk' : 'a same-day turn'} with nobody assigned; ${fit.name} is on shift in ${fit.market || c.market || 'the market'} with room for ${fit.headroom} more clean${fit.headroom === 1 ? '' : 's'}.`,
      exec: { taskId: c.taskId, person: fit.name },
    })
  }
  return out
}

async function bigArrivalUninspected(env: WatchEnv): Promise<Prepared[]> {
  const cd = await env.commandDay()
  if (!cd) return []
  const limit = shift(env.today, 2)
  // 'auto' rows are Task automation's to file — only 'none' (automation off) is hers to raise.
  const rows = cd.tiles.arrivals.rows.filter(a => a.big && a.inspection === 'none' && a.listingId && a.checkIn >= env.today && a.checkIn <= limit)
  if (!rows.length) return []
  const cfg = await env.automation()
  // NOT ASKED WHEN AUTOMATED (Jon, 2026-09-30: inspections "shouldn't be required or asked for"):
  // with the master switch and big arrivals on, the cron creates and assigns it — nothing to ask.
  if (cfg && cfg.enabled && cfg.bigArrivals) return []
  const never = await neverAssign()
  const out: Prepared[] = []
  for (const a of rows) {
    const market = cd.tiles.cleans.rows.find(c => c.unit === a.unit)?.market || null
    const sup = cfg ? (cfg.supervisors[market || 'Miami'] || cfg.supervisors.Miami) : ''
    const assignees = Array.from(new Set([cfg?.assignAlways, sup].filter(Boolean))).filter(n => !never.blocks(n))
    out.push({
      subject: `res:${a.reservationId}`, action: 'task_create', metric: 'low_reviews', unit: a.unit || null,
      ask: `create a pre-arrival inspection on ${a.unit} for ${a.checkIn} (${a.guest}, $${Math.round(a.value).toLocaleString('en-US')}) and give it to ${assignees.join(' + ') || 'the supervisor'}?`,
      why: `A $${Math.round(a.value).toLocaleString('en-US')} arrival ${a.checkIn === env.today ? 'today' : 'on ' + a.checkIn} with no inspection on the books.`,
      exec: {
        listingId: a.listingId, title: `Pre-arrival inspection — ${a.unit} (big arrival)`, department: 'inspection', priority: 'high', date: a.checkIn, assignees,
        autoInspectionKey: a.reservationId, autoInspectionReason: 'big arrival', guest: a.guest,
        description: `BIG ARRIVAL ${a.checkIn}.\nGuest: ${a.guest} · ${a.nights} night${a.nights === 1 ? '' : 's'} · $${Math.round(a.value).toLocaleString('en-US')}\nWalk the unit AFTER the turn and BEFORE the guest lands: cleanliness to standard, AC cooling, hot water, wifi, door code working, no maintenance flags. Photograph anything off and file it before check-in.`,
      },
    })
  }
  return out
}

async function badReviewIn(env: WatchEnv): Promise<Prepared[]> {
  const db = env.db
  const since = new Date(env.now.getTime() - 48 * 3600_000).toISOString()
  const { data } = await db.from('guesty_reviews').select('id,listing_id,rating,content,guest_name,channel,created_at,has_reply')
    .gte('created_at', since).eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(60)
  const norm = (v: any) => { const n = Number(v); return Number.isFinite(n) ? (n > 5 ? n / 2 : n) : NaN }
  let low = ((data as any[]) || []).filter(r => { const n = norm(r.rating); return Number.isFinite(n) && n > 0 && n <= 3 })
  if (!low.length) return []
  // The low-review automation (lib/auto-inspections.ts) may already have filed the inspection.
  try {
    const { data: done } = await db.from('auto_inspections').select('reservation_id,task_id').in('reservation_id', low.map(r => 'rev:' + str(r.id)))
    const has = new Set(((done as any[]) || []).filter(d => d.task_id).map(d => str(d.reservation_id)))
    low = low.map(r => ({ ...r, _inspected: has.has('rev:' + str(r.id)) }))
  } catch { /* no table: nothing filed */ }
  const lids = Array.from(new Set(low.map(r => str(r.listing_id)).filter(Boolean)))
  // Belt and braces: an open "Quality inspection" task already on the unit (from the automation, a
  // person, or a previous run of this watch before its receipt landed) means no second task.
  try {
    const { data: open } = await db.from('breezeway_tasks_sync').select('reference_property_id,name').in('reference_property_id', lids).is('finished_at', null).ilike('name', '%quality inspection%').limit(200)
    const has = new Set(((open as any[]) || []).map(t => str(t.reference_property_id)))
    low = low.map(r => (has.has(str(r.listing_id)) ? { ...r, _inspected: true } : r))
  } catch { /* fine */ }
  // And a walk that already FINISHED on or after the review's day covers it (Jon, 2026-09-28: "the
  // same bad review should not populate the same bad review inspection") — whoever raised it.
  try {
    const { coveredReviewIds } = await import('@/lib/review-inspections')
    const covered = await coveredReviewIds(db, low)
    if (covered.size) low = low.map(r => (covered.has(str(r.id)) ? { ...r, _inspected: true } : r))
  } catch { /* fine */ }
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').in('id', lids)
  const nameOf: Record<string, string> = {}
  // THE INSPECTION GOES TO THAT MARKET'S SUPERVISOR (Jon, 2026-09-23 review). This handed every
  // low-review inspection to the MIAMI supervisor, so a Broward review landed on someone who does
  // not run Broward and the person who does never saw it. The market comes from the same
  // marketOf(building, city, name) that lib/auto-inspections uses for its own low-review tasks;
  // Miami stays only as the fallback for a market with no supervisor configured.
  const { marketOf } = await import('@/lib/segments')
  const marketOfLid: Record<string, string> = {}
  for (const l of ((ls as any[]) || [])) {
    nameOf[str(l.id)] = str(l.nickname || l.title)
    marketOfLid[str(l.id)] = str(marketOf(l.building, l.address_city, l.nickname || l.title))
  }
  const { data: nx } = await db.from('guesty_reservations').select('listing_id,check_out,status').in('listing_id', lids).gte('check_out', env.today).in('status', ['confirmed', 'checked_in']).order('check_out').limit(1000) // deliberate cap: upcoming stays of the few units with a low review in the last 48h (at most 60 reviews read), soonest first, so each unit's next check-out is on this page
  const nextOut: Record<string, string> = {}
  for (const r of ((nx as any[]) || [])) { const lid = str(r.listing_id); if (!nextOut[lid]) nextOut[lid] = str(r.check_out).slice(0, 10) }
  const cfg = await env.automation()
  // THE INSPECTION IS NOT HERS TO ASK FOR WHEN IT IS AUTOMATED (Jon, 2026-09-30: "quality inspection
  // should be auto-generated. It shouldn't be required or asked for"). With the master switch and
  // the low-review rule on, the cron files it on the unit's next checkout by itself; she keeps
  // preparing the public reply, which nobody automates.
  let covers: (rating: number, at: string) => Promise<boolean> = async () => false
  if (cfg && cfg.enabled && cfg.lowReviews) {
    try { const { lowReviewRuleCovers } = await import('@/lib/auto-inspections'); covers = (rating, at) => lowReviewRuleCovers(cfg, rating, at) } catch { /* ask as before */ }
  }
  const never = await neverAssign()
  const out: Prepared[] = []
  for (const r of low) {
    const lid = str(r.listing_id), unit = nameOf[lid] || 'the unit', rating = Math.round(norm(r.rating) * 10) / 10
    const quote = str(r.content).replace(/\s+/g, ' ').trim().slice(0, 300)
    const date = nextOut[lid] || env.today
    const sup = cfg ? (cfg.supervisors?.[marketOfLid[lid]] || cfg.supervisors?.Miami) : ''
    const assignees = Array.from(new Set([cfg?.assignAlways, sup].filter(Boolean))).filter(n => !never.blocks(n))
    // Only the reviews the rule itself files (its threshold, since its start line) are skipped.
    const automated = await covers(norm(r.rating), str(r.created_at))
    if (!r._inspected && !automated) out.push({
      subject: `rev:${r.id}:inspect`, action: 'task_create', metric: 'low_reviews',
      ask: `create a quality inspection on ${unit} for ${date} after ${str(r.guest_name) || 'a guest'}'s ${rating}★ ${str(r.channel)} review?`,
      why: quote ? `"${quote.slice(0, 160)}"` : `A ${rating}★ review with no written comment.`,
      exec: {
        listingId: lid, title: `Quality inspection — ${unit} (${rating}★ review)`, department: 'inspection', priority: 'high', date, assignees,
        autoInspectionKey: 'rev:' + str(r.id), autoInspectionReason: 'low review ' + rating + '★', guest: str(r.guest_name) || null,
        description: `From a ${rating}/5 review on ${str(r.channel)} (${str(r.created_at).slice(0, 10)}).\n\nWHAT THE GUEST SAID\n${quote ? `"${quote}"\n— ${str(r.guest_name) || 'Guest'}` : 'No written comment — the score is the signal.'}\n\nWalk the unit as a first-time guest and find what earned ${rating}/5. Photograph everything, good and bad. Anything that needs a trade becomes a work order today.`,
      },
    })
    if (!r.has_reply && quote) {
      out.push({
        subject: `rev:${r.id}:reply`, action: 'guest_reply_draft', metric: 'unanswered_reviews',
        ask: `draft a public reply to ${str(r.guest_name) || 'the guest'}'s ${rating}★ review on ${unit}? (it waits on /reviews; nothing is published yet)`,
        why: `A low review with no reply yet — a prospect reads the reply before booking.`,
        exec: async () => {
          const draft = await askModel('review-reply', REVIEW_REPLY_SYSTEM, `Channel: ${str(r.channel)}\nGuest: ${str(r.guest_name) || 'the guest'}\nRating: ${rating} out of 5\nGuest review:\n"""${quote}"""\n\nWrite the single best reply.`, 300)
          if (!draft) return null
          return { reviewId: str(r.id), draft, guest: str(r.guest_name) || 'Guest', unit, channel: str(r.channel), why: `${rating}★ review, unanswered.` }
        },
      })
    }
  }
  return out
}

async function channelBroken(env: WatchEnv): Promise<Prepared[]> {
  const { readSnapshot, problemsFromSnapshot } = await import('@/lib/channel-health')
  const { CHANNEL_LABEL, VERDICT_LABEL } = await import('@/lib/channel-types')
  const snap = await readSnapshot()
  const probs = problemsFromSnapshot(snap)
  if (!probs.length) return []
  const byListing: Record<string, typeof probs> = {}
  for (const p of probs) (byListing[p.listingId] ||= []).push(p)
  const ids = Object.keys(byListing).sort()
  const lines = ids.map(lid => { const rows = byListing[lid]; return `${rows[0].unit} (${rows[0].market}): ${rows.map(r => `${(VERDICT_LABEL as any)[r.verdict] || r.verdict} on ${(CHANNEL_LABEL as any)[r.platform] || r.platform}`).join(', ')}` })
  const to = env.settings.approvers[0] || OWNER
  const text = `Guesty's channel snapshot${snap?.at ? ` (${str(snap.at).slice(0, 16).replace('T', ' ')})` : ''} shows ${ids.length} active listing${ids.length === 1 ? '' : 's'} off a major channel:\n\n${lines.map(l => '• ' + l).join('\n')}\n\nGuests cannot book these there until they are reconnected. Open Guesty → Channel settings for each, or /channels in Lighthouse.`
  return [{
    subject: `listings:${ids.join(',')}`, action: 'email_draft', metric: 'bookings_made',
    ask: `open Guesty channel settings — ${ids.length} listing${ids.length === 1 ? '' : 's'} off a major channel (${lines[0].slice(0, 80)}${ids.length > 1 ? '…' : ''}); I drafted the list to ${to}?`,
    why: lines.slice(0, 3).join(' · ').slice(0, 280),
    exec: { to: [to], subject: `Channel check: ${ids.length} listing${ids.length === 1 ? '' : 's'} off a major channel — ${env.today}`, text },
  }]
}

async function glitchOverdue(env: WatchEnv): Promise<Prepared[]> {
  const db = env.db
  const { data } = await db.from('glitches').select('id,listing_id,unit,status,glitch_type,category,overview,due_date,assignee,breezeway_task_id,guest_name,created_at')
    .not('status', 'in', '("done","resolved","closed")').lt('due_date', env.today).is('breezeway_task_id', null).order('due_date').limit(40)
  const rows = ((data as any[]) || []).filter(g => str(g.listing_id))
  const out: Prepared[] = []
  for (const g of rows) {
    const issue = str(g.overview || g.glitch_type || g.category) || 'Guest issue'
    const unit = str(g.unit) || 'the unit'
    const daysLate = Math.max(1, Math.round((Date.parse(env.today + 'T12:00:00Z') - Date.parse(str(g.due_date).slice(0, 10) + 'T12:00:00Z')) / 86400_000))
    out.push({
      subject: `glitch:${g.id}`, action: 'task_create', metric: 'glitches_open', unit: g.unit || null,
      ask: `create a maintenance task on ${unit} for the glitch "${issue.slice(0, 70)}" — ${daysLate} day${daysLate === 1 ? '' : 's'} past due with no Breezeway task?`,
      why: `Due ${str(g.due_date).slice(0, 10)}${g.assignee ? `, owned by ${str(g.assignee)}` : ''}${g.guest_name ? `, reported by ${str(g.guest_name)}` : ''}; nobody in the field has it.`,
      exec: {
        listingId: str(g.listing_id), glitchId: str(g.id), title: `Glitch: ${issue.slice(0, 90)}`, department: 'maintenance', priority: 'high', date: env.today,
        description: `From the glitch board (due ${str(g.due_date).slice(0, 10)}, ${daysLate}d overdue).\n${issue}\n${g.guest_name ? `Reported by ${str(g.guest_name)}.` : ''}`.trim(),
      },
    })
  }
  return out
}

async function stockLow(env: WatchEnv): Promise<Prepared[]> {
  const db = env.db
  const { data } = await db.from('guest_order_stock').select('item_id,scope,on_hand,reserved,low_at,guest_order_catalog(name,sku,track_stock,active,supplier,reorder_url)').limit(500)
  const rows = ((data as any[]) || []).filter(r => {
    const c = r.guest_order_catalog
    return c && c.active !== false && c.track_stock === true && (Number(r.on_hand) - Number(r.reserved)) <= Number(r.low_at)
  })
  if (!rows.length) return []
  const byScope: Record<string, any[]> = {}
  for (const r of rows) (byScope[str(r.scope) || 'global'] ||= []).push(r)
  const to = env.settings.approvers[0] || OWNER
  const out: Prepared[] = []
  for (const scope of Object.keys(byScope).sort()) {
    const items = byScope[scope].sort((a, b) => (Number(a.on_hand) - Number(a.reserved)) - (Number(b.on_hand) - Number(b.reserved)))
    const list = items.map(r => `• ${str(r.guest_order_catalog.name)}${r.guest_order_catalog.sku ? ` (${r.guest_order_catalog.sku})` : ''}: ${Number(r.on_hand) - Number(r.reserved)} available, low at ${r.low_at}${r.guest_order_catalog.supplier ? ` — ${str(r.guest_order_catalog.supplier)}` : ''}${r.guest_order_catalog.reorder_url ? ` ${str(r.guest_order_catalog.reorder_url)}` : ''}`)
    const where = scope === 'global' ? 'all hubs' : scope.replace(/^hub:/, 'hub ')
    out.push({
      subject: `${scope}:${items.map(r => str(r.item_id)).sort().join(',')}`, action: 'email_draft', metric: 'revenue',
      ask: `draft the purchase list for ${where} — ${items.length} guest-order item${items.length === 1 ? '' : 's'} at or below par (${str(items[0].guest_order_catalog.name)}${items.length > 1 ? ', …' : ''})?`,
      why: `Items at or below their low mark disappear from the guest order form; a purchase list gets them back.`,
      exec: { to: [to], subject: `Guest orders — purchase list for ${where} (${env.today})`, text: `These guest-order items are at or below par in ${where}:\n\n${list.join('\n')}\n\nCounts are on_hand minus reserved, from the Guest orders inventory.` },
    })
  }
  return out
}

// THE NO-SHOW WATCH, NARROWED (2026-09-28 audit, F24 + 06 F-11). It fired for every arrival today
// with no welcome call and no message ever — which is most Booking.com and Expedia guests on an
// ordinary day. Now it needs all of:
//   - a Booking.com, Expedia or Direct booking (Airbnb and Vrbo guests talk through the channel),
//     never an owner or friends-and-family stay (an inventory decision, not a guest);
//   - for TODAY's arrival, a check-in time that has come (before it, silence is normal);
//   - and TOMORROW's arrivals are raised as a flag on the Thinking tab — observe only, nothing is
//     posted or noted — so there is a day to call.
const NO_SHOW_CHANNELS = ['Booking.com', 'Expedia', 'Direct']
const minutesOfClock = (v: any): number | null => {
  const m = str(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (!m[3]) h = Number(m[1]) % 24
  else if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}
const minutesNowET = (d: Date) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':'); return (Number(p[0]) % 24) * 60 + Number(p[1]) }

async function noShowRisk(env: WatchEnv): Promise<Prepared[]> {
  const cd = await env.commandDay()
  if (!cd) return []
  const tomorrow = shift(env.today, 1)
  const arrivals = cd.tiles.arrivals.rows.filter(a => !a.welcomeDone && (a.today || a.checkIn === tomorrow))
  if (!arrivals.length) return []
  const db = env.db
  const resIds = arrivals.map(a => a.reservationId)
  const lids = Array.from(new Set(arrivals.map(a => str(a.listingId)).filter(Boolean)))
  const [{ data: calls }, { data: convs }, { data: rs }, { data: ls }] = await Promise.all([
    db.from('guest_calls').select('reservation_id,outcome').in('reservation_id', resIds).limit(500),
    db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', resIds).limit(500),
    db.from('guesty_reservations').select('id,source,guest_name,tags:raw->tags').in('id', resIds).limit(500),
    lids.length ? db.from('guesty_listings').select('id,checkIn:raw->>defaultCheckInTime').in('id', lids) : Promise.resolve({ data: [] } as any),
  ])
  const { otaChannelOf } = await import('@/lib/ota-playbook')
  const { isOwnerOrFriendsFamily } = await import('@/lib/owner-audit')
  const resById: Record<string, any> = {}
  for (const r of ((rs as any[]) || [])) resById[str(r.id)] = r
  const checkInMin: Record<string, number> = {}
  for (const l of ((ls as any[]) || [])) { const m = minutesOfClock(l.checkIn); if (m != null) checkInMin[str(l.id)] = m }
  const nowMin = minutesNowET(env.now)
  const { COMPLETED } = await import('@/lib/call-desk')
  const called = new Set<string>()
  for (const c of ((calls as any[]) || [])) if (COMPLETED.indexOf(str(c.outcome)) >= 0) called.add(str(c.reservation_id))
  const convOf: Record<string, string> = {}
  for (const c of ((convs as any[]) || [])) convOf[str(c.reservation_id)] = str(c.id)
  const convIds = Object.values(convOf)
  const replied = new Set<string>()
  if (convIds.length) {
    const { data: cr } = await db.from('conversation_response').select('conversation_id,guest_msgs').in('conversation_id', convIds)
    for (const r of ((cr as any[]) || [])) if (Number(r.guest_msgs) > 0) replied.add(str(r.conversation_id))
  }
  const cfg = await env.automation()
  const out: Prepared[] = []
  for (const a of arrivals) {
    if (called.has(a.reservationId)) continue
    const conv = convOf[a.reservationId]
    if (conv && replied.has(conv)) continue
    const res = resById[a.reservationId]
    const channel = otaChannelOf(res?.source)
    if (!channel || NO_SHOW_CHANNELS.indexOf(channel) < 0) continue
    if (isOwnerOrFriendsFamily(str(res?.source), JSON.stringify(res?.tags || ''), str(res?.guest_name || a.guest))) continue
    if (!a.today) {
      // Tomorrow: a flag on the Thinking tab, never an action (observeOnly). The payload is the
      // customer-care line, so "Do it" there posts it if a person decides to.
      const channelId = cfg?.noticeDrafts?.slackChannel || ''
      if (!channelId) continue
      const line = `📞 ${a.guest} arrives TOMORROW at ${a.unit} (${channel}) — no welcome call logged and no reply in their thread yet. Worth a call today.`
      out.push({ subject: `res:${a.reservationId}:tomorrow`, action: 'slack_post', observeOnly: true, metric: 'sentiment_negative', ask: `flag: ${a.guest} (${channel}) arrives tomorrow at ${a.unit} with no welcome call and no reply — call today?`, why: `A silent ${channel} arrival a day out; there is still time to reach them.`, exec: { channel: channelId, channel_name: 'customer care', text: line } })
      continue
    }
    // Today: only once the unit's check-in time has come (the listing default, 4pm when unset).
    const cin = a.listingId && checkInMin[a.listingId] != null ? checkInMin[a.listingId] : 16 * 60
    if (nowMin < cin) continue
    const note = `NO-SHOW RISK: ${a.guest} arrives today at ${a.unit} (${channel}) — no welcome call logged and the guest has never replied in their thread. Please call and confirm their ETA.`
    // The note goes on today's task for this unit (the inspection if there is one, else any open
    // task on the unit today); with no task to write on, it is a line in the customer-care channel.
    let taskId = a.inspectionTaskId
    if (!taskId && a.listingId) {
      const { data: t } = await db.from('breezeway_tasks_sync').select('id,name').eq('reference_property_id', a.listingId).eq('scheduled_date', env.today).is('finished_at', null).order('id').limit(1)
      taskId = str(((t as any[]) || [])[0]?.id) || null
    }
    if (taskId) {
      out.push({ subject: `res:${a.reservationId}`, action: 'task_note', metric: 'sentiment_negative', ask: `note on today's task at ${a.unit}: ${a.guest} arrives today with no welcome call and no reply — call them?`, why: `No welcome call, no guest message; a silent arrival is the usual no-show.`, exec: { taskId, text: note } })
    } else {
      const careRoom = cfg?.noticeDrafts?.slackChannel || ''
      if (!careRoom) continue
      out.push({ subject: `res:${a.reservationId}`, action: 'slack_post', metric: 'sentiment_negative', ask: `post in customer care: ${a.guest} arrives today at ${a.unit} with no welcome call and no reply — call them?`, why: `No welcome call, no guest message, and no task on the unit today to note it on.`, exec: { channel: careRoom, channel_name: 'customer care', text: `📞 ${note}` } })
    }
  }
  return out
}

export const WATCHES: WatchDef[] = [
  { key: 'guest_unanswered_1h', title: 'Guest past the reply-by time', what: 'A guest waiting on a reply past the inbox\'s reply-by time: an hour for a message sent 8am–10pm ET or on their arrival day, 8am for one sent overnight. She drafts the reply and asks "send this?".', action: 'guest_reply_draft', cooldownHours: 24, trigger: guestUnanswered },
  { key: 'clean_late', title: 'Late clean with nobody on it', what: 'A late or at-risk clean on Today in Ops with no assignee. She picks the on-shift housekeeper in that market with headroom and asks to assign.', action: 'task_assign', cooldownHours: 24, trigger: cleanLate },
  { key: 'big_arrival_uninspected', title: 'Big arrival with no inspection', what: 'A big-value arrival within 48h with no inspection task, while Task automation is NOT filing big-arrival inspections. She prepares the pre-arrival inspection (same payload as the automation) and asks. With the automation on she stays quiet — it creates them.', action: 'task_create', cooldownHours: 48, trigger: bigArrivalUninspected },
  { key: 'bad_review_in', title: 'Bad review just landed', what: 'A review at 3★ or below in the last 48h. She prepares a public reply draft and asks. She also prepares the quality inspection on the next checkout — but only while Task automation\'s bad-review rule is off; with it on, the automation files the inspection and she never asks.', action: 'task_create', cooldownHours: 168, trigger: badReviewIn },
  { key: 'channel_broken', title: 'Listing off a major channel', what: 'The channel snapshot shows an active listing failed or disconnected on Airbnb, Booking.com, Vrbo or Expedia. She drafts the list to the approver and asks you to open Guesty channel settings. Always a proposal.', action: 'email_draft', cooldownHours: 48, maxMode: 'propose', trigger: channelBroken },
  { key: 'glitch_overdue', title: 'Glitch past due with no task', what: 'A glitch past its due date with no Breezeway task. She prepares the maintenance task and asks.', action: 'task_create', cooldownHours: 48, trigger: glitchOverdue },
  { key: 'stock_low', title: 'Guest-order stock below par', what: 'A tracked guest-order item at or below its low mark. She drafts the purchase list (one email per hub) and asks.', action: 'email_draft', cooldownHours: 72, trigger: stockLow },
  { key: 'no_show_risk', title: 'Arrival today, no call, no reply', what: 'A Booking.com, Expedia or Direct guest (never an owner or friends-and-family stay) arriving today with no welcome call logged and no reply in their thread, once the unit\'s check-in time has come. She notes it on today\'s task for the unit (or posts to customer care) and asks. Tomorrow\'s silent arrivals are flagged on the Thinking tab only.', action: 'task_note', cooldownHours: 24, trigger: noShowRisk },
]
export const WATCH_BY_KEY: Record<string, WatchDef> = WATCHES.reduce((m, w) => { m[w.key] = w; return m }, {} as Record<string, WatchDef>)

// ---- Rows ---------------------------------------------------------------------------------------

export type WatchRow = {
  key: WatchKey; title: string; what: string; action: ActionType
  enabled: boolean; cooldownHours: number; rungOverride: number | null
  lastFiredAt: string | null; lastRunAt: string | null; firedCount: number; lastResult: any
  migrated: boolean
}

/** The eight watches with their stored state. `migrated:false` on every row means migration 102 has not run. */
export async function listWatches(): Promise<WatchRow[]> {
  let rows: any[] = []
  let migrated = true
  try {
    const { data, error } = await supabaseAdmin().from('eve_watches').select('key,enabled,cooldown_hours,rung_override,last_fired_at,last_run_at,fired_count,last_result').not('key', 'is', null)
    if (error) throw error
    rows = (data as any[]) || []
  } catch { migrated = false }
  const byKey: Record<string, any> = {}
  for (const r of rows) byKey[str(r.key)] = r
  return WATCHES.map(w => {
    const r = byKey[w.key]
    return {
      key: w.key, title: w.title, what: w.what, action: w.action,
      enabled: r ? r.enabled !== false : false,
      cooldownHours: r && Number.isFinite(Number(r.cooldown_hours)) ? Number(r.cooldown_hours) : w.cooldownHours,
      rungOverride: r && r.rung_override != null ? Number(r.rung_override) : null,
      lastFiredAt: r?.last_fired_at || null, lastRunAt: r?.last_run_at || null, firedCount: Number(r?.fired_count) || 0, lastResult: r?.last_result || null,
      migrated,
    }
  })
}

export async function setWatch(key: string, patch: { enabled?: boolean; cooldownHours?: number; rungOverride?: number | null }, by: string): Promise<{ ok: boolean; error?: string }> {
  const w = WATCH_BY_KEY[key]
  if (!w) return { ok: false, error: 'unknown watch' }
  const row: any = { key, title: w.title, label: w.title }
  if (patch.enabled != null) row.enabled = !!patch.enabled
  if (patch.cooldownHours != null) row.cooldown_hours = Math.min(Math.max(Math.round(Number(patch.cooldownHours) || w.cooldownHours), 1), 24 * 30)
  if (patch.rungOverride !== undefined) row.rung_override = patch.rungOverride == null ? null : Math.max(0, Math.min(4, Math.round(Number(patch.rungOverride))))
  try {
    const { error } = await supabaseAdmin().from('eve_watches').upsert(row, { onConflict: 'key' })
    if (error) return { ok: false, error: /column|constraint|schema cache/i.test(error.message) ? 'Run migration 102 first.' : error.message.slice(0, 200) }
    await logAgent({ action: w.action, rung: 0, allowed: true, mode: 'observe', reason: `watch ${key} changed: ${JSON.stringify(patch)}`, summary: w.title, by: 'chat', actor: by })
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

// ---- The runner -----------------------------------------------------------------------------------

export type WatchRun = {
  ok: boolean; skipped?: string; ranAt: string
  watches: { key: string; found: number; fired: number; cooled: number; modes: Record<string, number>; error?: string; ms: number }[]
}

/**
 * Run every enabled watch (or one, with `only`). Chained into the 30-minute sentiment scan and the
 * morning ask, and callable from the panel's "Run now". `force` ignores the cooldown for a manual run.
 */
export async function runWatches(by = 'cron:watches', opts: { only?: string; force?: boolean } = {}): Promise<WatchRun> {
  const ranAt = new Date().toISOString()
  const rows = await listWatches()
  if (!rows.some(r => r.migrated)) return { ok: false, skipped: 'migration 102 has not run — eve_watches has no key column', ranAt, watches: [] }
  // NOTHING TO WATCH, NOTHING TO BUILD (2026-09-28 audit, F43). This runs every half hour, chained to
  // the sentiment scan, and it read the settings, the declined shapes and the AI ledger — and the
  // watches built the two heaviest day pictures — even with every watch switched off. Now it stops
  // here when nothing is due. Outside 07:00–22:00 ET only the two watches that matter at night run
  // (a guest waiting on an answer, a silent arrival); a manual run (only / force) is not held back.
  const h = hourET()
  const offHours = h < 7 || h >= 22
  const manual = !!opts.only || !!opts.force
  const dueNow = (r: WatchRow) => opts.only ? r.key === opts.only : (r.enabled && (manual || !offHours || NIGHT_WATCHES.indexOf(r.key) >= 0))
  if (!rows.some(dueNow)) return { ok: true, skipped: opts.only ? `no watch called ${opts.only}` : offHours ? 'off hours: no night watch is enabled' : 'no watch is enabled', ranAt, watches: [] }
  const settings = await getAgentSettings()
  // WHAT JON ALREADY SAID NO TO (2026-09-21, the learning audit). One read per run: every shape of
  // proposal he dismissed with a reason. A watch that would raise a declined shape skips it and
  // says so — the visible form of "she learned from the correction".
  let declined: Record<string, { reasons: string[]; lastAt: string; firstAt: string }> = {}
  try { const { declinedShapes } = await import('./learning-audit'); declined = await declinedShapes() } catch { declined = {} }
  const env = makeEnv(settings, declined)
  const out: WatchRun = { ok: true, ranAt, watches: [] }
  const db = supabaseAdmin()
  // AI drafts cost money at every rung — including observe, now that the draft IS the thought
  // (lib/eve/thoughts.ts) — and agentAllowed only meters spend for an act. One read here: over
  // today's AI budget, a watch that needs a model call is recorded without its draft.
  let overAiBudget = false
  if (settings.budgets.aiUsdPerDay > 0) {
    try { const { aiSpendToday } = await import('./agent-mode'); overAiBudget = (await aiSpendToday()) >= settings.budgets.aiUsdPerDay } catch { overAiBudget = false }
  }

  for (const row of rows) {
    if (opts.only && row.key !== opts.only) continue
    if (!row.enabled && !opts.only) continue
    if (!dueNow(row)) continue
    const def = WATCH_BY_KEY[row.key]
    const t0 = Date.now()
    // Would she do more than observe for this watch right now? (The switch, the action's rung and
    // the watch's own override — the override can raise a watch to propose: "Ask me next time".)
    const actionRung = Number(settings.rungs[def.action] || 0)
    const ov = row.rungOverride
    const effectiveRung = !settings.enabled ? 0 : ov == null ? actionRung : ov >= 2 ? Math.max(2, Math.min(ov, actionRung)) : Math.min(ov, actionRung)
    const observesNow = effectiveRung <= 0
    const rec = { key: row.key, found: 0, fired: 0, cooled: 0, modes: {} as Record<string, number>, ms: 0, error: undefined as string | undefined }
    let found: Prepared[] = []
    try { found = await def.trigger(env) } catch (e: any) { rec.error = String(e?.message || e).slice(0, 200) }
    rec.found = found.length

    // Cooldown: one read for all this watch's subjects.
    const subjects = found.map(f => f.subject)
    const cooled = new Set<string>()
    if (subjects.length && !opts.force) {
      try {
        const since = new Date(Date.now() - row.cooldownHours * 3600_000).toISOString()
        const { data } = await db.from('eve_watch_fires').select('subject,mode').eq('watch_key', row.key).in('subject', subjects.slice(0, 200)).gte('fired_at', since)
        // A subject only OBSERVED (a thought on the Thinking tab) is not in cooldown once she would
        // do more than observe: flipping the switch or raising a rung should let her raise what
        // she saw, not wait a day. While she still observes, the thought stands and is not redone.
        // A FLAG COOLS LIKE ANYTHING ELSE (audit 2026-10-05): an observeOnly subject (no_show_risk's
        // tomorrow arrivals) can never be more than a thought, so "not in cooldown once she would do
        // more" never applies to it — yet it was re-raised every hourly run, 55 decisions a day of the
        // same silent arrivals, burying the real ones on the Thinking tab.
        const flagOnly = new Set(found.filter(f => f.observeOnly).map(f => f.subject))
        for (const r of ((data as any[]) || [])) if (!(r.mode === 'observe' && !observesNow && !flagOnly.has(str(r.subject)))) cooled.add(str(r.subject))
      } catch { /* no table = no cooldown; the per-run cap still holds */ }
      // SECOND LOCK on repeats: the receipt the fire itself leaves. If the eve_watch_fires write
      // failed last time, the proposal / draft / guest draft it made still carries (watchKey,
      // subject) in its payload — anything raised inside the cooldown, or still open, is cooled.
      try {
        const since = new Date(Date.now() - row.cooldownHours * 3600_000).toISOString()
        const { data } = await db.from('eve_actions').select('payload,status').neq('kind', 'thought').filter('payload->>watchKey', 'eq', row.key).gte('created_at', since).order('created_at', { ascending: false }).limit(200)
        for (const r of ((data as any[]) || [])) { const sub = str(r.payload?.subject); if (sub && subjects.indexOf(sub) >= 0 && (!opts.force || r.status === 'proposed')) cooled.add(sub) }
      } catch { /* fine */ }
    }

    let fired = 0, tries = 0
    for (const f of found) {
      if (cooled.has(f.subject)) { rec.cooled++; continue }
      if (tries >= MAX_PER_WATCH) break
      tries++
      const byLabel = `watch:${row.key}`
      // A DECLINED SHAPE IS SKIPPED, AND THE SKIP IS ON THE RECORD. Checked on the prepared action
      // before any model draft is built (no spend on something she will not raise), and the reasons
      // Jon gave ride along as evidence so the Thinking tab shows what she consulted.
      // THE SHAPE IS THE BUILDING (independent audit 2026-10-10): static watches carried no unit in their
      // payload, so every late-clean ask collapsed to one shape and one "Not this" muted them all; model
      // drafts were checked with a null payload and recorded with a full one, so the two never matched.
      // The unit the watch knows rides on both sides now.
      const preShape = shapeOf(f.action, byLabel, { ...(typeof f.exec === 'function' ? {} : (f.exec || {})), ...(f.unit ? { unit: f.unit } : {}) }, f.subject)
      const saidNo = declined[preShape]
      if (saidNo && saidNo.reasons.length) {
        rec.modes.skipped_declined = (rec.modes.skipped_declined || 0) + 1
        try {
          await recordThought({
            action: f.action, payload: typeof f.exec === 'function' ? null : f.exec, why: f.why, ask: f.ask, source: byLabel, subject: f.subject,
            rungNow: effectiveRung, wouldHaveBeen: 'observe', evidence: saidNo.reasons.map(r => `Jon: ${r}`),
            note: 'skipped — Jon declined this shape before', by: byLabel, cooldownHours: opts.force ? 0 : row.cooldownHours,
          })
        } catch { /* the skip stands either way */ }
        try { await db.from('eve_watch_fires').upsert({ watch_key: row.key, subject: f.subject, fired_at: new Date().toISOString(), mode: 'observe', ref: null }, { onConflict: 'watch_key,subject' }) } catch { /* fine */ }
        continue
      }
      let mode: Mode = 'observe'
      let ref: string | null = null
      try {
        let verdict: AgentVerdict = await agentAllowed(f.action, { ask: true, usd: f.usd })
        // OFF: observe only — no drafts piling up, no model calls, but the log says what she saw.
        if (!settings.enabled) verdict = { ...verdict, mode: 'observe', ok: false, needsApproval: false, reason: 'agent mode is OFF; watch observed only' }
        // A per-watch ceiling, and channel_broken's standing "always propose".
        const ceiling = row.rungOverride != null ? row.rungOverride : (def.maxMode === 'propose' ? 2 : null)
        if (ceiling != null && ceiling < 3 && (verdict.mode === 'act' || verdict.mode === 'deferred')) verdict = { ...verdict, mode: ceiling >= 2 ? 'propose' : ceiling === 1 ? 'draft' : 'observe', ok: false, needsApproval: ceiling >= 2, reason: `${verdict.reason}; watch capped at rung ${ceiling}` }
        if (ceiling != null && ceiling < 2 && verdict.mode === 'propose') verdict = { ...verdict, mode: ceiling === 1 ? 'draft' : 'observe', ok: false, needsApproval: false, reason: `${verdict.reason}; watch capped at rung ${ceiling}` }
        // "ASK ME NEXT TIME" (Thinking tab): an override of 2 on a watch whose action still sits at
        // observe or draft RAISES it to propose — while agent mode is on, so the ask can be delivered.
        if (settings.enabled && row.rungOverride != null && row.rungOverride >= 2 && (verdict.mode === 'observe' || verdict.mode === 'draft')) verdict = { ...verdict, mode: 'propose', ok: false, needsApproval: true, reason: `${verdict.reason}; watch raised to propose (ask me next time)` }
        // A FLAG IS NOT AN ACTION (no_show_risk's tomorrow arrivals): observed whatever the rung says.
        if (f.observeOnly && verdict.mode !== 'observe') verdict = { ...verdict, mode: 'observe', ok: false, needsApproval: false, reason: `${verdict.reason}; a flag, not an action` }
        if (typeof f.exec === 'function' && overAiBudget && verdict.mode !== 'observe') verdict = { ...verdict, mode: 'observe', ok: false, needsApproval: false, reason: `${verdict.reason}; AI spend is over today's $${settings.budgets.aiUsdPerDay} — no draft` }
        // THE DRAFT IS THE THOUGHT (2026-09-21). At observe she still prepares the whole action so
        // the Thinking tab shows what she would have done — the one exception is a model draft
        // when today's AI budget is spent, which is recorded as a thought without its draft.
        let exec: any = null
        let note: string | null = null
        const skipModel = typeof f.exec === 'function' && overAiBudget
        if (skipModel) note = 'draft skipped — AI budget'
        else {
          exec = typeof f.exec === 'function' ? await f.exec() : f.exec
          // Nothing to draft (thread answered meanwhile, model returned nothing): it still counts
          // against this run's cap, so a run can never loop the model over thirty threads.
          if (!exec) { rec.modes.skipped = (rec.modes.skipped || 0) + 1; continue }
          exec = { ...exec, watchKey: row.key, subject: f.subject, ...(f.unit && !exec.unit ? { unit: f.unit } : {}) }
        }
        const evidence = [f.why, ...(exec && typeof exec === 'object' && exec.why ? [String(exec.why)] : [])].filter(Boolean)
        const r = await stepDown(verdict, { action: f.action, summary: f.ask, exec, why: f.why, by: byLabel, watchKey: row.key, subject: f.subject, metric: f.metric || null, usd: f.usd ?? null, evidence, note, thoughtCooldownHours: opts.force ? 0 : row.cooldownHours })
        mode = r.mode; ref = r.ref || null
        if (!r.ok && r.error) rec.error = (rec.error ? rec.error + '; ' : '') + `${f.subject}: ${r.error}`.slice(0, 200)
      } catch (e: any) {
        rec.error = (rec.error ? rec.error + '; ' : '') + String(e?.message || e).slice(0, 160)
        await logAgent({ action: f.action, rung: 0, allowed: false, mode: 'observe', reason: `watch threw: ${String(e?.message || e).slice(0, 160)}`, summary: f.ask, by: byLabel })
      }
      rec.modes[mode] = (rec.modes[mode] || 0) + 1
      fired++
      try { await db.from('eve_watch_fires').upsert({ watch_key: row.key, subject: f.subject, fired_at: new Date().toISOString(), mode, ref }, { onConflict: 'watch_key,subject' }) } catch { /* cooldown lost for this one */ }
    }
    rec.fired = fired
    rec.ms = Date.now() - t0
    out.watches.push(rec)
    try {
      const patch: any = { last_run_at: ranAt, last_result: { found: rec.found, fired: rec.fired, cooled: rec.cooled, modes: rec.modes, error: rec.error || null, ms: rec.ms } }
      if (fired) { patch.last_fired_at = ranAt; patch.fired_count = row.firedCount + fired }
      await db.from('eve_watches').update(patch).eq('key', row.key)
    } catch { /* receipts are best-effort */ }
  }
  return out
}
