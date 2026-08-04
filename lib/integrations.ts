// Connected apps — storage + delivery for outside tools a teammate connects themselves.
//
// WHY THIS EXISTS. Slack used to be a single global SLACK_WEBHOOK_URL that only Jon could set, in
// Vercel, by hand. Nobody could see whether it was set, and when it wasn't, four days of sync-failure
// alerts went into the void. Now a teammate clicks Connect, authorises in Slack, picks their own
// channel, and the webhook lands here — visible, testable, revocable, and per-team.
//
// STORAGE. Connections live in app_settings under one JSON key (no migration needed — app_settings
// is an existing TEXT key/value table). The webhook URL is a secret: it is written here and read by
// the server when posting, and MUST never be returned to the browser. Use publicView() for anything
// that leaves the server.
//
// FAIL-OPEN / BACKWARD COMPATIBLE. If nothing is connected we still fall back to the SLACK_WEBHOOK_URL
// env var, so an existing deployment keeps working exactly as before.
import 'server-only'
import { createHash } from 'crypto'
import { getSetting, setSetting } from './app-settings'

export const CONNECTIONS_KEY = 'integration_connections'

export type SlackConnection = {
  teamName: string          // Slack workspace, e.g. "Stay Hospitality"
  channel: string           // channel the webhook posts to, e.g. "#lighthouse-alerts"
  webhookUrl: string        // SECRET — never send to the browser
  connectedBy: string       // email of the teammate who connected it
  connectedAt: string       // ISO
}

export type Connections = { slack?: SlackConnection | null }

/** Everything the browser is allowed to know: connected or not, and by whom — never the URL. */
export type PublicConnection = {
  connected: boolean; teamName?: string; channel?: string; connectedBy?: string; connectedAt?: string
  /** true when the connection comes from the legacy env var rather than a click-to-connect install. */
  viaEnv?: boolean
}

function secret(): string {
  return process.env.OWNER_SHARE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE
    || process.env.SUPABASE_SERVICE_KEY
    || 'stayboard'
}

/**
 * Anti-CSRF state for the OAuth round trip. Slack hands this back on the callback; if it doesn't
 * match what we would have signed for that user, the callback is someone else's redirect and we
 * refuse it. Keyed on the email so one person's install can't be bounced into another's account.
 */
export function oauthState(email: string): string {
  return createHash('sha256').update('stayboard-oauth:' + secret() + ':' + String(email || '').toLowerCase()).digest('hex').slice(0, 32)
}
export function oauthStateValid(email: string, state: string): boolean {
  const expected = oauthState(email)
  const got = String(state || '')
  // Constant-time-ish: same length and identical, without leaking position via early return.
  if (expected.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export async function getConnections(): Promise<Connections> {
  const stored = await getSetting<any>(CONNECTIONS_KEY, null)
  if (!stored || typeof stored !== 'object') return {}
  return stored as Connections
}

export async function setSlackConnection(conn: SlackConnection | null, actor: string): Promise<{ ok: boolean; error?: string }> {
  const current = await getConnections()
  return setSetting(CONNECTIONS_KEY, { ...current, slack: conn }, actor)
}

/** Strip the secret. This is the ONLY shape that may cross the wire. */
export function publicView(c: Connections): { slack: PublicConnection } {
  const s = c.slack
  if (s && s.webhookUrl) {
    return { slack: { connected: true, teamName: s.teamName, channel: s.channel, connectedBy: s.connectedBy, connectedAt: s.connectedAt } }
  }
  if (process.env.SLACK_WEBHOOK_URL) {
    return { slack: { connected: true, viaEnv: true, channel: 'set in Vercel', teamName: 'Configured by environment variable' } }
  }
  return { slack: { connected: false } }
}

/** Is a Slack app configured at all? Without these two, the Connect button cannot work. */
export function slackAppConfigured(): boolean {
  return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET)
}

/**
 * Post to Slack. Prefers the connected workspace; falls back to the legacy env var so nothing that
 * worked before stops working. Returns a status string rather than throwing — a failed alert must
 * never take down the thing that was trying to alert.
 */
export async function postSlack(text: string): Promise<'sent' | 'no-webhook' | 'failed'> {
  let url = ''
  try {
    const c = await getConnections()
    url = (c.slack && c.slack.webhookUrl) || ''
  } catch { /* fall through to env */ }
  if (!url) url = process.env.SLACK_WEBHOOK_URL || ''
  if (!url) return 'no-webhook'
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    return r.ok ? 'sent' : 'failed'
  } catch { return 'failed' }
}
