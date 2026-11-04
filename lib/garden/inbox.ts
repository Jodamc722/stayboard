// THE GARDEN HOTEL'S UNIFIED INBOX (Jon, 2026-11-04: "Build a unified inbox, build it where we can
// sort by channel or source. Make this a robust app to manage cloudbeds").
//
// Cloudbeds has NO guest-messaging API (no endpoint, no webhook event — confirmed by the audit), so
// this inbox is not a mirror of Cloudbeds' inbox. It merges every conversation source Lighthouse
// CAN reach into one stream of "items", each tied to a Cloudbeds reservation when one can be matched:
//
//   thread     garden_threads + garden_messages — guest email / SMS / WhatsApp / OTA messages pushed in
//              through POST /api/garden/inbox/ingest (forwarders, Zapier, the phone system), plus the
//              Cloudbeds reservation notes lib/garden/hub pulls (thread id 'note:<reservationId>')
//   call       garden_phone_calls — calls and voicemails from lib/garden/phone
//   review     garden_reviews — reviews and their Adam-drafted replies (lib/garden/reviews)
//   desk_call  garden_calls — the front desk's own call log (pre-arrival / welcome attempts)
//
// STATE FOR ITEMS THAT ARE NOT THREADS. A call or a review has no unread / status / assignee column,
// and this file adds no migration. So the first time someone marks one read, sets its status, assigns
// it or logs a note, a SHADOW THREAD is written: garden_threads id 'call:<id>' | 'review:<id>' |
// 'desk:<id>'. Its status / unread / assigned_to override the computed defaults, and its
// garden_messages are the notes on that item. Shadow threads are never listed as threads themselves.
//
// Internal notes are garden_messages with direction 'note' (never shown as sent to the guest).
// Nothing here sends anything to a guest: a reply is LOGGED (direction 'out'); the person sends it
// from their own mail client / phone / the OTA extranet.
import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '../supabase-admin'
import { getSetting, getSettingFresh, setSetting } from '../app-settings'
import { ingestMessage } from './hub'

// ---- Types ----------------------------------------------------------------------------------------
export type InboxKind = 'thread' | 'call' | 'review' | 'desk_call'
export type InboxSource = 'email' | 'sms' | 'whatsapp' | 'ota' | 'note' | 'phone' | 'voicemail' | 'review' | 'web'
export type InboxStatus = 'open' | 'waiting' | 'closed'
export type ResSummary = {
  id: string; status: string | null; guest_name: string | null; guest_email: string | null; guest_phone: string | null
  check_in: string | null; check_out: string | null; nights: number | null; room_names: string[]
  source: string | null; channel: string; total: number | null; balance: number | null
}
export type InboxItem = {
  id: string                       // t:<threadId> | c:<phoneCallId> | r:<reviewId> | d:<gardenCallId>
  kind: InboxKind
  source: InboxSource
  channel: string                  // normalized booking channel or review site; 'Unmatched' when neither
  guest: string
  reservation: ResSummary | null
  last_at: string | null
  snippet: string
  unread: number
  status: InboxStatus
  assigned_to: string | null
  needs_reply: boolean
  email: string | null             // best known guest email (reservation, else the sender)
  phone: string | null             // best known guest phone
  meta: Record<string, any>        // kind-specific one-liners for the row (rating, duration, result…)
}
export type InboxFilter = { source?: string | null; channel?: string | null; status?: string | null; q?: string | null; needsReply?: boolean; sort?: string | null }

// ---- Normalizers ------------------------------------------------------------------------------------
const s = (v: any) => (v == null ? '' : String(v))
const SOURCES: InboxSource[] = ['email', 'sms', 'whatsapp', 'ota', 'note', 'phone', 'voicemail', 'review', 'web']
export function normSource(v: any): InboxSource | null {
  const x = s(v).toLowerCase().trim()
  if (!x) return null
  if ((SOURCES as string[]).includes(x)) return x as InboxSource
  if (/whats/.test(x)) return 'whatsapp'
  if (/sms|text|mms|imessage/.test(x)) return 'sms'
  if (/mail/.test(x)) return 'email'
  if (/voice ?mail|vm\b/.test(x)) return 'voicemail'
  if (/phone|call/.test(x)) return 'phone'
  if (/note/.test(x)) return 'note'
  if (/review/.test(x)) return 'review'
  if (/chat|web|form|site/.test(x)) return 'web'
  if (/airbnb|booking|expedia|vrbo|ota|hotels\.com|agoda|trip/.test(x)) return 'ota'
  return null
}

/** Booking channel (reservation.source) or review site → a small set the filter chips use. */
export function normChannel(v: any): string {
  const x = s(v).toLowerCase().trim()
  if (!x) return ''
  if (/airbnb/.test(x)) return 'Airbnb'
  if (/vrbo|homeaway/.test(x)) return 'Vrbo'
  if (/expedia|hotels\.?com|hotwire|orbitz|travelocity|egencia/.test(x)) return 'Expedia'
  if (/website|direct|booking ?engine|own site|cloudbeds|mybooking|book now|hotel site/.test(x)) return 'Direct'
  if (/booking/.test(x)) return 'Booking.com'
  if (/walk|phone|call|front desk|in ?person/.test(x)) return 'Walk-in/Phone'
  if (/google/.test(x)) return 'Google'
  if (/tripadvisor/.test(x)) return 'Tripadvisor'
  if (/agoda/.test(x)) return 'Agoda'
  return 'Other'
}

const digits10 = (v: any): string | null => { const d = s(v).replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : null }
const emailOf = (v: any): string | null => { const m = s(v).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0].toLowerCase() : null }
const clip = (v: any, n = 160) => { const t = s(v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const isMissing = (e: any) => /does not exist|schema cache|relation/i.test(s(e?.message))
const SHADOW = ['call:', 'review:', 'desk:']
const isShadow = (id: string) => SHADOW.some(p => id.startsWith(p))

function resSummary(r: any): ResSummary {
  return {
    id: s(r.id), status: r.status || null, guest_name: r.guest_name || null, guest_email: r.guest_email || null, guest_phone: r.guest_phone || null,
    check_in: r.check_in || null, check_out: r.check_out || null, nights: r.nights ?? null, room_names: Array.isArray(r.room_names) ? r.room_names : [],
    source: r.source || null, channel: normChannel(r.source) || 'Other', total: r.total != null ? Number(r.total) : null, balance: r.balance != null ? Number(r.balance) : null,
  }
}
const RES_COLS = 'id,status,guest_name,guest_email,guest_phone,check_in,check_out,nights,room_names,source,total,balance'

async function loadReservations(ids: string[]): Promise<Record<string, ResSummary>> {
  const out: Record<string, ResSummary> = {}
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  const db = supabaseAdmin()
  for (let i = 0; i < uniq.length; i += 150) {
    const { data } = await db.from('garden_reservations').select(RES_COLS).in('id', uniq.slice(i, i + 150))
    for (const r of (data || []) as any[]) out[s(r.id)] = resSummary(r)
  }
  return out
}

// ---- Building items ---------------------------------------------------------------------------------
type Shadow = { id: string; status: string | null; unread: number; assigned_to: string | null; last_message_at: string | null; last_snippet: string | null }

function threadItem(t: any, res: ResSummary | null): InboxItem {
  const id = s(t.id)
  const chan = s(t.channel)
  // Where it came from: the source column (migration 170), else what the id says (note:<res>,
  // ib:<source>:…), else a channel that is really a medium, else an OTA name, else email.
  const fromId = id.startsWith('note:') ? 'note' : id.startsWith('ib:') ? normSource(id.split(':')[1]) : null
  const chanSrc = /^(email|sms|whatsapp|ota|web|text)$/i.test(chan) ? normSource(chan) : null
  const source: InboxSource = normSource(t.source) || fromId || chanSrc
    || (['Airbnb', 'Booking.com', 'Expedia', 'Vrbo', 'Agoda'].includes(normChannel(chan)) ? 'ota' : 'email')
  const channel = res?.channel || (chan && !/^(email|sms|whatsapp|ota|web|text|note)$/i.test(chan) ? normChannel(chan) : '') || 'Unmatched'
  const status = (['open', 'waiting', 'closed'].includes(t.status) ? t.status : 'open') as InboxStatus
  return {
    id: 't:' + id, kind: 'thread', source, channel,
    guest: t.guest_name || res?.guest_name || 'Guest', reservation: res,
    last_at: t.last_message_at || t.synced_at || null, snippet: clip(t.last_snippet),
    unread: Number(t.unread) || 0, status, assigned_to: t.assigned_to || null,
    needs_reply: source !== 'note' && status === 'open',
    email: res?.guest_email || null, phone: res?.guest_phone || null, meta: {},
  }
}

function callItem(c: any, res: ResSummary | null, calledBackAfter: boolean): InboxItem {
  const inbound = c.direction === 'inbound'
  const result = s(c.result) || null
  const source: InboxSource = result === 'voicemail' ? 'voicemail' : 'phone'
  const owed = inbound && (result === 'missed' || result === 'voicemail')
  const recent = c.started_at && Date.parse(c.started_at) > Date.now() - 14 * 86400000
  const status: InboxStatus = owed && !calledBackAfter ? 'open' : 'closed'
  const guestNum = inbound ? c.from_number : c.to_number
  const mins = c.duration_sec ? Math.max(1, Math.round(Number(c.duration_sec) / 60)) : 0
  const label = inbound ? (result === 'missed' ? 'Missed call' : result === 'voicemail' ? 'Voicemail' : 'Inbound call') : (result === 'voicemail' ? 'Outbound — voicemail left' : result === 'missed' ? 'Outbound — no answer' : 'Outbound call')
  return {
    id: 'c:' + s(c.id), kind: 'call', source, channel: res?.channel || 'Unmatched',
    guest: res?.guest_name || fmtPhone(guestNum) || 'Unknown caller', reservation: res,
    last_at: c.started_at || c.synced_at || null,
    snippet: clip(c.transcript ? `${label}: ${c.transcript}` : `${label}${mins ? ` · ${mins} min` : ''}${calledBackAfter && owed ? ' · called back' : ''}`),
    unread: owed && !calledBackAfter && recent ? 1 : 0, status, assigned_to: null,
    needs_reply: owed && !calledBackAfter,
    email: res?.guest_email || null, phone: guestNum || res?.guest_phone || null,
    meta: { direction: c.direction, result, duration_sec: c.duration_sec ?? null, provider: c.provider, recording: !!c.recording_url, called_back: calledBackAfter },
  }
}

function reviewItem(r: any, res: ResSummary | null): InboxItem {
  const rs = s(r.reply_status) || 'none'
  const status: InboxStatus = rs === 'sent' || rs === 'skipped' ? 'closed' : rs === 'approved' ? 'waiting' : 'open'
  const recent = r.received_at && Date.parse(r.received_at) > Date.now() - 14 * 86400000
  const max = Number(r.max_rating) || 5
  return {
    id: 'r:' + s(r.id), kind: 'review', source: 'review',
    channel: normChannel(r.source) || res?.channel || 'Other',
    guest: r.guest_name || res?.guest_name || 'Reviewer', reservation: res,
    last_at: r.received_at || r.synced_at || null, snippet: clip(`${r.rating}/${max} · ${r.title ? r.title + ' — ' : ''}${s(r.body) || '(no text)'}`),
    unread: rs === 'none' && recent ? 1 : 0, status, assigned_to: null,
    needs_reply: rs === 'none' || rs === 'drafted',
    email: res?.guest_email || null, phone: res?.guest_phone || null,
    meta: { rating: r.rating != null ? Number(r.rating) : null, max_rating: max, sentiment: r.sentiment || null, reply_status: rs, site: r.source },
  }
}

function deskItem(c: any, res: ResSummary | null): InboxItem {
  const kind = s(c.kind).replace(/_/g, ' ') || 'call'
  return {
    id: 'd:' + s(c.id), kind: 'desk_call', source: 'phone', channel: res?.channel || 'Unmatched',
    guest: c.guest_name || res?.guest_name || 'Guest', reservation: res,
    last_at: c.called_at || c.created_at || null,
    snippet: clip(`Desk ${kind} call${c.outcome ? ' · ' + s(c.outcome).replace(/_/g, ' ') : ''}${c.called_by ? ' · ' + c.called_by : ''}${c.note ? ' — ' + c.note : ''}`),
    unread: 0, status: 'closed', assigned_to: null, needs_reply: false,
    email: res?.guest_email || null, phone: res?.guest_phone || null,
    meta: { desk_kind: c.kind, outcome: c.outcome || null, called_by: c.called_by || null, duration_min: c.duration_min ?? null },
  }
}

function applyShadow(it: InboxItem, sh: Shadow | undefined): InboxItem {
  if (!sh) return it
  const status = (['open', 'waiting', 'closed'].includes(s(sh.status)) ? sh.status : it.status) as InboxStatus
  // A review that has been posted or skipped is closed whatever the shadow says.
  const finalStatus = it.kind === 'review' && ['sent', 'skipped'].includes(it.meta.reply_status) ? 'closed' : status
  return { ...it, status: finalStatus, unread: Number(sh.unread) || 0, assigned_to: sh.assigned_to || null, needs_reply: it.needs_reply && finalStatus !== 'closed' }
}

export function fmtPhone(p: any): string {
  const d = s(p).replace(/\D/g, '')
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : s(p)
}

export type InboxLoad = { items: InboxItem[]; missing: string[]; live: { threads: number; calls: number; reviews: number; desk: number } }

/** Every conversation Lighthouse can reach, newest first. Each source is independent: a missing
 *  table (migration not run) drops that source and is reported in `missing`, never fails the page. */
export async function loadInboxItems(): Promise<InboxLoad> {
  const db = supabaseAdmin()
  const missing: string[] = []
  const take = async (table: string, q: PromiseLike<{ data: any; error: any }>): Promise<any[]> => {
    try { const { data, error } = await q; if (error) { if (isMissing(error)) missing.push(table); return [] } return (data || []) as any[] }
    catch { missing.push(table); return [] }
  }
  // select('*') on threads: migration 170's `source` column may not exist yet.
  const [threads, calls, reviews, desk, sh1, sh2, sh3] = await Promise.all([
    take('garden_threads', db.from('garden_threads').select('*').not('id', 'like', 'call:%').not('id', 'like', 'review:%').not('id', 'like', 'desk:%').order('last_message_at', { ascending: false, nullsFirst: false }).limit(400)),
    take('garden_phone_calls', db.from('garden_phone_calls').select('id,provider,direction,from_number,to_number,started_at,duration_sec,result,recording_url,transcript,reservation_id,synced_at').gte('started_at', daysAgo(60)).order('started_at', { ascending: false }).limit(300)),
    take('garden_reviews', db.from('garden_reviews').select('id,source,reservation_id,guest_name,rating,max_rating,title,body,received_at,sentiment,reply_status,synced_at').gte('received_at', daysAgo(180)).order('received_at', { ascending: false }).limit(250)),
    take('garden_calls', db.from('garden_calls').select('id,reservation_id,guest_name,kind,outcome,called_at,called_by,duration_min,note,created_at').gte('called_at', daysAgo(30)).order('called_at', { ascending: false }).limit(200)),
    take('', db.from('garden_threads').select('id,status,unread,assigned_to,last_message_at,last_snippet').like('id', 'call:%').limit(2000)),
    take('', db.from('garden_threads').select('id,status,unread,assigned_to,last_message_at,last_snippet').like('id', 'review:%').limit(2000)),
    take('', db.from('garden_threads').select('id,status,unread,assigned_to,last_message_at,last_snippet').like('id', 'desk:%').limit(2000)),
  ])
  const shadows: Record<string, Shadow> = {}
  for (const x of [...sh1, ...sh2, ...sh3]) shadows[s(x.id)] = x
  // The phone sync also writes an attempt into garden_calls for matched outbound calls — the call
  // itself is already an item, so those rows are not shown twice.
  const deskRows = desk.filter(c => !s(c.called_by).startsWith('phone:'))
  const res = await loadReservations([...threads, ...calls, ...reviews, ...deskRows].map(x => s(x.reservation_id)))
  const R = (id: any) => (id ? res[s(id)] || null : null)

  // Was a missed / voicemail inbound call followed by an outbound call to the same number?
  const outByNum: Record<string, string[]> = {}
  for (const c of calls) if (c.direction === 'outbound') { const k = digits10(c.to_number); if (k && c.started_at) (outByNum[k] = outByNum[k] || []).push(c.started_at) }
  const calledBack = (c: any) => { const k = digits10(c.from_number); return !!(k && c.started_at && (outByNum[k] || []).some(t => t > c.started_at)) }

  const items: InboxItem[] = [
    ...threads.filter(t => !isShadow(s(t.id))).map(t => threadItem(t, R(t.reservation_id))),
    ...calls.map(c => applyShadow(callItem(c, R(c.reservation_id), c.direction === 'inbound' && calledBack(c)), shadows['call:' + s(c.id)])),
    ...reviews.map(r => applyShadow(reviewItem(r, R(r.reservation_id)), shadows['review:' + s(r.id)])),
    ...deskRows.map(c => applyShadow(deskItem(c, R(c.reservation_id)), shadows['desk:' + s(c.id)])),
  ]
  items.sort((a, b) => s(b.last_at).localeCompare(s(a.last_at)))
  return { items, missing: Array.from(new Set(missing.filter(Boolean))), live: { threads: threads.length, calls: calls.length, reviews: reviews.length, desk: deskRows.length } }
}

// ---- Filtering (the API's ?source=&channel=&status=&q=; the page filters client-side the same way) --
export const SOURCE_GROUPS: Record<string, InboxSource[]> = {
  email: ['email'], messaging: ['sms', 'whatsapp'], phone: ['phone', 'voicemail'], review: ['review'], note: ['note'], ota: ['ota'], web: ['web'],
}
export function filterItems(items: InboxItem[], f: InboxFilter): InboxItem[] {
  const src = s(f.source).toLowerCase()
  const group: string[] | null = src && src !== 'all' ? (SOURCE_GROUPS[src] || [src]) : null
  const chan = s(f.channel)
  const st = s(f.status).toLowerCase()
  const q = s(f.q).toLowerCase().trim()
  let out = items.filter(it =>
    (!group || group.includes(it.source)) &&
    (!chan || chan === 'all' || it.channel.toLowerCase() === chan.toLowerCase()) &&
    (!st || st === 'all' || it.status === st) &&
    (!f.needsReply || it.needs_reply) &&
    (!q || [it.guest, it.snippet, it.channel, it.source, it.assigned_to, it.email, it.phone, it.reservation?.id, ...(it.reservation?.room_names || [])].some(v => s(v).toLowerCase().includes(q))))
  out = sortItems(out, s(f.sort) || 'newest')
  return out
}
export function sortItems(items: InboxItem[], sort: string): InboxItem[] {
  const arr = [...items]
  if (sort === 'oldest_unanswered') arr.sort((a, b) => (Number(b.needs_reply) - Number(a.needs_reply)) || s(a.last_at).localeCompare(s(b.last_at)))
  else if (sort === 'arrival') {
    const today = ymd(new Date())
    const key = (it: InboxItem) => { const r = it.reservation; if (!r?.check_in) return '3'; return (s(r.check_out) >= today ? '1' : '2') + (s(r.check_out) >= today ? r.check_in : String(99999999 - Number(r.check_in.replace(/-/g, '')))) }
    arr.sort((a, b) => key(a).localeCompare(key(b)) || s(b.last_at).localeCompare(s(a.last_at)))
  } else arr.sort((a, b) => s(b.last_at).localeCompare(s(a.last_at)))
  return arr
}

// ---- One item, in full ------------------------------------------------------------------------------
export type InboxDetail = {
  item: InboxItem
  messages: { id: string; direction: string; author: string | null; body: string; sent_at: string | null }[]   // thread messages, or notes on a call/review
  call?: any; review?: any; desk?: any
  related: { id: string; kind: InboxKind; label: string; at: string | null }[]
}

function parseItemId(id: string): { kind: InboxKind; raw: string; shadow: string | null } | null {
  const p = id.slice(0, 2), raw = id.slice(2)
  if (!raw) return null
  if (p === 't:') return { kind: 'thread', raw, shadow: null }
  if (p === 'c:') return { kind: 'call', raw, shadow: 'call:' + raw }
  if (p === 'r:') return { kind: 'review', raw, shadow: 'review:' + raw }
  if (p === 'd:') return { kind: 'desk_call', raw, shadow: 'desk:' + raw }
  return null
}

async function shadowOf(id: string | null): Promise<Shadow | undefined> {
  if (!id) return undefined
  const { data } = await supabaseAdmin().from('garden_threads').select('id,status,unread,assigned_to,last_message_at,last_snippet').eq('id', id).maybeSingle()
  return (data as any) || undefined
}

/** The item as the list would show it, plus its raw record. */
async function loadOne(itemId: string): Promise<{ item: InboxItem; row: any; shadowId: string | null } | null> {
  const p = parseItemId(itemId)
  if (!p) return null
  const db = supabaseAdmin()
  if (p.kind === 'thread') {
    const { data: t } = await db.from('garden_threads').select('*').eq('id', p.raw).maybeSingle()
    if (!t || isShadow(p.raw)) return null
    const res = (await loadReservations([s((t as any).reservation_id)]))[s((t as any).reservation_id)] || null
    return { item: threadItem(t, res), row: t, shadowId: null }
  }
  if (p.kind === 'call') {
    const { data: c } = await db.from('garden_phone_calls').select('*').eq('id', p.raw).maybeSingle()
    if (!c) return null
    const res = (await loadReservations([s((c as any).reservation_id)]))[s((c as any).reservation_id)] || null
    let back = false
    const num = (c as any).from_number
    if ((c as any).direction === 'inbound' && num && (c as any).started_at) {
      const { data: later } = await db.from('garden_phone_calls').select('id,to_number').eq('direction', 'outbound').gt('started_at', (c as any).started_at).limit(200)
      back = ((later || []) as any[]).some(x => digits10(x.to_number) === digits10(num))
    }
    return { item: applyShadow(callItem(c, res, back), await shadowOf(p.shadow)), row: c, shadowId: p.shadow }
  }
  if (p.kind === 'review') {
    const { data: r } = await db.from('garden_reviews').select('*').eq('id', p.raw).maybeSingle()
    if (!r) return null
    const res = (await loadReservations([s((r as any).reservation_id)]))[s((r as any).reservation_id)] || null
    return { item: applyShadow(reviewItem(r, res), await shadowOf(p.shadow)), row: r, shadowId: p.shadow }
  }
  const { data: d } = await db.from('garden_calls').select('*').eq('id', p.raw).maybeSingle()
  if (!d) return null
  const res = (await loadReservations([s((d as any).reservation_id)]))[s((d as any).reservation_id)] || null
  return { item: applyShadow(deskItem(d, res), await shadowOf(p.shadow)), row: d, shadowId: p.shadow }
}

export async function loadInboxDetail(itemId: string): Promise<InboxDetail | null> {
  const one = await loadOne(itemId)
  if (!one) return null
  const db = supabaseAdmin()
  const { item, row } = one
  const threadId = item.kind === 'thread' ? s(row.id) : one.shadowId
  const { data: msgs } = threadId ? await db.from('garden_messages').select('id,direction,author,body,sent_at').eq('thread_id', threadId).order('sent_at', { ascending: true }).limit(500) : { data: [] as any[] }
  const messages = ((msgs || []) as any[]).map(m => ({ id: s(m.id), direction: s(m.direction), author: m.author || null, body: s(m.body), sent_at: m.sent_at || null }))
  // A thread's sender is the best email / phone we have when the reservation does not carry one.
  if (item.kind === 'thread') {
    const lastIn = [...messages].reverse().find(m => m.direction === 'in')
    if (!item.email) item.email = emailOf(lastIn?.author) || messages.map(m => emailOf(m.author)).find(Boolean) || null
    if (!item.phone && lastIn && !emailOf(lastIn.author) && digits10(lastIn.author)) item.phone = s(lastIn.author)
    if (lastIn) item.needs_reply = item.source !== 'note' && item.status !== 'closed' && messages[messages.length - 1]?.id === lastIn.id
  }
  // Everything else on the same reservation — so the desk sees the whole conversation history.
  const related: InboxDetail['related'] = []
  const rid = item.reservation?.id
  if (rid) {
    const [t, c, r, d] = await Promise.all([
      db.from('garden_threads').select('id,last_message_at,last_snippet,channel').eq('reservation_id', rid).limit(20),
      db.from('garden_phone_calls').select('id,direction,result,started_at,duration_sec').eq('reservation_id', rid).order('started_at', { ascending: false }).limit(20),
      db.from('garden_reviews').select('id,source,rating,max_rating,received_at').eq('reservation_id', rid).limit(10),
      db.from('garden_calls').select('id,kind,outcome,called_at,called_by').eq('reservation_id', rid).order('called_at', { ascending: false }).limit(20),
    ])
    for (const x of ((t.data || []) as any[])) if (!isShadow(s(x.id))) related.push({ id: 't:' + x.id, kind: 'thread', label: `${s(x.id).startsWith('note:') ? 'Cloudbeds notes' : 'Messages'} — ${clip(x.last_snippet, 60)}`, at: x.last_message_at })
    for (const x of ((c.data || []) as any[])) related.push({ id: 'c:' + x.id, kind: 'call', label: `${x.direction === 'inbound' ? 'Inbound' : 'Outbound'} call · ${x.result || '—'}${x.duration_sec ? ' · ' + Math.max(1, Math.round(x.duration_sec / 60)) + ' min' : ''}`, at: x.started_at })
    for (const x of ((r.data || []) as any[])) related.push({ id: 'r:' + x.id, kind: 'review', label: `${normChannel(x.source) || x.source} review · ${x.rating}/${x.max_rating || 5}`, at: x.received_at })
    for (const x of ((d.data || []) as any[])) if (!s(x.called_by).startsWith('phone:')) related.push({ id: 'd:' + x.id, kind: 'desk_call', label: `Desk ${s(x.kind).replace(/_/g, ' ')} · ${s(x.outcome).replace(/_/g, ' ') || '—'}`, at: x.called_at })
  }
  const rel = related.filter(x => x.id !== item.id).sort((a, b) => s(b.at).localeCompare(s(a.at)))
  const out: InboxDetail = { item, messages, related: rel }
  if (item.kind === 'call') out.call = { ...row, raw: undefined }
  if (item.kind === 'review') out.review = { ...row, raw: undefined }
  if (item.kind === 'desk_call') out.desk = row
  return out
}

// ---- Actions ------------------------------------------------------------------------------------------
async function upsertThreadRow(row: any) {
  const db = supabaseAdmin()
  const { error } = await db.from('garden_threads').upsert(row, { onConflict: 'id' })
  if (error && /source|schema cache/i.test(error.message)) { const { source: _drop, ...rest } = row; void _drop; const r2 = await db.from('garden_threads').upsert(rest, { onConflict: 'id' }); if (r2.error) throw new Error(r2.error.message) }
  else if (error) throw new Error(error.message)
}

/** Make sure a call / review / desk item has its shadow thread, seeded with the item's current state. */
async function ensureShadow(one: { item: InboxItem; shadowId: string | null }): Promise<string> {
  const id = one.shadowId!
  const { data } = await supabaseAdmin().from('garden_threads').select('id').eq('id', id).maybeSingle()
  if (!data) {
    const it = one.item
    await upsertThreadRow({ id, reservation_id: it.reservation?.id || null, guest_name: it.guest, channel: it.channel, source: it.source, status: it.status, unread: it.unread, assigned_to: it.assigned_to, last_message_at: it.last_at, last_snippet: it.snippet.slice(0, 200), synced_at: new Date().toISOString() })
  }
  return id
}

export type InboxOp =
  | { op: 'read'; item: string; unread?: boolean }
  | { op: 'status'; item: string; status: InboxStatus }
  | { op: 'assign'; item: string; assigned_to: string | null }
  | { op: 'reply'; item: string; body: string }
  | { op: 'note'; item: string; body: string }

export async function applyInboxOp(b: InboxOp, by: string | null): Promise<{ ok: true; item?: InboxItem } | { ok: false; error: string; status?: number }> {
  const one = await loadOne(s((b as any).item))
  if (!one) return { ok: false, error: 'That conversation was not found.', status: 404 }
  const db = supabaseAdmin()
  const threadId = one.item.kind === 'thread' ? s(one.row.id) : null
  const patch: any = {}
  if (b.op === 'read') patch.unread = b.unread ? 1 : 0
  else if (b.op === 'status') { if (!['open', 'waiting', 'closed'].includes(b.status)) return { ok: false, error: 'status must be open, waiting or closed', status: 400 }; patch.status = b.status; if (b.status === 'closed') patch.unread = 0 }
  else if (b.op === 'assign') patch.assigned_to = b.assigned_to ? String(b.assigned_to).trim().slice(0, 120) || null : null
  else if (b.op === 'reply' || b.op === 'note') {
    const body = s(b.body).trim()
    if (!body) return { ok: false, error: 'Write something first.', status: 400 }
    if (body.length > 20000) return { ok: false, error: 'That is too long.', status: 400 }
    const at = new Date().toISOString()
    const mid = `${b.op}:${Date.now().toString(36)}:${randomBytes(4).toString('hex')}`
    if (b.op === 'reply') {
      if (!threadId) return { ok: false, error: 'Replies are logged on message threads. For a call, call back and log a note; for a review, use the reply box.', status: 400 }
      if (threadId.startsWith('note:')) return { ok: false, error: 'Cloudbeds notes are not a guest conversation — log a note instead.', status: 400 }
      // Through ingestMessage so the thread's snippet / status / unread move the same way an inbound
      // message moves them. Pass the thread's own fields back: ingestMessage rewrites them.
      const t = one.row
      await ingestMessage({ threadId, reservationId: t.reservation_id || null, guest: t.guest_name || null, channel: t.channel || null, source: t.source || one.item.source, id: mid, direction: 'out', author: by || 'Front desk', body, sentAt: at })
      return { ok: true, item: (await loadOne(one.item.id))?.item }
    }
    const tid = threadId || await ensureShadow(one)
    const { error } = await db.from('garden_messages').insert({ id: mid, thread_id: tid, direction: 'note', author: by || 'Front desk', body, sent_at: at })
    if (error) return { ok: false, error: error.message, status: 500 }
    return { ok: true, item: (await loadOne(one.item.id))?.item }
  } else return { ok: false, error: 'unknown op', status: 400 }

  const tid = threadId || await ensureShadow(one)
  const { error } = await db.from('garden_threads').update(patch).eq('id', tid)
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, item: (await loadOne(one.item.id))?.item }
}

// ---- Matching ---------------------------------------------------------------------------------------
/** In house beats arriving soonest beats most recent past; cancelled only if nothing else. */
function pickBest(rows: any[]): any | null {
  if (!rows.length) return null
  const today = ymd(new Date())
  const live = rows.filter(r => !/cancel|no_show/i.test(s(r.status)))
  const pool = live.length ? live : rows
  const inHouse = pool.filter(r => s(r.check_in) <= today && s(r.check_out) >= today)
  if (inHouse.length) return inHouse[0]
  const upcoming = pool.filter(r => s(r.check_in) > today).sort((a, b) => s(a.check_in).localeCompare(s(b.check_in)))
  if (upcoming.length) return upcoming[0]
  return [...pool].sort((a, b) => s(b.check_out).localeCompare(s(a.check_out)))[0]
}

export class ReservationMatcher {
  private phoneIndex: Record<string, any[]> | null = null
  async match(m: { reservationId?: any; email?: any; phone?: any; guest?: any }): Promise<{ res: any | null; by: 'reservationId' | 'email' | 'phone' | 'name' | null }> {
    const db = supabaseAdmin()
    const rid = s(m.reservationId).trim()
    if (rid) {
      const { data } = await db.from('garden_reservations').select(RES_COLS).eq('id', rid).maybeSingle()
      if (data) return { res: data, by: 'reservationId' }
    }
    const email = emailOf(m.email)
    if (email) {
      const { data } = await db.from('garden_reservations').select(RES_COLS).ilike('guest_email', email).order('check_in', { ascending: false }).limit(20)
      const best = pickBest((data || []) as any[])
      if (best) return { res: best, by: 'email' }
    }
    const ph = digits10(m.phone)
    if (ph) {
      if (!this.phoneIndex) {
        this.phoneIndex = {}
        // guest_phone is stored however Cloudbeds had it, so match on the last ten digits in code.
        const { data } = await db.from('garden_reservations').select(RES_COLS).gte('check_out', ymd(new Date(Date.now() - 120 * 86400000))).lte('check_in', ymd(new Date(Date.now() + 400 * 86400000))).not('guest_phone', 'is', null).limit(5000)
        for (const r of ((data || []) as any[])) { const k = digits10(r.guest_phone); if (k) (this.phoneIndex[k] = this.phoneIndex[k] || []).push(r) }
      }
      const best = pickBest(this.phoneIndex[ph] || [])
      if (best) return { res: best, by: 'phone' }
    }
    const name = s(m.guest).replace(/<[^>]*>/g, '').replace(/["']/g, '').trim()
    if (name && name.split(/\s+/).length >= 2 && !emailOf(name)) {
      const { data } = await db.from('garden_reservations').select(RES_COLS).ilike('guest_name', name.replace(/[%_]/g, '')).gte('check_out', ymd(new Date(Date.now() - 86400000))).order('check_in', { ascending: true }).limit(5)
      const best = pickBest((data || []) as any[])
      if (best) return { res: best, by: 'name' }
    }
    return { res: null, by: null }
  }
}

// ---- Ingest ------------------------------------------------------------------------------------------
export type IngestIn = { id?: any; threadId?: any; from?: any; to?: any; guest?: any; email?: any; phone?: any; channel?: any; source?: any; subject?: any; body?: any; sentAt?: any; direction?: any; reservationId?: any }
export type IngestResult = { received: number; stored: number; duplicates: number; matched: number; errors: string[]; threads: string[] }

const slug = (v: any) => s(v).toLowerCase().replace(/[^a-z0-9@.+]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

export async function ingestInbound(list: IngestIn[]): Promise<IngestResult> {
  const out: IngestResult = { received: list.length, stored: 0, duplicates: 0, matched: 0, errors: [], threads: [] }
  const matcher = new ReservationMatcher()
  const db = supabaseAdmin()
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {}
    try {
      const subject = s(m.subject).trim()
      const text = s(m.body).trim()
      const body = subject && !text.startsWith(subject) ? `${subject}\n\n${text}` : text
      if (!body) { out.errors.push(`#${i}: body required`); continue }
      const direction: 'in' | 'out' = /^out/i.test(s(m.direction)) ? 'out' : 'in'
      const guestSide = direction === 'in' ? m.from : m.to
      const email = emailOf(m.email) || emailOf(guestSide)
      const phone = digits10(m.phone) || (!emailOf(guestSide) ? digits10(guestSide) : null)
      const source: InboxSource = normSource(m.source) || (email ? 'email' : phone ? 'sms' : normChannel(m.channel) && normChannel(m.channel) !== 'Other' ? 'ota' : 'web')
      const { res, by } = await matcher.match({ reservationId: m.reservationId, email, phone, guest: m.guest || (direction === 'in' ? m.from : null) })
      if (res) out.matched++
      void by
      // One thread per guest contact per source unless the forwarder names its own thread.
      const threadId = m.threadId ? 'ib:' + slug(m.threadId)
        : email ? `ib:email:${email}`
          : phone ? `ib:${source}:${phone}`
            : res ? `ib:${source}:res:${res.id}`
              : `ib:${source}:${slug(guestSide || m.guest || 'unknown')}`
      const sentAt = m.sentAt && !isNaN(Date.parse(s(m.sentAt))) ? new Date(s(m.sentAt)).toISOString() : new Date().toISOString()
      const msgId = 'ib:' + (m.id ? slug(m.id) || createHash('sha1').update(s(m.id)).digest('hex').slice(0, 24) : createHash('sha1').update(`${threadId}|${sentAt}|${body}`).digest('hex').slice(0, 24))
      const { data: seen } = await db.from('garden_messages').select('id').eq('id', msgId).maybeSingle()
      if (seen) { out.duplicates++; continue }
      // Keep a link the thread already had if this message did not match one.
      const { data: prev } = await db.from('garden_threads').select('reservation_id,guest_name,channel').eq('id', threadId).maybeSingle()
      const guestName = s(m.guest).trim() || res?.guest_name || (prev as any)?.guest_name || s(guestSide).replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || 'Guest'
      await ingestMessage({
        threadId, id: msgId, direction, body, sentAt,
        reservationId: res?.id || (prev as any)?.reservation_id || null,
        guest: guestName,
        channel: s(m.channel).trim() || res?.source || (prev as any)?.channel || null,
        source,
        author: direction === 'in' ? (s(m.from).trim() || guestName) : (s(m.from).trim() || 'Hotel'),
      })
      out.stored++
      if (!out.threads.includes(threadId)) out.threads.push(threadId)
    } catch (e: any) { out.errors.push(`#${i}: ${s(e?.message || e).slice(0, 200)}`) }
  }
  return out
}

// ---- The ingest token --------------------------------------------------------------------------------
export const INBOX_TOKEN_KEY = 'garden_inbox_token'
type TokenRow = { token: string; created_at: string; created_by: string | null }

/** The current token; creates one when `createAs` is given and none exists. */
export async function inboxToken(createAs?: string | null): Promise<string | null> {
  const have = await getSettingFresh<TokenRow | null>(INBOX_TOKEN_KEY, null)
  if (have?.token) return have.token
  if (createAs === undefined) return null
  return rotateInboxToken(createAs)
}
export async function rotateInboxToken(by: string | null): Promise<string | null> {
  const token = 'gin_' + randomBytes(24).toString('hex')
  const r = await setSetting(INBOX_TOKEN_KEY, { token, created_at: new Date().toISOString(), created_by: by } as TokenRow, by)
  return r.ok ? token : null
}
export async function checkInboxToken(given: string): Promise<boolean> {
  if (!given) return false
  let row = await getSetting<TokenRow | null>(INBOX_TOKEN_KEY, null)
  if (!row?.token || row.token.length !== given.length) row = await getSettingFresh<TokenRow | null>(INBOX_TOKEN_KEY, null)
  const want = s(row?.token)
  if (!want || want.length !== given.length) return false
  return timingSafeEqual(Buffer.from(want), Buffer.from(given))
}

/** The hotel's staff roster, for the assign picker. */
export async function inboxStaff(): Promise<{ name: string; role: string | null; email: string | null }[]> {
  try {
    const { data, error } = await supabaseAdmin().from('garden_staff').select('name,role,email,active').order('name')
    if (error) return []
    return ((data || []) as any[]).filter(x => x.active !== false && x.name).map(x => ({ name: s(x.name), role: x.role || null, email: x.email || null }))
  } catch { return [] }
}
