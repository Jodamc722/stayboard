// HANDOFF ALERTS — storage, recipients and firing (rules in lib/handoff.ts).
// Stored as one JSON value in app_settings ('handoff_alerts'): a few dozen open alerts at a time,
// no migration to hand-run. Every write reads the row fresh (never the 60s settings cache), the same
// way the Bulletin does, so a confirm and a cron tick a minute apart don't undo each other.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { setSetting } from './app-settings'
import {
  type Alert, type Recipient, isDue, needsNag, shouldClose, pending, pruneAlerts, makeAlert, isQuiet,
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
export async function mentionsFor(people: Recipient[]): Promise<string> {
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

/**
 * THE BRIEF — the first useful sentence of the alert, and nothing after it.
 *
 * The body of a guest-issue alert is a report: what the guest said, what is wrong, who owns it,
 * the glitch link, the transcript link. That is the right thing to read in Lighthouse and the
 * wrong thing to paste into a room — the post scrolls, and the one line that matters scrolls with
 * it. So Slack gets a sentence and a link (Jon, 2026-10-07: "it too should just be the link and a
 * small brief").
 */
function brief(body: string, max = 180): string {
  const flat = String(body || '')
    .split('\n')
    // Lines that are links, labels or instructions are not the brief.
    .filter(l => l.trim() && !/^https?:\/\//i.test(l.trim()) && !/^(glitch filed|read it in full|what is wrong|customer care owns this)/i.test(l.trim()))
    .join(' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return ''
  if (flat.length <= max) return flat
  // Cut at the end of a sentence where there is one, otherwise at a word.
  const stop = flat.slice(0, max).lastIndexOf('. ')
  if (stop > 60) return flat.slice(0, stop + 1)
  const sp = flat.slice(0, max).lastIndexOf(' ')
  return flat.slice(0, sp > 60 ? sp : max).trim() + '…'
}

function slackText(a: Alert, who: string): string {
  const icon = a.severity === 'urgent' ? '🚨' : a.severity === 'warn' ? '⚠️' : '🔔'
  const link = `${APP_URL}/command?alert=${encodeURIComponent(a.id)}`
  // Eve's titles start with their own siren and usually name the unit already; one icon and one
  // mention of the unit is the point of condensing it.
  const title = String(a.title || '').replace(/^(?:[\u2190-\u2BFF\u2600-\u27BF\uFE0F\uD800-\uDFFF]|\s)+/, '').trim() || a.title
  const unit = a.unit && !title.toLowerCase().includes(String(a.unit).toLowerCase()) ? ` · ${a.unit}` : ''
  const head = `${icon} *${title}*${unit}`
  const b = brief(a.body)
  // QUIET (2026-10-07): Eve's alerts tell the room, they do not ask anyone to confirm anything and
  // they tag nobody. "Resolved" in Lighthouse closes it for everyone and says so in this thread.
  if (isQuiet(a)) return [head, b, `<${link}|Open in Lighthouse> · FYI, no reply needed`].filter(Boolean).join('\n')
  return [head, b, `${who ? who + ' · ' : ''}<${link}|Open and confirm>`].filter(Boolean).join('\n')
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
        // A quiet alert tags nobody — unless it was raised WITH names (a safety matter tags Jon and
        // Roberto in the one customer-care post rather than getting a second post in #leadership).
        const extra = (a.slackMentions || []).map(id => '<@' + id + '>').join(' ')
        const r = await postToChannel(a.channel, slackText(a, isQuiet(a) ? extra : [await mentionsFor(a.recipients), extra].filter(Boolean).join(' ')))
        if (r.ok) { a.slackTs = r.ts || null; a.slackError = null } else { a.slackError = r.error || 'failed'; notes.push(a.title + ': ' + a.slackError) }
      }
      fired++; changed = true
      continue
    }
    if (needsNag(a, now) && a.slackTs) {
      const who = await mentionsFor(pending(a))
      const r = await postThreadReply(a.channel!, a.slackTs, `Still waiting on ${who}: <${APP_URL}/command?alert=${encodeURIComponent(a.id)}|open and confirm>`)
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
 * A REMINDER FROM THE SHIFT BRIEF (Jon, 2026-10-07: "I could put a due date on. I can set it as a
 * reminder"). The alert engine already does intrusive-at-a-time-and-confirm, so a brief reminder is
 * one of its alerts rather than a second mechanism: Lighthouse only (no Slack channel), no nagging,
 * for one person. Returns the alert id so the brief can cancel it if the date moves.
 */
export async function scheduleBriefReminder(input: {
  title: string; body?: string; fireAt: string; forEmail: string; unit?: string | null
  by: { name: string; email: string }
}): Promise<string | null> {
  const alerts = await readAlerts()
  const id = randomUUID()
  const a = makeAlert({
    title: input.title, body: input.body || '', unit: input.unit || null,
    audience: { kind: 'people', emails: [input.forEmail] },
    fireAt: input.fireAt, channel: null, nag: false, severity: 'info', source: 'person',
  }, input.by, id, new Date().toISOString())
  if (!a) return null
  alerts.unshift(a)
  const saved = await writeAlerts(alerts, input.by.email)
  return saved.ok ? id : null
}

/** Drop a reminder that has not fired yet (the date moved, or the item was ticked off). */
export async function cancelBriefReminder(alertId: string | null | undefined): Promise<void> {
  if (!alertId) return
  const alerts = await readAlerts()
  const a = alerts.find(x => x.id === alertId)
  if (!a || a.firedAt) return
  await writeAlerts(alerts.filter(x => x.id !== alertId), 'brief')
}

/**
 * Eve raises an alert (the guest-move watch). One open alert per `dedupe` key — the same conflict
 * found again on the next run does not post again. Fires on the next cron tick.
 */
export async function raiseEveAlert(input: { title: string; body: string; unit?: string | null; dedupe: string; severity?: 'info' | 'warn' | 'urgent'; channel?: string | null; glitchId?: string | null; mentions?: string[] }): Promise<boolean> {
  const alerts = await readAlerts()
  if (alerts.some(a => a.dedupe === input.dedupe && (!a.closedAt || Date.now() - Date.parse(a.closedAt) < 12 * 3600_000))) return false
  const { EVE_CHANNELS } = await import('./slack-rules')
  // QUIET (Jon, 2026-10-07: "too sensitive … still alert us but not so intrusive"). Everyone can see
  // it in the bell and it is posted once to the customer care room — no pop-up over the page, no
  // "Got it" demanded, no hourly nag, no @-tagging Roberto, Karla and Silvia on every one.
  // `mentions` is the exception a caller makes on purpose (a safety matter tags Jon and Roberto).
  const { mentions, ...rest } = input
  const a = makeAlert({ ...rest, source: 'eve', quiet: true, audience: { kind: 'everyone' }, slackMentions: Array.isArray(mentions) ? mentions.filter(Boolean) : [], channel: input.channel === undefined ? EVE_CHANNELS.ccsJon : input.channel }, { name: 'Eve', email: 'eve@lighthouse' }, randomUUID(), new Date().toISOString())
  if (!a) return false
  alerts.unshift(a)
  await writeAlerts(alerts, 'eve')
  return true
}

/**
 * RESOLVED, FOR EVERYONE (Jon, 2026-10-07: "an option to close them for everyone (Resolved)" · "if
 * the immediate issue is resolved attach it to the glitch"). Closes the alert, keeps who and why,
 * says so in its Slack thread, and — when the alert is about a glitch (the one it was filed with, or
 * the newest open glitch on the same unit from the last week) — adds the note to that glitch's
 * history so the glitch carries the story. The glitch itself is not closed: the guest side may still
 * be open; whoever owns it closes it on the board. Returns the glitch it went onto, if any.
 */
export async function resolveAlert(a: Alert, by: { name: string; email: string }, note: string, attach: boolean): Promise<{ glitchId: string | null }> {
  const nowIso = new Date().toISOString()
  a.closedAt = nowIso; a.closedBy = by.name
  a.resolvedNote = note || null
  let glitchId: string | null = null
  if (attach) {
    const db = supabaseAdmin()
    try {
      if (a.glitchId) glitchId = a.glitchId
      else if (a.unit) {
        const since = new Date(Date.now() - 7 * 86400_000).toISOString()
        const { data } = await db.from('glitches').select('id,status,unit').ilike('unit', a.unit.replace(/[%_]/g, '') + '%').gte('created_at', since).order('created_at', { ascending: false }).limit(5)
        const g = ((data || []) as any[]).find(r => !/closed|resolved|done|cancel/i.test(String(r.status || '')))
        glitchId = g ? String(g.id) : null
      }
      if (glitchId) {
        const { data: g } = await db.from('glitches').select('history').eq('id', glitchId).maybeSingle()
        const history = Array.isArray((g as any)?.history) ? (g as any).history.slice(-60) : []
        history.push({ at: nowIso, by: by.name, action: 'note', detail: `Alert resolved — "${a.title.slice(0, 120)}"${note ? ': ' + note.slice(0, 500) : ''}` })
        await db.from('glitches').update({ history }).eq('id', glitchId)
      }
    } catch { glitchId = null }
  }
  a.resolvedGlitchId = glitchId
  if (a.channel && a.slackTs) {
    try {
      const { postThreadReply } = await import('./slack')
      await postThreadReply(a.channel, a.slackTs, `✅ *Resolved* by ${by.name}${note ? ': ' + note.slice(0, 400) : ''}${glitchId ? ` · <${APP_URL}/glitches?id=${glitchId}|added to the glitch>` : ''}`)
    } catch { /* Lighthouse has it */ }
  }
  return { glitchId }
}
