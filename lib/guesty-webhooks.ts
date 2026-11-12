// INSTANT GUEST MESSAGES (Jon, 2026-11-12: "fully integrate and manage guest messages from Lighthouse" →
// "Instant + alerts").
//
// Until now Lighthouse learnt about a guest's message by asking: every 30 seconds while someone had /inbox open,
// and every half hour from the cron otherwise. Guesty can instead TELL us — a webhook subscription on
// `reservation.messageReceived` and `reservation.messageSent` (open-api-docs.guesty.com/docs/webhooks-messages) —
// so the thread is in our copy seconds after the guest presses send, whoever is or is not looking.
//
// HOW IT IS TRUSTED. The payload is never believed: an event only names the conversation to re-read, and the words
// come from Guesty's own API (lib/guesty syncMessages), exactly as the poll would read them. A forged POST can at
// worst cause a harmless re-read. On top of that, the URL carries a random token (like the Talkroute hook), and
// when Guesty's Svix signing secret is on file every delivery's signature is checked (svix-id / svix-timestamp /
// svix-signature, HMAC-SHA256 over "id.timestamp.body", 5-minute window).
//
// Stored in app_settings `guesty_webhook` (no migration): { token, url, subscriptionId, secret, connectedAt,
// connectedBy, lastEventAt, lastEvent, events }.
import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { getSettingFresh, setSetting } from './app-settings'
import { guestyGet, guestyWrite } from './guesty'

export const WEBHOOK_EVENTS = ['reservation.messageReceived', 'reservation.messageSent']
const KEY = 'guesty_webhook'

export type GuestyWebhookSettings = {
  token?: string | null; url?: string | null; subscriptionId?: string | null; secret?: string | null
  connectedAt?: string | null; connectedBy?: string | null
  lastEventAt?: string | null; lastEvent?: string | null; events?: number
}

export async function readWebhookSettings(): Promise<GuestyWebhookSettings> {
  const v = await getSettingFresh<GuestyWebhookSettings>(KEY, {}).catch(() => ({} as GuestyWebhookSettings))
  return v && typeof v === 'object' ? v : {}
}
async function writeWebhookSettings(patch: Partial<GuestyWebhookSettings>, by?: string | null) {
  const cur = await readWebhookSettings()
  return setSetting(KEY, { ...cur, ...patch }, by || null)
}

/** Every subscription Guesty has for this account — so we never add a second copy of ours. */
export async function listGuestyWebhooks(): Promise<{ id: string; url: string; events: string[] }[]> {
  const r = await guestyGet<any>('/webhooks')
  const arr: any[] = Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : Array.isArray(r?.data) ? r.data : []
  return arr.map(w => ({ id: String(w?._id || w?.id || ''), url: String(w?.url || ''), events: Array.isArray(w?.events) ? w.events.map(String) : [] })).filter(w => w.id)
}

/** The Svix signing secret Guesty uses for an endpoint. Its answer's shape is undocumented — take the whsec_ string. */
async function fetchSecret(url: string): Promise<string | null> {
  try {
    const r = await guestyGet<any>('/webhooks-v2/secret?url=' + encodeURIComponent(url))
    const s = JSON.stringify(r || {}).match(/whsec_[A-Za-z0-9+/=]+/)
    return s ? s[0] : null
  } catch { return null }
}

/** Subscribe (or re-use our existing subscription). `origin` is the site's own address, e.g. https://lighthouse-stay.vercel.app */
export async function connectWebhook(origin: string, by: string): Promise<GuestyWebhookSettings & { reused: boolean }> {
  const cur = await readWebhookSettings()
  const token = cur.token || randomBytes(24).toString('hex')
  const url = origin.replace(/\/$/, '') + '/api/guesty/webhook?t=' + token
  const existing = (await listGuestyWebhooks()).find(w => w.url.split('?')[0] === url.split('?')[0])
  let subscriptionId = existing?.id || ''
  let reused = false
  if (existing && existing.url === url && WEBHOOK_EVENTS.every(e => existing.events.indexOf(e) >= 0)) reused = true
  else {
    // A stale copy of OUR endpoint (old token, fewer events) is replaced, never left beside the new one.
    if (existing) await guestyWrite('/webhooks/' + encodeURIComponent(existing.id), undefined, 'DELETE').catch(() => null)
    const r = await guestyWrite<any>('/webhooks', { url, events: WEBHOOK_EVENTS })
    subscriptionId = String(r?._id || r?.id || r?.data?._id || '')
  }
  const secret = await fetchSecret(url)
  const next = { token, url, subscriptionId, secret, connectedAt: new Date().toISOString(), connectedBy: by }
  await writeWebhookSettings(next, by)
  return { ...cur, ...next, reused }
}

export async function disconnectWebhook(by: string): Promise<void> {
  const cur = await readWebhookSettings()
  const subs = await listGuestyWebhooks().catch(() => [])
  const ours = subs.filter(w => w.url.indexOf('/api/guesty/webhook') >= 0)
  for (const w of ours) await guestyWrite('/webhooks/' + encodeURIComponent(w.id), undefined, 'DELETE').catch(() => null)
  await writeWebhookSettings({ ...cur, subscriptionId: null, url: null, secret: null, connectedAt: null, connectedBy: by }, by)
}

/** Note that an event arrived — at most once a minute, so a burst of messages is not a burst of writes. */
let lastNoted = 0
export async function noteEvent(event: string) {
  if (Date.now() - lastNoted < 60_000) return
  lastNoted = Date.now()
  const cur = await readWebhookSettings()
  await writeWebhookSettings({ lastEventAt: new Date().toISOString(), lastEvent: event, events: (cur.events || 0) + 1 })
}

/** Svix signature check. True when it verifies; false when it does not. Header names: svix-* or webhook-*. */
export function verifySvix(secret: string, headers: Headers, body: string, now = Date.now()): boolean {
  const id = headers.get('svix-id') || headers.get('webhook-id') || ''
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp') || ''
  const sigs = headers.get('svix-signature') || headers.get('webhook-signature') || ''
  if (!id || !ts || !sigs) return false
  const t = Number(ts)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest()
  return sigs.split(' ').some(part => {
    const [ver, sig] = part.split(',')
    if (ver !== 'v1' || !sig) return false
    const got = Buffer.from(sig, 'base64')
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}
