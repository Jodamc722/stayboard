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

// ── Bilingual support (field channels) ─────────────────────────────────────────────────────────
//
// Jon, 2026-08-19: "Bilingual in the field channels." The crews are Spanish-first and currently
// write translated English ("Plis", "The lovy is ready", "Streps unit 508") — the wire is English
// but comprehension is not. So field-facing messages lead with Spanish, then the same thing in
// English. Management and CCS channels stay English-only.
//
// The unit list is NOT duplicated — names, times and @-mentions are language-neutral and repeating
// twenty lines twice would make the message unreadable. Only the framing is translated.

const ES = {
  behindHead: (area: string) => '👋 *' + area + '* — resumen de hoy',
  behindCount: (n: number, arr: number) =>
    n + (n === 1 ? ' limpieza de salida pendiente' : ' limpiezas de salida pendientes') +
    (arr ? ', y ' + arr + (arr === 1 ? ' tiene' : ' tienen') + ' huésped que llega hoy' : ''),
  behindAsk: (unassigned: number) => unassigned
    ? '¿Podemos asignar ' + (unassigned === 1 ? 'la que está' : 'las ' + unassigned + ' que están') + ' sin nombre? En cuanto estén cubiertas, el resto es sencillo.'
    : 'Todo está asignado — solo falta empezar. Si algo les está bloqueando, díganlo aquí y lo resolvemos.',
  behindThanks: 'Gracias a todos 🙏',
  glitchHead: (area: string) => '🔧 *' + area + '* — incidencias abiertas',
  glitchCount: (n: number, overdue: number) =>
    n + (n === 1 ? ' incidencia abierta' : ' incidencias abiertas') +
    (overdue ? ', ' + overdue + ' fuera de fecha' : ''),
  glitchAsk: 'Con una nota corta de cómo va cada una es suficiente. Si algo espera una pieza o al propietario, avisen y lo empujamos nosotros.',
  divider: '— — —',
}

/** Spanish lead-in for a late-cleans message. Returns '' when bilingual is off. */
export function lateCleansSpanish(area: string, items: LateCleanItem[], on?: boolean): string {
  if (!on) return ''
  const arr = items.filter(i => i.arrivingAt).length
  const un = items.filter(i => !i.assignee).length
  return nl([
    ES.behindHead(area),
    ES.behindCount(items.length, arr) + '.',
    ES.behindAsk(un),
    ES.behindThanks,
    '',
    ES.divider,
    '',
  ])
}

/** Spanish lead-in for a glitches message. Returns '' when bilingual is off. */
export function glitchesSpanish(area: string, items: GlitchItem[], on?: boolean): string {
  if (!on) return ''
  const overdue = items.filter(i => i.overdue).length
  return nl([
    ES.glitchHead(area),
    ES.glitchCount(items.length, overdue) + '.',
    ES.glitchAsk,
    '',
    ES.divider,
    '',
  ])
}

// ── Repeat offenders ───────────────────────────────────────────────────────────────────────────

export type RepeatItem = {
  unit: string
  category: string
  count: number
  closedBefore: number
  firstSeen: string
  lastSeen: string
  latestIssue: string
}

/**
 * The point of this message is the WORD "again". It is not a nag at whoever did the repair — it is
 * a flag that the fix is not holding and the next visit should look deeper.
 */
export function repeatOffendersMessage(opts: {
  items: RepeatItem[]
  audience: string[]
  windowDays: number
}): { body: string; summary: string } {
  const { items, audience, windowDays } = opts
  const rows = items.slice(0, 10).map(i =>
    '• *' + i.unit + '* — ' + i.category + '\n   ' + i.count + ' tickets in ' + windowDays +
    ' days, ' + i.closedBefore + ' already closed as fixed  ·  latest: ' + i.latestIssue.slice(0, 70))
  if (items.length > 10) rows.push('• …and ' + (items.length - 10) + ' more')

  const body = nl([
    '🔁 *Coming back again*',
    plural(items.length, 'One unit has', items.length + ' units have') +
      ' had the same problem reported more than once in ' + windowDays + ' days, after it was closed as fixed.',
    '',
    rows.join('\n'),
    '',
    'Nothing wrong with the work — it just means the root cause is probably still there. Worth a longer look on the next visit rather than another quick fix.',
    ccLine(audience),
  ])
  const summary = items.length + ' repeat ' + plural(items.length, 'issue', 'issues') + ' — ' +
    items.slice(0, 3).map(i => i.unit).join(', ')
  return { body, summary }
}

// ── Door codes ─────────────────────────────────────────────────────────────────────────────────

export function codeProblemsMessage(opts: {
  duplicates: { code: string; units: string[] }[]
  audience: string[]
}): { body: string; summary: string } {
  const { duplicates, audience } = opts
  const body = nl([
    '🔑 *Same door code on two units*',
    'Both have a guest arriving — worth changing one before check-in.',
    '',
    duplicates.map(d => '• `' + d.code + '` — ' + d.units.join(' and ')).join('\n'),
    '',
    'Easy to change now, awkward to explain once the wrong guest opens the wrong door.',
    ccLine(audience),
  ])
  const summary = duplicates.length + ' duplicate door code' + (duplicates.length === 1 ? '' : 's')
  return { body, summary }
}

// ── Booked into a blocked unit ─────────────────────────────────────────────────────────────────

export type BlockedArrivalItem = {
  unit: string
  checkIn: string
  daysAway: number
  reason: string
  openEnded: boolean
  blockedTo: string
}

export function blockedArrivalsMessage(opts: {
  items: BlockedArrivalItem[]
  audience: string[]
}): { body: string; summary: string } {
  const { items, audience } = opts
  const rows = items.map(i => {
    const when = i.daysAway <= 0 ? 'arriving TODAY' : i.daysAway === 1 ? 'arriving tomorrow' : 'arriving in ' + i.daysAway + ' days'
    const until = i.openEnded ? 'no end date set' : 'blocked to ' + i.blockedTo
    return '• *' + i.unit + '* — ' + when + ' (' + i.checkIn + ')\n   ' + i.reason + ' · ' + until
  })

  const body = nl([
    '🚨 *Guest booked into a unit that is out of service*',
    'Better to catch these now than at the door.',
    '',
    rows.join('\n'),
    '',
    'Either the unit needs to be ready in time, or the guest needs moving. Whoever picks it up, drop a note here so we do not both chase it.',
    ccLine(audience),
  ])
  const summary = items.length + ' arrival' + (items.length === 1 ? '' : 's') + ' into blocked ' +
    plural(items.length, 'unit', 'units') + ' — ' + items.slice(0, 3).map(i => i.unit).join(', ')
  return { body, summary }
}

// ── Short market brief ─────────────────────────────────────────────────────────────────────────

export type MarketLine = {
  market: string
  cleans: number
  arrivals: number
  blocked: { unit: string; at: string | null; note?: string }[]
  lateWithArrival: { unit: string; at: string | null }[]
  lateNoArrival: { unit: string; at: string | null }[]
  unassigned: { unit: string; at: string | null }[]
  overdue: { unit: string; at: string | null; note?: string }[]
}

/** "Elser 2103, Arya 1705/2 and 3 more" — names first, count only for the tail. */
function namedList(items: { unit: string }[], cap = 4): string {
  const names = items.map(i => i.unit)
  if (names.length <= cap) return humanList(names)
  return names.slice(0, cap).join(', ') + ' and ' + (names.length - cap) + ' more'
}

/**
 * Jon: "short and to the point, top priorities per market."
 *
 * The first version obeyed "short" and nothing else — it posted a bare
 * *"1 guest booked into a unit that is out of service"* with no unit, no time, no name. Jon: "so
 * bad... no clarity or detail." Fair. A count nobody can act on is worse than silence, because it
 * makes someone go and look it up.
 *
 * The bar is the humans already in that channel. Hasan writes: "The 1418/2 guest denied PTE. He is
 * saying he does not want anyone to enter the unit and we can take care of it on Friday when they
 * check out." Unit, problem, reason, plan. So: every line NAMES ITS UNITS and gives the time that
 * makes it urgent, every market appears (a missing market reads as a broken report), and the day's
 * shape sits next to the problems so the numbers mean something.
 */
export function marketBriefMessage(opts: {
  markets: MarketLine[]
  date: string
  audience: string[]
  boardUrl?: string
}): { body: string; summary: string } {
  const { markets, date, audience, boardUrl } = opts

  const pretty = (() => {
    try {
      return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
      })
    } catch { return date }
  })()

  const blocks = markets.map(m => {
    const shape = (m.cleans || m.arrivals)
      ? '  ·  ' + m.cleans + ' ' + plural(m.cleans, 'clean', 'cleans') + ' · ' + m.arrivals + ' ' + plural(m.arrivals, 'arrival', 'arrivals')
      : ''
    const head = '*' + m.market + '*' + shape

    const lines: string[] = []

    // Most urgent first: a guest walking into a dead unit beats everything else on the board.
    for (const b of m.blocked.slice(0, 4)) {
      lines.push('🚨 *' + b.unit + '* — guest arrives ' + (b.at || 'soon') +
        ', unit is out of service' + (b.note ? ' (' + b.note + ')' : ''))
    }
    for (const l of m.lateWithArrival.slice(0, 5)) {
      lines.push('⏰ *' + l.unit + '* — clean not started, guest arrives ' + (l.at || 'today'))
    }
    if (m.lateWithArrival.length > 5) {
      lines.push('⏰ …and ' + (m.lateWithArrival.length - 5) + ' more cleans with arrivals today')
    }
    if (m.unassigned.length) {
      lines.push('👤 No cleaner assigned yet — ' + namedList(m.unassigned))
    }
    if (m.overdue.length) {
      const o = m.overdue[0]
      lines.push('🔧 ' + m.overdue.length + ' ' + plural(m.overdue.length, 'issue', 'issues') +
        ' past date — e.g. *' + o.unit + '*' + (o.note ? ': ' + o.note : ''))
    }
    // Only worth saying when there is nothing more urgent above it.
    if (!lines.length && m.lateNoArrival.length) {
      lines.push('• ' + m.lateNoArrival.length + ' ' + plural(m.lateNoArrival.length, 'clean', 'cleans') +
        ' still to start, no arrivals waiting — ' + namedList(m.lateNoArrival))
    }

    if (!lines.length) return head + '\n   all clear ✅'
    return head + '\n' + lines.map(l => '   ' + l).join('\n')
  })

  const busy = markets.filter(m =>
    m.blocked.length || m.lateWithArrival.length || m.unassigned.length || m.overdue.length).length

  const body = nl([
    '📌 *Top priorities — ' + pretty + '*',
    '',
    blocks.join('\n\n'),
    '',
    busy
      ? 'Anything not listed is running fine. Reply here if you are already on one of these so we do not double up.'
      : 'Nothing outstanding anywhere — good day to get ahead of the upkeep work.',
    boardUrl ? '<' + boardUrl + '|Open Today in Ops>' : null,
    ccLine(audience),
  ])

  const summary = busy
    ? busy + ' ' + plural(busy, 'market', 'markets') + ' need attention'
    : 'all markets clear'
  return { body, summary }
}

// ── Nightly handover (leadership) ──────────────────────────────────────────────────────────────

export type HandoverAreaLine = {
  area: string
  cleans: number
  arrivals: number
  departures: number
  sameDayTurns: number
  openIssues: number
}

/**
 * The draft of what Karla writes by hand every night. Explicitly framed as a DRAFT, because Jon
 * asked for it to go to leadership so they "can then edit it as needed" — it is a starting point,
 * not a published report, and saying so stops anyone treating it as final.
 */
export function handoverMessage(opts: {
  date: string
  areas: HandoverAreaLine[]
  audience: string[]
}): { body: string; summary: string } {
  const { date, areas, audience } = opts
  const busiest = areas.slice().sort((a, b) => (b.cleans + b.arrivals) - (a.cleans + a.arrivals))[0]
  const totals = areas.reduce((acc, a) => ({
    cleans: acc.cleans + a.cleans,
    arrivals: acc.arrivals + a.arrivals,
    departures: acc.departures + a.departures,
    turns: acc.turns + a.sameDayTurns,
  }), { cleans: 0, arrivals: 0, departures: 0, turns: 0 })

  const rows = areas
    .filter(a => a.cleans || a.arrivals || a.departures)
    .map(a => {
      const bits = [
        a.cleans ? a.cleans + ' ' + plural(a.cleans, 'clean', 'cleans') : null,
        a.arrivals ? a.arrivals + ' in' : null,
        a.departures ? a.departures + ' out' : null,
        a.sameDayTurns ? a.sameDayTurns + ' same-day ' + plural(a.sameDayTurns, 'turn', 'turns') : null,
        a.openIssues ? a.openIssues + ' open ' + plural(a.openIssues, 'issue', 'issues') : null,
      ].filter(Boolean)
      return '• *' + a.area + '* — ' + bits.join(' · ')
    })

  const body = nl([
    '🌙 *Highlights for tomorrow — ' + date + '*',
    '_Draft from Lighthouse. Edit anything that needs it before it goes out._',
    '',
    totals.cleans + ' ' + plural(totals.cleans, 'clean', 'cleans') + ', ' + totals.arrivals + ' ' +
      plural(totals.arrivals, 'arrival', 'arrivals') + ', ' + totals.departures + ' ' +
      plural(totals.departures, 'departure', 'departures') +
      (totals.turns ? ', ' + totals.turns + ' same-day ' + plural(totals.turns, 'turn', 'turns') : '') + '.',
    busiest && (busiest.cleans + busiest.arrivals) > 0 ? 'Heaviest area is *' + busiest.area + '*.' : null,
    '',
    rows.join('\n'),
    '',
    'Anything to add before this goes to the team?',
    ccLine(audience),
  ])
  const summary = 'Handover draft for ' + date + ' — ' + totals.cleans + ' cleans, ' + totals.arrivals + ' arrivals'
  return { body, summary }
}

// ── Walk-in risk ───────────────────────────────────────────────────────────────────────────────

export type WalkInItem = {
  unit: string
  at: string | null
  problems: string[]
  unassigned: boolean
}

/**
 * Jon: "Anything that it catches throughout the day that might be urgent or to prevent a walkin,
 * it should state."
 *
 * The only message in this system that leads with the consequence rather than the situation,
 * because the consequence IS the point: a guest is going to turn up and not get in. Named unit,
 * arrival time, exactly what is wrong, and one clear ask.
 */
export function walkInRiskMessage(opts: {
  items: WalkInItem[]
  audience: string[]
  here?: boolean
}): { body: string; summary: string } {
  const { items, audience, here } = opts

  const rows = items.map(i => {
    const when = i.at ? ' — guest arrives *' + i.at + '*' : ' — guest arrives today'
    const why = i.problems.map(p => '      ↳ ' + p).join('\n')
    return '• *' + i.unit + '*' + when + '\n' + why
  })

  const soonest = items.find(i => i.at)
  const body = nl([
    '⚠️ *Could be a walk-in tonight*',
    plural(items.length, 'One unit', items.length + ' units') + ' with a guest arriving today ' +
      plural(items.length, 'has', 'have') + ' something in the way' +
      (soonest && soonest.at ? ' — earliest arrival ' + soonest.at : '') + '.',
    '',
    rows.join('\n'),
    '',
    'If you are already on one of these, say so here so we do not double up. If one cannot be fixed in time, flag it now while there is still room to move the guest.',
    ccLine(audience, here),
  ])

  const summary = items.length + ' possible walk-in' + (items.length === 1 ? '' : 's') + ' — ' +
    items.slice(0, 3).map(i => i.unit).join(', ')
  return { body, summary }
}

// ── The 3pm readiness check ────────────────────────────────────────────────────────────────────

export type ReadinessItem = {
  unit: string
  at: string | null
  status: 'done' | 'in progress' | 'not started' | 'no clean scheduled'
  assignees: string[]
  startedAt: string | null
}

/**
 * Jon, 2026-08-19: "it should just be based on status cleans at 3pm to make sure units are ready
 * at 4pm."
 *
 * So this is a readiness scoreboard, not a nag: ready count first, then only the units that still
 * need something, each with who is on it and when the guest lands. If everything is done it says
 * so in one line — that is worth sending, because "all ready" at 3pm is the news.
 */
export function readinessMessage(opts: {
  area: string
  items: ReadinessItem[]
  audience: string[]
  here?: boolean
  spanish?: boolean
}): { body: string; summary: string } {
  const { area, items, audience, here, spanish } = opts
  const done = items.filter(i => i.status === 'done')
  const notStarted = items.filter(i => i.status === 'not started')
  const inProgress = items.filter(i => i.status === 'in progress')
  const noClean = items.filter(i => i.status === 'no clean scheduled')

  const who = (i: ReadinessItem) => i.assignees.length ? i.assignees.join(', ') : '_nobody assigned_'
  const when = (i: ReadinessItem) => i.at ? 'guest ' + i.at : 'guest today'

  const lines: string[] = []
  if (notStarted.length) {
    lines.push('*Not started (' + notStarted.length + ')*')
    for (const i of notStarted.slice(0, 10)) lines.push('• *' + i.unit + '* — ' + when(i) + ' · ' + who(i))
    if (notStarted.length > 10) lines.push('• …and ' + (notStarted.length - 10) + ' more')
  }
  if (inProgress.length) {
    if (lines.length) lines.push('')
    lines.push('*In progress (' + inProgress.length + ')*')
    for (const i of inProgress.slice(0, 8)) {
      lines.push('• *' + i.unit + '* — ' + when(i) + ' · ' + who(i) + (i.startedAt ? ' · started ' + i.startedAt : ''))
    }
  }
  if (noClean.length) {
    if (lines.length) lines.push('')
    lines.push('*No clean on the board (' + noClean.length + ')* — worth a check')
    lines.push('• ' + noClean.slice(0, 8).map(i => i.unit).join(', '))
  }

  const allReady = !notStarted.length && !inProgress.length && !noClean.length
  const es = spanish
    ? nl([
        '🕒 *' + area + '* — revisión de las 3pm',
        allReady
          ? 'Las ' + done.length + ' unidades con llegada hoy están listas. Gracias 🙏'
          : done.length + ' de ' + items.length + ' listas. Quedan ' + (notStarted.length + inProgress.length) + ' antes de las 4pm.',
        '',
        '— — —',
        '',
      ])
    : ''

  const en = nl([
    '🕒 *' + area + ' — 3pm check*',
    allReady
      ? 'All ' + done.length + ' ' + plural(done.length, 'unit', 'units') + ' with a guest today ' +
        plural(done.length, 'is', 'are') + ' ready. Nice work 🙏'
      : '*' + done.length + ' of ' + items.length + ' ready* for 4pm. ' +
        (notStarted.length + inProgress.length) + ' still to finish.',
    lines.length ? '' : null,
    lines.length ? lines.join('\n') : null,
    lines.length ? '' : null,
    allReady ? null : 'An hour to go. If any of these will not make 4pm, say so now and we will warn the guest or move them.',
    ccLine(audience, here),
  ])

  const summary = area + ' 3pm — ' + done.length + '/' + items.length + ' ready' +
    (notStarted.length ? ', ' + notStarted.length + ' not started' : '')
  return { body: es + en, summary }
}

// ── Hours, for leadership ──────────────────────────────────────────────────────────────────────

export type LaborItem = { name: string; hours: number; since?: string | null }

/**
 * Jon, 2026-08-19: "sending a message in leadership chat sharing hours, not clocked in, over
 * hours, ect."
 *
 * Facts, in the order a manager reads them: what today has cost, who never showed, who is running
 * long, and whose card from an earlier day was never closed.
 */
export function laborMessage(opts: {
  date: string
  totalHours: number
  clockedInNow: LaborItem[]
  overHours: LaborItem[]
  notClockedIn: { name: string; shift: string }[]
  missedClockOut: LaborItem[]
  threshold: number
  audience: string[]
}): { body: string; summary: string } {
  const { date, totalHours, clockedInNow, overHours, notClockedIn, missedClockOut, threshold, audience } = opts

  const pretty = (() => {
    try {
      return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
      })
    } catch { return date }
  })()

  const sections: string[] = []

  sections.push('*On the clock now:* ' + clockedInNow.length +
    '   ·   *Hours today so far:* ' + totalHours.toFixed(1) + 'h')

  if (notClockedIn.length) {
    sections.push('*Scheduled, no punch (' + notClockedIn.length + ')*\n' +
      notClockedIn.slice(0, 10).map(n => '• ' + n.name + (n.shift ? ' — ' + n.shift : '')).join('\n') +
      (notClockedIn.length > 10 ? '\n• …and ' + (notClockedIn.length - 10) + ' more' : ''))
  }

  if (overHours.length) {
    sections.push('*Over ' + threshold + 'h (' + overHours.length + ')*\n' +
      overHours.map(o => '• ' + o.name + ' — *' + o.hours.toFixed(1) + 'h*' + (o.since ? ' since ' + o.since : '')).join('\n'))
  }

  if (missedClockOut.length) {
    sections.push('*Never clocked out (earlier day)*\n' +
      missedClockOut.slice(0, 8).map(m => '• ' + m.name + ' — ' + m.hours.toFixed(1) + 'h open').join('\n'))
  }

  const clean = !notClockedIn.length && !overHours.length && !missedClockOut.length

  const body = nl([
    '👥 *Hours — ' + pretty + '*',
    '',
    sections.join('\n\n'),
    '',
    clean
      ? 'Everyone scheduled is on the clock and nobody is running long.'
      : 'Worth a look at the names above before the day closes out.',
    ccLine(audience),
  ])

  const summary = 'Hours — ' + totalHours.toFixed(1) + 'h, ' + clockedInNow.length + ' on the clock' +
    (notClockedIn.length ? ', ' + notClockedIn.length + ' no punch' : '') +
    (overHours.length ? ', ' + overHours.length + ' over ' + threshold + 'h' : '')
  return { body, summary }
}

// ── Owner stays & big bookings ─────────────────────────────────────────────────────────────────

export type NotableItem = {
  unit: string
  guest: string
  checkIn: string
  daysAway: number
  nights: number | null
  value: number | null
  kind: 'owner' | 'big' | 'long'
}

const money = (n: number | null): string =>
  n == null ? '' : '$' + Math.round(n).toLocaleString('en-US')

/**
 * Jon, 2026-08-19: "It should also send updates for owner stays, big bookings, etc."
 *
 * A heads-up, not a task list — so it names who is coming, when, and why it is worth extra care,
 * and asks for nothing. The point is that nobody finds out an owner is arriving on the day.
 */
export function notableArrivalsMessage(opts: {
  items: NotableItem[]
  audience: string[]
  days: number
}): { body: string; summary: string } {
  const { items, audience, days } = opts
  const owners = items.filter(i => i.kind === 'owner')
  const big = items.filter(i => i.kind === 'big')
  const long = items.filter(i => i.kind === 'long')

  const whenOf = (i: NotableItem) =>
    i.daysAway <= 0 ? 'today' : i.daysAway === 1 ? 'tomorrow' : 'in ' + i.daysAway + ' days (' + i.checkIn + ')'

  const sections: string[] = []
  if (owners.length) {
    sections.push('*Owner stays (' + owners.length + ')*\n' + owners.map(i =>
      '• *' + i.unit + '* — ' + i.guest + ', ' + whenOf(i) +
      (i.nights ? ' · ' + i.nights + ' ' + plural(i.nights, 'night', 'nights') : '')).join('\n'))
  }
  if (big.length) {
    sections.push('*Big bookings (' + big.length + ')*\n' + big.map(i =>
      '• *' + i.unit + '* — ' + i.guest + ', ' + whenOf(i) +
      (i.value ? ' · ' + money(i.value) : '') +
      (i.nights ? ' · ' + i.nights + ' ' + plural(i.nights, 'night', 'nights') : '')).join('\n'))
  }
  if (long.length) {
    sections.push('*Long stays (' + long.length + ')*\n' + long.map(i =>
      '• *' + i.unit + '* — ' + i.guest + ', ' + whenOf(i) +
      (i.nights ? ' · ' + i.nights + ' nights' : '')).join('\n'))
  }

  const body = nl([
    '⭐ *Worth knowing — next ' + days + ' days*',
    '',
    sections.join('\n\n'),
    '',
    'Nothing to action right now — just so nobody finds out on the day. Extra attention on the clean and the welcome for these.',
    ccLine(audience),
  ])

  const bits: string[] = []
  if (owners.length) bits.push(owners.length + ' owner')
  if (big.length) bits.push(big.length + ' big')
  if (long.length) bits.push(long.length + ' long')
  return { body, summary: 'Worth knowing — ' + bits.join(', ') }
}
