// TALKROUTE — the phone system (2026-09-21). Jon: "This is how we call guests, manage guest calls."
//
// What the API can and cannot do, from the v2 spec (apidocs.talkroute.com, 2.0.2):
//   CAN   read call history with a RESULT per call (answered / missed / hangup), duration, both
//         numbers and a recording URL; read and send SMS threads (sending needs the account's bulk
//         texting plan); read voicemails with transcripts; register webhooks for new_call_record,
//         call_completed, new_text_message and new_voicemail.
//   CAN'T place a call. There is no click-to-call. The team dials from the Talkroute app and this
//         module WATCHES what happened — which is exactly what the Calls desk needed: a welcome call
//         is proven by the phone system, not declared by a button.
//
// Auth: one bearer key (`tr_live_…`). It comes from the TALKROUTE_API_KEY env var or, when Jon
// pastes it on the Users & admin → Talkroute panel, from app_settings sealed with the vault key.
// Never returned to a browser; the admin route reports presence and the last four characters.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { encryptSecret, decryptSecret, vaultKeyReady } from './vault'

export const TR_BASE = 'https://api.talkroute.com/api/v2'
export const TR_SETTINGS_KEY = 'talkroute'

export type TalkrouteSettings = {
  apiKeyCipher?: string | null     // sealed with VAULT_KEY (preferred)
  apiKeyPlain?: string | null      // only when no vault key is configured — same posture as the Slack webhook
  keyHint?: string | null          // last four characters, for the admin screen
  connectedBy?: string | null
  connectedAt?: string | null
  webhookToken?: string | null     // random secret in the hook URL — Talkroute signs nothing
  /** An outbound call that is ANSWERED but shorter than this went to the guest's voicemail box. */
  voicemailMaxSec?: number
  lastCallSyncAt?: string | null
  lastTextSyncAt?: string | null
  lastVoicemailSyncAt?: string | null
  lastError?: string | null
}

export const DEFAULT_VOICEMAIL_MAX_SEC = 20

export async function getTalkrouteSettings(): Promise<TalkrouteSettings> {
  return await getSetting<TalkrouteSettings>(TR_SETTINGS_KEY, {})
}
export async function saveTalkrouteSettings(patch: Partial<TalkrouteSettings>, actor?: string | null) {
  const cur = await getTalkrouteSettings()
  return setSetting(TR_SETTINGS_KEY, { ...cur, ...patch }, actor || null)
}

/** The bearer key, or '' when Talkroute is not connected. */
export async function talkrouteKey(): Promise<string> {
  const env = String(process.env.TALKROUTE_API_KEY || '').trim()
  if (env) return env
  const s = await getTalkrouteSettings()
  if (s.apiKeyCipher) { try { return decryptSecret(s.apiKeyCipher) } catch { return '' } }
  return String(s.apiKeyPlain || '').trim()
}
export async function talkrouteConfigured(): Promise<boolean> { return !!(await talkrouteKey()) }

/** Store a pasted key. Sealed when the vault key exists; the hint is all the browser ever sees. */
export async function storeTalkrouteKey(key: string, actor: string) {
  const k = String(key || '').trim()
  if (!/^tr_(live|test)_[0-9a-f]{32,}$/i.test(k)) return { ok: false, error: 'That does not look like a Talkroute API key (tr_live_…).' }
  const patch: Partial<TalkrouteSettings> = { keyHint: k.slice(-4), connectedBy: actor, connectedAt: new Date().toISOString(), lastError: null }
  if (vaultKeyReady()) { patch.apiKeyCipher = encryptSecret(k); patch.apiKeyPlain = null }
  else { patch.apiKeyPlain = k; patch.apiKeyCipher = null }
  return saveTalkrouteSettings(patch, actor)
}
export async function clearTalkrouteKey(actor: string) {
  return saveTalkrouteSettings({ apiKeyCipher: null, apiKeyPlain: null, keyHint: null, connectedBy: null, connectedAt: null }, actor)
}

// ── PHONE NORMALISATION ─────────────────────────────────────────────────────────────────────────
// Talkroute speaks E.164 ("+13055551234"); Guesty stores whatever the guest typed ("(305) 555-1234",
// "305-555-1234", "+1 305 555 1234", "0034 6…"). Everything is compared as digits with the country
// code: a bare 10-digit NANP number gets its leading 1. The last ten digits are the join key for
// anything that still disagrees (a guest who typed 001-305… on Vrbo).
export function phoneDigits(raw: any): string {
  let s = String(raw || '').replace(/[^\d+]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('00')) s = s.slice(2)
  s = s.replace(/\D/g, '')
  if (s.length === 10) s = '1' + s
  if (s.length === 11 && s[0] === '1') return s
  return s
}
/** The ten digits after the country code for NANP numbers; the whole thing otherwise. */
export function phoneKey(raw: any): string {
  const d = phoneDigits(raw)
  if (!d) return ''
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}
export function formatPhone(digits: string): string {
  const d = String(digits || '')
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return d ? '+' + d : ''
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
export class TalkrouteError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }

export async function trFetch<T = any>(path: string, init: RequestInit & { query?: Record<string, any> } = {}): Promise<T> {
  const key = await talkrouteKey()
  if (!key) throw new TalkrouteError(0, 'Talkroute is not connected — paste the API key on Users & admin → Talkroute.')
  const url = new URL(TR_BASE + path)
  for (const [k, v] of Object.entries(init.query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  const r = await fetch(url.toString(), {
    method: init.method || 'GET',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as any || {}) },
    body: init.body, cache: 'no-store',
  })
  const text = await r.text()
  let j: any = null
  try { j = text ? JSON.parse(text) : null } catch { j = null }
  if (!r.ok) {
    const msg = (j && (j.message || j.error || (j.errors && JSON.stringify(j.errors)))) || text.slice(0, 200) || r.statusText
    throw new TalkrouteError(r.status, `Talkroute ${r.status}: ${String(msg).slice(0, 240)}`)
  }
  return j as T
}

// ── TYPES (the fields we read; the spec has more) ───────────────────────────────────────────────
export type TrCallEvent = { id?: string; type?: string; description?: string; createdAt?: string }
export type TrCallRecord = {
  id: string; direction: 'inbound' | 'outbound'; callDate: string
  externalName?: string | null; externalNumber?: string | null; phoneNumber?: string | null
  duration?: number; recorded?: boolean; recording?: string | null; result?: string | null
  events?: TrCallEvent[]
}
export type TrPagination = { total?: number; count?: number; perPage?: number; currentPage?: number; totalPages?: number }
export type TrPage<T> = { data: T[]; pagination?: TrPagination }
export type TrTextMessage = { id: string; body?: string | null; read?: boolean; userEmail?: string | null; direction?: string; createdAt?: string; attachments?: any[] }
export type TrTextConversation = { conversation_id: string; talkroute_number?: string; contact_number?: string; last_message_at?: string; last_message?: TrTextMessage | null; messages_count?: number }
export type TrVoiceMessage = {
  id: string; read?: boolean; phoneNumber?: string; callResult?: string; callerName?: string; callerNumber?: string
  duration?: number; transcript?: string | null; transcriptionInProgress?: boolean; audioLink?: string | null; createdAt?: string
  voiceMailboxId?: string | number; mailboxId?: string | number
}
export type TrVirtualNumber = { id: string; phoneNumber?: string; description?: string; messagingStatus?: boolean; voiceEnabled?: boolean }
export type TrSubscription = { id: string; hookUrl: string; type: string }
export const TR_WEBHOOK_TYPES = ['new_call_record', 'new_text_message', 'new_voicemail'] as const

/**
 * Talkroute's date filters want `Y-m-d\TH:i:sP` — "2026-09-14T14:26:00+00:00". JS's toISOString()
 * gives "2026-09-14T14:26:00.123Z", which it rejects with a 422 (first live sync, 2026-09-21).
 */
export function trDate(v: string | Date | undefined): string | undefined {
  if (!v) return undefined
  const d = v instanceof Date ? v : new Date(v)
  if (!Number.isFinite(d.getTime())) return undefined
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

// ── ENDPOINTS ───────────────────────────────────────────────────────────────────────────────────
export async function trCallHistory(q: { after?: string; before?: string; direction?: string; page?: number; pageSize?: number } = {}) {
  return trFetch<TrPage<TrCallRecord>>('/call-history', { query: { pageSize: q.pageSize || 100, page: q.page || 1, after: trDate(q.after), before: trDate(q.before), direction: q.direction } })
}
/** Every call record since `after`, walking the pages (capped so a runaway account cannot hang a cron). */
export async function trAllCallsSince(after: string, maxPages = 10): Promise<TrCallRecord[]> {
  const out: TrCallRecord[] = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await trCallHistory({ after, page, pageSize: 100 })
    const rows = Array.isArray(r?.data) ? r.data : []
    out.push(...rows)
    const tp = Number(r?.pagination?.totalPages || 1)
    if (page >= tp || rows.length === 0) break
  }
  return out
}
export async function trTextConversations(q: { since?: string; page?: number; pageSize?: number; unread?: boolean } = {}) {
  return trFetch<TrPage<TrTextConversation>>('/text-conversations', { query: { pageSize: q.pageSize || 100, page: q.page || 1, since: trDate(q.since), unread: q.unread } })
}
export async function trTextMessages(conversationId: string, q: { page?: number; pageSize?: number } = {}) {
  return trFetch<TrPage<TrTextMessage>>(`/text-conversations/${encodeURIComponent(conversationId)}/messages`, { query: { pageSize: q.pageSize || 100, page: q.page || 1 } })
}
export async function trSendText(conversationId: string, body: string) {
  return trFetch<TrTextMessage>(`/text-conversations/${encodeURIComponent(conversationId)}`, { method: 'POST', body: JSON.stringify({ body }) })
}
export async function trVoicemails(q: { page?: number; pageSize?: number } = {}) {
  return trFetch<TrPage<TrVoiceMessage>>('/voice-messages', { query: { pageSize: q.pageSize || 100, page: q.page || 1 } })
}
export async function trVirtualNumbers() {
  const r = await trFetch<TrPage<TrVirtualNumber>>('/virtual-numbers', { query: { pageSize: 100 } })
  return Array.isArray(r?.data) ? r.data : []
}
export async function trSubscriptions(): Promise<TrSubscription[]> {
  const r = await trFetch<TrPage<TrSubscription>>('/subscriptions', { query: { pageSize: 100 } })
  return Array.isArray(r?.data) ? r.data : []
}
export async function trSubscribe(hookUrl: string, type: string) {
  return trFetch<{ data: TrSubscription }>('/subscriptions', { method: 'POST', body: JSON.stringify({ hookUrl, type }) })
}
export async function trUnsubscribe(id: string) {
  return trFetch<any>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function trAccount() { return trFetch<any>('/account') }

/**
 * A conversation id is `<ourNumber>-<theirNumber>` in Talkroute's format (11 digits, leading 1, no
 * plus). Build one for a fresh outbound text to a guest who has never texted us.
 */
export function trConversationId(talkrouteNumber: string, contactNumber: string): string {
  return `${phoneDigits(talkrouteNumber)}-${phoneDigits(contactNumber)}`
}
