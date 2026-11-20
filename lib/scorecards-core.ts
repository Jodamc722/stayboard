// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard based on KPI").
//
// THE PURE HALF. lib/scorecards.ts reads the tables; this file holds the rules that turn rows into a
// ranked board, with no imports and no server dependency, so the page, the briefs and the plain-node
// test (lib/__tests__/scorecards.test.mjs) all use the same ones.
//
// THE RULES
//   1. NO RATE WITHOUT A SAMPLE (the codebase's rule, lib/money pctOrCount). A person is ranked on a
//      rate only once there are enough events behind it; under the minimum they are listed, unranked,
//      as "not enough yet (n)". Every rate carries its count.
//   2. A BOARD SAYS WHAT IT RANKS BY, in words (`ranksBy`).
//   3. THE EMAILS SHOW THE TOP ONLY (`topOfBoard`). The full table is on the page for managers; the
//      bottom of a board and the unranked list never go in a brief.
//   4. A TILE THAT COULD NOT BE READ IS NOT A ZERO. It carries `degraded` with the reason.

export type Period = 'yesterday' | 'week'
export type TeamKey = 'admin' | 'ccs' | 'housekeeping' | 'maintenance' | 'inspections' | 'reviews'
export const TEAMS: { key: TeamKey; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'ccs', label: 'Guest support' },
  { key: 'housekeeping', label: 'Housekeeping' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'reviews', label: 'Reviews' },
]

/** Cleans or guest replies behind a person's rate before it is printed. */
export const MIN_RATE_SAMPLE = 10
/** Inspections behind a score, or closes behind a median, before it is printed. */
export const MIN_SCORE_SAMPLE = 5

export type Tile = { key: string; label: string; value: string; sub?: string; href?: string; degraded?: string }
export type Entry = { name: string; value: number | null; sample: number; secondary?: string[] }
export type Row = { rank: number | null; name: string; kpi: string; value: number | null; count: number; secondary: string[] }
export type Leaderboard = {
  /** What the board ranks by, in words. */
  ranksBy: string
  kpiLabel: string
  countLabel: string
  minSample: number
  rows: Row[]
  /** People with too few events for the KPI: listed, never ranked. */
  unranked: Row[]
  note?: string
  degraded?: string
}
export type Scorecard = { team: TeamKey; label: string; completed: Tile[]; leaderboard: Leaderboard; links?: { label: string; href: string }[] }
export type ScorecardPeriod = { key: Period; label: string; from: string; to: string; teams: Record<TeamKey, Scorecard> }
export type Scorecards = { ok: true; day: string; generatedAt: string; yesterday: ScorecardPeriod; week: ScorecardPeriod }

const finite = (n: any): n is number => typeof n === 'number' && Number.isFinite(n)

/** "not enough yet (3)": the one wording for a person under the minimum. */
export const notEnough = (n: number) => `not enough yet (${Math.max(0, Math.round(n))})`

/** A share as a whole percent, or the plain count under the minimum. Never a percent off a handful. */
export function shareOrCount(num: number, den: number, minN = MIN_RATE_SAMPLE): { pct: number | null; n: number; text: string } {
  if (!finite(num) || !finite(den) || den <= 0) return { pct: null, n: 0, text: '—' }
  if (den < minN) return { pct: null, n: den, text: `${Math.round(num)} of ${Math.round(den)}` }
  const pct = Math.round((num / den) * 100)
  return { pct, n: den, text: pct + '%' }
}

export function median(list: number[]): number | null {
  const a = list.filter(finite).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

/**
 * Rank people on one KPI.
 *   ranked    value known AND sample >= minSample, best first; equal values share a rank (1, 1, 3)
 *   unranked  everyone else with anything to show, most events first, KPI "not enough yet (n)"
 * `order` says which direction is better. Ties break on the larger sample, then the name.
 */
export function rankPeople(entries: Entry[], o: { minSample: number; order?: 'desc' | 'asc'; fmt: (v: number, sample: number) => string }): { rows: Row[]; unranked: Row[] } {
  const order = o.order || 'desc'
  const min = Math.max(1, o.minSample)
  const ok = entries.filter(e => finite(e.value) && e.sample >= min)
  const rest = entries.filter(e => !(finite(e.value) && e.sample >= min) && (e.sample > 0 || (e.secondary || []).length > 0))
  ok.sort((a, b) => (order === 'desc' ? (b.value as number) - (a.value as number) : (a.value as number) - (b.value as number)) || b.sample - a.sample || a.name.localeCompare(b.name))
  const rows: Row[] = []
  ok.forEach((e, i) => {
    const prev = rows[i - 1]
    const rank = prev && prev.value === e.value ? (prev.rank as number) : i + 1
    rows.push({ rank, name: e.name, kpi: o.fmt(e.value as number, e.sample), value: e.value as number, count: e.sample, secondary: e.secondary || [] })
  })
  rest.sort((a, b) => b.sample - a.sample || a.name.localeCompare(b.name))
  const unranked: Row[] = rest.map(e => ({ rank: null, name: e.name, kpi: e.sample > 0 ? notEnough(e.sample) : '—', value: null, count: e.sample, secondary: e.secondary || [] }))
  return { rows, unranked }
}

/** The top of a board for an email: ranked rows only, best first. Never the bottom, never the unranked. */
export function topOfBoard(b: Leaderboard | null | undefined, n = 3): Row[] {
  if (!b || b.degraded) return []
  return b.rows.slice(0, Math.max(0, n))
}

/** "1h 25m", "45m". For actual against expected clean time. */
export function fmtMinutes(min: number | null | undefined): string {
  if (!finite(min as any) || (min as number) < 0) return '—'
  const m = Math.round(min as number)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

/** "5m", "1.4h", "2.1d". For how long a guest waited. */
export function fmtWait(ms: number | null | undefined): string {
  if (!finite(ms as any) || (ms as number) < 0) return '—'
  const m = (ms as number) / 60000
  if (m < 1) return Math.round((ms as number) / 1000) + 's'
  if (m < 60) return Math.round(m) + 'm'
  const h = m / 60
  return h < 24 ? h.toFixed(1) + 'h' : (h / 24).toFixed(1) + 'd'
}

// ── HOURS HIT PER CLEAN ─────────────────────────────────────────────────────────────────────────
// Jon's labor KPI gives each clean an expected time (expected labor cost ÷ pay per hour). A clean
// "hit" when its recorded minutes are at or under that. It is a guide, so the words are always
// "within the expected time", never late or slow.
//
// A TIMER IS NOT ALWAYS A CLEAN. Breezeway's minutes are the task timer, and a clean "timed" at two
// minutes is a timer started at the door on the way out; one at eleven hours was never stopped.
// Neither is a time anybody cleaned in, so both are left out of the KPI: the same 20-minute to 8-hour
// band lib/eve/dossiers uses for a cleaner's median. The clean itself still counts as completed.
export const CLEAN_MIN_MINUTES = 20
export const CLEAN_MAX_MINUTES = 480
export type TimedClean = { minutes: number; expected: number }
export function hoursHit(cleans: TimedClean[]): { timed: number; within: number; avgActual: number | null; avgExpected: number | null } {
  const ok = cleans.filter(c => finite(c.minutes) && c.minutes >= CLEAN_MIN_MINUTES && c.minutes <= CLEAN_MAX_MINUTES && finite(c.expected) && c.expected > 0)
  if (!ok.length) return { timed: 0, within: 0, avgActual: null, avgExpected: null }
  const sum = (f: (c: TimedClean) => number) => ok.reduce((a, c) => a + f(c), 0)
  return { timed: ok.length, within: ok.filter(c => c.minutes <= c.expected).length, avgActual: sum(c => c.minutes) / ok.length, avgExpected: sum(c => c.expected) / ok.length }
}

// ── GUEST REPLIES ───────────────────────────────────────────────────────────────────────────────
// One rule for "a guest asked and a person answered", the same shape lib/response-times uses for
// who is waiting: a run opens on the first guest message after the last reply a PERSON sent and is
// closed only by a person's reply. A template (is_automated, or a machine author such as "hook")
// answers nobody, so the clock runs past it. A follow-up while waiting does not restart the clock;
// a guest message more than `horizonH` after the run opened starts a fresh one.
export type Msg = { conversation_id: string; sender: string; sender_name?: string | null; sent_at: string; is_automated?: boolean | null; module?: string | null }
export type ReplyRun = { conversation_id: string; askedAt: string; answeredAt: string | null; responder: string | null; ms: number | null }
const NOT_A_MESSAGE = ['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system']

export function replyRuns(msgs: Msg[], o: { isPerson: (name: string) => boolean; horizonH?: number }): ReplyRun[] {
  const horizon = (o.horizonH ?? 72) * 3600_000
  const byConv: Record<string, Msg[]> = {}
  for (const m of msgs) { const k = String(m.conversation_id || ''); if (k) (byConv[k] = byConv[k] || []).push(m) }
  const out: ReplyRun[] = []
  for (const cid of Object.keys(byConv)) {
    const thread = byConv[cid].slice().sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at))
    let open: string | null = null
    for (const m of thread) {
      const t = Date.parse(m.sent_at)
      if (!Number.isFinite(t)) continue
      if (m.module && NOT_A_MESSAGE.indexOf(String(m.module).toLowerCase()) >= 0) continue
      if (m.sender === 'guest') {
        if (open !== null && t - Date.parse(open) > horizon) { out.push({ conversation_id: cid, askedAt: open, answeredAt: null, responder: null, ms: null }); open = null }
        if (open === null) open = m.sent_at
      } else if (m.sender === 'host') {
        const who = String(m.sender_name || '').trim()
        if (m.is_automated === true || !who || !o.isPerson(who)) continue
        if (open !== null) { out.push({ conversation_id: cid, askedAt: open, answeredAt: m.sent_at, responder: who, ms: t - Date.parse(open) }); open = null }
      }
    }
    if (open !== null) out.push({ conversation_id: cid, askedAt: open, answeredAt: null, responder: null, ms: null })
  }
  return out
}

// ── WHO DID IT, WHEN THE ROW DOES NOT SAY ───────────────────────────────────────────────────────
// An outcome row with no "by" column (a listing's last_optimized, a review's reply date) is credited
// to the person whose gated API call for that feature landed just before it (user_activity). Only
// when exactly ONE person was active in the window: two people on the same screen is nobody's credit.
export type Stamp = { at: number; email: string }
/** `stamps` sorted ascending by `at`. Returns the email, or null when nobody or more than one person fits. */
export function creditFrom(stamps: Stamp[], at: number, beforeMs: number, afterMs: number): string | null {
  if (!Number.isFinite(at)) return null
  const lo = at - beforeMs, hi = at + afterMs
  // binary search for the first stamp >= lo
  let a = 0, b = stamps.length
  while (a < b) { const mid = (a + b) >> 1; if (stamps[mid].at < lo) a = mid + 1; else b = mid }
  let who: string | null = null
  for (let i = a; i < stamps.length && stamps[i].at <= hi; i++) {
    if (who === null) who = stamps[i].email
    else if (stamps[i].email !== who) return null
  }
  return who
}

/** "suleman.afzal@x.com" → "Suleman Afzal". Used only when the account has no name on its profile. */
export function nameFromEmail(email: string): string {
  const local = String(email || '').split('@')[0].replace(/\d+$/, '')
  return local.split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') || String(email || '')
}

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many || one + 's')}`
/** "12 listings optimised": the phrase behind a person's count, dropped when it is zero. */
export function phrase(n: number, one: string, many?: string): string | null { return n > 0 ? plural(n, one, many) : null }
export { plural }
