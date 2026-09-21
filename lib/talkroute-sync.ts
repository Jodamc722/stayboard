// TALKROUTE SYNC + THE CALL MATCHER (2026-09-21).
//
// Jon: "instead of marking a call completed for welcome calls it should be able to know if a call
// was completed to guest before checkin, track, see if someone picked up."
//
// Three feeds are mirrored (calls, texts, voicemails), then every call is matched to a booking by
// the guest's phone number and the calendar:
//
//   WELCOME        an OUTBOUND call to the guest's number from 72h before arrival through the
//                  arrival day (lib/call-desk's own window — WELCOME_AHEAD_DAYS / GRACE_DAYS, so
//                  the desk and the matcher can never disagree about what counts).
//   POST-CHECKOUT  a call to the guest within 48h after checkout.
//   STAY           any other call to or from a guest with a live booking — logged on the booking,
//                  no desk outcome.
//
// What a matched WELCOME call does to the log (Jon, 2026-09-21: "Answered OR voicemail left"):
//   answered, ≥ voicemailMaxSec   → outcome `reached`   — the guest picked up. Completed.
//   answered, < voicemailMaxSec   → outcome `voicemail` — an answered call that short is the
//                                   guest's voicemail greeting; the caller left a message or hung
//                                   up on it. Completed (voicemail counts, per Jon).
//   missed / hangup               → attempts += 1, outcome `no_answer`, the card stays on the desk.
// Completing writes the Guesty "Welcome Call" custom field and appends a dated line to the
// reservation notes — the same two writes the button made — so Guesty stays the source of truth
// for "was it called" and the team's other tools keep working.
//
// A POST-CHECKOUT match only records the attempt (attempts, last result, talk time): the phone can
// tell us they answered, not whether they were happy or had an issue. The card says "Answered ·
// 4 min · via Talkroute — what did they say?" and the person picks the outcome.
//
// Idempotent end to end: every call record is keyed by Talkroute's id, the matcher skips records
// it has already matched, and a completed log row is never downgraded by a later missed call.
import 'server-only'
import {
  trAllCallsSince, trTextConversations, trTextMessages, trVoicemails, phoneDigits, phoneKey,
  getTalkrouteSettings, saveTalkrouteSettings, DEFAULT_VOICEMAIL_MAX_SEC, talkrouteConfigured,
  type TrCallRecord, type TrTextConversation, type TrVoiceMessage,
} from './talkroute'
import { getToken as guestyToken } from './guesty'
import { writeCustomFields } from './guesty-custom-fields'
import { appendReservationNote } from './guesty-res-notes'
import { WELCOME_AHEAD_DAYS, WELCOME_GRACE_DAYS, POST_GRACE_DAYS, addDays, isCompleted } from './call-desk'
import { isLiveStay } from './stay-status'

// Guesty's reservation customFields carry no field name in the mirror; the Welcome Call definition
// id is known from live data (app/api/welcome-call/route.ts uses the same constant).
const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type SyncReport = {
  calls: { fetched: number; upserted: number; matched: number; welcomeCompleted: number; welcomeAttempts: number; postAttempts: number; stay: number; partial?: boolean }
  texts: { conversations: number; messages: number; matched: number; partial?: boolean }
  voicemails: { fetched: number; matched: number }
  errors: string[]
  ms: number
  /** true when a feed ran out of time — the next run (cron or button) continues from where it stopped. */
  partial: boolean
}
// TIME-BOXED (2026-09-21, first live sync). The first pull — 7 days of calls, 30 days of text
// threads, each thread a message fetch — ran past Vercel's function limit and the panel got a
// gateway page. Every feed now takes a deadline and stops cleanly when it is reached; because the
// mirror is keyed by id and unchanged threads are skipped, the next run resumes where this one
// stopped. `last*SyncAt` only advances when a feed finished, so nothing is ever skipped.
const over = (deadline: number) => Date.now() > deadline

// ── RESERVATION LOOKUP BY PHONE ─────────────────────────────────────────────────────────────────
// Bookings whose guest phone ends in the same ten digits. Phones are stored as the guest typed them,
// so the SQL side matches on the digits-only tail and the exact comparison happens here. Restricted
// to bookings within ±45 days of `around` so a repeat guest's old stay never wins.
type ResLite = { id: string; listing_id: string | null; guest_name: string | null; guest_phone: string | null; check_in: string; check_out: string; status: string; custom_fields: any; raw: any }
const RES_COLS = 'id,listing_id,guest_name,guest_phone,check_in,check_out,status,custom_fields,raw'

async function reservationsByPhone(sb: any, phone: string, around: string): Promise<ResLite[]> {
  const key = phoneKey(phone)
  if (key.length < 7) return []
  const lo = addDays(around, -45), hi = addDays(around, 45)
  // The tail of the number with any separator between digits: "555-1234" and "5551234" both hit.
  const tail = key.slice(-7)
  const pattern = '%' + tail.split('').join('%') + '%'
  const { data } = await sb.from('guesty_reservations').select(RES_COLS)
    .ilike('guest_phone', pattern).gte('check_out', lo).lte('check_in', hi).limit(40)
  const rows: ResLite[] = (data || []).filter((r: any) => phoneKey(r.guest_phone) === key && isLiveStay(r.status))
  return rows
}

/**
 * Which booking a call belongs to and why. Preference order: the welcome window, then the
 * post-checkout window, then any stay the call date falls inside (±1 day), else the nearest.
 */
export function classifyCall(callYmd: string, direction: string, candidates: ResLite[]): { res: ResLite; kind: 'welcome' | 'post_checkout' | 'stay' } | null {
  if (!candidates.length) return null
  let best: { res: ResLite; kind: 'welcome' | 'post_checkout' | 'stay'; rank: number } | null = null
  for (const r of candidates) {
    const inWelcome = direction === 'outbound' && callYmd >= addDays(r.check_in, -WELCOME_AHEAD_DAYS) && callYmd <= addDays(r.check_in, WELCOME_GRACE_DAYS)
    const inPost = callYmd >= r.check_out && callYmd <= addDays(r.check_out, POST_GRACE_DAYS)
    const inStay = callYmd >= addDays(r.check_in, -1) && callYmd <= addDays(r.check_out, 1)
    const kind: 'welcome' | 'post_checkout' | 'stay' | null = inWelcome ? 'welcome' : inPost ? 'post_checkout' : inStay ? 'stay' : null
    if (!kind) continue
    const rank = kind === 'welcome' ? 3 : kind === 'post_checkout' ? 2 : 1
    if (!best || rank > best.rank) best = { res: r, kind, rank }
  }
  if (best) return { res: best.res, kind: best.kind }
  // Nothing in a window: the nearest booking by check-in, tagged as a stay call, so the log on the
  // reservation still shows the phone contact.
  const nearest = candidates.slice().sort((a, b) => Math.abs(new Date(a.check_in).getTime() - new Date(callYmd).getTime()) - Math.abs(new Date(b.check_in).getTime() - new Date(callYmd).getTime()))[0]
  return nearest ? { res: nearest, kind: 'stay' } : null
}

// ── PHONE BACKFILL ──────────────────────────────────────────────────────────────────────────────
// Reservations synced before the guest's phone landed on the guest object have guest_phone NULL,
// and the desk backfills them from Guesty on every page load without saving. The matcher needs
// them saved. Arrivals in the welcome runway plus the last week of departures — a small set.
async function backfillPhones(sb: any, today: string, errors: string[]): Promise<number> {
  const lo = addDays(today, -7), hi = addDays(today, WELCOME_AHEAD_DAYS + 1)
  const { data } = await sb.from('guesty_reservations').select('id,status,guestId:raw->guest->>_id')
    .is('guest_phone', null).gte('check_out', lo).lte('check_in', hi).limit(60)
  const rows = (data || []).filter((r: any) => r.guestId && isLiveStay(r.status))
  if (!rows.length) return 0
  let tok = ''
  try { tok = await guestyToken() } catch (e: any) { errors.push('guesty token: ' + String(e?.message || e).slice(0, 120)); return 0 }
  const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
  let n = 0
  for (const r of rows.slice(0, 25)) {
    try {
      const g: any = await fetch(`${BASE}/guests/${r.guestId}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }).then(x => x.ok ? x.json() : null)
      const ph = g?.phone || (Array.isArray(g?.phones) && g.phones.length ? (typeof g.phones[0] === 'string' ? g.phones[0] : (g.phones[0]?.number || g.phones[0]?.phone)) : '')
      if (ph) { await sb.from('guesty_reservations').update({ guest_phone: String(ph) }).eq('id', r.id); n++ }
      await new Promise(res => setTimeout(res, 120))
    } catch { /* one guest at a time; the next cron retries */ }
  }
  return n
}

// ── COMPLETE A WELCOME CALL FROM THE PHONE RECORD ───────────────────────────────────────────────
async function completeWelcome(sb: any, res: ResLite, call: TrCallRecord, outcome: 'reached' | 'voicemail', by: string, errors: string[]): Promise<boolean> {
  const at = new Date(call.callDate || Date.now()).toISOString()
  const mins = Math.max(1, Math.round((Number(call.duration) || 0) / 60))
  const noteLine = outcome === 'reached' ? `Guest answered (${mins} min, Talkroute)` : `Voicemail (${Number(call.duration) || 0}s, Talkroute)`
  // 1. Guesty: the Welcome Call field + a dated notes line. Merge-and-write, never a bare PUT.
  let fields: any[] | null = null
  try {
    const tok = await guestyToken()
    const value = outcome === 'voicemail' ? 'Voicemail left' : 'Completed'
    const wr = await writeCustomFields(res.id, tok, [{ fieldId: WELCOME_FIELD_ID, value }])
    if (!wr.ok) errors.push(`guesty field ${res.id}: ${String(wr.note || 'write failed').slice(0, 120)}`)
    else fields = Array.isArray(wr.fields) ? wr.fields : null
    const current = fields || (Array.isArray(res.custom_fields) ? res.custom_fields : (Array.isArray(res.raw?.customFields) ? res.raw.customFields : []))
    const nr = await appendReservationNote({ reservationId: res.id, token: tok, current, label: 'Welcome call', by, note: noteLine })
    if (nr.ok && nr.fields) fields = nr.fields
  } catch (e: any) { errors.push(`guesty ${res.id}: ${String(e?.message || e).slice(0, 120)}`) }
  // 2. Local mirror of the merged array, so the desk reflects it before the next reservations sync.
  if (fields) {
    try {
      const raw = (res.raw && typeof res.raw === 'object') ? res.raw : {}
      const cf = fields.map((c: any) => ({ ...c }))
      const idx = cf.findIndex((c: any) => String(c?.fieldId?._id || c?.fieldId || c?._id || '') === WELCOME_FIELD_ID)
      const meta = { _by: by, _at: at, _note: noteLine }
      if (idx >= 0) cf[idx] = { ...cf[idx], ...meta }
      await sb.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', res.id)
    } catch { /* mirror best-effort */ }
  }
  // 3. The durable log — the row the desk and the scoreboard read.
  const { data: prev } = await sb.from('guest_calls').select('attempts,tier,outcome').eq('reservation_id', res.id).eq('kind', 'welcome').maybeSingle()
  const attempts = (Number(prev?.attempts) || 0) + 1
  const { error } = await sb.from('guest_calls').upsert({
    reservation_id: res.id, kind: 'welcome', outcome, attempts,
    tier: prev?.tier || 'standard',
    called_by: by, caller_email: null, called_at: at,
    listing_id: res.listing_id || null, guest_name: res.guest_name || null,
    ref_date: res.check_in || null, scheduled_for: res.check_in || null,
    source: 'talkroute', talkroute_call_id: call.id, last_attempt_at: at, last_result: String(call.result || ''), talk_seconds: Number(call.duration) || 0,
  }, { onConflict: 'reservation_id,kind' })
  if (error) { errors.push(`guest_calls ${res.id}: ${error.message}`); return false }
  return true
}

async function recordAttempt(sb: any, res: ResLite, kind: 'welcome' | 'post_checkout', call: TrCallRecord, by: string, errors: string[]) {
  const at = new Date(call.callDate || Date.now()).toISOString()
  const { data: prev } = await sb.from('guest_calls').select('attempts,tier,outcome,called_by').eq('reservation_id', res.id).eq('kind', kind).maybeSingle()
  // Never downgrade: a completed row keeps its outcome; only the attempt counters move.
  const completed = prev && isCompleted(prev.outcome)
  const attempts = (Number(prev?.attempts) || 0) + 1
  const row: any = {
    reservation_id: res.id, kind, attempts,
    tier: prev?.tier || 'standard',
    called_by: prev?.called_by || by, called_at: at,
    listing_id: res.listing_id || null, guest_name: res.guest_name || null,
    ref_date: kind === 'welcome' ? res.check_in : res.check_out, scheduled_for: kind === 'welcome' ? res.check_in : res.check_out,
    source: 'talkroute', talkroute_call_id: call.id, last_attempt_at: at, last_result: String(call.result || ''), talk_seconds: Number(call.duration) || 0,
    outcome: completed ? prev.outcome : (kind === 'welcome' ? 'no_answer' : (prev?.outcome === 'in_progress' ? 'in_progress' : (String(call.result) === 'answered' ? 'in_progress' : 'no_answer'))),
  }
  if (completed) { delete row.called_at; delete row.called_by }
  const { error } = await sb.from('guest_calls').upsert(row, { onConflict: 'reservation_id,kind' })
  if (error) errors.push(`guest_calls ${res.id}: ${error.message}`)
}

// ── CALLS ───────────────────────────────────────────────────────────────────────────────────────
function callerLabel(c: TrCallRecord): string {
  // The extension / forwarding-device event names who was on our end, when Talkroute includes it.
  const ev = (c.events || []).find(e => e.type === 'user_extension' || e.type === 'forwarding_device')
  return ev?.description ? `Talkroute · ${String(ev.description).slice(0, 60)}` : 'Talkroute'
}

export async function syncTalkrouteCalls(sb: any, opts: { since?: string; today?: string; deadline?: number } = {}): Promise<SyncReport['calls'] & { errors: string[] }> {
  const deadline = opts.deadline || (Date.now() + 40_000)
  const errors: string[] = []
  const rep = { fetched: 0, upserted: 0, matched: 0, welcomeCompleted: 0, welcomeAttempts: 0, postAttempts: 0, stay: 0, partial: false, errors }
  const settings = await getTalkrouteSettings()
  const vmMax = Number(settings.voicemailMaxSec) || DEFAULT_VOICEMAIL_MAX_SEC
  const today = opts.today || ymdET(new Date())
  // Overlap the previous sync by an hour: a webhook and the cron can both run, and Talkroute's
  // call-history filter is on the call's START, so a long call that ended after the last sync is
  // still found.
  const since = opts.since || (settings.lastCallSyncAt ? new Date(new Date(settings.lastCallSyncAt).getTime() - 3600_000).toISOString() : new Date(Date.now() - 7 * 86400_000).toISOString())

  let records: TrCallRecord[] = []
  try { records = await trAllCallsSince(since) } catch (e: any) { errors.push('call-history: ' + String(e?.message || e).slice(0, 200)); await saveTalkrouteSettings({ lastError: errors[0] }); return rep }
  rep.fetched = records.length

  try { await backfillPhones(sb, today, errors) } catch (e: any) { errors.push('backfill: ' + String(e?.message || e).slice(0, 120)) }

  // Which records are new or still unmatched.
  const ids = records.map(r => String(r.id)).filter(Boolean)
  const known = new Map<string, { reservation_id: string | null; match_kind: string | null; transcript_status: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('talkroute_calls').select('id,reservation_id,match_kind,transcript_status').in('id', ids.slice(i, i + 200))
    for (const k of (data || [])) known.set(String(k.id), { reservation_id: k.reservation_id, match_kind: k.match_kind, transcript_status: k.transcript_status })
  }

  const upserts: any[] = []
  for (const c of records) {
    if (!c.id) continue
    const voicemail = (c.events || []).some(e => e.type === 'voicemail')
    const known0 = known.get(String(c.id))
    upserts.push({
      id: String(c.id), direction: c.direction === 'outbound' ? 'outbound' : 'inbound',
      call_at: new Date(c.callDate || Date.now()).toISOString(),
      external_number: phoneDigits(c.externalNumber) || null, external_name: c.externalName || null,
      talkroute_number: phoneDigits(c.phoneNumber) || null,
      duration: Number(c.duration) || 0, result: String(c.result || '').toLowerCase() || null,
      recorded: !!c.recorded, voicemail, events: c.events || null, raw: c, synced_at: new Date().toISOString(),
      // THE RECORDING (2026-09-21). `recording` is a temporary signed URL, so it is refreshed on
      // every sync and the transcript — not the link — is what we keep. A call that connected and
      // was recorded joins the transcription queue; lib/call-notes walks it.
      ...(c.recording ? { recording_url: String(c.recording), recording_seen_at: new Date().toISOString() } : {}),
      ...(known0?.transcript_status ? {} : { transcript_status: (c.recorded && String(c.result || '').toLowerCase() === 'answered') ? 'pending' : 'none' }),
      // keep an existing match
      ...(known.get(String(c.id))?.reservation_id ? { reservation_id: known.get(String(c.id))!.reservation_id, match_kind: known.get(String(c.id))!.match_kind } : {}),
    })
  }
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await sb.from('talkroute_calls').upsert(upserts.slice(i, i + 200), { onConflict: 'id' })
    if (error) errors.push('upsert calls: ' + error.message); else rep.upserted += Math.min(200, upserts.length - i)
  }

  // Match, oldest first so attempts count up in the order they happened.
  const toMatch = records.filter(c => c.id && !known.get(String(c.id))?.reservation_id && phoneKey(c.externalNumber).length >= 7)
    .sort((a, b) => new Date(a.callDate).getTime() - new Date(b.callDate).getTime())
  for (const c of toMatch) {
    if (over(deadline)) { rep.partial = true; break }
    try {
      const callYmd = ymdET(new Date(c.callDate))
      const cands = await reservationsByPhone(sb, String(c.externalNumber), callYmd)
      const m = classifyCall(callYmd, c.direction, cands)
      if (!m) continue
      rep.matched++
      await sb.from('talkroute_calls').update({ reservation_id: m.res.id, match_kind: m.kind, matched_at: new Date().toISOString() }).eq('id', String(c.id))
      const result = String(c.result || '').toLowerCase()
      const by = callerLabel(c)
      if (m.kind === 'welcome') {
        const { data: prev } = await sb.from('guest_calls').select('outcome').eq('reservation_id', m.res.id).eq('kind', 'welcome').maybeSingle()
        if (prev && isCompleted(prev.outcome)) { await recordAttempt(sb, m.res, 'welcome', c, by, errors); continue }
        if (result === 'answered') {
          const outcome: 'reached' | 'voicemail' = (Number(c.duration) || 0) >= vmMax ? 'reached' : 'voicemail'
          if (await completeWelcome(sb, m.res, c, outcome, by, errors)) rep.welcomeCompleted++
        } else { await recordAttempt(sb, m.res, 'welcome', c, by, errors); rep.welcomeAttempts++ }
      } else if (m.kind === 'post_checkout') {
        await recordAttempt(sb, m.res, 'post_checkout', c, by, errors); rep.postAttempts++
      } else rep.stay++
    } catch (e: any) { errors.push(`match ${c.id}: ${String(e?.message || e).slice(0, 120)}`) }
  }
  await saveTalkrouteSettings({ ...(rep.partial ? {} : { lastCallSyncAt: new Date().toISOString() }), lastError: errors.length ? errors[0] : null })
  return rep
}

// ── TEXTS ───────────────────────────────────────────────────────────────────────────────────────
async function matchByPhone(sb: any, phone: string, around: string): Promise<ResLite | null> {
  const cands = await reservationsByPhone(sb, phone, around)
  const m = classifyCall(around, 'inbound', cands)
  return m ? m.res : null
}

export async function syncTalkrouteTexts(sb: any, opts: { since?: string; full?: boolean; deadline?: number } = {}): Promise<SyncReport['texts'] & { errors: string[] }> {
  const deadline = opts.deadline || (Date.now() + 40_000)
  const errors: string[] = []
  const rep = { conversations: 0, messages: 0, matched: 0, partial: false, errors }
  const settings = await getTalkrouteSettings()
  const since = opts.full ? undefined : (opts.since || (settings.lastTextSyncAt ? new Date(new Date(settings.lastTextSyncAt).getTime() - 3600_000).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString()))
  let convos: TrTextConversation[] = []
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await trTextConversations({ since, page, pageSize: 100 })
      const rows = Array.isArray(r?.data) ? r.data : []
      convos.push(...rows)
      if (page >= Number(r?.pagination?.totalPages || 1) || !rows.length) break
    }
  } catch (e: any) { errors.push('text-conversations: ' + String(e?.message || e).slice(0, 200)); return rep }
  for (const c of convos) {
    if (!c.conversation_id) continue
    if (over(deadline)) { rep.partial = true; break }
    try {
      const contact = phoneDigits(c.contact_number)
      const lastAt = c.last_message_at ? new Date(c.last_message_at).toISOString() : null
      const { data: prevRow } = await sb.from('talkroute_conversations').select('reservation_id,messages_count,last_message_at').eq('id', c.conversation_id).maybeSingle()
      let res: ResLite | null = null
      if (!prevRow?.reservation_id && contact) res = await matchByPhone(sb, contact, ymdET(new Date(lastAt || Date.now())))
      if (res) rep.matched++
      await sb.from('talkroute_conversations').upsert({
        id: c.conversation_id, talkroute_number: phoneDigits(c.talkroute_number) || null, contact_number: contact || null,
        last_message_at: lastAt, last_message_preview: String(c.last_message?.body || '').slice(0, 240) || null,
        last_direction: c.last_message?.direction || null, messages_count: Number(c.messages_count) || 0,
        unread: c.last_message ? c.last_message.read === false && c.last_message.direction === 'incoming' : false,
        ...(res ? { reservation_id: res.id, guest_name: res.guest_name, listing_id: res.listing_id } : {}),
        raw: c, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      rep.conversations++
      // Messages: pull the thread when it changed (count or last-message time), capped at 2 pages.
      const changed = !prevRow || Number(prevRow.messages_count) !== Number(c.messages_count) || String(prevRow.last_message_at || '') !== String(lastAt || '')
      if (!changed && !opts.full) continue
      for (let page = 1; page <= 2; page++) {
        const r = await trTextMessages(c.conversation_id, { page, pageSize: 100 })
        const msgs = Array.isArray(r?.data) ? r.data : []
        if (msgs.length) {
          const { error } = await sb.from('talkroute_texts').upsert(msgs.map(m => ({
            id: String(m.id), conversation_id: c.conversation_id, direction: m.direction || null, body: m.body || null,
            user_email: m.userEmail || null, read: !!m.read, sent_at: m.createdAt ? new Date(m.createdAt).toISOString() : null,
            attachments: m.attachments || null, raw: m, synced_at: new Date().toISOString(),
          })), { onConflict: 'id' })
          if (error) errors.push('texts: ' + error.message); else rep.messages += msgs.length
        }
        if (page >= Number(r?.pagination?.totalPages || 1) || !msgs.length) break
      }
    } catch (e: any) { errors.push(`convo ${c.conversation_id}: ${String(e?.message || e).slice(0, 120)}`) }
  }
  if (!rep.partial) await saveTalkrouteSettings({ lastTextSyncAt: new Date().toISOString() })
  return rep
}

// ── VOICEMAILS ──────────────────────────────────────────────────────────────────────────────────
export async function syncTalkrouteVoicemails(sb: any, opts: { deadline?: number } = {}): Promise<SyncReport['voicemails'] & { errors: string[] }> {
  const deadline = opts.deadline || (Date.now() + 20_000)
  const errors: string[] = []
  const rep = { fetched: 0, matched: 0, errors }
  let vms: TrVoiceMessage[] = []
  try {
    for (let page = 1; page <= 3; page++) {
      const r = await trVoicemails({ page, pageSize: 100 })
      const rows = Array.isArray(r?.data) ? r.data : []
      vms.push(...rows)
      if (page >= Number(r?.pagination?.totalPages || 1) || !rows.length) break
    }
  } catch (e: any) { errors.push('voice-messages: ' + String(e?.message || e).slice(0, 200)); return rep }
  rep.fetched = vms.length
  const ids = vms.map(v => String(v.id))
  const known = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('talkroute_voicemails').select('id,reservation_id').in('id', ids.slice(i, i + 200))
    for (const k of (data || [])) known.set(String(k.id), k.reservation_id)
  }
  for (const v of vms) {
    if (!v.id) continue
    if (over(deadline)) break
    try {
      const caller = phoneDigits(v.callerNumber)
      const at = v.createdAt ? new Date(v.createdAt).toISOString() : null
      let resId: string | null = known.get(String(v.id)) || null
      if (!resId && caller && !known.has(String(v.id))) { const r = await matchByPhone(sb, caller, ymdET(new Date(at || Date.now()))); if (r) { resId = r.id; rep.matched++ } }
      const { error } = await sb.from('talkroute_voicemails').upsert({
        id: String(v.id), mailbox_id: v.voiceMailboxId != null ? String(v.voiceMailboxId) : (v.mailboxId != null ? String(v.mailboxId) : null),
        talkroute_number: phoneDigits(v.phoneNumber) || null, caller_number: caller || null, caller_name: v.callerName || null,
        duration: Number(v.duration) || 0, transcript: v.transcript || null, transcribing: !!v.transcriptionInProgress,
        audio_link: v.audioLink || null, call_result: v.callResult || null, read: !!v.read, created_at: at,
        ...(resId ? { reservation_id: resId } : {}), raw: v, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      if (error) errors.push('voicemail: ' + error.message)
      // A voicemail the guest left, matched to a booking, gets its one line on the reservation —
      // their own words are the most useful thing the phone produces (lib/call-notes).
      if (resId && !known.has(String(v.id))) {
        try {
          const { pushVoicemailNote } = await import('./call-notes')
          await pushVoicemailNote(sb, { id: String(v.id), reservation_id: resId, transcript: v.transcript, duration: v.duration, note_pushed_at: null })
        } catch { /* the note is best-effort; the voicemail itself is saved */ }
      }
    } catch (e: any) { errors.push(`vm ${v.id}: ${String(e?.message || e).slice(0, 120)}`) }
  }
  await saveTalkrouteSettings({ lastVoicemailSyncAt: new Date().toISOString() })
  return rep
}

/** Everything, in order. Safe to call from the cron, the webhook and the admin "Sync now". */
export async function syncTalkrouteAll(sb: any, opts: { calls?: boolean; texts?: boolean; voicemails?: boolean; fullTexts?: boolean; budgetMs?: number } = {}): Promise<SyncReport> {
  const t0 = Date.now()
  const budget = opts.budgetMs || 45_000
  const end = t0 + budget
  const rep: SyncReport = {
    calls: { fetched: 0, upserted: 0, matched: 0, welcomeCompleted: 0, welcomeAttempts: 0, postAttempts: 0, stay: 0 },
    texts: { conversations: 0, messages: 0, matched: 0 }, voicemails: { fetched: 0, matched: 0 }, errors: [], ms: 0, partial: false,
  }
  if (!(await talkrouteConfigured())) { rep.errors.push('Talkroute is not connected.'); rep.ms = Date.now() - t0; return rep }
  const want = { calls: opts.calls !== false, texts: opts.texts !== false, voicemails: opts.voicemails !== false }
  // Calls first (they drive the desk), voicemails second (small), texts get whatever is left.
  if (want.calls) { const r = await syncTalkrouteCalls(sb, { deadline: t0 + Math.round(budget * 0.45) }); rep.calls = r; rep.errors.push(...r.errors) }
  if (want.voicemails) { const r = await syncTalkrouteVoicemails(sb, { deadline: Math.min(end, Date.now() + 10_000) }); rep.voicemails = r; rep.errors.push(...r.errors) }
  if (want.texts && !over(end - 3_000)) { const r = await syncTalkrouteTexts(sb, { full: !!opts.fullTexts, deadline: end }); rep.texts = r; rep.errors.push(...r.errors) }
  else if (want.texts) rep.texts = { conversations: 0, messages: 0, matched: 0, partial: true }
  rep.partial = !!(rep.calls.partial || rep.texts.partial)
  rep.ms = Date.now() - t0
  try { await sb.from('automation_runs').insert({ name: 'talkroute-sync', ok: rep.errors.length === 0, item_count: rep.calls.fetched + rep.texts.messages + rep.voicemails.fetched, detail: rep, ms: rep.ms }) } catch { /* ledger best-effort */ }
  return rep
}
