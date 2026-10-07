// HANDOFF ALERTS — storage, recipients and firing (rules in lib/handoff.ts).
// Stored as one JSON value in app_settings ('handoff_alerts'): a few dozen open alerts at a time,
// no migration to hand-run. Every write reads the row fresh (never the 60s settings cache), the same
// way the Bulletin does, so a confirm and a cron tick a minute apart don't undo each other.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { setSetting } from './app-settings'
import {
  type Alert, type Recipient, isDue, needsNag, shouldClose, pending, pruneAlerts, makeAlert,
} from './handoff'

const KEY = 'handoff_alerts'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')

export async function readAlerts(): Promise<Alert[]> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).limit(1)
    const raw = (data as any)?.[0]?.value
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(j?.alerts) ? j.alerts : []
  } catch { return [] }
}
export async function writeAlerts(alerts: Alert[], by?: string | null) {
  return setSetting(KEY, { alerts: pruneAlerts(alerts, Date.now()) }, by || null)
}

/** Active Stay Hospitality logins: email, display name, role key. */
export async function teamDirectory(): Promise<{ email: string; name: string; role: string | null }[]> {
  try {
    const { data } = await supabaseAdmin().from('app_users').select('*').eq('status', 'active')
    return ((data || []) as any[])
      .filter(u => !Array.isArray(u.businesses) || u.businesses.includes('vr'))
      .map(u => ({
        email: String(u.email || '').toLowerCase(),
        name: String(u.profile?.name || '') || String(u.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        role: u.role === 'admin' ? 'admin' : (u.access_role || null),
      }))
      .filter(u => u.email)
  } catch { return [] }
}

async function recipientsFor(a: Alert): Promise<Recipient[]> {
  if (a.audience.kind === 'everyone') return []
  const dir = await teamDirectory()
  if (a.audience.kind === 'people') {
    const want = new Set(a.audience.emails)
    return dir.filter(u => want.has(u.email)).map(u => ({ email: u.email, name: u.name }))
  }
  const roles = new Set(a.audience.roles)
  return dir.filter(u => u.role && roles.has(u.role)).map(u => ({ email: u.email, name: u.name }))
}

/** Slack @-mentions for the people, matched by email first, then by name (lib/slack-rules). */
async function mentionsFor(people: Recipient[]): Promise<string> {
  if (!people.length) return ''
  try {
    const [{ getDirectory, mention }, { getSlackRules, resolveSlackId }] = await Promise.all([import('./slack'), import('./slack-rules')])
    const [dir, rules] = await Promise.all([getDirectory(), getSlackRules()])
    const users = (dir.users || []) as any[]
    return people.map(p => {
      const byEmail = users.find(u => u && !u.deleted && String(u.email || '').toLowerCase() === p.email)
      const id = byEmail?.id || resolveSlackId(p.name, users, rules)
      return id ? mention(id) : p.name
    }).join(' ')
  } catch { return people.map(p => p.name).join(', ') }
}

function slackText(a: Alert, who: string): string {
  const icon = a.severity === 'urgent' ? '🚨' : a.severity === 'warn' ? '⚠️' : '🔔'
  return [
    `${icon} *Handoff${a.source === 'eve' ? ' from Eve' : ' from ' + a.by}:* ${a.title}`,
    a.body ? a.body : '',
    a.unit ? `_About:_ ${a.unit}` : '',
    (who ? `For ${who} — ` : 'For the team — ') + `please confirm you've got it: <${APP_URL}/command|Got it in Lighthouse>`,
  ].filter(Boolean).join('\n')
}

/**
 * The cron's job (every 5 minutes, from /api/cron/eve-reminders): fire what is due, nag the people
 * who haven't confirmed, close what is done. Returns a short tally for the run log.
 */
export async function runHandoffs(): Promise<{ fired: number; nagged: number; closed: number; notes: string[] }> {
  const alerts = await readAlerts()
  const now = Date.now()
  let fired = 0, nagged = 0, closed = 0
  const notes: string[] = []
  let changed = false
  const { postToChannel, postThreadReply } = await import('./slack')
  for (const a of alerts) {
    if (isDue(a, now)) {
      a.recipients = await recipientsFor(a)
      a.firedAt = new Date(now).toISOString()
      if (a.channel) {
        const extra = (a.slackMentions || []).map(id => '<@' + id + '>').join(' ')
        const r = await postToChannel(a.channel, slackText(a, [await mentionsFor(a.recipients), extra].filter(Boolean).join(' ')))
        if (r.ok) { a.slackTs = r.ts || null; a.slackError = null } else { a.slackError = r.error || 'failed'; notes.push(a.title + ': ' + a.slackError) }
      }
      fired++; changed = true
      continue
    }
    if (needsNag(a, now) && a.slackTs) {
      const who = await mentionsFor(pending(a))
      const r = await postThreadReply(a.channel!, a.slackTs, `Still waiting on ${who} to confirm this one: <${APP_URL}/command|Got it in Lighthouse>`)
      a.nags = (a.nags || 0) + 1; a.lastNagAt = new Date(now).toISOString()
      if (!r.ok) notes.push('nag ' + a.title + ': ' + (r.error || 'failed'))
      nagged++; changed = true
    }
    if (shouldClose(a, now)) { a.closedAt = new Date(now).toISOString(); a.closedBy = 'auto'; closed++; changed = true }
  }
  if (changed) await writeAlerts(alerts, 'cron')
  return { fired, nagged, closed, notes }
}

/**
 * Eve raises an alert (the guest-move watch). One open alert per `dedupe` key — the same conflict
 * found again on the next run does not post again. Fires on the next cron tick.
 */
export async function raiseEveAlert(input: { title: string; body: string; unit?: string | null; dedupe: string; severity?: 'info' | 'warn' | 'urgent'; channel?: string | null }): Promise<boolean> {
  const alerts = await readAlerts()
  if (alerts.some(a => a.dedupe === input.dedupe && (!a.closedAt || Date.now() - Date.parse(a.closedAt) < 12 * 3600_000))) return false
  const { EVE_CHANNELS, ROBERTO_SLACK_ID, KARLA_SLACK_ID, SILVIA_SLACK_ID } = await import('./slack-rules')
  // Everyone sees it in Lighthouse; in Slack it tags the people who run the handoff (Roberto,
  // Karla, Silvia) in the customer care room.
  const a = makeAlert({ ...input, source: 'eve', audience: { kind: 'everyone' }, slackMentions: [ROBERTO_SLACK_ID, KARLA_SLACK_ID, SILVIA_SLACK_ID], channel: input.channel === undefined ? EVE_CHANNELS.ccsJon : input.channel }, { name: 'Eve', email: 'eve@lighthouse' }, randomUUID(), new Date().toISOString())
  if (!a) return false
  alerts.unshift(a)
  await writeAlerts(alerts, 'eve')
  return true
}
