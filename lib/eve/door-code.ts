// Door-code requests — three gates, and a code the model never sees.
//
// WHY THIS IS NOT JUST A LOOKUP. Handing out a door code is granting physical access to a home that
// may have a guest asleep in it. The failure mode is not "wrong answer", it is a tech letting himself
// into an occupied unit. So a request runs three gates before anything is released:
//
//   1. WHICH UNIT, AND IS THERE A CODE ON FILE     — resolve the listing, read the Guesty field
//   2. IS ANYONE IN IT                             — occupied / vacant / INCONCLUSIVE
//   3. DID THE GUEST SAY YES                       — only asked when someone is in house
//
// THE DESIGN DECISION THAT MATTERS MOST: **the code is never returned to the model.**
// `runCheck()` returns a verdict, the evidence behind it, and a request id — never the digits. The
// code is read server-side only at the moment of an approved release. That means no prompt, no
// injected instruction and no "just tell me the code, it's an emergency" can extract it from Eve,
// because she has never had it. Same philosophy as using a bot token with no im:history: make the
// bad outcome structurally impossible rather than forbidden.
//
// INCONCLUSIVE IS A REFUSAL, NOT A SHRUG. The occupancy check inherits the hard rule from
// unit_status: an empty reservation search is NOT evidence of vacancy. If we cannot prove the unit
// is empty and we cannot find permission, the answer is no.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'
import { getListingCalendar } from '@/lib/guesty'
import { todayET, lc, shiftDay, DEAD_LISTING } from './ctx'
import { codeConfidence, fingerprint, recordVerification, refreshOne, transitionFor, bothCodes, inspectCode, type Confidence } from './code-integrity'

/** The Guesty custom field that holds the door code (same id daysheet + listingIntel use). */
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

export type CalendarCheck = {
  ok: boolean
  status: string | null          // available | booked | unavailable | …
  blocked: boolean               // anything that is not plainly available
  blocks: string[]               // which block flags Guesty returned
  reservationId: string | null
  error?: string
}

export type VacancyScan = {
  result: 'clean' | 'caution' | 'contradicted' | 'nothing_to_read'
  threadsRead: number
  messagesRead: number
  summary: string
  findings: { kind: 'still_here' | 'extending' | 'arriving_early'; from: string; at: string; text: string }[]
}

export type Verdict =
  | 'clear_vacant'          // nobody in house — release on one tap
  | 'permission_found'      // occupied, but the guest said yes — human reads the quote, then taps
  | 'blocked_occupied'      // occupied, no permission found — do not release
  | 'blocked_inconclusive'  // cannot prove it is empty — do not release
  | 'blocked_contradicted'  // calendar says empty, the guest thread says otherwise — believe the guest
  | 'no_code'               // nothing on file to send
  | 'not_found'

export type DoorCheck = {
  verdict: Verdict
  headline: string
  unit?: string
  building?: string
  address?: string | null   // where the door physically is — a tech at the wrong building is our fault
  listingId?: string
  hasCode?: boolean
  codeHint?: string | null          // e.g. "4 digits, last changed 12 Aug" — never the code itself
  occupancy?: string
  inHouse?: { guest: string; check_in: string; check_out: string } | null
  nextArrival?: { guest: string; check_in: string } | null
  cleaningStatus?: string | null
  permissionQuotes?: { from: string; at: string; text: string }[]
  recentThread?: { from: string; at: string; text: string }[]
  /** The vacancy double-check: what the threads say, even when the calendar says nobody is in. */
  vacancyScan?: VacancyScan | null
  /** The LIVE Guesty calendar for today — the authority on extensions and manual blocks. */
  calendar?: CalendarCheck | null
  /** Is the code itself believable — shape, agreement with the listing text, and real-world use. */
  confidence?: Confidence | null
  /** After check-in time on an arrival day, the unit is theirs even if nobody has walked in yet. */
  arrivalWarning?: string | null
  taskToday?: { name: string; assignees: string[]; dept: string } | null
  requestId?: string | null
  canRelease: boolean
  note: string
}

function doorCodeOf(raw: any): string | null {
  const cf = Array.isArray(raw?.customFields) ? raw.customFields : []
  for (const c of cf) {
    const id = String(c?.fieldId?._id || c?.fieldId?.id || c?.fieldId || '')
    const nm = lc(c?.fieldId?.name || c?.name || c?.fieldName)
    if (id === DOOR_CODE_FIELD || /door\s*code|entry\s*code|access\s*code|keypad/.test(nm)) {
      const v = typeof c?.value === 'string' ? c.value.trim() : (c?.value != null ? String(c.value).trim() : '')
      if (v) return v
    }
  }
  return null
}

/** A hint a human can sanity-check against ("is that the 4-digit one?") without exposing the code. */
function hintFor(code: string): string {
  const digits = (code.match(/\d/g) || []).length
  return digits ? `${digits} digits on file` : 'a non-numeric code on file'
}

// Consent has to be an AFFIRMATIVE and an ENTRY context in the same guest message. Either alone is
// noise — "yes the wifi works" is not permission, and "someone is coming to fix the AC" is us, not
// them. Deliberately deterministic: no model gets to decide whether consent happened.
const AFFIRM = /\b(yes|yeah|yep|sure|ok|okay|of course|go ahead|please do|that'?s fine|thats fine|no problem|fine by me|feel free|sounds good|works for me|permission|you can|you may|go for it|absolutely)\b/i
const ENTRY = /\b(enter|entry|come in|come by|coming|access|inside|the unit|apartment|maintenance|technician|tech|plumber|electrician|repair|fix|clean(?:er|ing)?|service|visit|stop by|let (?:them|him|her) in)\b/i



// THE LIVE CALENDAR (Jon, 2026-08-24: "Need to look at actual calendar make sure not extensions").
//
// Our reservations table is a CACHE. An extension actioned in Guesty ten minutes ago is on the
// calendar and not yet in our copy, and that is exactly the case where somebody gets a code for a
// unit that is still occupied. So the occupancy gate does not trust the cache alone: it asks Guesty
// for the calendar for this one listing, right now, for yesterday through tomorrow.
//
// One listing, a three-day window — cheap enough to do on every request, and it is the only source
// that reflects an extension, a manual block, or an owner stay the moment somebody enters it.
//
// A FAILED CALL IS NOT A PASS. If Guesty does not answer, the check is marked degraded and that is
// said out loud on the approval rather than quietly treated as "available". It does not hard-block —
// a human still has to tap, and refusing every code because an API hiccuped would push people back
// to texting each other codes, which is the outcome this whole system exists to prevent.
async function liveCalendar(listingId: string, from: string, to: string, day: string): Promise<CalendarCheck> {
  try {
    const days: any[] = await getListingCalendar(listingId, from, to)
    const d = days.find((x: any) => String(x?.date || '').slice(0, 10) === day)
    if (!d) return { ok: false, status: null, blocked: false, blocks: [], reservationId: null, error: 'Guesty returned no row for today.' }
    const status = lc(d.status) || null
    const blocksObj = (d.blocks && typeof d.blocks === 'object') ? d.blocks : {}
    // `bw` means "beyond the booking window" — a sales limit, not somebody in the unit.
    const blocks = Object.keys(blocksObj).filter(k => k !== 'bw' && !!(blocksObj as any)[k])
    const blocked = (status != null && status !== 'available') || blocks.length > 0
    return {
      ok: true, status, blocked, blocks,
      reservationId: d?.reservationId || d?.reservation?._id || d?.blockRef?.reservationId || null,
    }
  } catch (e: any) {
    return { ok: false, status: null, blocked: false, blocks: [], reservationId: null, error: String(e?.message || e).slice(0, 200) }
  }
}

const BLOCK_WORD: Record<string, string> = {
  b: 'a manual block', m: 'a manual block', r: 'a reservation',
  o: 'an owner stay', a: 'an advance-notice hold', bd: 'a booked date',
}

// THE VACANCY DOUBLE-CHECK (Jon, 2026-08-24: "it should also scan the messages... if unit is vacant
// does not have to but need to have a double check before approving").
//
// The calendar is not the unit. A guest who asked for a late checkout an hour ago is still in there
// whether or not anyone actioned it in Guesty; a guest who is "outside the building already" is
// about to be. So when the reservations say vacant we do NOT skip the threads — we read them and
// look for the three ways the calendar is routinely wrong:
//
//   still_here     — they have not actually left, or they came back for something
//   extending      — they asked for another night or a late checkout and nobody has actioned it
//   arriving_early — the next guest is early, or already standing outside
//
// Permission is NOT required here; an empty unit needs nobody's consent. This is a contradiction
// check, and a contradiction outranks the calendar every time — same rule as gate 2, where an empty
// reservation search is not proof of vacancy. Silence in the threads is the reassuring answer, and
// it is reported as such rather than left implied.
const STILL_HERE = /\b(still (?:here|in|at|inside)|haven'?t left|have not left|not left yet|not out yet|leaving late|running late|came back|coming back|back at the (?:unit|apartment)|left (?:my|our|some|a) .{0,20}(?:inside|in the (?:unit|apartment|room))|forgot .{0,20}(?:inside|in the (?:unit|apartment|room)))\b/i
const EXTEND = /\b(extra night|another night|one more night|extend(?:ing|ed)? (?:my|our|the)? ?stay|stay(?:ing)? (?:an? )?(?:extra|longer|one more)|late check.?out|later check.?out|check.?out later)\b/i
const EARLY = /\b(early check.?in|check.?in early|checking in early|arriv(?:e|ing) early|here early|already here|we'?re outside|i'?m outside|outside the (?:building|door|unit)|can we (?:come|get) in (?:early|now)|in the lobby)\b/i

/** Guest-side messages on one reservation's thread, newest first. */
async function guestThread(db: any, reservationId: string, limit = 40): Promise<{ from: string; at: string; text: string; isGuest: boolean }[]> {
  const out: { from: string; at: string; text: string; isGuest: boolean }[] = []
  try {
    const { data: conv } = await db.from('guesty_conversations').select('id,guest_name')
      .eq('reservation_id', reservationId).order('last_message_at', { ascending: false }).limit(1)
    const cid = (conv || [])[0]?.id
    if (!cid) return out
    const { data: msgs } = await db.from('guesty_messages')
      .select('sender,sender_name,body,sent_at').eq('conversation_id', cid)
      .order('sent_at', { ascending: false }).limit(limit)
    for (const m of (msgs || [])) {
      const text = String((m as any).body || '').trim()
      if (!text) continue
      const isGuest = /guest|inbound/i.test(lc((m as any).sender))
      out.push({ from: isGuest ? 'GUEST' : ((m as any).sender_name || 'us'), at: String((m as any).sent_at), text: text.slice(0, 500), isGuest })
    }
  } catch { /* a thread we cannot read is reported as unread, never as clean */ }
  return out
}

async function scanVacancy(db: any, threads: { id: string; who: string; role: 'departed' | 'arriving' }[], windowDays = 3): Promise<VacancyScan> {
  const cutoff = Date.now() - windowDays * 86400000
  const findings: VacancyScan['findings'] = []
  let threadsRead = 0
  let messagesRead = 0

  for (const t of threads) {
    const msgs = await guestThread(db, t.id)
    if (!msgs.length) continue
    threadsRead++
    for (const m of msgs) {
      if (!m.isGuest) continue
      const at = Date.parse(m.at)
      if (!Number.isFinite(at) || at < cutoff) continue
      messagesRead++
      const who = `${t.who} (${t.role === 'departed' ? 'checked out' : 'arriving'})`
      if (t.role === 'departed' && STILL_HERE.test(m.text)) findings.push({ kind: 'still_here', from: who, at: m.at, text: m.text })
      else if (t.role === 'departed' && EXTEND.test(m.text)) findings.push({ kind: 'extending', from: who, at: m.at, text: m.text })
      else if (t.role === 'arriving' && EARLY.test(m.text)) findings.push({ kind: 'arriving_early', from: who, at: m.at, text: m.text })
    }
  }

  if (!threadsRead) {
    return {
      result: 'nothing_to_read', threadsRead: 0, messagesRead: 0, findings: [],
      summary: 'No guest thread I could read for the last checkout or the next arrival, so the calendar is the only evidence of vacancy I have. Treat that as thinner than it looks.',
    }
  }
  if (findings.length) {
    const kinds = Array.from(new Set(findings.map(f => f.kind)))
    const words: Record<string, string> = {
      still_here: 'the last guest may not actually be out',
      extending: 'the last guest asked to stay longer and I cannot see that it was actioned',
      arriving_early: 'the next guest is arriving early, possibly already there',
    }
    return {
      result: 'contradicted', threadsRead, messagesRead, findings: findings.slice(0, 4),
      summary: `The calendar says vacant but the thread says otherwise: ${kinds.map(k => words[k]).join('; ')}. Read the message below before anyone goes near the door.`,
    }
  }
  return {
    result: 'clean', threadsRead, messagesRead, findings: [],
    summary: `Read ${messagesRead} guest message${messagesRead === 1 ? '' : 's'} across ${threadsRead} thread${threadsRead === 1 ? '' : 's'} from the last ${windowDays} days — nothing about staying late, extending, or arriving early. Nothing contradicts vacancy.`,
  }
}

export async function runCheck(input: { unit?: string; listingId?: string; requestedBy?: string; requesterSlackId?: string; reason?: string }): Promise<DoorCheck> {
  const db = supabaseAdmin()
  const today = todayET()

  // ---- Gate 1: resolve the unit and the code ----
  const q = String(input?.unit || '').trim()
  const id = String(input?.listingId || '').trim()
  if (!q && !id) return { verdict: 'not_found', headline: 'No unit given.', canRelease: false, note: 'Tell me which unit.' }

  let sel = db.from('guesty_listings').select('id,nickname,title,status,building,address_full,address_city,raw')
  if (id) sel = sel.eq('id', id)
  else sel = sel.or(`nickname.ilike.%${q}%,title.ilike.%${q}%`)
  const { data: ls } = await sel.order('id').limit(8)
  const matches = (ls || [])
  if (!matches.length) {
    return { verdict: 'not_found', headline: `No unit matches "${q || id}".`, canRelease: false, note: 'Give me the exact unit name or a listing id — I will not guess which door this is.' }
  }
  const live = matches.filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
  const l: any = live[0] || matches[0]
  const unit = l.nickname || l.title || 'Unknown unit'
  const building = rollupBuilding(l.building, unit)
  const code = doorCodeOf(l.raw)

  const address = l.address_full || l.raw?.address?.full || l.address_city || null

  // A code we hold is not the same as a code that works. Weigh it before promising anything.
  // Refresh THIS unit first: the first observer of a change is the only one that can record what
  // the code used to be, and the old code is what the keypad still holds until housekeeping has
  // been in. Getting that wrong sends somebody to a door with a number that stopped working.
  if (code) await refreshOne(String(l.id), code, inspectCode(code).digits)
  const confidence = code ? await codeConfidence(String(l.id), code, l.raw) : null
  if (confidence) confidence.transition = await transitionFor(String(l.id), today)

  const base: DoorCheck = {
    verdict: 'no_code', headline: '', unit, building, address, listingId: String(l.id),
    hasCode: !!code, codeHint: code ? hintFor(code) : null, confidence,
    canRelease: false, note: '',
  }
  if (!code) {
    return { ...base, verdict: 'no_code', headline: `No door code on file for ${unit}.`, note: 'Nothing to send. Add it to the door-code custom field in Guesty first.' }
  }

  // ---- Gate 2: is anyone in it? ----
  const { data: rv } = await db.from('guesty_reservations')
    .select('id,guest_name,listing_id,check_in,check_out,status,confirmation_code')
    .eq('listing_id', l.id).order('check_out', { ascending: false }).limit(60)
  const liveRes = (rv || []).filter((r: any) => !/cancel|declin|inquir|expire/i.test(lc(r.status)))
  const inHouse = liveRes.find((r: any) => String(r.check_in).slice(0, 10) <= today && today < String(r.check_out).slice(0, 10)) || null
  const upcoming = liveRes.filter((r: any) => String(r.check_in).slice(0, 10) > today)
    .sort((a: any, b: any) => String(a.check_in).localeCompare(String(b.check_in)))[0] || null
  const lastOut = liveRes.filter((r: any) => String(r.check_out).slice(0, 10) <= today)
    .sort((a: any, b: any) => String(b.check_out).localeCompare(String(a.check_out)))[0] || null
  const cleaningStatus = (l.raw && (l.raw.cleaningStatus || l.raw?.pms?.cleaningStatus)) || null
  const arrivesToday = upcoming && String(upcoming.check_in).slice(0, 10) === today

  // Ask Guesty directly, because our reservations table is a cache and an extension lands here first.
  const calendar = await liveCalendar(String(l.id), shiftDay(today, -1), shiftDay(today, 1), today)

  // THE 3PM RULE (Jon: "After 3 pm it should state arrival and to be careful with entering").
  // Once check-in time has passed on an arrival day the unit belongs to that guest whether or not
  // anyone has watched them walk in. Guests turn up early, get let in by a neighbour, or check in
  // on the app from the lobby — none of which reaches our reservation row. "Vacant" stops being a
  // fact at 3pm and becomes a countdown.
  const checkInTime = String(l.raw?.defaultCheckInTime || l.raw?.checkInTime || '15:00').slice(0, 5)
  const nowET = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  const pastCheckIn = arrivesToday && nowET >= checkInTime
  const arrivalWarning = arrivesToday
    ? (pastCheckIn
        ? `⚠️ ${upcoming.guest_name} ARRIVES TODAY and it is already ${nowET} — past the ${checkInTime} check-in. Treat this unit as occupied: knock, wait, announce yourself, and do not walk in. Guests let themselves in early far more often than our records show it.`
        : `${upcoming.guest_name} arrives today at ${checkInTime}. Whatever is being done in there needs to be finished and out before then.`)
    : null

  // Is there real work booked on this unit today? Not a gate, but it is the difference between a
  // scheduled tech and someone who just fancies the code.
  let taskToday: DoorCheck['taskToday'] = null
  try {
    const { data: tk } = await db.from('breezeway_tasks_sync')
      .select('name,assignees,type_department,status')
      .eq('reference_property_id', l.id).eq('scheduled_date', today).order('id').limit(10)
    const t: any = (tk || [])[0]
    if (t) taskToday = { name: t.name, assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => String(a?.name || '')).filter(Boolean) : [], dept: t.type_department }
  } catch { /* not a gate */ }

  const common = { ...base, calendar, arrivalWarning, inHouse: inHouse ? { guest: inHouse.guest_name, check_in: String(inHouse.check_in).slice(0, 10), check_out: String(inHouse.check_out).slice(0, 10) } : null, nextArrival: upcoming ? { guest: upcoming.guest_name, check_in: String(upcoming.check_in).slice(0, 10) } : null, cleaningStatus, taskToday }

  // ---- Gate 2b: the live calendar overrules the cache ----
  // Our reservations say nobody is in, and Guesty says today is not available. That gap IS the
  // extension case: somebody stayed on, or an owner stay or a block went in, and our copy has not
  // caught up. There is no reservation to read a thread against, so there is nothing to weigh — the
  // answer is no.
  if (!inHouse && calendar.ok && calendar.blocked) {
    const why = calendar.blocks.length
      ? calendar.blocks.map(b => BLOCK_WORD[b] || `a "${b}" block`).join(' and ')
      : `status "${calendar.status}"`
    return {
      ...common, verdict: 'blocked_contradicted', canRelease: false,
      headline: `BLOCKED — our records say ${unit} is empty, the live Guesty calendar says it is not.`,
      occupancy: `Guesty shows today as ${calendar.status || 'not available'}${calendar.blocks.length ? ` (${why})` : ''}, while no reservation in our copy covers today.`,
      note: 'Our reservation table is a cache; the calendar is the live answer, and it wins. This is what an extension looks like before it syncs. Find out what is on that date in Guesty before anyone gets a code.',
    }
  }

  // ---- Gate 3: permission, only when someone is in house ----
  if (inHouse) {
    const quotes: DoorCheck['permissionQuotes'] = []
    const thread: DoorCheck['recentThread'] = []
    try {
      const { data: conv } = await db.from('guesty_conversations').select('id,guest_name')
        .eq('reservation_id', inHouse.id).order('last_message_at', { ascending: false }).limit(1)
      const cid = (conv || [])[0]?.id
      if (cid) {
        const { data: msgs } = await db.from('guesty_messages')
          .select('sender,sender_name,body,sent_at').eq('conversation_id', cid)
          .order('sent_at', { ascending: false }).limit(40)
        for (const m of (msgs || [])) {
          const isGuest = /guest|inbound/i.test(lc((m as any).sender))
          const text = String((m as any).body || '').trim()
          if (!text) continue
          const row = { from: isGuest ? 'GUEST' : ((m as any).sender_name || 'us'), at: String((m as any).sent_at), text: text.slice(0, 500) }
          thread.push(row)
          if (isGuest && AFFIRM.test(text) && ENTRY.test(text)) quotes.push(row)
        }
        thread.reverse()
      }
    } catch { /* fall through to blocked */ }

    if (quotes.length) {
      return {
        ...common, verdict: 'permission_found',
        headline: `${unit} is OCCUPIED — but ${inHouse.guest_name} appears to have agreed to entry.`,
        occupancy: `Occupied: ${inHouse.guest_name}, ${String(inHouse.check_in).slice(0, 10)} to ${String(inHouse.check_out).slice(0, 10)}.`,
        permissionQuotes: quotes.slice(0, 4), recentThread: thread.slice(-12),
        canRelease: true,
        calendar,
        note: 'READ THE QUOTE BEFORE RELEASING. I matched an affirmative plus an entry reference in a guest message — that is a pattern match, not a judgement. You decide whether it actually means yes.',
      }
    }
    return {
      ...common, verdict: 'blocked_occupied',
      headline: `BLOCKED — ${unit} is occupied and I cannot find permission to enter.`,
      occupancy: `Occupied: ${inHouse.guest_name}, ${String(inHouse.check_in).slice(0, 10)} to ${String(inHouse.check_out).slice(0, 10)}.`,
      recentThread: thread.slice(-12), canRelease: false,
      note: `There is a guest in this unit and nothing in the recent thread reads as consent. Message ${inHouse.guest_name} and ask before anyone goes near the door.`,
    }
  }

  // Nobody in house. Still refuse if the signals contradict "empty".
  const recentCheckout = !!lastOut && (Date.now() - new Date(String(lastOut.check_out).slice(0, 10) + 'T00:00:00').getTime()) <= 1 * 86400000
  if (!liveRes.length) {
    return {
      ...common, verdict: 'blocked_inconclusive',
      headline: `Cannot confirm ${unit} is empty.`,
      occupancy: 'No reservation on file for this listing — which is INCONCLUSIVE, not proof of vacancy.',
      canRelease: false,
      note: 'I have no booking history for this listing, so I cannot prove nobody is inside. Confirm the unit is empty by another route before releasing anything.',
    }
  }
  // The calendar says empty. Read the threads anyway before agreeing with it.
  const toScan: { id: string; who: string; role: 'departed' | 'arriving' }[] = []
  if (lastOut) toScan.push({ id: lastOut.id, who: lastOut.guest_name || 'last guest', role: 'departed' })
  if (upcoming) toScan.push({ id: upcoming.id, who: upcoming.guest_name || 'next guest', role: 'arriving' })
  const vacancyScan = await scanVacancy(db, toScan)

  if (vacancyScan.result === 'contradicted') {
    const f = vacancyScan.findings[0]
    return {
      ...common, vacancyScan, verdict: 'blocked_contradicted',
      headline: `BLOCKED — the calendar says ${unit} is empty, the guest thread says otherwise.`,
      occupancy: `No reservation covers today, but: ${vacancyScan.summary}`,
      permissionQuotes: vacancyScan.findings.map(x => ({ from: x.from, at: x.at, text: x.text })),
      canRelease: false,
      note: `${f.from} wrote: "${f.text.slice(0, 240)}" (${String(f.at).slice(0, 10)}). A message beats the calendar — confirm the unit is actually empty, or fix the reservation, before anyone gets a code.`,
    }
  }

  const cautions: string[] = []
  if (lc(cleaningStatus) === 'dirty') cautions.push('cleaning status is DIRTY')
  if (recentCheckout) cautions.push(`last checkout was ${String(lastOut.check_out).slice(0, 10)}`)
  if (arrivesToday) cautions.push(pastCheckIn ? `a guest ARRIVES TODAY and check-in time has already passed (${upcoming.guest_name})` : `a guest ARRIVES TODAY (${upcoming.guest_name})`)
  if (vacancyScan.result === 'nothing_to_read') cautions.push('no guest thread to cross-check against')
  if (!calendar.ok) cautions.push('the LIVE Guesty calendar could not be read, so an extension made in the last few minutes would not show here')

  return {
    ...common, vacancyScan, verdict: 'clear_vacant',
    headline: `${unit} is vacant right now.` + (cautions.length ? ` Heads up: ${cautions.join(', ')}.` : ''),
    occupancy: 'No guest in house.',
    canRelease: true,
    note: (cautions.length
      ? `Vacant, but ${cautions.join(' and ')} — worth a thought about timing before someone walks in.`
      : (taskToday ? `Vacant, and there is work booked on it today (${taskToday.name}).` : 'Vacant, and no work is booked on it today — worth asking why the code is needed.'))
      + ` Double-check: ${vacancyScan.summary}`
      + (calendar.ok ? ' The live Guesty calendar agrees the unit is free today.' : ` Calendar check DEGRADED: ${calendar.error || 'no answer from Guesty'}.`)
      + (arrivalWarning ? ` ${arrivalWarning}` : ''),
  }
}

/**
 * Park an approved-pending request. Stored in eve_actions (migration 045) with a one-time token, so
 * the release link cannot be replayed. The CODE IS NOT STORED HERE — only the listing id.
 */
export async function createRequest(check: DoorCheck, who: { email?: string; slackUserId?: string; reason?: string }): Promise<{ ok: boolean; requestId?: string; token?: string; confirmToken?: string; error?: string }> {
  if (!check.canRelease || !check.listingId) return { ok: false, error: 'This check did not clear — nothing to park.' }
  const db = supabaseAdmin()
  const token = randomBytes(24).toString('hex')
  // A SECOND token that survives the release. The first is burned the moment the code is revealed;
  // this one is what the "did it work" prompt rides on afterwards, which is the only place real
  // ground truth about a code ever comes from.
  const confirmToken = randomBytes(18).toString('hex')
  try {
    const { data, error } = await db.from('eve_actions').insert({
      created_by: who.email || who.slackUserId || 'unknown',
      kind: 'door_code',
      payload: {
        listingId: check.listingId, unit: check.unit, building: check.building, address: check.address || null,
        requesterSlackId: who.slackUserId || null, requesterEmail: who.email || null,
        reason: who.reason || null, token, confirmToken,
      },
      why: check.headline,
      evidence: {
        verdict: check.verdict, occupancy: check.occupancy,
        permissionQuotes: check.permissionQuotes || null, taskToday: check.taskToday || null,
        vacancyScan: check.vacancyScan || null,
        arrivalWarning: check.arrivalWarning || null,
        calendar: check.calendar || null,
        confidence: check.confidence || null,
      },
      status: 'proposed',
      // Physical access should not sit approvable overnight.
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, requestId: (data as any)?.id, token, confirmToken }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/**
 * Release. This is the ONLY place the code is read, and it happens after a human has approved.
 * One-time: the token is cleared so a forwarded link is dead on arrival.
 */
export async function releaseByToken(token: string, approvedBy: string): Promise<{
  ok: boolean; code?: string; previousCode?: string | null; expect?: 'new' | 'old' | 'only_one'
  transitionNote?: string | null; arrivalWarning?: string | null
  unit?: string; slackUserId?: string | null; slackChannel?: string | null; slackTs?: string | null
  confirmToken?: string | null; error?: string
}> {
  const db = supabaseAdmin()
  const t = String(token || '').trim()
  if (!t) return { ok: false, error: 'no token' }
  const { data, error } = await db.from('eve_actions').select('*').eq('kind', 'door_code').limit(200)
  if (error) return { ok: false, error: 'lookup failed' }
  const row: any = (data || []).find((r: any) => r?.payload?.token === t)
  if (!row) return { ok: false, error: 'This link is no longer valid. Door-code links work once and then expire.' }
  if (row.status === 'executed') return { ok: false, error: 'That code was already sent.' }
  if (row.status === 'rejected' || row.status === 'expired') return { ok: false, error: `This request was ${row.status}.` }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await db.from('eve_actions').update({ status: 'expired' }).eq('id', row.id)
    return { ok: false, error: 'This request expired. Ask again and it will re-run the checks against how things stand now.' }
  }

  // Re-read the code NOW, server-side. It was never stored on the request and never shown to Eve.
  const { data: ls } = await db.from('guesty_listings').select('raw,nickname,title').eq('id', row.payload.listingId).limit(1)
  const code = doorCodeOf(((ls || [])[0] as any)?.raw)
  if (!code) return { ok: false, error: 'The door code has disappeared from Guesty since this was checked.' }

  await db.from('eve_actions').update({
    status: 'executed', decided_by: approvedBy, decided_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    // Blank the token so the link is single-use, and record WHO got it without recording WHAT.
    // Burn the release token, KEEP the confirm token: the question "did it work" only becomes
    // answerable after this point, and it is the whole reason we will ever know a code is right.
    payload: { ...row.payload, token: null },
    result: { codeFp: fingerprint(code), sentTo: row.payload.requesterSlackId || row.payload.requesterEmail || 'unknown', at: new Date().toISOString() },
  }).eq('id', row.id)

  // BOTH CODES GO OUT. The keypad holds the old one until housekeeping changes it at the end of the
  // clean, so handing over only the newest value is handing over the one that does not open the
  // door yet. Which to try first is stated; both are shown, because being wrong about the order
  // costs a retry and being wrong about the set costs a wasted trip.
  const pair = await bothCodes(String(row.payload.listingId), code)
  const tr = await transitionFor(String(row.payload.listingId), todayET())

  return {
    ok: true, code, previousCode: pair.previous, expect: tr.expect, transitionNote: tr.reason,
    arrivalWarning: row?.evidence?.arrivalWarning || null,
    unit: row.payload.unit, slackUserId: row.payload.requesterSlackId || null,
    slackChannel: row.payload.slackChannel || null, slackTs: row.payload.slackTs || null,
    confirmToken: row.payload.confirmToken || null,
  }
}

/**
 * "Did it actually open the door?" — answered from a link in the release DM, by whoever was
 * standing there. Deliberately needs no login: the token is the credential, it is single-purpose,
 * and it reveals nothing. Requiring a session here would mean the field techs, who are exactly the
 * people who know the answer, could never give it.
 */
export async function confirmByToken(confirmToken: string, which: 'new' | 'old' | 'neither', note?: string): Promise<{ ok: boolean; unit?: string; which?: string; error?: string }> {
  const db = supabaseAdmin()
  const t = String(confirmToken || '').trim()
  if (!t) return { ok: false, error: 'no token' }
  const { data } = await db.from('eve_actions').select('*').eq('kind', 'door_code').order('created_at', { ascending: false }).limit(400)
  const row: any = (data || []).find((r: any) => r?.payload?.confirmToken === t)
  if (!row) return { ok: false, error: 'That link is not one of ours, or it is too old to match.' }
  if (row.status !== 'executed') return { ok: false, error: 'That code was never released, so there is nothing to confirm.' }
  const fp = row?.result?.codeFp
  if (!fp) return { ok: false, error: 'This release predates outcome tracking.' }

  const by = row.payload?.requesterEmail || row.payload?.requesterSlackId || 'the requester'
  // "The old one worked" is not a failure of the code — it is a FACT ABOUT THE LOCK: housekeeping
  // has not changed it yet. Recording that as a plain no would flag a perfectly good new code as
  // broken and send somebody to change something that is already correct.
  const res = await recordVerification({
    listingId: String(row.payload.listingId), codeFp: String(fp), worked: which === 'new', by,
    actionId: String(row.id), note: note || null, which,
    skipStateUpdate: which === 'old',
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, unit: row.payload.unit, which }
}


/** Remember where the approval was posted, so the same message can be updated when it resolves. */
export async function attachSlackPost(requestId: string, channel: string, ts: string): Promise<void> {
  if (!requestId || !channel || !ts) return
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('eve_actions').select('payload').eq('id', requestId).maybeSingle()
    const payload = ((data as any)?.payload) || {}
    await db.from('eve_actions').update({ payload: { ...payload, slackChannel: channel, slackTs: ts } }).eq('id', requestId)
  } catch { /* cosmetic only — never block a release on it */ }
}

export type PendingRequest = {
  id: string
  token: string | null
  unit: string
  building: string | null
  address: string | null
  verdict: string
  headline: string
  occupancy: string | null
  quote: { from: string; at: string; text: string } | null
  taskToday: { name: string; assignees: string[] } | null
  vacancyScan: VacancyScan | null
  arrivalWarning: string | null
  calendar: CalendarCheck | null
  confidence: Confidence | null
  requestedBy: string
  reason: string | null
  createdAt: string
  expiresAt: string | null
  minutesLeft: number | null
  status: string
}

function toPending(row: any): PendingRequest {
  const ev = row?.evidence || {}
  const pl = row?.payload || {}
  const exp = row?.expires_at ? new Date(row.expires_at).getTime() : 0
  return {
    id: String(row.id),
    token: pl.token || null,
    unit: pl.unit || 'Unknown unit',
    building: pl.building || null,
    address: pl.address || null,
    verdict: ev.verdict || 'unknown',
    headline: row.why || '',
    occupancy: ev.occupancy || null,
    quote: Array.isArray(ev.permissionQuotes) && ev.permissionQuotes[0] ? ev.permissionQuotes[0] : null,
    taskToday: ev.taskToday || null,
    vacancyScan: ev.vacancyScan || null,
    arrivalWarning: ev.arrivalWarning || null,
    calendar: ev.calendar || null,
    confidence: ev.confidence || null,
    requestedBy: pl.requesterEmail || pl.requesterSlackId || row.created_by || 'unknown',
    reason: pl.reason || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    minutesLeft: exp ? Math.max(0, Math.round((exp - Date.now()) / 60000)) : null,
    status: row.status,
  }
}

/**
 * What is waiting on a human right now. Never includes a code — this feeds a screen, and screens
 * get left open, screenshotted and shoulder-surfed.
 */
export async function listPending(limit = 20): Promise<PendingRequest[]> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_actions').select('*').eq('kind', 'door_code')
    .eq('status', 'proposed').order('created_at', { ascending: false }).limit(limit)
  const now = Date.now()
  return (data || [])
    .filter((r: any) => !r.expires_at || new Date(r.expires_at).getTime() > now)
    .map(toPending)
}

/** The context behind one release link, so the approver decides on evidence rather than on trust. */
export async function peekRequest(token: string): Promise<{ ok: boolean; request?: PendingRequest; error?: string }> {
  const t = String(token || '').trim()
  if (!t) return { ok: false, error: 'no token' }
  const db = supabaseAdmin()
  const { data } = await db.from('eve_actions').select('*').eq('kind', 'door_code').limit(200)
  const row: any = (data || []).find((r: any) => r?.payload?.token === t)
  if (!row) return { ok: false, error: 'This link is no longer valid. Door-code links work once and then expire.' }
  return { ok: true, request: toPending(row) }
}

/** Turn a request down. Same one-tap weight as approving it, so "no" is as cheap as "yes". */
export async function rejectByToken(token: string, by: string): Promise<{ ok: boolean; unit?: string; slackUserId?: string | null; slackChannel?: string | null; slackTs?: string | null; error?: string }> {
  const db = supabaseAdmin()
  const t = String(token || '').trim()
  if (!t) return { ok: false, error: 'no token' }
  const { data } = await db.from('eve_actions').select('*').eq('kind', 'door_code').limit(200)
  const row: any = (data || []).find((r: any) => r?.payload?.token === t)
  if (!row) return { ok: false, error: 'This link is no longer valid.' }
  if (row.status !== 'proposed') return { ok: false, error: `This request was already ${row.status}.` }
  await db.from('eve_actions').update({
    status: 'rejected', decided_by: by, decided_at: new Date().toISOString(),
    payload: { ...row.payload, token: null },
  }).eq('id', row.id)
  return {
    ok: true, unit: row.payload.unit, slackUserId: row.payload.requesterSlackId || null,
    slackChannel: row.payload.slackChannel || null, slackTs: row.payload.slackTs || null,
  }
}
