// AI sentiment scan of guest messages -> one row per conversation in
// guesty_conversation_sentiment. Backfills the last N days (default 30) then runs forward:
// only (re)scans a conversation when it has new activity since the last scan. Rate-limit
// aware: processes a small batch per call and returns `remaining` so it can be re-run /
// scheduled to drain the backlog. The cron (bearer), or a person with edit on Messages.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { moodOf, flushMoodNotes } from '@/lib/guest-mood'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { modelPairFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { flushDeferred } from '@/lib/eve/agent-mode'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// High-risk keywords -> one of the four warning triggers.
const KW = [
  'refund', 'broken', 'dirty', 'filthy', 'cancel', 'complaint', 'complain', 'unacceptable', 'manager',
  'disappointed', 'disappointing', 'rude', 'scam', 'never again', 'worst', 'roach', 'bed bug', 'bugs',
  'no hot water', 'no ac', 'a/c', 'not working', "doesn't work", 'overcharged', 'dispute', 'angry',
  'unhappy', 'terrible', 'horrible', 'mold', 'smell', 'leak', 'lockout', "can't get in", "couldn't get in",
  'demand', 'lawyer', 'review', 'unsafe', 'emergency',
]
function hasKw(t: string): boolean { const s = t.toLowerCase(); return KW.some(k => s.includes(k)) }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const isGuest = (sender: string) => /guest/i.test(sender) || sender === 'inbound'

export async function POST(req: NextRequest) {
  // Accept the Vercel cron as well as a logged-in user.
  //
  // 2026-08-19: this route had NO cron and required a session, which meant guest sentiment was only
  // ever scanned when somebody happened to click. 392 conversations were sitting unscanned. For an
  // assistant meant to run customer service that is the difference between knowing a guest is unhappy
  // and finding out from the review.
  // AUTH (fixed 2026-08-26). The 2026-08-19 note above says this route "had NO cron and required a
  // session". It got its cron — and then answered it 401 every half hour, because the bearer check
  // needs a CRON_SECRET that was not set then (it is now). So the 392 unscanned conversations that
  // prompted that note were joined by every conversation since. This scan calls Anthropic per thread,
  // so with no secret it runs for anyone but no more often than its own schedule. See lib/cron-auth.ts.
  //
  // A PERSON PRESSING SCAN (2026-09-28 audit, D16). The scheduler carries the bearer. The Scan
  // button on the Sentiment tab carries a session — and with CRON_SECRET set (it is, in prod) the
  // old order answered it 401 before the session was ever looked at, so the button had been dead
  // since the secret went in, while any signed-in account could run it wherever the secret was not
  // set. A person now needs edit on Messages, the tab the button lives on; interactive runs stay
  // capped at 8 threads below. With no secret configured an anonymous caller still gets the
  // scheduled cadence and no more (tooSoon), exactly as before.
  const allowed = cronAllowed(req)
  const viaCron = allowed.viaSecret
  if (!viaCron) {
    const person = await requireLevel('messages', 'edit')
    if (!person.ok) {
      if (!allowed.ok) return person.res
      const skip = await tooSoon('sentiment', 25)
      if (skip) return NextResponse.json({ ok: true, ...skip })
    }
  }

  // EVE'S HELD WORK (2026-09-21). This is the one job that runs every 30 minutes around the clock,
  // so it is where anything Eve held for quiet hours (a 5:22am roll-up, a nudge) gets carried out
  // once quiet hours end. Best effort; a flush failure never stops the scan.
  let flushed: any = null
  try { flushed = await flushDeferred('cron:sentiment-scan'); if (flushed.ran || flushed.failed) await recordRun({ name: 'eve-deferred', ok: !flushed.failed, itemCount: flushed.ran, detail: flushed }) } catch { flushed = null }
  // EVE'S EYES (2026-09-21). The eight watches (lib/eve/watches.ts) ride the same 30-minute beat,
  // for the cron only — an interactive scan should not wait on the day picture. A chain, not a cron
  // of its own. Best effort; a watch failure never stops the scan.
  let watched: any = null
  if (viaCron) {
    try {
      const { runWatches } = await import('@/lib/eve/watches')
      watched = await runWatches('cron:sentiment-scan')
      const fired = (watched.watches || []).reduce((n: number, w: any) => n + (w.fired || 0), 0)
      if (fired || watched.skipped) await recordRun({ name: 'eve-watches', ok: !!watched.ok, itemCount: fired, detail: watched })
    } catch (e: any) { watched = { ok: false, error: String(e?.message || e).slice(0, 200) } }
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const params = new URL(req.url).searchParams
  const days = Math.min(60, Math.max(1, Number(params.get('days')) || 30))
  // Interactive callers stay capped at 8 to respect the org token-per-minute tier; the cron may go
  // wider because nothing else is competing with it.
  const limit = Math.min(viaCron ? 25 : 8, Math.max(1, Number(params.get('limit')) || 5))
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()

  const sb = supabaseAdmin()

  // 1) Conversations active within the window.
  const { data: convos, error: cErr } = await sb
    .from('guesty_conversations')
    .select('id, reservation_id, listing_id, guest_name, channel, last_message_at')
    .gte('last_message_at', cutoff)
    .order('last_message_at', { ascending: false })
    .limit(400)
  if (cErr) return NextResponse.json({ error: `conversations: ${cErr.message}` }, { status: 500 })
  const all = convos ?? []

  // 2) Which already have an up-to-date sentiment row?
  // ONLY THE CANDIDATES' ROWS (2026-09-28 audit, D7). This read the whole state table with no
  // filter; rows are never deleted, and past PostgREST's 1,000-row cap an arbitrary subset came
  // back — a conversation whose row was cut looked "never scanned" and was re-scored on Sonnet
  // every run. The candidate set is at most 400 ids, read 200 at a time.
  const existing: any[] = []
  for (let i = 0; i < all.length; i += 200) {
    const { data: part, error: eErr } = await sb
      .from('guesty_conversation_sentiment')
      .select('conversation_id, last_message_at, status, marked_sensitive_at, triggers, mood')
      .in('conversation_id', all.slice(i, i + 200).map(c => c.id))
    if (eErr) {
      const missing = eErr.code === '42P01' || /does not exist|schema cache/i.test(eErr.message)
      return NextResponse.json({ error: missing ? 'Sentiment table not found - run guest_sentiment_migration.sql in Supabase first.' : `sentiment state: ${eErr.message}` }, { status: 503 })
    }
    for (const r of (part ?? [])) existing.push(r)
  }
  const seen = new Map<string, string>()
  const markedSet = new Set<string>()
  const prevTriggers = new Map<string, string[]>()
  // Rows scored before the four labels existed (2026-09-30) are rescanned once to get one.
  const unlabeled = new Set<string>()
  existing.forEach((r: any) => {
    if (!r.mood) unlabeled.add(r.conversation_id)
    seen.set(r.conversation_id, str(r.last_message_at))
    if (r.marked_sensitive_at) markedSet.add(r.conversation_id)
    prevTriggers.set(r.conversation_id, Array.isArray(r.triggers) ? r.triggers.map(String) : [])
  })

  // Need a (re)scan when there's no row, or the conversation has newer activity.
  const candidates = all.filter(c => {
    const prev = seen.get(c.id)
    return prev === undefined || unlabeled.has(c.id) || (c.last_message_at && new Date(c.last_message_at).getTime() > new Date(prev).getTime())
  })
  // ONLY IF THE GUEST SAID SOMETHING NEW (2026-09-09). Sentiment is the GUEST's; a host reply moves
  // last_message_at and used to trigger a full rescan of the whole transcript, so every answer the
  // front desk sent bought another model call that could not change the verdict.
  //
  // One query for every candidate (not one per conversation): the newest message since each
  // conversation's watermark, guest or host. Three outcomes per conversation:
  //   · no row yet, or a GUEST message since the watermark  -> rescan (model call)
  //   · only HOST messages since the watermark               -> no model call; move the watermark
  //     AND clear awaiting_reply / the unanswered_negative trigger, because the reply happened —
  //     the rescan used to be what cleared those, and skipping it must not leave them latched
  //   · nothing at all since the watermark                   -> leave it alone. last_message_at moved
  //     before the messages sync landed the post (guest-comms starts two minutes before this job);
  //     the message is still coming, so the watermark must not jump past it.
  const todo: typeof candidates = []
  const withRow = candidates.filter(c => seen.get(c.id) !== undefined)
  const oldestPrev = withRow.reduce((m, c) => { const p = str(seen.get(c.id)); return !m || p < m ? p : m }, '')
  const newerBy = new Map<string, { guest: boolean; host: boolean; lastAt: string }>()
  if (withRow.length && oldestPrev) {
    const ids = withRow.map(c => c.id)
    for (let i = 0; i < ids.length; i += 200) {
      // PAGED (2026-09-29). The window starts at the OLDEST watermark in the chunk, so older traffic
      // could fill a capped 1,000 rows and push other conversations' new messages past the cut —
      // those threads then read as "not landed yet" and waited, run after run.
      const newerPaged = await pageRows((a, b) => sb.from('guesty_messages')
        .select('id, conversation_id, sender, sent_at')
        .in('conversation_id', ids.slice(i, i + 200))
        .gt('sent_at', oldestPrev)
        .order('sent_at', { ascending: true }).order('id')
        .range(a, b))
      if (newerPaged.truncated) console.error('sentiment/scan: newer-message read stopped early')
      const newer = newerPaged.rows
      for (const m of (newer ?? [])) {
        const cid = str((m as any).conversation_id)
        const prev = seen.get(cid)
        if (prev === undefined || str((m as any).sent_at) <= prev) continue   // not newer for THIS conversation
        const e = newerBy.get(cid) || { guest: false, host: false, lastAt: '' }
        if (isGuest(str((m as any).sender))) e.guest = true; else e.host = true
        if (str((m as any).sent_at) > e.lastAt) e.lastAt = str((m as any).sent_at)
        newerBy.set(cid, e)
      }
    }
  }
  const hostOnly: { conversation_id: string; last_message_at: string }[] = []
  for (const c of candidates) {
    if (seen.get(c.id) === undefined || unlabeled.has(c.id)) { todo.push(c); continue }
    const e = newerBy.get(c.id)
    if (!e) continue                       // sync has not landed the message yet — look again next run
    if (e.guest) todo.push(c)
    else hostOnly.push({ conversation_id: c.id, last_message_at: e.lastAt })
  }
  if (hostOnly.length) {
    // upsert merges only the columns sent: score, band, reason and the rest stay as they were.
    // Only the unanswered_negative trigger is cleared — the guest's dissatisfaction, keyword and
    // low-score triggers are about what the guest said, and a reply does not unsay it.
    await sb.from('guesty_conversation_sentiment').upsert(
      hostOnly.map(h => ({
        ...h, awaiting_reply: false,
        triggers: (prevTriggers.get(h.conversation_id) || []).filter(t => t !== 'unanswered_negative'),
      })),
      { onConflict: 'conversation_id' })
  }
  const batch = todo.slice(0, limit)

  // The model and the one to retry on come from the registry (lib/ai-models), once per run.
  const { model, fallback } = await modelPairFor('sentiment')
  let scanned = 0, flagged = 0, failed = 0, rateLimited = false
  let lastFail = ''
  for (const c of batch) {
    try {
      const { data: msgs } = await sb
        .from('guesty_messages')
        .select('sender, sender_name, body, sent_at')
        .eq('conversation_id', c.id)
        .order('sent_at', { ascending: true })
        .limit(40)
      const rows = (msgs ?? []).filter((m: any) => str(m.body).trim())
      if (rows.length === 0) continue

      const recent = rows.slice(-16)
      const transcript = recent.map((m: any) => `${isGuest(str(m.sender)) ? 'GUEST' : 'HOST'}: ${str(m.body).replace(/\s+/g, ' ').trim().slice(0, 500)}`).join('\n')
      const guestText = recent.filter((m: any) => isGuest(str(m.sender))).map((m: any) => str(m.body)).join(' ')
      const last = rows[rows.length - 1]
      const lastIsGuest = isGuest(str(last.sender))
      const lastGuest = [...rows].reverse().find((m: any) => isGuest(str(m.sender)))
      const lastGuestAt = lastGuest ? str(lastGuest.sent_at) : null
      const awaiting = lastIsGuest

      const SYSTEM = `You are a guest-experience analyst for a short-term-rental manager. Read a guest conversation transcript and rate the GUEST's sentiment toward their stay/host. Be calibrated: most routine logistics are neutral (3). Reserve 1-2 for genuine frustration, complaints, or dissatisfaction, and 4-5 for clear happiness/praise.
Return STRICT minified JSON only, no markdown:
{"score":1-5,"band":"positive|neutral|negative","mood":"happy|neutral|frustrated|sensitive","complaint":true|false,"dissatisfied":true|false,"topIssue":"short label or null","reason":"1-2 sentences","excerpt":"the single most telling guest sentence, verbatim, <=160 chars"}
"mood" — pick exactly one, from the GUEST's words only (ignore the host's and automated messages):
- happy: warm, excited, thankful or praising.
- neutral: routine logistics and questions. A calm request to cancel, to change dates, or a plain question about a fee is neutral.
- frustrated: friction WITHOUT a complaint — confused, stuck (e.g. can't pay the deposit or sign the agreement), impatient, repeating themselves.
- sensitive: the guest COMPLAINS — about the unit, cleanliness, something broken or missing, noise, access or the door code, a fee or charge they object to, our service or response time — or asks for a refund/compensation because of a problem, or threatens a bad review or a dispute.
"complaint" = true exactly when mood is sensitive.
"dissatisfied" = true only if the guest expresses real frustration, a complaint, or an unresolved problem.`
      const USER = `Conversation (most recent last):\n"""${transcript.slice(0, 5000)}"""`

      const r = await aiFetch('sentiment', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        // Sonnet 5 (2026-09-09), not Haiku. This is the one background job where a miss has a cost
        // — a frustrated guest nobody flagged becomes a review — so it stays on a full-size model
        // (Jon: "make sure we do not lose performance where it matters"). Sonnet 5 is the newer
        // generation of the model that ran here yesterday and a third cheaper; the real saving is
        // above, in not rescanning a thread every time the front desk replies.
        body: JSON.stringify({ model, max_tokens: 500, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
      })
      if (r.status === 429) { rateLimited = true; break } // hit the rate limit - stop; the rest stays in `remaining` for the next run
      let d: any = await r.json().catch(() => ({}))
      // If the account cannot see the Sonnet 5 alias, fall back to yesterday's model rather than
      // skip the scan — the cost is the smaller problem.
      if (r.status === 404 || (r.status === 400 && /model/i.test(str(d?.error?.message)))) {
        const r2 = await aiFetch('sentiment', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: fallback, max_tokens: 500, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
        })
        d = await r2.json().catch(() => ({}))
        if (!r2.ok) { failed++; lastFail = `model ${r2.status}: ${str(d?.error?.message).slice(0, 120)}`; continue }
      } else if (!r.ok) { failed++; lastFail = `model ${r.status}: ${str(d?.error?.message).slice(0, 120)}`; continue }
      const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
      const parsed = parseJson(text)
      if (!parsed) { failed++; lastFail = 'the model answer was not readable JSON'; continue }

      const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 3)))
      const band = score <= 2 ? 'negative' : score >= 4 ? 'positive' : 'neutral'
      const aiDissatisfied = parsed.dissatisfied === true || band === 'negative'
      const kw = hasKw(guestText)

      const triggers: string[] = []
      if (aiDissatisfied) triggers.push('ai_dissatisfaction')
      if (kw) triggers.push('keyword')
      if (score <= 2) triggers.push('low_score')
      const staleHrs = lastGuestAt ? (Date.now() - new Date(lastGuestAt).getTime())/ 3600000 : 0
      if (band === 'negative' && awaiting && staleHrs >= 2) triggers.push('unanswered_negative')

      // A KEYWORD IS A TAG, NEVER A VERDICT (2026-09-28 audit, D6). The list holds 'review', 'a/c',
      // 'cancel', 'manager', 'smell' — so "we'll leave you a great review" or "how do I set the
      // a/c?" was filed as an unhappy guest, surfaced on the Command Center as "within the hour",
      // and written into Guesty as sensitive. The keyword stays in `triggers`; only the model's
      // reading or a low score makes a guest dissatisfied.
      const complaint = parsed.complaint === true || String(parsed.mood || '').toLowerCase() === 'sensitive'
      const mood = moodOf(parsed.mood, score, complaint)
      const dissatisfied = aiDissatisfied || score <= 2 || mood === 'sensitive'

      await sb.from('guesty_conversation_sentiment').upsert({
        conversation_id: c.id,
        guest_name: c.guest_name || null,
        channel: c.channel || null,
        reservation_id: c.reservation_id || null,
        listing_id: c.listing_id || null,
        score,
        band,
        dissatisfied,
        triggers,
        top_issue: str(parsed.topIssue).trim() ? str(parsed.topIssue).trim().slice(0, 80) : null,
        reason: str(parsed.reason).trim().slice(0, 400) || null,
        guest_excerpt: str(parsed.excerpt).trim().slice(0, 200) || null,
        last_message_at: c.last_message_at || null,
        last_guest_at: lastGuestAt,
        awaiting_reply: awaiting,
        mood,
        complaint,
        scanned_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id' })

      scanned++
      if (triggers.length) flagged++

      // THE GUESTY WRITE (the label in Reservation Notes; Sensitive ticked on a complaint) happens
      // after the batch, in flushMoodNotes — capped, retried, and read-merge-write.
    } catch { /* skip this conversation, continue the batch */ }
  }

  // THE LABELS INTO GUESTY (2026-09-30). Every thread whose label is not in the reservation's notes
  // yet — this run's and the backlog — capped per run because Guesty 429s readily. Complaints first.
  let guesty: any = null
  try { guesty = await flushMoodNotes(viaCron ? 15 : 6) } catch (e: any) { guesty = { error: String(e?.message || e).slice(0, 200) } }

  // AN HONEST RECEIPT (2026-09-28 audit, 03 #23). A run where every model call failed used to be
  // recorded as ok with "scanned 0", so the watchdog saw a healthy job while nothing was being read.
  const remaining = Math.max(0, todo.length - scanned)
  const allFailed = batch.length > 0 && scanned === 0 && failed > 0
  const error = allFailed ? `every model call failed (${failed}) — ${lastFail}` : null
  recordRun({ name: 'sentiment', ok: !allFailed, itemCount: scanned, detail: { scanned, flagged, failed, rateLimited, remaining, windowDays: days, guesty }, error })

  // EVERY GUEST ISSUE BECOMES A GLITCH (Jon, 2026-10-07). This scan is where a guest's unhappiness
  // in the message thread is first written down; the watch runs behind it so a thread scored
  // dissatisfied becomes a glitch and a customer-care flag in the same half hour, not whenever
  // somebody next opens the Sentiment tab. Cron only — an interactive scan should not file things
  // under the person who pressed a button. Best effort: never costs the scan its result.
  let heard: any = null
  if (viaCron && flagged > 0) {
    try {
      const { runGuestIssueWatch } = await import('@/lib/guest-issue')
      const { getSetting } = await import('@/lib/app-settings')
      const cfg = await getSetting<any>('guest_issue_watch', null)
      if (!cfg || cfg.on !== false) heard = await runGuestIssueWatch({ hours: 12, by: 'cron:sentiment-scan' })
    } catch (e: any) { heard = { ok: false, error: String(e?.message || e).slice(0, 200) } }
  }
  return NextResponse.json({ ok: !allFailed, scanned, flagged, failed, rateLimited, remaining, windowDays: days, guesty, flushed, watched, guestIssues: heard, ...(error ? { error } : {}) })
}

export const GET = POST

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}
