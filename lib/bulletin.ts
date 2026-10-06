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
  /** photos on the post (public URLs from the uploader), up to MAX_PHOTOS */
  photos?: string[]
  /** how each photo sits in the slide's frame, same order as photos */
  frames?: Frame[]
  reactions?: Record<string, string[]>   // emoji → emails
  replies?: Reply[]
}
/** birthdays: name → 'MM-DD' (no year — nobody's age lives here). */
export type Board = { posts: Post[]; birthdays?: Record<string, string> }

export const MAX_POSTS = 120
export const MAX_REPLIES = 40
export const MAX_PHOTOS = 4
/** PHOTO FRAMING (Jon, 2026-10-06: "need to be able to be cropped or fitted better").
 *  fill = crop to fill the box, positioned at x/y % and zoomed z×; fit = the whole photo, letterboxed
 *  over a blurred copy of itself. */
export type Frame = { fit: 'fill' | 'fit'; x: number; y: number; z: number }
export const DEFAULT_FRAME: Frame = { fit: 'fill', x: 50, y: 50, z: 1 }
export function cleanFrame(v: any): Frame {
  const n = (x: any, lo: number, hi: number, d: number) => { const k = Number(x); return Number.isFinite(k) ? Math.max(lo, Math.min(hi, Math.round(k * 100) / 100)) : d }
  return { fit: v?.fit === 'fit' ? 'fit' : 'fill', x: n(v?.x, 0, 100, 50), y: n(v?.y, 0, 100, 50), z: n(v?.z, 1, 3, 1) }
}
/** One frame per photo (missing ones get the default). */
export function cleanFrames(v: any, count: number): Frame[] {
  const a = Array.isArray(v) ? v : []
  return Array.from({ length: count }, (_, i) => cleanFrame(a[i]))
}
/** Only https URLs, deduped, at most MAX_PHOTOS. */
export function cleanPhotos(v: any): string[] {
  const out: string[] = []
  for (const u of Array.isArray(v) ? v : []) { const s = String(u || '').trim(); if (/^https:\/\/\S+$/.test(s) && s.length < 600 && !out.includes(s)) out.push(s) }
  return out.slice(0, MAX_PHOTOS)
}

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
  const photos = cleanPhotos(input?.photos)
  if (!title && !body && !review && !photos.length) return null
  const exp = input?.expires === null ? null : ymd(input?.expires) || defaultExpiry(kind, today)
  return {
    id, kind, title, body, by: clip(author.name, 60) || 'A leader', byEmail: author.email, at: nowIso,
    pinned: !!input?.pinned, expires: exp,
    due: kind === 'reminder' ? ymd(input?.due) : null,
    owner: kind === 'reminder' ? clip(input?.owner, 60) || null : null,
    review, photos, frames: cleanFrames(input?.frames, photos.length), reactions: {}, replies: [],
  }
}

/** Fields a leader may change after posting. */
export function editPost(p: Post, input: any): Post {
  const out = { ...p }
  if (input?.title != null) out.title = clip(input.title, 120)
  if (input?.body != null) out.body = String(input.body).trim().slice(0, 1500)
  if (input?.pinned != null) out.pinned = !!input.pinned
  if (input?.photos !== undefined) out.photos = cleanPhotos(input.photos)
  if (input?.photos !== undefined || input?.frames !== undefined) out.frames = cleanFrames(input?.frames !== undefined ? input.frames : out.frames, (out.photos || []).length)
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

// ── BIRTHDAYS (Jon, 2026-10-06: "if it knows people's birthday it should populate it") ───────────
/** 'YYYY-MM-DD' or 'MM-DD' or 'M/D' → 'MM-DD'; null when it isn't a date. */
export function monthDay(v: any): string | null {
  const s = String(v || '').trim()
  let m = s.match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})(?:T.*)?$/) || s.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/)
  if (!m) return null
  const mo = Number(m[1]), d = Number(m[2])
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null
  return pad(mo) + '-' + pad(d)
}
export type Celebration = { name: string; md: string; inDays: number }
/** Birthdays from today through `days` ahead, soonest first. Feb 29 is celebrated on Feb 28 off leap years. */
export function upcomingBirthdays(map: Record<string, string>, today: string, days = 6): Celebration[] {
  const out: Celebration[] = []
  for (let k = 0; k <= days; k++) {
    const day = addDays(today, k)
    const y = Number(day.slice(0, 4)), md = day.slice(5)
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    for (const [name, raw] of Object.entries(map || {})) {
      const b = monthDay(raw)
      if (!b) continue
      if (b === md || (!leap && b === '02-29' && md === '02-28')) out.push({ name, md: b, inDays: k })
    }
  }
  return out
}

// ── QUOTE OF THE DAY — the fallback when the daily quote service can't be reached ─────────────────
// Short, attributed, on work, service and teams. Picked by day of year so everyone sees the same one.
export const QUOTES: { q: string; a: string }[] = [
  { q: 'Well done is better than well said.', a: 'Benjamin Franklin' },
  { q: 'Quality is not an act, it is a habit.', a: 'Will Durant' },
  { q: 'The secret of getting ahead is getting started.', a: 'Mark Twain' },
  { q: 'Coming together is a beginning; keeping together is progress; working together is success.', a: 'Edward Everett Hale' },
  { q: 'Do what you can, with what you have, where you are.', a: 'Theodore Roosevelt' },
  { q: 'It is not enough to be busy. The question is: what are we busy about?', a: 'Henry David Thoreau' },
  { q: 'The best way out is always through.', a: 'Robert Frost' },
  { q: 'Little things make big things happen.', a: 'John Wooden' },
  { q: 'Alone we can do so little; together we can do so much.', a: 'Helen Keller' },
  { q: 'Whatever you are, be a good one.', a: 'Abraham Lincoln' },
  { q: 'Energy and persistence conquer all things.', a: 'Benjamin Franklin' },
  { q: 'Act as if what you do makes a difference. It does.', a: 'William James' },
  { q: 'He that is good for making excuses is seldom good for anything else.', a: 'Benjamin Franklin' },
  { q: 'Nothing will work unless you do.', a: 'Maya Angelou' },
  { q: 'Courtesy is the one coin you can never have too much of.', a: 'Arthur Helps' },
  { q: 'The way to get started is to quit talking and begin doing.', a: 'Walt Disney' },
  { q: 'Hospitality is making your guests feel at home, even if you wish they were.', a: 'Unknown' },
  { q: 'Excellence is never an accident.', a: 'Aristotle' },
  { q: 'Don’t watch the clock; do what it does. Keep going.', a: 'Sam Levenson' },
  { q: 'The details are not the details. They make the design.', a: 'Charles Eames' },
  { q: 'Plans are nothing; planning is everything.', a: 'Dwight D. Eisenhower' },
  { q: 'Do the hard jobs first. The easy jobs will take care of themselves.', a: 'Dale Carnegie' },
  { q: 'Talent wins games, but teamwork wins championships.', a: 'Michael Jordan' },
  { q: 'What gets measured gets managed.', a: 'Peter Drucker' },
  { q: 'People will forget what you said, but never how you made them feel.', a: 'Maya Angelou' },
  { q: 'Make each day your masterpiece.', a: 'John Wooden' },
  { q: 'Start where you are. Use what you have. Do what you can.', a: 'Arthur Ashe' },
  { q: 'Done is better than perfect.', a: 'Sheryl Sandberg' },
  { q: 'Small deeds done are better than great deeds planned.', a: 'Peter Marshall' },
  { q: 'If you take care of your people, they will take care of your guests.', a: 'J. W. Marriott' },
  { q: 'Whatever you do, do it well.', a: 'Walt Disney' },
]
export function fallbackQuote(today: string): { q: string; a: string } {
  const doy = Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(today.slice(0, 4) + '-01-01T12:00:00Z')) / 86400000)
  return QUOTES[((doy % QUOTES.length) + QUOTES.length) % QUOTES.length]
}
