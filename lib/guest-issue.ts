// EVERY GUEST ISSUE BECOMES A GLITCH (Jon, 2026-10-07).
//
// The case that prompted this. Jenna Marcello, Eden 1104, Airbnb, 6 Oct. Nine minutes on the
// phone: somebody tried her door handle, and then the lock would not lock at all — "if someone
// tried to open my door, I'd rather not stay". Hassan moved her to 1203 that night.
//
// Lighthouse HAD all of it. lib/call-intel had already read the transcript and written, into
// talkroute_calls.intel:
//     issues: ["Door lock malfunction—will not lock from inside or outside",
//              "Attempted unauthorized entry from neighboring unit", "Guest security concern"]
// …and then stopped. The note went on the booking and nothing else happened: no glitch, no
// message to customer care, nothing in Slack, no maintenance task on the lock. The only trace in
// the app the next morning was a block note on 1203 — the consequence, not the incident.
//
// So this module is the missing wire. It reads the two places a guest's own words already land —
// recorded calls (call intel) and the guest message threads (the sentiment scan) — and for each
// issue it files the glitch, flags customer care with an alert they have to acknowledge, and
// posts to Slack. Nothing here re-reads a transcript with the model: the reading is done, this
// is the acting on it.
//
// Deliberately conservative about what counts, because a board full of noise is a board nobody
// reads: a routine "what time is check-in" call has an empty issues[] and never reaches here.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { marketOf } from './segments'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clean = (s: any, n = 300) => str(s).replace(/\s+/g, ' ').trim().slice(0, n)

/** How loudly this has to land. */
export type IssueSeverity = 'security' | 'issue' | 'watch' | 'none'

export type Detection = {
  sourceKey: string                 // 'call:<id>' | 'thread:<conversation id>'
  kind: 'call' | 'message'
  occurredAt: string
  reservationId: string | null
  conversationId: string | null
  listingId: string | null
  unit: string
  guestName: string
  channel: string
  severity: IssueSeverity
  category: string
  headline: string                  // one line a manager reads and understands
  issues: string[]                  // the specific things that are wrong
  evidence: string                  // the guest's own words, or the call summary
  link: string                      // where to read the whole thing
}

// ── WHAT MAKES SOMETHING URGENT ─────────────────────────────────────────────────────────────────
// A safety or security problem is not "a guest issue" in the ordinary sense: it is somebody in a
// room they are now afraid of. It escalates past customer care to leadership the same minute.
// These patterns come from the Jenna call and from the categories the team already files under.
const SECURITY_RE = /\b(lock(?:ing|s|ed)?\s*(?:is|are|not|n't|won'?t|doesn'?t|broken|fail)|won'?t lock|not? lock(?:ing)?|door (?:won'?t|will not|doesn'?t|does not) (?:lock|close)|deadbolt|broke[rn]? in|break[- ]?in|intrud|tried to (?:open|get in|enter)|someone (?:was|is) (?:at|outside|trying)|stranger|unsafe|not safe|afraid|scared|threat|stalk|harass|assault|weapon|gun|robbed|stolen|theft|burglar|police|911|fire|smoke|gas leak|carbon monoxide|flood(?:ing|ed)|electrical (?:fire|shock)|injur|fell|blood|hospital)\b/i
// Problems that stop the stay working but are not a safety matter.
const HARD_RE = /\b(no (?:hot )?water|no (?:a\/?c|air|power|electricity|wifi|internet)|not working|doesn'?t work|won'?t turn|broken|leak|flood|mold|roach|bed ?bug|pest|infest|filthy|dirty|unclean|smell|sewage|locked out|lock(?:ed)? out|can'?t get in|couldn'?t get in|no access|code (?:doesn'?t|did not|didn'?t) work|double ?book|wrong unit|cancel)\b/i

/** Category, from the CAT_CHIPS vocabulary the Glitches board already files under. */
export function categoryFor(text: string): string {
  const t = text.toLowerCase()
  if (SECURITY_RE.test(t) || /\block|door|key|fob|entry|access|code\b/.test(t)) {
    // An access problem that is only "the code did not work" is a building/access matter; a lock
    // that will not lock, or somebody at the door, is security.
    if (SECURITY_RE.test(t)) return 'Safety/Security Concern'
    return 'Maintenance - Building/Common Areas'
  }
  if (/\b(a\/?c|air con|heat|hot|cold|temperature|hvac|thermostat)\b/.test(t)) return 'Maintenance - HVAC/Temperature'
  if (/\b(hot water|water heater|shower.*(cold|no water))\b/.test(t)) return 'Maintenance - Water Heater'
  if (/\b(dirty|filthy|unclean|clean(?:liness|ing)|stain|trash|dishes|linen|towel)\b/.test(t)) return 'Cleanliness - Inadequate Cleaning'
  if (/\b(toilet|sink|drain|plumb|leak|water everywhere|clog)\b/.test(t)) return 'Maintenance - Plumbing'
  if (/\b(fridge|refrigerator|oven|stove|microwave|washer|dryer|dishwasher|appliance|tv|television)\b/.test(t)) return 'Maintenance - Appliances'
  if (/\b(power|outlet|electric|light|breaker|fuse)\b/.test(t)) return 'Maintenance - Electrical'
  if (/\b(roach|bug|bed ?bug|ant|rodent|mouse|rat|pest|infest)\b/.test(t)) return 'Pests/Bed Bugs'
  if (/\b(park|garage|valet|vehicle|car)\b/.test(t)) return 'Parking/Vehicle'
  if (/\b(elevator|lobby|gym|pool|common|building|hallway|construction|noise)\b/.test(t)) return 'Maintenance - Building/Common Areas'
  return 'Other'
}

/** How loud. Security wins; otherwise a concrete fault is an issue and a grumble is a watch. */
export function severityFor(text: string, sentiment?: string | null): IssueSeverity {
  const t = text.toLowerCase()
  if (SECURITY_RE.test(t)) return 'security'
  if (HARD_RE.test(t)) return 'issue'
  if (sentiment === 'unhappy' || sentiment === 'negative') return 'issue'
  return 'watch'
}

export const SEV_LABEL: Record<IssueSeverity, string> = {
  security: 'Safety / security', issue: 'Guest issue', watch: 'Worth a look', none: '—',
}

// ── READING WHAT WE ALREADY HEARD ───────────────────────────────────────────────────────────────

/** Calls whose intel names something wrong, in the window, that we have not judged yet. */
async function fromCalls(sinceISO: string, seen: Set<string>): Promise<Detection[]> {
  const db = supabaseAdmin()
  const { data } = await db.from('talkroute_calls')
    .select('id, call_at, direction, duration, reservation_id, summary, intel, external_number')
    .gte('call_at', sinceISO).not('intel', 'is', null)
    .order('call_at', { ascending: false }).limit(300)
  const rows = (data || []) as any[]
  const wanted = rows.filter(r => !seen.has('call:' + r.id))
  if (!wanted.length) return []

  // One read for every booking these calls belong to.
  const resIds = Array.from(new Set(wanted.map(r => str(r.reservation_id)).filter(Boolean)))
  const resById: Record<string, any> = {}
  if (resIds.length) {
    const { data: res } = await db.from('guesty_reservations')
      .select('id, listing_id, guest_name, listing_name, check_in, check_out, status, source, money_total')
      .in('id', resIds.slice(0, 300))
    for (const r of (res || []) as any[]) resById[str(r.id)] = r
  }

  const out: Detection[] = []
  for (const c of wanted) {
    const intel = c.intel && typeof c.intel === 'object' ? c.intel : {}
    const issues: string[] = Array.isArray(intel.issues) ? intel.issues.map((x: any) => clean(x, 160)).filter(Boolean) : []
    const sentiment = str(intel.sentiment)
    // THE BAR. Something the model named as wrong, or a guest who came off the call unhappy.
    // A call with no issues and a fine tone is a normal call and never reaches the board.
    if (!issues.length && sentiment !== 'unhappy') continue
    const r = resById[str(c.reservation_id)] || null
    const blob = [issues.join(' · '), str(intel.summary)].join(' ')
    out.push({
      sourceKey: 'call:' + c.id,
      kind: 'call',
      occurredAt: str(c.call_at),
      reservationId: str(c.reservation_id) || null,
      conversationId: null,
      listingId: r ? str(r.listing_id) : null,
      unit: r ? str(r.listing_name) : '',
      guestName: r ? str(r.guest_name) : '',
      channel: r ? str(r.source) : '',
      severity: severityFor(blob, sentiment),
      category: categoryFor(blob),
      headline: clean(intel.summary || issues[0], 400),
      issues,
      evidence: clean(intel.summary, 600),
      link: APP_URL + '/welcome-calls/call/' + c.id,
    })
  }
  return out
}

/** Guest threads the sentiment scan has already judged unhappy, that we have not acted on. */
async function fromThreads(sinceISO: string, seen: Set<string>): Promise<Detection[]> {
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_conversation_sentiment')
    .select('conversation_id, guest_name, channel, reservation_id, listing_id, score, band, dissatisfied, triggers, top_issue, reason, guest_excerpt, last_guest_at, last_message_at, scanned_at, status, complaint, mood')
    .gte('scanned_at', sinceISO)
    .order('scanned_at', { ascending: false }).limit(300)
  const rows = (data || []) as any[]
  const wanted = rows.filter(r => !seen.has('thread:' + r.conversation_id))
  if (!wanted.length) return []

  const listingIds = Array.from(new Set(wanted.map(r => str(r.listing_id)).filter(Boolean)))
  const nameOf: Record<string, string> = {}
  if (listingIds.length) {
    const { data: ls } = await db.from('guesty_listings').select('id, nickname, title').in('id', listingIds.slice(0, 300))
    for (const l of (ls || []) as any[]) nameOf[str(l.id)] = str(l.nickname || l.title || '')
  }

  const out: Detection[] = []
  for (const s of wanted) {
    const triggers: string[] = Array.isArray(s.triggers) ? s.triggers.map(String) : []
    const bad = s.dissatisfied === true || /neg|bad|angry|upset|unhappy/i.test(str(s.band)) || str(s.complaint) === 'yes'
    // THE BAR, on this side: the scan says the guest is dissatisfied, or it is a complaint. A low
    // score with a neutral read is left to the Sentiment tab — this board is for things to DO.
    if (!bad) continue
    const blob = [str(s.top_issue), str(s.reason), str(s.guest_excerpt), triggers.join(' ')].join(' ')
    out.push({
      sourceKey: 'thread:' + s.conversation_id,
      kind: 'message',
      occurredAt: str(s.last_guest_at || s.last_message_at || s.scanned_at),
      reservationId: str(s.reservation_id) || null,
      conversationId: str(s.conversation_id),
      listingId: str(s.listing_id) || null,
      unit: nameOf[str(s.listing_id)] || '',
      guestName: str(s.guest_name),
      channel: str(s.channel),
      severity: severityFor(blob, s.dissatisfied ? 'unhappy' : null),
      category: categoryFor(blob),
      headline: clean(s.top_issue || s.reason, 400),
      issues: [clean(s.top_issue, 160)].filter(Boolean),
      evidence: clean(s.guest_excerpt || s.reason, 600),
      link: APP_URL + '/messages?c=' + encodeURIComponent(str(s.conversation_id)),
    })
  }
  return out
}

// ── FILING ──────────────────────────────────────────────────────────────────────────────────────

/** The glitch this detection becomes. Returns its id, or null when the insert was refused. */
async function fileGlitch(d: Detection): Promise<string | null> {
  const db = supabaseAdmin()
  let res: any = null
  if (d.reservationId) {
    const { data } = await db.from('guesty_reservations')
      .select('id, listing_id, guest_name, listing_name, check_in, check_out, source, money_total, raw')
      .eq('id', d.reservationId).maybeSingle()
    res = data || null
  }
  const unit = d.unit || (res ? str(res.listing_name) : '')
  const phone = res && res.raw && res.raw.guest ? str(res.raw.guest.phone) : ''
  const email = res && res.raw && res.raw.guest ? str(res.raw.guest.email) : ''
  const row: Record<string, any> = {
    status: 'pool',
    // A safety matter is filed AS a safety matter — the board draws it differently and it is the
    // word an insurer or an owner will read a year from now.
    glitch_type: d.severity === 'security' ? 'Security Incident' : 'Glitch (Quality Issue)',
    category: d.category,
    categories: Array.from(new Set([d.category])),
    listing_id: d.listingId || (res ? str(res.listing_id) : null),
    unit: unit || null,
    market: marketOf(unit) || null,
    reservation_id: d.reservationId,
    conversation_id: d.conversationId,
    guest_name: d.guestName || (res ? str(res.guest_name) : null),
    guest_phone: phone || null,
    guest_email: email || null,
    channel: d.channel || (res ? str(res.source) : null),
    check_in: res ? str(res.check_in).slice(0, 10) || null : null,
    check_out: res ? str(res.check_out).slice(0, 10) || null : null,
    reservation_total: res && res.money_total != null ? Number(res.money_total) : null,
    incident_date: (d.occurredAt || new Date().toISOString()).slice(0, 10),
    overview: [d.headline, d.issues.length > 1 ? 'Reported: ' + d.issues.join('; ') : ''].filter(Boolean).join('\n\n').slice(0, 4000),
    reported_via: d.kind === 'call' ? 'call' : 'message',
    reported_by: 'Lighthouse (heard it in the ' + (d.kind === 'call' ? 'call' : 'messages') + ')',
    guest_tone: d.severity === 'security' ? 'frustrated' : null,
    refund_approved: 0,
    assignee: 'Support',
    detected_from: d.sourceKey,
    details: 'Filed automatically from the ' + (d.kind === 'call' ? 'recorded call' : 'guest message thread') + '. Read it: ' + d.link,
    history: [{ at: new Date().toISOString(), by: 'lighthouse', action: 'created', detail: 'auto-filed from ' + d.sourceKey }],
  }
  let ins = await db.from('glitches').insert(row).select('id').single()
  if (ins.error && /column|schema/i.test(str(ins.error.message))) {
    // Same defence the manual route uses: save the core record rather than lose the issue.
    delete row.guest_tone; delete row.reported_via; delete row.categories; delete row.details
    ins = await db.from('glitches').insert(row).select('id').single()
  }
  if (ins.error) {
    // The unique index on detected_from means a racing second run loses politely.
    if (/duplicate|unique/i.test(str(ins.error.message))) return null
    throw new Error('glitch insert: ' + ins.error.message)
  }
  return ins.data ? str((ins.data as any).id) : null
}

/** The line customer care sees — in the pop-up they must acknowledge, and in Slack. */
export function alertText(d: Detection, glitchId: string | null): { title: string; body: string } {
  const who = [d.guestName || 'A guest', d.unit ? 'at ' + d.unit : ''].filter(Boolean).join(' ')
  const title = (d.severity === 'security' ? '🚨 Safety/security — ' : 'Guest issue — ')
    + (d.unit || d.guestName || 'a stay')
  const body = [
    who + (d.channel ? ' (' + d.channel + ')' : '') + ' — ' + (d.kind === 'call' ? 'said this on the phone' : 'wrote this to us') + ':',
    d.headline,
    d.issues.length > 1 ? 'What is wrong: ' + d.issues.join('; ') : '',
    d.severity === 'security'
      ? 'This is a safety matter. Confirm the guest is safe and the unit is secure now, then tell operations and management.'
      : 'Customer care owns this: answer the guest, get the fix moving, and keep the glitch updated.',
    glitchId ? 'Glitch filed: ' + APP_URL + '/glitches?id=' + glitchId : 'No glitch filed yet — file one from the Glitches board.',
    'Read it in full: ' + d.link,
  ].filter(Boolean).join('\n')
  return { title, body }
}

// ── THE WATCH ───────────────────────────────────────────────────────────────────────────────────

export type WatchResult = {
  ok: boolean
  looked: { calls: number; threads: number }
  found: number
  filed: number
  alerted: number
  skipped: number
  dryRun: boolean
  detections: (Detection & { verdict: string; glitchId: string | null; alerted: boolean })[]
  error?: string
}

/**
 * Run the watch. `hours` is how far back to read (the cron passes a small window; a person
 * catching up can ask for more). `dryRun` reads and judges and writes nothing — the Detected tab
 * uses it to preview.
 */
export async function runGuestIssueWatch(opts: { hours?: number; dryRun?: boolean; by?: string } = {}): Promise<WatchResult> {
  const hours = Math.max(1, Math.min(24 * 14, Number(opts.hours) || 24))
  const dryRun = !!opts.dryRun
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const db = supabaseAdmin()
  const out: WatchResult = { ok: true, looked: { calls: 0, threads: 0 }, found: 0, filed: 0, alerted: 0, skipped: 0, dryRun, detections: [] }

  // What we have already judged — by source key, so nothing is filed twice.
  const seen = new Set<string>()
  try {
    const { data } = await db.from('guest_issue_detections').select('source_key').gte('detected_at', new Date(Date.now() - 60 * 86400_000).toISOString()).limit(5000)
    for (const r of (data || []) as any[]) seen.add(str(r.source_key))
  } catch (e: any) {
    if (/relation|does not exist|schema cache/i.test(str(e?.message))) return { ...out, ok: false, error: 'Run migration 148 (guest_issue_detections) in Supabase first.' }
  }
  // A dry run wants to SHOW what is already handled too, so it does not hide the recent history.
  const skipSeen = dryRun ? new Set<string>() : seen

  let found: Detection[] = []
  try {
    const [calls, threads] = await Promise.all([fromCalls(since, skipSeen), fromThreads(since, skipSeen)])
    out.looked = { calls: calls.length, threads: threads.length }
    found = [...calls, ...threads].sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || ''))
  } catch (e: any) {
    return { ...out, ok: false, error: String(e?.message || e).slice(0, 300) }
  }
  out.found = found.length

  for (const d of found) {
    const already = seen.has(d.sourceKey)
    if (dryRun) {
      // A PREVIEW THAT CAN BE ACTED ON. Reading without recording left the Detected tab with
      // nothing to put a File it button on, so a person could see an issue and not file it — the
      // exact gap this whole module exists to close. A preview writes the row as `pending`: no
      // glitch, no alert, nothing said to anyone, but it is now something a person can file or
      // dismiss in one click. An entry we have already judged is never overwritten.
      if (!already) await recordDetection(d, { verdict: 'pending', glitchId: null, alerted: false, note: 'seen by a preview — not filed, waiting on a person' })
      out.detections.push({ ...d, verdict: already ? 'handled' : 'pending', glitchId: null, alerted: false })
      continue
    }
    // A grumble with nothing concrete behind it is recorded and left alone — the Detected tab
    // shows it, and a person can file it in one click if they disagree.
    if (d.severity === 'watch') {
      out.skipped++
      await recordDetection(d, { verdict: 'skipped', glitchId: null, alerted: false, note: 'nothing concrete named — left for a person' })
      continue
    }
    let glitchId: string | null = null
    try { glitchId = await fileGlitch(d) } catch (e: any) { out.error = String(e?.message || e).slice(0, 200) }
    if (glitchId) out.filed++
    // FLAG CUSTOMER CARE, ALWAYS (Jon: "we need to flag the customer service team immediately").
    // raiseEveAlert is the intrusive pop-up with acknowledgement tracking AND the Slack post to
    // #vr-customercareteam tagging Roberto, Karla and Silvia — one call does both.
    let alerted = false
    try {
      const { raiseEveAlert } = await import('./handoff-store')
      const { title, body } = alertText(d, glitchId)
      alerted = await raiseEveAlert({
        title, body, unit: d.unit || null, dedupe: 'guest-issue:' + d.sourceKey,
        severity: d.severity === 'security' ? 'urgent' : 'warn',
      })
      if (alerted) out.alerted++
    } catch { /* the glitch is filed; the alert is best effort and the Detected tab still shows it */ }
    // A safety matter also goes to leadership — customer care is not the right ceiling for it.
    if (d.severity === 'security') {
      try {
        const { postToChannel } = await import('./slack')
        const { EVE_CHANNELS, JON_SLACK_ID, ROBERTO_SLACK_ID } = await import('./slack-rules')
        const { title, body } = alertText(d, glitchId)
        await postToChannel(EVE_CHANNELS.leadership, `<@${JON_SLACK_ID}> <@${ROBERTO_SLACK_ID}> *${title}*\n${body}`)
      } catch { /* customer care already has it */ }
    }
    await recordDetection(d, { verdict: glitchId ? 'filed' : 'skipped', glitchId, alerted, note: glitchId ? null : 'glitch not filed' })
    out.detections.push({ ...d, verdict: glitchId ? 'filed' : 'skipped', glitchId, alerted })
  }
  return out
}

async function recordDetection(d: Detection, r: { verdict: string; glitchId: string | null; alerted: boolean; note?: string | null }) {
  try {
    await supabaseAdmin().from('guest_issue_detections').upsert({
      source_key: d.sourceKey, kind: d.kind, occurred_at: d.occurredAt || null,
      reservation_id: d.reservationId, conversation_id: d.conversationId, listing_id: d.listingId,
      unit: d.unit || null, guest_name: d.guestName || null, channel: d.channel || null,
      severity: d.severity, category: d.category, headline: d.headline, issues: d.issues,
      evidence: d.evidence, link: d.link,
      verdict: r.verdict, glitch_id: r.glitchId, alerted: r.alerted, note: r.note || null,
    }, { onConflict: 'source_key' })
  } catch { /* the glitch and the alert are what matter */ }
}

/** The Detected tab's list: what the watch found lately and what became of each one. */
export async function recentDetections(days = 14): Promise<any[]> {
  const since = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 86400_000).toISOString()
  const { data } = await supabaseAdmin().from('guest_issue_detections')
    .select('*').gte('detected_at', since).order('detected_at', { ascending: false }).limit(300)
  return (data || []) as any[]
}

/** A person disagreeing with the watch: file one it skipped, or dismiss one it raised. */
export async function decideDetection(sourceKey: string, decision: 'file' | 'dismiss', by: string): Promise<{ ok: boolean; glitchId?: string | null; error?: string }> {
  const db = supabaseAdmin()
  const { data } = await db.from('guest_issue_detections').select('*').eq('source_key', sourceKey).maybeSingle()
  if (!data) return { ok: false, error: 'Not found.' }
  const row: any = data
  if (decision === 'dismiss') {
    await db.from('guest_issue_detections').update({ verdict: 'dismissed', note: 'dismissed by ' + by }).eq('source_key', sourceKey)
    return { ok: true }
  }
  if (row.glitch_id) return { ok: true, glitchId: str(row.glitch_id) }
  const d: Detection = {
    sourceKey: str(row.source_key), kind: row.kind === 'call' ? 'call' : 'message',
    occurredAt: str(row.occurred_at), reservationId: row.reservation_id || null, conversationId: row.conversation_id || null,
    listingId: row.listing_id || null, unit: str(row.unit), guestName: str(row.guest_name), channel: str(row.channel),
    severity: (str(row.severity) || 'issue') as IssueSeverity, category: str(row.category) || 'Other',
    headline: str(row.headline), issues: Array.isArray(row.issues) ? row.issues.map(String) : [],
    evidence: str(row.evidence), link: str(row.link),
  }
  let glitchId: string | null = null
  try { glitchId = await fileGlitch(d) } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
  await db.from('guest_issue_detections').update({ verdict: 'manual', glitch_id: glitchId, note: 'filed by ' + by }).eq('source_key', sourceKey)
  return { ok: true, glitchId }
}
