// THE DAILY CHECKLIST — the parts the server and the browser both need.
//
// Split out of lib/daily-checklist (which is server-only) so the page and the API agree about what
// "late" means and what a time reads like, instead of each keeping its own copy. A checklist whose
// header and rows disagree about whether something is overdue is worse than no checklist.
export const BANDS = ['morning', 'midday', 'afternoon', 'evening'] as const
export type Band = typeof BANDS[number]
export const BAND_LABEL: Record<Band, string> = {
  morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening',
}
/** The buildings are all in one timezone; the checklist runs on their clock, not the server's. */
export const OPS_TZ = 'America/New_York'

/** "14:30:00" or "14:30" → 870 minutes past midnight. Null for anything that is not a time. */
export function minutesOf(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  if (!m) return null
  const h = Number(m[1]), mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h > 23 || mm > 59) return null
  return h * 60 + mm
}

/** "14:30:00" → "2:30 PM". The list is read at a glance, and 24-hour time is not. */
export function clockLabel(t: string | null | undefined): string | null {
  const mins = minutesOf(t)
  if (mins == null) return null
  const h24 = Math.floor(mins / 60), mm = mins % 60
  const h = h24 % 12 || 12
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** The operating day and the minute of it, both on the buildings' clock. */
export function opsNow(at: Date = new Date()): { day: string; minutes: number; clock: string } {
  const day = at.toLocaleDateString('en-CA', { timeZone: OPS_TZ })
  const clock = at.toLocaleTimeString('en-GB', { timeZone: OPS_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return { day, minutes: minutesOf(clock) ?? 0, clock }
}

/**
 * Is this item late?
 *
 * Late means three things at once: it has a time, that time has passed, and nobody has ticked it.
 * An item with no time can never be late — plenty of daily work genuinely just has to happen
 * sometime, and colouring it red at midnight would teach people to ignore red.
 */
export function isLate(byTime: string | null | undefined, done: boolean, nowMinutes: number): boolean {
  if (done) return false
  const due = minutesOf(byTime)
  return due != null && nowMinutes > due
}

/** How the day is going. `next` is the soonest thing still ahead of somebody. */
export function progressOf<T extends { done: boolean; late: boolean; in_minutes: number | null }>(rows: T[]) {
  const total = rows.length
  const done = rows.filter(r => r.done).length
  const late = rows.filter(r => r.late).length
  const next = rows.filter(r => !r.done && r.in_minutes != null && r.in_minutes >= 0)
    .sort((a, b) => (a.in_minutes as number) - (b.in_minutes as number))[0] || null
  return { total, done, late, pct: total ? Math.round((done / total) * 100) : 0, next }
}

// ── SIGNALS: the live number next to an item ────────────────────────────────────────────────────
//
// Jon, 2026-09-16: "Have part of the checklist eve questions" — and the day before: "you could
// click on it, and it'll push you to the tab with the glitches and claims to be managed."
//
// An item may name a `signal`, and the list then carries a count beside it. "Answer one of Eve's
// questions · 45 waiting" is a different instruction from a checkbox with the same words on it,
// because the checkbox makes you go and look before you know whether there is anything to do.
//
// THE WORDING LIVES HERE, next to `isLate`, for the same reason `isLate` does: the page and the
// API must not each keep their own copy. The server owns the NUMBER (lib/checklist-signals, which
// is server-only because it counts rows); this file owns what the number reads like.
//
// AN UNKNOWN KEY IS SILENT, NEVER FATAL. The standing list is edited in the browser, so a manager
// can type a signal this build has never heard of. That item shows no chip and still works.
export type SignalMeta = {
  /** Where the work is actually done — always an in-app path. */
  link: string
  /** What the chip reads, given the count. */
  label: (n: number) => string
  /** What the editor calls it. */
  title: string
}

export const SIGNAL_META: Record<string, SignalMeta> = {
  eve_questions: {
    link: '/command', title: "Eve's open questions",
    label: n => (n > 0 ? `${n} waiting` : 'none waiting'),
  },
  open_glitches: {
    link: '/glitches', title: 'Open glitches',
    label: n => (n > 0 ? `${n} open` : 'all clear'),
  },
  // 2026-10-01 (Jon: "the checklist is built with actionable steps"): the counts the day actually
  // turns on, so an item says how much of it there is before anybody opens a tab.
  arrivals_today: {
    link: '/command', title: 'Arrivals today',
    label: n => (n > 0 ? `${n} arriving` : 'no arrivals'),
  },
  cleans_open_today: {
    link: '/plan', title: 'Departure cleans not finished today',
    label: n => (n > 0 ? `${n} not done` : 'all done'),
  },
  cleans_not_started_today: {
    link: '/plan', title: 'Departure cleans nobody has started today',
    label: n => (n > 0 ? `${n} not started` : 'all started'),
  },
  same_day_turns_open: {
    link: '/plan', title: 'Same-day turns not finished',
    label: n => (n > 0 ? `${n} same-day open` : 'turns done'),
  },
  cleans_unassigned_today: {
    link: '/schedule', title: 'Cleans today with nobody assigned',
    label: n => (n > 0 ? `${n} nobody on it` : 'all assigned'),
  },
  inspections_open_today: {
    link: '/plan', title: 'Inspections not closed today',
    label: n => (n > 0 ? `${n} to walk` : 'all walked'),
  },
  welcome_calls_owed: {
    link: '/welcome-calls', title: 'Welcome calls still owed for today',
    label: n => (n > 0 ? `${n} to call` : 'all called'),
  },
  tomorrow_cleans_unassigned: {
    link: '/schedule', title: "Tomorrow's cleans with nobody assigned",
    label: n => (n > 0 ? `${n} unassigned tomorrow` : 'tomorrow assigned'),
  },
  tomorrow_arrivals: {
    link: '/schedule', title: 'Arrivals tomorrow',
    label: n => (n > 0 ? `${n} arriving tomorrow` : 'none tomorrow'),
  },
  overdue_tasks: {
    link: '/maintenance', title: 'Breezeway tasks past their date',
    label: n => (n > 0 ? `${n} overdue` : 'nothing overdue'),
  },
}

// ── STEPS: an item is a short procedure, not a noun ───────────────────────────────────────────────
// Jon, 2026-10-01: "the checklist is built with actionable steps". The detail field holds them, one
// per line, each starting with "-" (or "•", or "1."). Anything before the first step is the line
// that says what done looks like. Items written before steps existed get a sensible default from
// STEP_GUIDE, matched on the title, so the list reads as procedure from day one.
export function parseDetail(detail: string | null | undefined): { summary: string; steps: string[] } {
  const lines = String(detail || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const steps: string[] = [], rest: string[] = []
  for (const l of lines) {
    const m = /^(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l)
    if (m) steps.push(m[1]); else rest.push(l)
  }
  return { summary: rest.join(' '), steps }
}
export function joinDetail(summary: string, steps: string[]): string {
  return [summary.trim(), ...steps.map(s => s.trim()).filter(Boolean).map(s => '- ' + s)].filter(Boolean).join('\n')
}
/** Default steps for the standing items, by a word or two of the title. Used when an item has none of its own. */
export const STEP_GUIDE: { match: RegExp; steps: string[] }[] = [
  { match: /arrivals? for today|check arrivals/i, steps: ['Open Today and read the arrivals list top to bottom', 'Every arrival has a unit that is clean or has a clean assigned with a time', 'Every arrival has a door code or key plan', 'No arrival has an unanswered message — reply or hand it to the front desk', 'Big or early arrivals are flagged to housekeeping'] },
  { match: /cleaners? (are )?on site|crew on site/i, steps: ['Open the Today board and check who has started in Breezeway', 'Call anyone scheduled who has not started by now', 'Reassign their cleans on the Scheduler if they are not coming', 'Tell the building if a vendor crew is running late'] },
  { match: /overnight guest messages|guest messages/i, steps: ['Open the Inbox sorted oldest first', 'Answer every message from the night — nothing older than an hour stays open', 'Anything that needs a visit becomes a glitch with an owner', 'Unhappy guests get a call, not just a reply'] },
  { match: /glitches/i, steps: ['Open Glitches and sort by oldest', 'Each open card has an owner and a next step written on it', 'Anything waiting on a vendor has a date', 'Close what is resolved; refund decisions go to management today'] },
  { match: /vendors? coming|vendors? today/i, steps: ['List who is coming today and to which building', 'The building or front desk knows the time and has access sorted', 'The task in Breezeway is assigned to the vendor', 'Confirm the arrival by text if nothing is heard by the slot'] },
  { match: /mid-?day clean|clean status/i, steps: ['Open the Today board and look at every departure clean', 'Anything not started has a person and a start time', 'Same-day turns are first in everybody\'s list', 'Call the cleaner on anything that will not land by 4pm and move help to it'] },
  { match: /same-?day turns/i, steps: ['Every same-day turn is finished or has 30 minutes left at most', 'The inspection or photo check is done on each', 'The guest is told the unit is ready, or given an honest new time'] },
  { match: /check-?in readiness|readiness sweep/i, steps: ['Every arrival unit is clean, inspected and the code works', 'Welcome call or message sent to every arrival', 'Parking and building access instructions are in the pre-arrival message', 'Anyone arriving after 8pm has the late-arrival instructions'] },
  { match: /late arrivals/i, steps: ['List arrivals after 8pm', 'Each one has self check-in instructions and a working code', 'The on-call number is in their message', 'Front desk knows who is still to arrive'] },
  { match: /eve'?s questions/i, steps: ['Open Today → Eve asks you', 'Answer at least one question — the answer becomes a rule she follows', 'Dismiss anything that is not a real question'] },
  { match: /tomorrow is staffed|staffed/i, steps: ['Open the Scheduler → Tomorrow at a glance', 'Every departure clean tomorrow has a person on it', 'Nobody marked OFF has work; nobody has more than a day', 'The roster for tomorrow is filled in on the Turnover Schedule', 'Message housekeeping leads with anything that changed'] },
  { match: /close the day|closing/i, steps: ['Every departure clean today is finished in Breezeway', 'Every arrival has checked in or has a plan', 'Open glitches from today have an owner', 'Anything undone on this checklist has a note saying why'] },
]
export function stepsFor(title: string, detail: string | null | undefined): { summary: string; steps: string[]; fromGuide: boolean } {
  const own = parseDetail(detail)
  if (own.steps.length) return { ...own, fromGuide: false }
  const g = STEP_GUIDE.find(x => x.match.test(title))
  return { summary: own.summary, steps: g ? g.steps : [], fromGuide: !!g }
}

/** The roles a person can filter the list to. "Mine" is remembered per browser. */
export const ROLES = ['Front desk', 'Housekeeping', 'Management', 'Maintenance'] as const

export const SIGNAL_KEYS = Object.keys(SIGNAL_META)

/** The chip text for one row, or '' when there is nothing worth printing. */
export function signalLabel(key: string | null | undefined, n: number | null | undefined): string {
  if (!key || n == null) return ''
  const meta = SIGNAL_META[key]
  return meta ? meta.label(n) : ''
}

/** Where a signalled item sends you when it has no link of its own. */
export function signalLink(key: string | null | undefined): string | null {
  return key && SIGNAL_META[key] ? SIGNAL_META[key].link : null
}
