// EVE'S STANDING AUDIT — the difference between a dashboard and a colleague.
//
// Jon, 2026-08-24: "She needs to run audits and scans of all activities and keep things on tab."
//
// The sweep (sweep.ts) learns what is NORMAL. Trends (trends.ts) spot what MOVED. Neither of those
// tells you something is BROKEN, because a broken thing is often perfectly steady — a feed that has
// been dead for three days has a beautifully flat line. That gap is not theoretical: guest messages
// died silently for two and a half days in August and nothing anywhere went red, because the process
// was KILLED rather than throwing, so nothing stamped an error. A parallel deploy quietly deleted
// three crons from vercel.json and no screen in the app was any the wiser. Sentiment scanning had
// never run automatically at all.
//
// So this file asks a different question from the rest of Eve: not "what is happening" but
// "what is WRONG right now, including with me".
//
// TWO DESIGN RULES THAT MAKE IT A TAB RATHER THAN A FIREHOSE:
//
//   1. EVERY FINDING HAS A STABLE ID. Not a timestamp, not a row count — a key derived from the
//      check and its subject ("sync_stale:messages"). The same problem on Monday and Wednesday is
//      ONE item that has been open two days, not two alerts. That is what "keep it on tab" means.
//
//   2. THE TAB CLOSES ITSELF. Anything that was open and does not come back in a later run is
//      marked resolved automatically, with the time it took. Nobody has to tidy up, so nobody
//      learns to ignore the list — which is the only way an alert list survives contact with a
//      real week.
//
// SEVERITY IS ABOUT CONSEQUENCE, NOT SIZE. critical = we are flying blind or a guest is being
// ignored right now. warn = it will cost us if it runs another week. info = worth knowing.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { todayET, lc, DEAD_LISTING, shiftDay } from './ctx'
import { auditCodes } from './code-integrity'
import { visionCoverage } from './vision'
import { crewScorecard } from './accountability'
import { expectedCronPaths } from './automations'

export type Severity = 'critical' | 'warn' | 'info'
export type Area = 'pipeline' | 'guests' | 'reviews' | 'ops' | 'listings' | 'money' | 'eve'

export type AuditFinding = {
  id: string
  area: Area
  severity: Severity
  title: string
  detail: string
  /** What a person should actually DO. A finding without this is a complaint, not an audit. */
  fix: string
  count: number
  evidence?: any
}

type Row = { db: ReturnType<typeof supabaseAdmin>; today: string }

async function safe<T>(p: any, fallback: T): Promise<T> {
  try { return (await p) as T } catch { return fallback }
}
const minsSince = (t: any): number | null => {
  const v = Date.parse(String(t || ''))
  return Number.isFinite(v) ? Math.round((Date.now() - v) / 60000) : null
}
const hrs = (m: number) => m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`

// =================================================================================================
// PIPELINE — is Eve actually seeing anything? Every other answer in the app is downstream of this,
// so these are the audits that run first and shout loudest.
// =================================================================================================

/**
 * How stale is too stale, PER FEED. A single global threshold is useless here: reservations sync
 * every five minutes and owner statements once a month, so one number would either scream about
 * statements or stay silent while the message feed rots.
 */
const FEED_BUDGET_MIN: Record<string, { warn: number; critical: number; label: string }> = {
  reservations:  { warn: 30,    critical: 180,   label: 'Reservations' },
  listings:      { warn: 1500,  critical: 4320,  label: 'Listings' },
  conversations: { warn: 180,   critical: 720,   label: 'Guest conversations' },
  messages:      { warn: 120,   critical: 480,   label: 'Guest messages' },
  reviews:       { warn: 1500,  critical: 4320,  label: 'Reviews' },
}

async function auditFeeds(c: Row): Promise<AuditFinding[]> {
  const out: AuditFinding[] = []
  const r: any = await safe(c.db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50), { data: [] })
  const rows: any[] = r?.data || []
  const seen = new Set<string>()

  for (const row of rows) {
    const key = String(row.entity || '')
    const budget = FEED_BUDGET_MIN[key]
    if (!budget) continue
    seen.add(key)
    const age = minsSince(row.last_sync_at)

    if (age == null) {
      out.push({
        id: 'feed_never:' + key, area: 'pipeline', severity: 'critical', count: 1,
        title: `${budget.label} has never synced`,
        detail: 'There is a row for this feed but no successful sync has ever been recorded. Everything Eve says about it is guesswork.',
        fix: `Run the sync for "${key}" by hand and read the error it returns.`,
        evidence: { entity: key },
      })
      continue
    }
    if (age >= budget.critical) {
      out.push({
        id: 'feed_stale:' + key, area: 'pipeline', severity: 'critical', count: age,
        title: `${budget.label} is ${hrs(age)} stale`,
        detail: `Last successful sync was ${hrs(age)} ago; this feed is expected roughly every ${hrs(budget.warn)}.`
          + (row.last_error ? ` Last error: ${String(row.last_error).slice(0, 200)}` : ' No error was recorded, which usually means the job was KILLED on timeout rather than failing — check the function duration, not just the logs.'),
        fix: `Open the cron for ${key}, run it manually, and watch whether it finishes or gets cut off.`,
        evidence: { entity: key, ageMinutes: age, lastError: row.last_error || null },
      })
    } else if (age >= budget.warn) {
      out.push({
        id: 'feed_stale:' + key, area: 'pipeline', severity: 'warn', count: age,
        title: `${budget.label} is ${hrs(age)} behind`,
        detail: `Expected roughly every ${hrs(budget.warn)}; currently ${hrs(age)} old.` + (row.last_error ? ` Last error: ${String(row.last_error).slice(0, 200)}` : ''),
        fix: 'Usually self-corrects on the next run. If it is still here tomorrow it is not self-correcting.',
        evidence: { entity: key, ageMinutes: age },
      })
    }
    if (row.last_error) {
      out.push({
        id: 'feed_error:' + key, area: 'pipeline', severity: 'warn', count: 1,
        title: `${budget.label} sync recorded an error`,
        detail: String(row.last_error).slice(0, 400),
        fix: 'Read the error. A feed that errors while still looking fresh is the most dangerous kind, because every screen looks normal.',
        evidence: { entity: key },
      })
    }
  }

  for (const key of Object.keys(FEED_BUDGET_MIN)) {
    if (seen.has(key)) continue
    out.push({
      id: 'feed_missing:' + key, area: 'pipeline', severity: 'critical', count: 1,
      title: `No sync record at all for ${FEED_BUDGET_MIN[key].label}`,
      detail: 'This feed has no row in guesty_sync_status, so nothing is monitoring it and nothing ever has.',
      fix: `Confirm the ${key} sync exists and is wired to a cron.`,
      evidence: { entity: key },
    })
  }
  return out
}

/**
 * The cron audit. This exists because of a specific, real failure: a commit from another session
 * ("Add files via upload") silently dropped three cron entries from vercel.json, and the loss was
 * only found by chance days later. Comparing the deployed schedule against the list of jobs we
 * believe we run turns that class of accident from invisible into a line on this screen.
 */
// Derived from the automation registry rather than retyped here. The hand-maintained version of
// this list covered 14 of the app's ~27 scheduled jobs, so the thirteen it had never heard of were
// outside the very safety net this audit exists to be.
const EXPECTED_CRONS = expectedCronPaths()

async function auditCrons(): Promise<AuditFinding[]> {
  const out: AuditFinding[] = []
  try {
    // Read at build/runtime from the repo itself: the schedule that actually shipped, not a copy.
    const cfg: any = await import('@/vercel.json').then(m => m.default || m)
    const paths: string[] = (cfg?.crons || []).map((x: any) => String(x?.path || ''))
    const missing = EXPECTED_CRONS.filter(p => !paths.includes(p))
    if (missing.length) {
      out.push({
        id: 'cron_missing', area: 'pipeline', severity: 'critical', count: missing.length,
        title: `${missing.length} scheduled job(s) are not in vercel.json`,
        detail: `Missing: ${missing.join(', ')}. These jobs exist in the codebase but nothing is calling them, so whatever they keep current is quietly rotting. This has happened before — a merge dropped three crons and nobody noticed for days.`,
        fix: 'Add them back to vercel.json crons and redeploy. After ANY change to vercel.json, diff the cron list.',
        evidence: { missing, deployed: paths.length },
      })
    }
  } catch {
    out.push({
      id: 'cron_unreadable', area: 'pipeline', severity: 'info', count: 1,
      title: 'Could not read the cron schedule',
      detail: 'vercel.json was not importable at runtime, so the scheduled-job audit could not run.',
      fix: 'Not urgent, but it means one of the audits is blind.',
    })
  }
  return out
}

/** Conversations that have moved recently but were never scored. Sentiment has form for this. */
async function auditSentimentBacklog(c: Row): Promise<AuditFinding[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  const conv: any = await safe(c.db.from('guesty_conversations').select('id').gte('last_message_at', since).order('id').limit(3000), { data: [] })
  const ids: string[] = (conv?.data || []).map((x: any) => String(x.id))
  if (!ids.length) return []
  const sc: any = await safe(c.db.from('guesty_conversation_sentiment').select('conversation_id').in('conversation_id', ids.slice(0, 1000)).limit(3000), { data: [] })
  const scored = new Set((sc?.data || []).map((x: any) => String(x.conversation_id)))
  const gap = ids.slice(0, 1000).filter(i => !scored.has(i)).length
  if (gap < 25) return []
  return [{
    id: 'sentiment_backlog', area: 'pipeline', severity: gap > 200 ? 'critical' : 'warn', count: gap,
    title: `${gap} recent guest threads have never been scored`,
    detail: 'Sentiment scoring is what turns raw messages into "this guest is unhappy". Unscored threads are invisible to every unhappy-guest view in the app.',
    fix: 'Run the sentiment scan. If the backlog keeps rebuilding, the cron is not firing often enough for the volume.',
    evidence: { unscored: gap, windowDays: 14 },
  }]
}

/** Days missing from the metric history. A hole here silently weakens every z-score built on it. */
async function auditMetricGaps(c: Row): Promise<AuditFinding[]> {
  const from = shiftDay(c.today, -14)
  const m: any = await safe(c.db.from('eve_metrics').select('day').gte('day', from).lte('day', c.today).order('day').limit(5000), { data: [] })
  const have = new Set((m?.data || []).map((x: any) => String(x.day).slice(0, 10)))
  const missing: string[] = []
  for (let i = 1; i <= 14; i++) {
    const d = shiftDay(c.today, -i)
    if (!have.has(d)) missing.push(d)
  }
  if (missing.length < 2) return []
  return [{
    id: 'metric_gaps', area: 'pipeline', severity: missing.length > 5 ? 'warn' : 'info', count: missing.length,
    title: `${missing.length} of the last 14 days have no metrics recorded`,
    detail: `Missing: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. Every trend and anomaly score is computed against this history, so holes make Eve less certain without her being able to say why.`,
    fix: 'Backfill the metric range for those days, then check the eve-metrics cron is firing.',
    evidence: { missing },
  }]
}

// =================================================================================================
// GUESTS, REVIEWS, OPS — is anybody being left waiting?
// =================================================================================================

async function auditAwaitingReply(c: Row): Promise<AuditFinding[]> {
  const s: any = await safe(c.db.from('guesty_conversation_sentiment')
    .select('conversation_id,listing_id,awaiting_reply,dissatisfied,last_guest_at,top_issue')
    .eq('awaiting_reply', true).order('last_guest_at', { ascending: true }).limit(500), { data: [] })
  const rows: any[] = s?.data || []
  if (!rows.length) return []
  const aged = rows.map(r => ({ ...r, mins: minsSince(r.last_guest_at) })).filter(r => r.mins != null && r.mins > 60 * 6)
  if (!aged.length) return []
  const unhappy = aged.filter(r => r.dissatisfied)
  const worst = aged[0]
  const out: AuditFinding[] = [{
    id: 'guests_awaiting_reply', area: 'guests', severity: aged.length > 15 || unhappy.length > 0 ? 'critical' : 'warn', count: aged.length,
    title: `${aged.length} guest${aged.length === 1 ? ' is' : 's are'} waiting on a reply`,
    detail: `All have been waiting over six hours; the oldest is ${worst.mins != null ? hrs(worst.mins) : 'unknown'}.`
      + (unhappy.length ? ` ${unhappy.length} of them are already flagged unhappy — those are the ones that turn into reviews.` : ''),
    fix: 'Answer the unhappy ones first, then oldest first. A holding reply beats silence.',
    evidence: { waiting: aged.length, unhappy: unhappy.length, oldestMinutes: worst.mins },
  }]
  return out
}

async function auditUnansweredReviews(c: Row): Promise<AuditFinding[]> {
  const from = new Date(Date.now() - 45 * 86400000).toISOString()
  const r: any = await safe(c.db.from('guesty_reviews').select('id,rating,has_reply,created_at,excluded_from_score')
    .gte('created_at', from).eq('excluded_from_score', false).order('created_at').limit(2000), { data: [] })
  const rows: any[] = r?.data || []
  const star = (n: any) => { const v = Number(n); return !Number.isFinite(v) || v <= 0 ? null : (v <= 5 ? v : v / 2) }
  const cutoff = Date.now() - 3 * 86400000
  const low = rows.filter(x => !x.has_reply && (star(x.rating) ?? 5) <= 3 && Date.parse(x.created_at) < cutoff)
  if (!low.length) return []
  return [{
    id: 'reviews_unanswered_low', area: 'reviews', severity: low.length > 3 ? 'critical' : 'warn', count: low.length,
    title: `${low.length} negative review${low.length === 1 ? '' : 's'} unanswered for over 3 days`,
    detail: 'A bad review with no reply is the last thing a prospect reads before deciding. The reply is not for the guest who wrote it, it is for the next hundred people who read it.',
    fix: 'Reply to each. Even a short, specific, non-defensive answer moves the read.',
    evidence: { count: low.length },
  }]
}

async function auditOverdueTasks(c: Row): Promise<AuditFinding[]> {
  const from = shiftDay(c.today, -21)
  const t: any = await safe(c.db.from('breezeway_tasks_sync')
    .select('id,name,status,scheduled_date,finished_at,started_at,type_department,reference_property_id')
    .gte('scheduled_date', from).lt('scheduled_date', c.today).order('scheduled_date').limit(4000), { data: [] })
  const rows: any[] = (t?.data || []).filter((x: any) => !/delete|cancel/.test(lc(x.status)))
  const done = (x: any) => !!x.finished_at || /complete|finish|close|approv/.test(lc(x.status))
  const open = rows.filter(x => !done(x))
  if (open.length < 5) return []
  const neverStarted = open.filter(x => !x.started_at)
  const byDept: Record<string, number> = {}
  for (const x of open) byDept[String(x.type_department || 'other')] = (byDept[String(x.type_department || 'other')] || 0) + 1
  const top = Object.keys(byDept).sort((a, b) => byDept[b] - byDept[a]).slice(0, 4)
  return [{
    id: 'tasks_overdue', area: 'ops', severity: open.length > 40 ? 'critical' : 'warn', count: open.length,
    title: `${open.length} past-dated task${open.length === 1 ? '' : 's'} still open`,
    detail: `Scheduled on or before yesterday and not finished. ${neverStarted.length} were never started at all. Heaviest: ${top.map(d => `${d} ${byDept[d]}`).join(', ')}.`
      + ' Some of these are genuinely done and never closed out, which is its own problem: it makes every completion number wrong.',
    fix: 'Close out the ones that are actually done, then triage the rest by department.',
    evidence: { open: open.length, neverStarted: neverStarted.length, byDept },
  }]
}

async function auditArrivalsWithoutCleans(c: Row): Promise<AuditFinding[]> {
  const tomorrow = shiftDay(c.today, 1)
  const r: any = await safe(c.db.from('guesty_reservations').select('id,listing_id,guest_name,check_in,status')
    .gte('check_in', c.today).lte('check_in', tomorrow).order('check_in').limit(500), { data: [] })
  const arrivals: any[] = (r?.data || []).filter((x: any) => !/cancel|declin|inquir|expire/i.test(lc(x.status)))
  if (!arrivals.length) return []
  const ids = Array.from(new Set(arrivals.map((a: any) => String(a.listing_id))))
  const t: any = await safe(c.db.from('breezeway_tasks_sync').select('reference_property_id,scheduled_date,type_department,name,status,finished_at')
    .in('reference_property_id', ids).gte('scheduled_date', shiftDay(c.today, -1)).lte('scheduled_date', tomorrow).order('scheduled_date').limit(2000), { data: [] })
  const cleanBy: Record<string, boolean> = {}
  for (const x of (t?.data || [])) {
    const isClean = /clean|turnover|housekeep/i.test(String(x.type_department || '') + ' ' + String(x.name || ''))
    if (isClean) cleanBy[String(x.reference_property_id)] = true
  }
  const naked = arrivals.filter((a: any) => !cleanBy[String(a.listing_id)])
  if (!naked.length) return []
  return [{
    id: 'arrivals_no_clean', area: 'ops', severity: 'critical', count: naked.length,
    title: `${naked.length} arrival${naked.length === 1 ? '' : 's'} in the next 2 days with no clean scheduled`,
    detail: `No cleaning or turnover task is on the board for ${naked.slice(0, 6).map((a: any) => a.guest_name || 'a guest').join(', ')}${naked.length > 6 ? ' and others' : ''}. Either the task is missing or it is filed under a name this check does not recognise.`,
    fix: 'Check each on the day sheet. A guest walking into an uncleaned unit is the single most expensive hour in this business.',
    evidence: { count: naked.length, listingIds: naked.slice(0, 20).map((a: any) => a.listing_id) },
  }]
}

const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

async function auditListingGaps(c: Row): Promise<AuditFinding[]> {
  const l: any = await safe(c.db.from('guesty_listings').select('id,nickname,title,status,pictures,raw').order('id').limit(500), { data: [] })
  const live = (l?.data || []).filter((x: any) => !DEAD_LISTING.test(lc(x.status)))
  if (live.length < 5) return []
  const out: AuditFinding[] = []

  const noCode = live.filter((x: any) => {
    const cf = Array.isArray(x.raw?.customFields) ? x.raw.customFields : []
    return !cf.some((f: any) => {
      const id = String(f?.fieldId?._id || f?.fieldId?.id || f?.fieldId || '')
      const nm = lc(f?.fieldId?.name || f?.name || f?.fieldName)
      const hit = id === DOOR_CODE_FIELD || /door\s*code|entry\s*code|access\s*code|keypad/.test(nm)
      return hit && String(f?.value || '').trim()
    })
  })
  if (noCode.length) {
    out.push({
      id: 'listings_no_door_code', area: 'listings', severity: noCode.length > live.length * 0.25 ? 'warn' : 'info', count: noCode.length,
      title: `${noCode.length} of ${live.length} live units have no door code on file`,
      detail: `Nobody can be sent a code for these, so every request becomes a phone call: ${noCode.slice(0, 8).map((x: any) => x.nickname || x.title).join(', ')}${noCode.length > 8 ? '…' : ''}.`,
      fix: 'Fill the door-code custom field in Guesty for each. The approval flow does the rest.',
      evidence: { count: noCode.length, sample: noCode.slice(0, 20).map((x: any) => x.nickname || x.title) },
    })
  }

  const thin = live.filter((x: any) => {
    const pics = Array.isArray(x.pictures) ? x.pictures.length : (Array.isArray(x.raw?.pictures) ? x.raw.pictures.length : 0)
    return pics < 12
  })
  if (thin.length) {
    out.push({
      id: 'listings_thin_photos', area: 'listings', severity: 'info', count: thin.length,
      title: `${thin.length} live unit${thin.length === 1 ? ' has' : 's have'} fewer than 12 photos`,
      detail: 'Photo count is the strongest listing-side lever on conversion that we can actually control this week.',
      fix: 'Prioritise the ones with the lowest occupancy first.',
      evidence: { count: thin.length, sample: thin.slice(0, 15).map((x: any) => x.nickname || x.title) },
    })
  }
  return out
}


/**
 * Guest-facing content that does not exist. A missing house rule is not cosmetic: it is what you
 * point at when a guest throws a party, and if it is not written you have nothing to point at.
 */
async function auditGuestContent(c: Row): Promise<AuditFinding[]> {
  const out: AuditFinding[] = []
  const l: any = await safe(c.db.from('guesty_listings').select('id,nickname,title,status,raw').order('id').limit(500), { data: [] })
  const live = (l?.data || []).filter((x: any) => !DEAD_LISTING.test(lc(x.status)))
  if (live.length < 5) return out

  const noRules = live.filter((x: any) => !String(x.raw?.publicDescription?.houseRules || '').trim())
  const noArrival = live.filter((x: any) => !String(x.raw?.checkInInstructions || x.raw?.publicDescription?.access || '').trim())

  if (noRules.length) {
    out.push({
      id: 'no_house_rules', area: 'listings', severity: noRules.length > live.length * 0.2 ? 'warn' : 'info', count: noRules.length,
      title: `${noRules.length} live unit${noRules.length === 1 ? ' has' : 's have'} no house rules written`,
      detail: `${noRules.slice(0, 8).map((x: any) => x.nickname || x.title).join(', ')}${noRules.length > 8 ? ' and others' : ''}. There is nothing to point at when a guest breaks a rule that was never stated, and nothing for the team to quote back.`,
      fix: 'Copy the standard house rules onto these listings in Guesty and adjust per building.',
      evidence: { units: noRules.slice(0, 25).map((x: any) => x.nickname || x.title) },
    })
  }
  if (noArrival.length) {
    out.push({
      id: 'no_arrival_instructions', area: 'listings', severity: 'warn', count: noArrival.length,
      title: `${noArrival.length} live unit${noArrival.length === 1 ? ' has' : 's have'} no arrival instructions`,
      detail: `${noArrival.slice(0, 8).map((x: any) => x.nickname || x.title).join(', ')}${noArrival.length > 8 ? ' and others' : ''}. Every arrival at one of these is a guest messaging us from the kerb, at whatever hour they land.`,
      fix: 'Write the access text on each listing. This is the single highest-volume avoidable message we get.',
      evidence: { units: noArrival.slice(0, 25).map((x: any) => x.nickname || x.title) },
    })
  }
  return out
}

/**
 * Tasks that never had their billing detail pulled.
 *
 * This gap is SILENT BY CONSTRUCTION, which is what makes it worth an audit line: the task list
 * Breezeway syncs from carries no costs or bill_to, so a task whose detail was never retrieved is
 * indistinguishable from a task with nothing to bill. It reads as $0 and nobody ever asks why.
 * Measured once in August, filling the gap moved 30-day maintenance revenue 19% with no code
 * change at all. The nightly pull now walks backwards through old months as well as the current
 * one; this line is how anyone knows whether it is keeping up.
 */
async function auditBillingDetailGap(c: Row): Promise<AuditFinding[]> {
  const from = shiftDay(c.today, -90)
  const t: any = await safe(c.db.from('breezeway_tasks_sync')
    .select('id,rate_paid,type_department,scheduled_date')
    .gte('scheduled_date', from).lte('scheduled_date', c.today)
    .order('scheduled_date').limit(8000), { data: [] })
  // Only tasks that could plausibly carry money — a $0 inspection with no detail costs us nothing.
  const worth = (t?.data || []).filter((x: any) => Number(x.rate_paid) > 0 || /maintenance/i.test(String(x.type_department || '')))
  if (worth.length < 20) return []

  const ids: string[] = worth.map((x: any) => String(x.id))
  const have = new Set<string>()
  for (let i = 0; i < ids.length; i += 400) {
    const d: any = await safe(c.db.from('breezeway_billing_details').select('task_id').in('task_id', ids.slice(i, i + 400)), { data: [] })
    for (const r of (d?.data || [])) have.add(String((r as any).task_id))
  }
  const missing = ids.filter(id => !have.has(id))
  if (missing.length < 25) return []

  const pct = Math.round((missing.length / ids.length) * 100)
  return [{
    id: 'billing_detail_gap', area: 'money', severity: pct > 30 ? 'warn' : 'info', count: missing.length,
    title: `${missing.length} billable task(s) in the last 90 days have no billing detail pulled`,
    detail: `${pct}% of rated or maintenance tasks. Each one bills $0 no matter what a tech entered in Breezeway, and it looks identical to a task with nothing to charge — which is why this never shows up as a complaint. Every maintenance recovery rate and owner invoice is understated by whatever is in here.`,
    fix: 'The nightly billing-detail pull works through these oldest-gap-first. If this number is not falling week to week, that job is not keeping up and needs a longer budget or a second daily run.',
    evidence: { missing: missing.length, considered: ids.length, pct },
  }]
}

/**
 * The other half of "caught but not fixed". The crew scorecard uses that number to EXONERATE the
 * person who found the problem; this is the same evidence pointed the other way, because an issue
 * reported before a turnover and still open when the guest walked in is a resolution failure with
 * a guest standing in the middle of it. Without this line the number only ever protects someone —
 * it never costs anyone anything, which is how a metric quietly becomes decorative.
 */
async function auditUnfixedBeforeArrival(): Promise<AuditFinding[]> {
  try {
    const s = await crewScorecard({ role: 'clean', days: 30 })
    const n = s.totals.caughtNotFixed
    if (n < 2) return []
    const worst = s.people.filter(p => p.caughtNotFixed > 0).sort((a, b) => b.caughtNotFixed - a.caughtNotFixed).slice(0, 5)
    return [{
      id: 'reported_not_fixed', area: 'ops', severity: n > 8 ? 'critical' : 'warn', count: n,
      title: `${n} issue${n === 1 ? ' was' : 's were'} reported at a turnover and still open when the guest arrived`,
      detail: `Found by the crew on the day they cleaned, unresolved by check-in. Most affected reporters: ${worst.map(p => `${p.person} (${p.caughtNotFixed})`).join(', ')}. `
        + 'These are NOT cleaning failures — the crew did their job. They are maintenance turnaround failures, and they are the ones that reach a guest.',
      fix: 'Work the maintenance queue against arrival dates rather than in the order it was raised. Anything reported on a turnover day has a deadline, not a backlog position.',
      evidence: { count: n, reporters: worst.map(p => ({ person: p.person, caughtNotFixed: p.caughtNotFixed })) },
    }]
  } catch { return [] }
}

/**
 * How much of the estate Eve has actually looked at. Deliberately INFO, never a warning: a nightly
 * quota is supposed to leave this incomplete for weeks, and flagging steady progress as a fault is
 * how a list teaches people to ignore it. It turns into a real finding only if it stops moving.
 */
async function auditVisionProgress(): Promise<AuditFinding[]> {
  try {
    const c = await visionCoverage()
    if (!c.photos) return []
    const pct = Math.round((c.seen / c.photos) * 100)
    if (pct >= 95) return []
    // Background scanning ships off, so an incomplete number is the expected state, not news.
    // Reporting it anyway would put a permanent grey line on the tab that never resolves.
    if (!c.seen) return []
    return [{
      id: 'vision_coverage', area: 'listings', severity: 'info', count: c.unitsNeverSeen,
      title: `Eve has looked at ${pct}% of the portfolio photos`,
      detail: `${c.seen} of ${c.photos} photos seen across ${c.units} live units. ${c.unitsFullySeen} units fully seen, ${c.unitsNeverSeen} never looked at. A nightly quota works through the worst-covered first.`,
      fix: 'Nothing to do — this climbs on its own. If the number stops moving for a week, the nightly pass has stopped running.',
      evidence: c,
    }]
  } catch { return [] }
}

// =================================================================================================
// EVE AUDITING HERSELF — the recommendations nobody answered, and the approvals nobody tapped.
// A proposal that expires unread is a broken loop, and a broken loop is worth a line on this screen
// even though nothing technically failed.
// =================================================================================================

async function auditEveLoops(c: Row): Promise<AuditFinding[]> {
  const out: AuditFinding[] = []

  const rec: any = await safe(c.db.from('eve_recommendations').select('id,title,status,created_at').eq('status', 'proposed').order('created_at').limit(200), { data: [] })
  const stale = (rec?.data || []).filter((r: any) => Date.parse(r.created_at) < Date.now() - 7 * 86400000)
  if (stale.length) {
    out.push({
      id: 'recs_undecided', area: 'eve', severity: 'info', count: stale.length,
      title: `${stale.length} recommendation${stale.length === 1 ? '' : 's'} waiting over a week for a yes or no`,
      detail: `Oldest: "${String(stale[0].title || '').slice(0, 120)}". Undecided proposals never get graded, so they teach Eve nothing either way — the scorecard only learns from calls that were actually made.`,
      fix: 'Accept or reject them in Settings, Eve, Direction. Rejecting is as useful as accepting.',
      evidence: { count: stale.length },
    })
  }

  const act: any = await safe(c.db.from('eve_actions').select('id,kind,status,created_at,why').eq('kind', 'door_code').order('created_at', { ascending: false }).limit(200), { data: [] })
  const week = Date.now() - 7 * 86400000
  const expired = (act?.data || []).filter((r: any) => r.status === 'expired' && Date.parse(r.created_at) > week)
  if (expired.length >= 2) {
    out.push({
      id: 'doorcodes_expired', area: 'eve', severity: 'warn', count: expired.length,
      title: `${expired.length} door-code request${expired.length === 1 ? '' : 's'} expired without anyone approving`,
      detail: 'Somebody asked, the checks cleared, and the four-hour window ran out with no tap. That is the approval loop failing quietly — and the usual next step is that people stop using it and start texting each other codes instead.',
      fix: 'Check the Slack approvals channel is set and that the right people are in it.',
      evidence: { count: expired.length },
    })
  }
  return out
}

// =================================================================================================
// THE RUNNER
// =================================================================================================

export const CHECKS: { key: string; run: (c: Row) => Promise<AuditFinding[]> }[] = [
  { key: 'feeds', run: auditFeeds },
  { key: 'crons', run: async () => auditCrons() },
  { key: 'sentiment_backlog', run: auditSentimentBacklog },
  { key: 'metric_gaps', run: auditMetricGaps },
  { key: 'awaiting_reply', run: auditAwaitingReply },
  { key: 'unanswered_reviews', run: auditUnansweredReviews },
  { key: 'overdue_tasks', run: auditOverdueTasks },
  { key: 'arrivals_no_clean', run: auditArrivalsWithoutCleans },
  { key: 'listing_gaps', run: auditListingGaps },
  { key: 'guest_content', run: auditGuestContent },
  { key: 'reported_not_fixed', run: async () => auditUnfixedBeforeArrival() },
  { key: 'billing_detail_gap', run: auditBillingDetailGap },
  { key: 'vision_progress', run: async () => auditVisionProgress() },
  { key: 'code_integrity', run: async () => (await auditCodes()) as AuditFinding[] },
  { key: 'eve_loops', run: auditEveLoops },
]

export type AuditRun = {
  ok: boolean
  ranAt: string
  checks: Record<string, number>
  errors: string[]
  opened: AuditFinding[]      // NEW since the last run — this is what is worth interrupting someone for
  stillOpen: number
  resolved: string[]          // closed themselves since the last run
  bySeverity: Record<string, number>
}

export async function runAudit(): Promise<AuditRun> {
  const db = supabaseAdmin()
  const c: Row = { db, today: todayET() }
  const now = new Date().toISOString()
  const checks: Record<string, number> = {}
  const errors: string[] = []
  const found: AuditFinding[] = []

  for (const chk of CHECKS) {
    try {
      const f = await chk.run(c)
      checks[chk.key] = f.length
      found.push(...f)
    } catch (e: any) {
      checks[chk.key] = -1
      errors.push(`${chk.key}: ${String(e?.message || e).slice(0, 160)}`)
    }
  }

  // What was already on the tab?
  const prev: any = await safe(db.from('eve_audits').select('id,status,first_seen_at,snooze_until').limit(2000), { data: [] })
  const prevRows: any[] = prev?.data || []
  const prevById: Record<string, any> = {}
  for (const r of prevRows) prevById[String(r.id)] = r

  const opened: AuditFinding[] = []
  const rows = found.map(f => {
    const old = prevById[f.id]
    const wasOpen = old && old.status === 'open'
    // A snooze that has run out goes back on the tab rather than staying quietly buried.
    const snoozedStill = old && old.status === 'snoozed' && old.snooze_until && Date.parse(old.snooze_until) > Date.now()
    if (!old || (!wasOpen && !snoozedStill)) opened.push(f)
    return {
      id: f.id, area: f.area, severity: f.severity, title: f.title.slice(0, 300),
      detail: f.detail.slice(0, 2000), fix: f.fix.slice(0, 600), count: f.count,
      evidence: f.evidence ?? null,
      status: snoozedStill ? 'snoozed' : 'open',
      // first_seen_at is the age of the PROBLEM, so it survives a resolve-and-reopen only if it
      // never actually closed. A reopened issue is a new one; pretending otherwise hides recurrence.
      first_seen_at: wasOpen ? old.first_seen_at : now,
      last_seen_at: now,
      resolved_at: null,
    }
  })

  let written = 0
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from('eve_audits').upsert(rows.slice(i, i + 100), { onConflict: 'id' })
    if (error) { errors.push('eve_audits upsert: ' + error.message.slice(0, 160)); break }
    written += Math.min(100, rows.length - i)
  }

  // THE TAB CLOSES ITSELF. Anything open that this run did not find is fixed.
  const stillIds = new Set(rows.map(r => r.id))
  const toResolve = prevRows.filter(r => (r.status === 'open' || r.status === 'snoozed') && !stillIds.has(String(r.id))).map(r => String(r.id))
  if (toResolve.length) {
    for (let i = 0; i < toResolve.length; i += 100) {
      await safe(db.from('eve_audits').update({ status: 'resolved', resolved_at: now }).in('id', toResolve.slice(i, i + 100)), null)
    }
  }

  const bySeverity: Record<string, number> = {}
  for (const r of rows) if (r.status === 'open') bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1

  return {
    ok: true, ranAt: now, checks, errors,
    opened, stillOpen: rows.filter(r => r.status === 'open').length,
    resolved: toResolve, bySeverity,
  }
}

export type AuditItem = {
  id: string; area: string; severity: string; title: string; detail: string; fix: string
  count: number; evidence: any; status: string
  first_seen_at: string; last_seen_at: string; resolved_at: string | null
  snooze_until: string | null; acked_by: string | null; note: string | null
  ageDays: number
}

export async function listAudits(opts?: { status?: string; limit?: number }): Promise<AuditItem[]> {
  const db = supabaseAdmin()
  const status = opts?.status || 'open'
  let q = db.from('eve_audits').select('*')
  if (status !== 'all') q = q.eq('status', status)
  const { data } = await q.order('last_seen_at', { ascending: false }).limit(Math.min(opts?.limit || 100, 300))
  const rank: Record<string, number> = { critical: 0, warn: 1, info: 2 }
  return (data || []).map((r: any) => ({
    ...r,
    ageDays: Math.max(0, Math.round((Date.now() - Date.parse(r.first_seen_at)) / 86400000)),
  })).sort((a: any, b: any) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.ageDays - a.ageDays)
}

/** Acknowledge or snooze. Deliberately no "dismiss": if it is real it comes straight back. */
export async function decideAudit(id: string, op: 'ack' | 'snooze' | 'reopen', by: string, days = 7): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const patch: any = op === 'ack' ? { status: 'acknowledged', acked_by: by }
    : op === 'snooze' ? { status: 'snoozed', acked_by: by, snooze_until: new Date(Date.now() + Math.min(Math.max(days, 1), 60) * 86400000).toISOString() }
    : { status: 'open', snooze_until: null, resolved_at: null }
  const { error } = await db.from('eve_audits').update(patch).eq('id', id)
  return error ? { ok: false, error: error.message.slice(0, 200) } : { ok: true }
}
