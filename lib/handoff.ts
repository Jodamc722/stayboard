// HANDOFF ALERTS (Jon, 2026-10-07: "field coordinators or even CCS can leave a message for the
// incoming team … a note or notification or reminder that's intrusive and will remind them at a
// particular time, where they'll have to confirm receipt … notifies them in the VR customer care
// team channel / they can assign it to any channel … maybe it's for a supervisor or somebody").
//
// The rules, pure — no imports — so the route, the cron, the banner and a test share one copy.
//   · An alert is FOR everyone, for roles (Customer service, Ops …), or for named people.
//   · It FIRES at a time (now, or later): it posts to a Slack channel (customer care by default, any
//     channel, or none) tagging the people it is for, and it lands as a banner across the top of
//     every Lighthouse page for each of them until they tap "Got it".
//   · Unconfirmed, it NAGS: a thread reply tagging only the people who have not confirmed, every
//     hour, up to three times. Who has and has not confirmed is on the alert for everyone to see.
//   · It CLOSES when everyone it was for has confirmed, when its writer or an admin closes it, or —
//     for an everyone alert, which has no "everyone" to count — a day after it fired.

export type Audience =
  | { kind: 'everyone' }
  | { kind: 'roles'; roles: string[] }          // app_roles keys, e.g. cs, cs_manager, ops
  | { kind: 'people'; emails: string[] }        // app_users emails

export type Recipient = { email: string; name: string }
// A comment can TAG people (Jon, 2026-10-07: "in the alerts column, let me be able to tag somebody
// … it notifies them in the comments"). Tagging puts the alert on that person's screen — they are
// added to the alert's recipients, so it shows in their bell until they confirm — and @-mentions
// them in the alert's Slack thread. `mentions` is emails; `mentionNames` is how to draw them.
export type Comment = {
  id: string; by: string; byEmail: string; text: string; at: string
  mentions?: string[]; mentionNames?: Record<string, string>
  // GROUPS (Jon, 2026-10-07: "can we make it so you can tag by groups, similar to Slack —
  // @channel, @CCS, @manager"). A group is a role key, or the reserved 'everyone'. It is expanded
  // to people when the comment is posted, so the tag means the same thing a year later even if
  // the team changed — the people it reached are recorded in `mentions`.
  groups?: string[]; groupLabels?: Record<string, string>
}

/** The reserved group: everyone with a Lighthouse login. Slack spells it @channel. */
export const GROUP_EVERYONE = 'everyone'

export type Alert = {
  id: string
  title: string
  body: string
  unit: string | null            // optional: the unit or reservation it is about
  audience: Audience
  fireAt: string                 // ISO
  channel: string | null         // Slack channel id; null = Lighthouse only
  nag: boolean
  by: string; byEmail: string
  at: string                     // created
  source: 'person' | 'eve'
  dedupe?: string | null         // Eve's alerts: one open alert per conflict
  slackMentions?: string[]       // extra Slack ids to tag (Eve's alerts: the CCS lead and supervisors)
  severity?: 'info' | 'warn' | 'urgent'
  firedAt?: string | null
  recipients?: Recipient[]       // snapshot at fire time (everyone alerts: empty — anyone who opens it)
  slackTs?: string | null
  slackError?: string | null
  nags?: number
  lastNagAt?: string | null
  acks: Record<string, string>   // email → ISO — "Got it"
  ackNames?: Record<string, string>
  // WHO SAW IT (Jon, 2026-10-07: "a notification bell that shows everyone who saw it, read it, or
  // acknowledged it based on the user"). seen = it came up on their screen; read = they opened it.
  seen?: Record<string, string>
  read?: Record<string, string>
  names?: Record<string, string>  // email → display name, for everyone who touched it
  comments?: Comment[]
  closedAt?: string | null
  closedBy?: string | null
}

export const NAG_EVERY_MIN = 60
export const MAX_NAGS = 3
export const EVERYONE_OPEN_HOURS = 24
export const MAX_ALERTS = 200

const clip = (v: any, n: number) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

export function cleanAudience(v: any): Audience {
  if (v?.kind === 'roles') { const roles = (Array.isArray(v.roles) ? v.roles : []).map((r: any) => clip(r, 40)).filter(Boolean).slice(0, 10); return roles.length ? { kind: 'roles', roles } : { kind: 'everyone' } }
  if (v?.kind === 'people') { const emails = (Array.isArray(v.emails) ? v.emails : []).map((e: any) => clip(e, 120).toLowerCase()).filter((e: string) => /@/.test(e)).slice(0, 30); return emails.length ? { kind: 'people', emails } : { kind: 'everyone' } }
  return { kind: 'everyone' }
}

/** A new alert from the form. null = nothing to say. fireAt in the past or missing = now. */
export function makeAlert(input: any, author: { name: string; email: string }, id: string, nowIso: string): Alert | null {
  const title = clip(input?.title, 140)
  const body = String(input?.body || '').trim().slice(0, 2000)
  if (!title && !body) return null
  const t = Date.parse(String(input?.fireAt || ''))
  const fireAt = Number.isFinite(t) && t > Date.parse(nowIso) ? new Date(t).toISOString() : nowIso
  const ch = input?.channel === null || input?.channel === '' ? null : clip(input?.channel, 40) || null
  return {
    id, title: title || clip(body, 80), body: title ? body : '', unit: clip(input?.unit, 80) || null,
    audience: cleanAudience(input?.audience), fireAt, channel: ch, nag: input?.nag !== false,
    by: clip(author.name, 60) || 'Someone', byEmail: author.email, at: nowIso, source: input?.source === 'eve' ? 'eve' : 'person',
    dedupe: input?.dedupe ? clip(input.dedupe, 200) : null,
    slackMentions: Array.isArray(input?.slackMentions) ? input.slackMentions.map((x: any) => clip(x, 20)).filter(Boolean).slice(0, 8) : [],
    severity: input?.severity === 'urgent' || input?.severity === 'warn' ? input.severity : 'info',
    acks: {}, seen: {}, read: {}, names: {}, comments: [],
  }
}

/** Is this person one of the people the alert is for? (recipients snapshot once fired) */
export function isFor(a: Alert, me: { email: string; role?: string | null }): boolean {
  const e = String(me.email || '').toLowerCase()
  if (!e) return false
  if (a.audience.kind === 'everyone') return true
  if (a.recipients && a.recipients.length) return a.recipients.some(r => r.email === e)
  if (a.audience.kind === 'people') return a.audience.emails.includes(e)
  return !!me.role && a.audience.roles.includes(me.role)
}

/**
 * Tagged in a comment = on the alert from now on. The people snapshot (`recipients`) is what the
 * bell, the nag and "who's seen it" all read, so adding them there is what makes the tag a
 * notification rather than a decoration. An `everyone` alert already includes them; a closed one
 * is left alone — reopening an alert by tagging someone in it would be a surprise.
 */
export function withTagged(a: Alert, people: Recipient[]): Alert {
  if (!people.length || a.closedAt || a.audience.kind === 'everyone') return a
  const have = new Set((a.recipients || []).map(r => r.email))
  const add = people.filter(p => !have.has(p.email))
  const emails = a.audience.kind === 'people'
    ? Array.from(new Set([...a.audience.emails, ...people.map(p => p.email)])).slice(0, 60)
    : null
  return {
    ...a,
    audience: emails ? { kind: 'people', emails } : a.audience,
    recipients: add.length ? [...(a.recipients || []), ...add] : a.recipients,
    names: { ...(a.names || {}), ...Object.fromEntries(people.map(p => [p.email, p.name])) },
  }
}

export const isOpen = (a: Alert) => !a.closedAt
export const hasFired = (a: Alert) => !!a.firedAt

/** The alerts that should be on this person's screen right now: fired, open, for them, not confirmed. */
export function bannerFor(alerts: Alert[], me: { email: string; role?: string | null }): Alert[] {
  const e = String(me.email || '').toLowerCase()
  return alerts.filter(a => isOpen(a) && hasFired(a) && isFor(a, me) && !a.acks[e])
    .sort((x, y) => sevRank(y) - sevRank(x) || String(x.firedAt).localeCompare(String(y.firedAt)))
}
const sevRank = (a: Alert) => a.severity === 'urgent' ? 2 : a.severity === 'warn' ? 1 : 0

/** Who it was for and has not confirmed (named recipients only; everyone alerts have no list). */
export function pending(a: Alert): Recipient[] {
  return (a.recipients || []).filter(r => !a.acks[r.email])
}

/** Fired and should close now: everyone named confirmed, or an everyone alert a day old. */
export function shouldClose(a: Alert, now: number): boolean {
  if (!isOpen(a) || !hasFired(a)) return false
  if (a.audience.kind === 'everyone' || !(a.recipients || []).length) return now - Date.parse(String(a.firedAt)) >= EVERYONE_OPEN_HOURS * 3600_000
  return pending(a).length === 0
}

/** Due to fire now. */
export function isDue(a: Alert, now: number): boolean { return isOpen(a) && !hasFired(a) && Date.parse(a.fireAt) <= now }

/** Due a nag: fired, nagging on, people still pending, an hour since the last word, under the cap. */
export function needsNag(a: Alert, now: number): boolean {
  if (!isOpen(a) || !hasFired(a) || !a.nag || !a.channel) return false
  if ((a.nags || 0) >= MAX_NAGS) return false
  if (!pending(a).length) return false
  const last = Date.parse(String(a.lastNagAt || a.firedAt))
  return now - last >= NAG_EVERY_MIN * 60_000
}

/** Keep the stored list small: closed alerts drop off after 14 days. */
export function pruneAlerts(alerts: Alert[], now: number): Alert[] {
  return alerts.filter(a => !(a.closedAt && now - Date.parse(a.closedAt) > 14 * 86400_000))
    .sort((x, y) => y.at.localeCompare(x.at)).slice(0, MAX_ALERTS)
}

/** Where one person is with an alert: acknowledged > read > seen > not yet. */
export type Stage = 'ack' | 'read' | 'seen' | 'none'
export function stageOf(a: Alert, email: string): Stage {
  const e = String(email || '').toLowerCase()
  if (a.acks?.[e]) return 'ack'
  if (a.read?.[e]) return 'read'
  if (a.seen?.[e]) return 'seen'
  return 'none'
}
/** Everyone to list under "who's seen it": the named recipients, plus anyone else who touched it. */
export function people(a: Alert): { email: string; name: string; stage: Stage; at: string | null }[] {
  const out: Record<string, string> = {}
  for (const r of a.recipients || []) out[r.email] = r.name
  for (const m of [a.seen, a.read, a.acks]) for (const e of Object.keys(m || {})) if (!out[e]) out[e] = a.names?.[e] || a.ackNames?.[e] || e.split('@')[0]
  const rank: Record<Stage, number> = { ack: 0, read: 1, seen: 2, none: 3 }
  return Object.entries(out).map(([email, name]) => {
    const stage = stageOf(a, email)
    const at = stage === 'ack' ? a.acks[email] : stage === 'read' ? a.read![email] : stage === 'seen' ? a.seen![email] : null
    return { email, name, stage, at: at || null }
  }).sort((x, y) => rank[x.stage] - rank[y.stage] || x.name.localeCompare(y.name))
}
/** Mark a stage for a person (each stage implies the ones before it). */
export function mark(a: Alert, email: string, name: string, stage: 'seen' | 'read' | 'ack', nowIso: string): Alert {
  const e = String(email || '').toLowerCase()
  const out: Alert = { ...a, seen: { ...(a.seen || {}) }, read: { ...(a.read || {}) }, acks: { ...(a.acks || {}) }, names: { ...(a.names || {}), [e]: name } }
  if (!out.seen![e]) out.seen![e] = nowIso
  if ((stage === 'read' || stage === 'ack') && !out.read![e]) out.read![e] = nowIso
  if (stage === 'ack' && !out.acks[e]) out.acks[e] = nowIso
  return out
}
