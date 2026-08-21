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
import { todayET, lc, DEAD_LISTING } from './ctx'

/** The Guesty custom field that holds the door code (same id daysheet + listingIntel use). */
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

export type Verdict =
  | 'clear_vacant'          // nobody in house — release on one tap
  | 'permission_found'      // occupied, but the guest said yes — human reads the quote, then taps
  | 'blocked_occupied'      // occupied, no permission found — do not release
  | 'blocked_inconclusive'  // cannot prove it is empty — do not release
  | 'no_code'               // nothing on file to send
  | 'not_found'

export type DoorCheck = {
  verdict: Verdict
  headline: string
  unit?: string
  building?: string
  listingId?: string
  hasCode?: boolean
  codeHint?: string | null          // e.g. "4 digits, last changed 12 Aug" — never the code itself
  occupancy?: string
  inHouse?: { guest: string; check_in: string; check_out: string } | null
  nextArrival?: { guest: string; check_in: string } | null
  cleaningStatus?: string | null
  permissionQuotes?: { from: string; at: string; text: string }[]
  recentThread?: { from: string; at: string; text: string }[]
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

export async function runCheck(input: { unit?: string; listingId?: string; requestedBy?: string; requesterSlackId?: string; reason?: string }): Promise<DoorCheck> {
  const db = supabaseAdmin()
  const today = todayET()

  // ---- Gate 1: resolve the unit and the code ----
  const q = String(input?.unit || '').trim()
  const id = String(input?.listingId || '').trim()
  if (!q && !id) return { verdict: 'not_found', headline: 'No unit given.', canRelease: false, note: 'Tell me which unit.' }

  let sel = db.from('guesty_listings').select('id,nickname,title,status,building,raw')
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

  const base: DoorCheck = {
    verdict: 'no_code', headline: '', unit, building, listingId: String(l.id),
    hasCode: !!code, codeHint: code ? hintFor(code) : null,
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

  const common = { ...base, inHouse: inHouse ? { guest: inHouse.guest_name, check_in: String(inHouse.check_in).slice(0, 10), check_out: String(inHouse.check_out).slice(0, 10) } : null, nextArrival: upcoming ? { guest: upcoming.guest_name, check_in: String(upcoming.check_in).slice(0, 10) } : null, cleaningStatus, taskToday }

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
  const cautions: string[] = []
  if (lc(cleaningStatus) === 'dirty') cautions.push('cleaning status is DIRTY')
  if (recentCheckout) cautions.push(`last checkout was ${String(lastOut.check_out).slice(0, 10)}`)
  if (arrivesToday) cautions.push(`a guest ARRIVES TODAY (${upcoming.guest_name})`)

  return {
    ...common, verdict: 'clear_vacant',
    headline: `${unit} is vacant right now.` + (cautions.length ? ` Heads up: ${cautions.join(', ')}.` : ''),
    occupancy: 'No guest in house.',
    canRelease: true,
    note: cautions.length
      ? `Vacant, but ${cautions.join(' and ')} — worth a thought about timing before someone walks in.`
      : (taskToday ? `Vacant, and there is work booked on it today (${taskToday.name}).` : 'Vacant, and no work is booked on it today — worth asking why the code is needed.'),
  }
}

/**
 * Park an approved-pending request. Stored in eve_actions (migration 045) with a one-time token, so
 * the release link cannot be replayed. The CODE IS NOT STORED HERE — only the listing id.
 */
export async function createRequest(check: DoorCheck, who: { email?: string; slackUserId?: string; reason?: string }): Promise<{ ok: boolean; requestId?: string; token?: string; error?: string }> {
  if (!check.canRelease || !check.listingId) return { ok: false, error: 'This check did not clear — nothing to park.' }
  const db = supabaseAdmin()
  const token = randomBytes(24).toString('hex')
  try {
    const { data, error } = await db.from('eve_actions').insert({
      created_by: who.email || who.slackUserId || 'unknown',
      kind: 'door_code',
      payload: {
        listingId: check.listingId, unit: check.unit, building: check.building,
        requesterSlackId: who.slackUserId || null, requesterEmail: who.email || null,
        reason: who.reason || null, token,
      },
      why: check.headline,
      evidence: {
        verdict: check.verdict, occupancy: check.occupancy,
        permissionQuotes: check.permissionQuotes || null, taskToday: check.taskToday || null,
      },
      status: 'proposed',
      // Physical access should not sit approvable overnight.
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, requestId: (data as any)?.id, token }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/**
 * Release. This is the ONLY place the code is read, and it happens after a human has approved.
 * One-time: the token is cleared so a forwarded link is dead on arrival.
 */
export async function releaseByToken(token: string, approvedBy: string): Promise<{ ok: boolean; code?: string; unit?: string; slackUserId?: string | null; error?: string }> {
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
    payload: { ...row.payload, token: null },
    result: { sentTo: row.payload.requesterSlackId || row.payload.requesterEmail || 'unknown', at: new Date().toISOString() },
  }).eq('id', row.id)

  return { ok: true, code, unit: row.payload.unit, slackUserId: row.payload.requesterSlackId || null }
}
