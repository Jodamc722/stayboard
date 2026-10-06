// THE BULLETIN BOARD (Jon, 2026-10-06: "the score board is weird, don't like it, can we get rid of
// it and have more of a notification board, like have to, etc. Maybe a bulletin board where we
// leaders can add something — quote of the day, pending project reminder … make it interactive, we
// can add employee of the month, highlight good reviews, etc").
//
// It replaces the week-KPI Scoreboard strip on Today. Two halves:
//   HAVE TO   what has to happen — leader reminders with a due date (overdue first) plus a few
//             automatic items read from the day the page already loaded (claims due, guests
//             waiting, unowned tasks, overdue glitches). Tick a reminder done in place.
//   BOARD     what leaders post: Employee of the month, Quote of the day, Shout-outs, Announcements,
//             and Good reviews pinned straight from Guesty. Everyone can react and reply.
//
// Pure — no imports — so the route, the page and a test share one set of rules. Stored as one JSON
// value in app_settings ('bulletin_board'): a few dozen posts, no migration to hand-run.

export type PostKind = 'eotm' | 'quote' | 'reminder' | 'announcement' | 'review' | 'shoutout'
export const KINDS: { key: PostKind; label: string; hint: string }[] = [
  { key: 'eotm', label: 'Employee of the month', hint: 'Who, and why in a line' },
  { key: 'quote', label: 'Quote of the day', hint: 'The quote, and who said it' },
  { key: 'reminder', label: 'Reminder / pending project', hint: 'What has to get done, and by when' },
  { key: 'shoutout', label: 'Shout-out', hint: 'Who did something great' },
  { key: 'announcement', label: 'Announcement', hint: 'News for the team' },
  { key: 'review', label: 'Good review', hint: 'Pick a 5★ review to highlight' },
]
export const REACTIONS = ['👏', '❤️', '🔥', '🙌', '😂'] as const

export type ReviewRef = { id: string; unit: string; guest: string; stars: number; channel: string; date: string; text: string }
export type Reply = { id: string; by: string; text: string; at: string }
export type Post = {
  id: string
  kind: PostKind
  title: string            // headline; for eotm/shoutout the person's name
  body: string             // the why / the quote / the details
  by: string               // author's display name
  byEmail: string
  at: string               // ISO created
  pinned?: boolean
  expires?: string | null  // YYYY-MM-DD (ET) — the post comes off the board after this day
  due?: string | null      // reminders: YYYY-MM-DD
  owner?: string | null    // reminders: whose it is
  doneAt?: string | null   // reminders ticked done
  doneBy?: string | null
  review?: ReviewRef | null
  reactions?: Record<string, string[]>   // emoji → emails
  replies?: Reply[]
}
export type Board = { posts: Post[] }

export const MAX_POSTS = 120
export const MAX_REPLIES = 40

const pad = (n: number) => String(n).padStart(2, '0')
/** Today in Miami, YYYY-MM-DD. */
export function etDay(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
}
export function endOfMonth(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
}

/** How long each kind stays up when the leader doesn't say. Reminders stay until done. */
export function defaultExpiry(kind: PostKind, today: string): string | null {
  if (kind === 'quote') return today
  if (kind === 'eotm') return endOfMonth(today)
  if (kind === 'reminder') return null
  if (kind === 'review') return addDays(today, 13)
  return addDays(today, 6)   // shout-outs, announcements: a week
}

/** On the board today: not expired; a done reminder stays one more day (struck through) then goes. */
export function isLive(p: Post, today: string): boolean {
  if (p.expires && p.expires < today) return false
  if (p.kind === 'reminder' && p.doneAt) return etDay(new Date(p.doneAt)) >= addDays(today, -1)
  return true
}

/** Reminder urgency against today. */
export function dueState(p: Post, today: string): 'overdue' | 'today' | 'soon' | 'later' | 'none' | 'done' {
  if (p.doneAt) return 'done'
  if (!p.due) return 'none'
  if (p.due < today) return 'overdue'
  if (p.due === today) return 'today'
  if (p.due <= addDays(today, 3)) return 'soon'
  return 'later'
}

const KIND_ORDER: Record<PostKind, number> = { eotm: 0, quote: 1, shoutout: 2, review: 3, announcement: 4, reminder: 5 }
/** The board: pinned first, then Employee of the month, today's quote, then newest. */
export function boardPosts(posts: Post[], today: string): Post[] {
  const live = posts.filter(p => p.kind !== 'reminder' && isLive(p, today))
  // One Quote of the day: the newest live one.
  const quotes = live.filter(p => p.kind === 'quote').sort((a, b) => b.at.localeCompare(a.at))
  const keep = new Set([...(quotes[0] ? [quotes[0].id] : [])])
  const rows = live.filter(p => p.kind !== 'quote' || keep.has(p.id))
  return rows.sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    || (a.kind === 'eotm' ? 0 : 1) - (b.kind === 'eotm' ? 0 : 1)
    || (a.kind === 'quote' ? 0 : 1) - (b.kind === 'quote' ? 0 : 1)
    || b.at.localeCompare(a.at)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/** Have-to reminders: open ones by urgency (overdue → today → soon → later → no date), done last. */
export function haveToPosts(posts: Post[], today: string): Post[] {
  const rank = { overdue: 0, today: 1, soon: 2, later: 3, none: 4, done: 5 } as const
  return posts.filter(p => p.kind === 'reminder' && isLive(p, today))
    .sort((a, b) => rank[dueState(a, today)] - rank[dueState(b, today)] || String(a.due || '9').localeCompare(String(b.due || '9')) || b.at.localeCompare(a.at))
}

/** Toggle one person's reaction (one of each emoji per person). */
export function toggleReaction(p: Post, emoji: string, email: string): Post {
  if (!(REACTIONS as readonly string[]).includes(emoji) || !email) return p
  const r = { ...(p.reactions || {}) }
  const who = new Set(r[emoji] || [])
  if (who.has(email)) who.delete(email); else who.add(email)
  if (who.size) r[emoji] = Array.from(who); else delete r[emoji]
  return { ...p, reactions: r }
}

const clip = (v: any, n: number) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)
const ymd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null

/** A new post from a leader's form, cleaned and bounded. null = not enough to post. */
export function makePost(input: any, author: { name: string; email: string }, today: string, id: string, nowIso: string): Post | null {
  const kind: PostKind = KINDS.some(k => k.key === input?.kind) ? input.kind : 'announcement'
  const review: ReviewRef | null = kind === 'review' && input?.review && typeof input.review === 'object' ? {
    id: clip(input.review.id, 60), unit: clip(input.review.unit, 80), guest: clip(input.review.guest, 60),
    stars: Math.max(0, Math.min(5, Number(input.review.stars) || 0)), channel: clip(input.review.channel, 30),
    date: clip(input.review.date, 10), text: String(input.review.text || '').trim().slice(0, 1200),
  } : null
  const title = clip(input?.title, 120) || (review ? review.unit : '')
  const body = String(input?.body || '').trim().slice(0, 1500)
  if (!title && !body && !review) return null
  const exp = input?.expires === null ? null : ymd(input?.expires) || defaultExpiry(kind, today)
  return {
    id, kind, title, body, by: clip(author.name, 60) || 'A leader', byEmail: author.email, at: nowIso,
    pinned: !!input?.pinned, expires: exp,
    due: kind === 'reminder' ? ymd(input?.due) : null,
    owner: kind === 'reminder' ? clip(input?.owner, 60) || null : null,
    review, reactions: {}, replies: [],
  }
}

/** Fields a leader may change after posting. */
export function editPost(p: Post, input: any): Post {
  const out = { ...p }
  if (input?.title != null) out.title = clip(input.title, 120)
  if (input?.body != null) out.body = String(input.body).trim().slice(0, 1500)
  if (input?.pinned != null) out.pinned = !!input.pinned
  if (input?.expires !== undefined) out.expires = input.expires === null ? null : ymd(input.expires) || out.expires
  if (p.kind === 'reminder') {
    if (input?.due !== undefined) out.due = ymd(input.due)
    if (input?.owner !== undefined) out.owner = clip(input.owner, 60) || null
  }
  return out
}

/** Drop what's long gone so the stored value stays small: expired 30+ days ago, done 30+ days ago. */
export function prune(posts: Post[], today: string): Post[] {
  const cut = addDays(today, -30)
  return posts.filter(p => !(p.expires && p.expires < cut) && !(p.doneAt && etDay(new Date(p.doneAt)) < cut))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_POSTS)
}
