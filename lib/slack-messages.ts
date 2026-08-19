// THE WORDS. Every Slack message the app sends is written here, in one voice.
//
// Jon, 2026-08-19: "The tone should be encouraging, ect. This is important."
//
// So the rule for everything below: state the picture plainly, point at the next action, and stay
// on the team's side. No "you are late". No naming someone as the problem. A cleaner reading this
// in a channel with their supervisor and the owner in it should feel backed, not caught. The
// numbers still have to be honest — encouraging is not the same as vague, and softening a real
// problem into mush would make the alert useless.
//
// Messages are GROUPED by construction: each builder takes a LIST and returns ONE message. There
// is no single-item variant on purpose, because that is how you end up spamming a channel.
import { mention } from './slack'

const nl = (lines: (string | null | undefined)[]): string =>
  lines.filter(l => l !== null && l !== undefined && l !== '').join('\n')

/** Rotates the greeting by day so a daily message does not read like a robot stuck in a loop. */
function opener(seed: string, options: string[]): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return options[h % options.length]
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** "Ana, Maria and José" — reads like a person wrote it. */
export function humanList(names: string[]): string {
  const c = names.filter(Boolean)
  if (!c.length) return ''
  if (c.length === 1) return c[0]
  if (c.length === 2) return c[0] + ' and ' + c[1]
  return c.slice(0, -1).join(', ') + ' and ' + c[c.length - 1]
}

/**
 * The tag line every grouped message ends with. `here` is set for VENDOR areas (Jon's call,
 * 2026-08-19): those crews are not in this workspace, so an @-mention resolves to nobody —
 * @here reaches whoever from the vendor side is actually in the channel.
 */
const ccLine = (audience: string[], here?: boolean): string => {
  const tags = audience.map(mention).filter(Boolean)
  if (here) tags.unshift('<!here>')
  return tags.length ? tags.join(' ') : ''
}

// ── Cleans running behind ──────────────────────────────────────────────────────────────────────

export type LateCleanItem = {
  unit: string
  assignee: string | null
  assigneeSlackId: string | null
  arrivingAt: string | null      // next guest's arrival today, else null
  checkOutTime: string | null
}

/**
 * ONE message for a whole AREA (all of Broward, all of Miami). Units are listed compactly; the
 * today are called out first because that is the only part that is genuinely time-critical.
 */
export function lateCleansMessage(opts: {
  /** the ROUTING AREA — "Broward", "Miami", "17West" — not one building. One message per area. */
  area: string
  items: LateCleanItem[]
  audience: string[]
  date: string
  here?: boolean
}): { body: string; summary: string } {
  const { area, items, audience, date, here } = opts
  const withArrival = items.filter(i => i.arrivingAt)
  const unassigned = items.filter(i => !i.assignee)
  const earliest = withArrival
    .map(i => i.arrivingAt as string)
    .sort()[0] || null

  const head = opener(area + date, [
    '👋 *' + area + '* — quick pulse on today',
    '🌤 *' + area + '* — where the day stands',
    '📋 *' + area + '* — heads up on the board',
  ])

  const count = items.length
  const line1 =
    count + ' departure ' + plural(count, 'clean', 'cleans') + ' still to start' +
    (withArrival.length
      ? ', and ' + withArrival.length + ' of ' + plural(withArrival.length, 'them has', 'them have') +
        ' a guest arriving today' + (earliest ? ' (earliest ' + earliest + ')' : '')
      : ' — no arrivals waiting on these, so there is room to work')

  const unitLines = items.slice(0, 12).map(i => {
    const who = i.assigneeSlackId ? mention(i.assigneeSlackId) : (i.assignee || '_nobody assigned yet_')
    const when = i.arrivingAt ? '  · guest arrives ' + i.arrivingAt : ''
    return '• *' + i.unit + '* — ' + who + when
  })
  if (items.length > 12) unitLines.push('• …and ' + (items.length - 12) + ' more')

  const ask = unassigned.length
    ? 'Could we get ' + plural(unassigned.length, 'a name', 'names') + ' on the ' + unassigned.length +
      ' without anyone assigned? Once ' + plural(unassigned.length, 'it is', 'they are') + ' covered the rest is straightforward.'
    : 'Everything is assigned — just needs a start. If anything is blocking you, say so here and we will clear it.'

  const body = nl([
    head,
    line1 + '.',
    '',
    unitLines.join('\n'),
    '',
    ask,
    'Thanks all 🙏',
    ccLine(audience, here),
  ])

  const summary = area + ' — ' + count + ' ' + plural(count, 'clean', 'cleans') + ' to start' +
    (withArrival.length ? ', ' + withArrival.length + ' with arrivals today' : '')
  return { body, summary }
}

// ── Glitches / guest issues ────────────────────────────────────────────────────────────────────

export type GlitchItem = {
  unit: string
  issue: string
  ageDays: number | null
  assignee: string | null
  assigneeSlackId: string | null
  overdue: boolean
}

export function glitchesMessage(opts: {
  /** the ROUTING AREA — one message per area per department. */
  area: string
  items: GlitchItem[]
  audience: string[]
  date: string
  here?: boolean
}): { body: string; summary: string } {
  const { area, items, audience, date, here } = opts
  const overdue = items.filter(i => i.overdue)

  const head = opener(area + date + 'g', [
    '🔧 *' + area + '* — open guest issues',
    '🛠 *' + area + '* — what is still open',
    '📌 *' + area + '* — issues worth a look',
  ])

  const line1 =
    items.length + ' open ' + plural(items.length, 'issue', 'issues') +
    (overdue.length ? ', ' + overdue.length + ' past the date we set' : ' — all still inside their window')

  const rows = items.slice(0, 10).map(i => {
    const who = i.assigneeSlackId ? mention(i.assigneeSlackId) : (i.assignee || '_unassigned_')
    const age = i.ageDays != null && i.ageDays > 0 ? '  · ' + i.ageDays + 'd open' : ''
    const flag = i.overdue ? ' ⏰' : ''
    return '• *' + i.unit + '* — ' + i.issue.slice(0, 90) + flag + '\n   ' + who + age
  })
  if (items.length > 10) rows.push('• …and ' + (items.length - 10) + ' more on the board')

  const ask = overdue.length
    ? 'For the ones with a ⏰ — a quick note on where they stand is enough. If something is waiting on a part or an owner, flag it and we will chase it from our side.'
    : 'Nothing urgent here. Post an update when you get to them so guests are not asking twice.'

  const body = nl([
    head,
    line1 + '.',
    '',
    rows.join('\n'),
    '',
    ask,
    ccLine(audience, here),
  ])

  const summary = area + ' — ' + items.length + ' open ' + plural(items.length, 'issue', 'issues') +
    (overdue.length ? ' (' + overdue.length + ' overdue)' : '')
  return { body, summary }
}

// ── Running over hours ─────────────────────────────────────────────────────────────────────────

export type LongShift = {
  name: string
  slackId: string | null
  hours: number
  clockIn: string | null
}

/**
 * Deliberately framed as looking after someone, not catching them. This goes to supervisors by
 * default (Jon's call) — the person is tagged so the supervisor can reach them in one tap.
 */
export function overtimeMessage(opts: {
  items: LongShift[]
  audience: string[]
  threshold: number
  date: string
}): { body: string; summary: string } {
  const { items, audience, threshold, date } = opts
  const head = opener(date + 'ot', [
    '⏱ *Still on the clock*',
    '⏱ *Long day check*',
    '⏱ *Worth a check-in*',
  ])

  const rows = items.map(i => {
    const who = i.slackId ? mention(i.slackId) : i.name
    return '• ' + who + ' — *' + i.hours.toFixed(1) + 'h*' + (i.clockIn ? ' since ' + i.clockIn : '')
  })

  const names = humanList(items.map(i => i.name))
  const body = nl([
    head,
    plural(items.length, 'One person is', items.length + ' people are') + ' past ' + threshold + 'h today.',
    '',
    rows.join('\n'),
    '',
    'Worth a quick check that ' + (items.length === 1 ? names + ' is' : 'they are') +
      ' alright and that the clock-out is not just forgotten. If the work genuinely needs the hours, no problem at all — better to know than to guess.',
    ccLine(audience),
  ])

  const summary = items.length + ' ' + plural(items.length, 'person', 'people') + ' over ' + threshold + 'h — ' + names
  return { body, summary }
}

// ── Sync health (system, auto-sends) ───────────────────────────────────────────────────────────

export function syncProblemMessage(alerts: string[]): string {
  return nl([
    '🔌 *Lighthouse lost a feed*',
    '',
    alerts.map(a => '• ' + a).join('\n'),
    '',
    'The day sheet and the boards may be showing older information until this reconnects. Nothing anyone did — flagging it so no one plans off stale numbers.',
  ])
}

export function syncRecoveredMessage(recovered: string[]): string {
  return nl([
    '✅ *Back up and syncing*',
    '',
    recovered.map(r => '• ' + r).join('\n'),
    '',
    'Everything is current again. Thanks for your patience 🙌',
  ])
}

// ── Morning digest ─────────────────────────────────────────────────────────────────────────────

export type DigestStats = {
  date: string
  turnovers: number
  arrivals: number
  unassignedCleans: number
  openGlitches: number
  overdueGlitches: number
  clockedIn: number
  expiredYesterday: number
}

export function digestMessage(s: DigestStats, audience: string[]): { body: string; summary: string } {
  const head = opener(s.date, [
    '☀️ *Good morning — here is the day*',
    '☀️ *Morning. What today looks like*',
    '☀️ *Fresh start — the shape of today*',
  ])

  const load =
    s.turnovers > 0
      ? s.turnovers + ' ' + plural(s.turnovers, 'turnover', 'turnovers') + ' and ' + s.arrivals + ' ' + plural(s.arrivals, 'arrival', 'arrivals')
      : 'No turnovers on the board' + (s.arrivals ? ', but ' + s.arrivals + ' ' + plural(s.arrivals, 'arrival', 'arrivals') + ' coming in' : '')

  const shape = s.turnovers >= 12
    ? 'Busy one — worth setting the order early.'
    : s.turnovers === 0
      ? 'Light day. Good window for the catch-up work.'
      : 'Very manageable.'

  const body = nl([
    head,
    '',
    '*' + load + '.* ' + shape,
    s.unassignedCleans ? '• ' + s.unassignedCleans + ' ' + plural(s.unassignedCleans, 'clean', 'cleans') + ' still without a name on ' + plural(s.unassignedCleans, 'it', 'them') : '• Every clean has someone on it ✅',
    s.openGlitches ? '• ' + s.openGlitches + ' open ' + plural(s.openGlitches, 'issue', 'issues') + (s.overdueGlitches ? ', ' + s.overdueGlitches + ' past date' : '') : '• No open issues on the board ✅',
    s.clockedIn ? '• ' + s.clockedIn + ' ' + plural(s.clockedIn, 'person', 'people') + ' clocked in so far' : null,
    s.expiredYesterday ? '• ' + s.expiredYesterday + ' queued ' + plural(s.expiredYesterday, 'message', 'messages') + ' expired unapproved yesterday' : null,
    '',
    'Have a good one 💪',
    ccLine(audience),
  ])

  return { body, summary: 'Morning digest — ' + s.turnovers + ' turnovers, ' + s.arrivals + ' arrivals' }
}

// ── Personal brief (per person DM) ─────────────────────────────────────────────────────────────

export type PersonalBrief = {
  name: string
  date: string
  cleans: { unit: string; arrivingAt: string | null }[]
  otherTasks: { unit: string; title: string }[]
  note: string | null
}

/**
 * Jon asked for this on 2026-08-19: "should give them a slack message about there day, what to
 * expect, what to know... useful for them to get a little brief." One DM, their work only.
 */
export function personalBriefMessage(b: PersonalBrief): { body: string; summary: string } {
  const first = (b.name || '').split(/\s+/)[0] || 'there'
  const head = opener(b.date + b.name, [
    '☀️ Morning ' + first + '!',
    '👋 Hey ' + first + ' — here is your day',
    '☀️ Good morning ' + first + ' — quick look at today',
  ])

  const tight = b.cleans.filter(c => c.arrivingAt)
  const cleanLines = b.cleans.map(c =>
    '• *' + c.unit + '*' + (c.arrivingAt ? ' — guest arrives ' + c.arrivingAt : ''))
  const taskLines = b.otherTasks.slice(0, 6).map(t => '• ' + t.unit + ' — ' + t.title.slice(0, 70))

  const total = b.cleans.length + b.otherTasks.length
  const shape = total === 0
    ? 'Nothing assigned to you yet today — check with your supervisor before you head out.'
    : total <= 2
      ? 'A light one today.'
      : total >= 6
        ? 'A full day — pace yourself, and shout if it is too much.'
        : 'A steady day.'

  const body = nl([
    head,
    shape,
    b.cleans.length ? '' : null,
    b.cleans.length ? '*Your cleans (' + b.cleans.length + ')*' : null,
    b.cleans.length ? cleanLines.join('\n') : null,
    b.otherTasks.length ? '' : null,
    b.otherTasks.length ? '*Also on you*' : null,
    b.otherTasks.length ? taskLines.join('\n') : null,
    tight.length ? '' : null,
    tight.length ? '⏰ ' + plural(tight.length, 'One unit has', tight.length + ' units have') + ' a guest arriving today, so those are the ones to hit first.' : null,
    b.note ? '\n📌 ' + b.note : null,
    '',
    'Anything in your way, just reply here — someone will pick it up. Have a great day 🙌',
  ])

  return { body, summary: b.name + ' — ' + b.cleans.length + ' cleans, ' + b.otherTasks.length + ' other tasks' }
}
