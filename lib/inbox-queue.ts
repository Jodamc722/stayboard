// THE GUEST INBOX AS A QUEUE (inbox audit, 2026-11-09).
//
// Two things the list and the server must agree on, so they live in one file with no server code:
//
//   1. WHAT A PERSON DID TO A THREAD. "No reply needed", "snooze" and "this one is mine / hand it
//      to Karla" are shared between agents (lib/inbox-state stores them). A mark is tied to the
//      GUEST'S newest message at the moment it was made (markTime): the guest writing again wakes
//      a snoozed thread and reopens a handled one on its own, while a Guesty template firing on the
//      thread does not. Nobody has to remember to un-snooze, and a "thanks!" marked handled cannot
//      hide the next question.
//
//   2. THE ORDER OF THE NEEDS-REPLY QUEUE (Jon: "guest waiting longest first, in-house and
//      arriving-today guests above future stays, unhappy above neutral, past the hour flagged").
//      Rank is: where the guest is in their stay → unhappy before the rest → waiting longest first.
//      Past the reply-by time is a flag on the row (the rose "Late" tag and the header count), not
//      a reason to lift a booking for next month over a guest standing at the door.

/** What a person did to one thread. Keys are the list's own: 'g:<conversation id>' | 'p:<digits>'. */
export type ThreadState = {
  /** Handled without a reply: the thread's last-message time when it was marked. */
  done?: string | null
  doneBy?: string | null
  /** Hidden from the queue until this time… */
  snoozeUntil?: string | null
  /** …unless the thread moves past this (its last-message time when it was snoozed). */
  snoozeAt?: string | null
  snoozeBy?: string | null
  /** Whose thread it is (email) and the name to show. */
  assignee?: string | null
  assigneeName?: string | null
  /** ARCHIVED (2026-11-12): out of every list but Archived until the guest writes again — the thread's mark time. */
  archived?: string | null
  archivedBy?: string | null
  /** Last change — entries untouched for two weeks are dropped (archived ones keep 60 days). */
  at: string
}
export type InboxStateMap = Record<string, ThreadState>

const ms = (iso: string | null | undefined): number => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : NaN }

/**
 * The time a mark is measured against: the guest's last message when we know it (a waiting Guesty
 * thread), else the thread's newest message. Everyone — the list, the pane, the server's header
 * count — must pass the same one.
 */
export function markTime(itemAt: string | null | undefined, lastGuest?: string | null): string {
  return String(lastGuest || itemAt || '')
}

/** Is this thread handled / snoozed RIGHT NOW, given its markTime? */
export function effectiveState(st: ThreadState | undefined | null, itemAt: string, now: number): { done: boolean; snoozed: boolean; archived: boolean; snoozeUntil: string | null; assignee: string; assigneeName: string } {
  const none = { done: false, snoozed: false, archived: false, snoozeUntil: null as string | null, assignee: '', assigneeName: '' }
  if (!st) return none
  const at = ms(itemAt)
  // A thread with no readable time cannot have moved: the mark holds.
  const notMovedSince = (mark: string | null | undefined) => { const m = ms(mark); return Number.isFinite(m) && (!Number.isFinite(at) || at <= m) }
  // Archived is handled too: it leaves Needs reply as well as the lists.
  const archived = !!st.archived && notMovedSince(st.archived)
  const done = archived || (!!st.done && notMovedSince(st.done))
  const until = ms(st.snoozeUntil)
  const snoozed = !done && Number.isFinite(until) && until > now && notMovedSince(st.snoozeAt)
  return { done, snoozed, archived, snoozeUntil: snoozed ? String(st.snoozeUntil) : null, assignee: String(st.assignee || ''), assigneeName: String(st.assigneeName || st.assignee || '') }
}

/** Where a guest is in their stay — what the row's tag says and what the queue ranks on. */
export type StayPhase = 'arriving' | 'inhouse' | 'departing' | 'soon' | 'future' | 'inquiry' | 'past' | 'canceled' | 'none'

/** `today` is the ET calendar date, YYYY-MM-DD. */
export function stayPhase(stay: { checkIn: string | null; checkOut: string | null; status: string | null } | null | undefined, today: string): StayPhase {
  if (!stay || !stay.checkIn) return 'none'
  const st = String(stay.status || '').toLowerCase()
  if (/cancel|declin|expired/.test(st)) return 'canceled'
  if (/inquir/.test(st)) return 'inquiry'
  if (stay.checkIn === today) return 'arriving'
  if (stay.checkOut === today) return 'departing'
  if (stay.checkIn < today && (!stay.checkOut || stay.checkOut > today)) return 'inhouse'
  if (stay.checkIn > today) {
    const days = Math.round((Date.parse(stay.checkIn + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400_000)
    return days <= 2 ? 'soon' : 'future'
  }
  return 'past'
}

/** Lower is sooner. Here now → here within two days → coming later or still deciding → gone / no booking. */
export function phaseTier(p: StayPhase): number {
  if (p === 'arriving' || p === 'inhouse' || p === 'departing') return 0
  if (p === 'soon') return 1
  if (p === 'future' || p === 'inquiry') return 2
  return 3
}

export type QueueKey = { tier: number; unhappy: boolean; since: number; at: number }

/** The Needs-reply order: stay tier, unhappy first, longest waiting first, then newest activity. */
export function compareQueue(a: QueueKey, b: QueueKey): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  if (a.unhappy !== b.unhappy) return a.unhappy ? -1 : 1
  const sa = Number.isFinite(a.since) ? a.since : Infinity, sb = Number.isFinite(b.since) ? b.since : Infinity
  if (sa !== sb) return sa < sb ? -1 : 1
  return b.at - a.at
}

/** The ET calendar date of an instant, YYYY-MM-DD. */
export function etDay(now: number): string {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Snooze choices, as the time they end. Evening is 6pm ET today (tomorrow 8am if it is already past 5). */
export function snoozeUntil(choice: '1h' | '3h' | 'evening' | 'tomorrow', now: number): string {
  if (choice === '1h') return new Date(now + 3600_000).toISOString()
  if (choice === '3h') return new Date(now + 3 * 3600_000).toISOString()
  const parts: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))) parts[x.type] = x.value
  const minsNow = (Number(parts.hour) % 24) * 60 + Number(parts.minute)
  // Minutes from now to a wall-clock ET time today (or tomorrow). Good to the minute; a DST change
  // inside the gap moves it an hour, which a snooze can live with.
  const to = (h: number, tomorrow: boolean) => new Date(now + ((tomorrow ? 24 * 60 : 0) + h * 60 - minsNow) * 60_000).toISOString()
  if (choice === 'evening' && minsNow < 17 * 60) return to(18, false)
  return to(8, true)
}
