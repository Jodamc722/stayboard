// ON THE BOOKS vs THE SAME TIME LAST YEAR — the next 30 / 60 / 90 days (audit 2026-09-28).
//
// The GM brief promised "booked-ahead" and printed six trailing numbers. This is the forward one:
// for each window starting today, the nights and net room revenue on the books NOW, next to what
// was on the books for the same dates a year ago AS OF THE SAME DAY a year ago — last year's stays
// in the matching window that had been booked (created) by today minus 365 days.
//
// RULES, NOT A MODEL:
//   - A stay counts when its status is live (confirmed, checked in / out, closed — the KPI board's
//     set) and it is not an owner or friends-and-family stay (lib/owner-audit, the one shared test —
//     those are inventory decisions, not demand).
//   - Nights and revenue are the part of each stay that falls inside the window, pro-rated by night.
//   - Net revenue = accommodation after channel fees (fareAccommodationAdjusted − hostServiceFee),
//     cleaning excluded — the 'net' basis of lib/basis.
//   - DIRECTIONAL. We do not hold the date a booking was cancelled, so last year's picture leaves out
//     stays that were on the books then and cancelled later, and this year's still carries stays
//     that may yet cancel. The comparison leans in this year's favour; the label says so.
//   - SAME UNITS. The portfolio grows; a bigger book is not better pacing. Each window also carries
//     the comparison over only the units that were already listed a year ago (Guesty createdAt),
//     when that date is known for most of them.
// Money truth stays the revenue app (lib/money-source); this is a pace, not a statement.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '../supabase-admin'
import { pageRows } from '../db-page'
import { isOwnerOrFriendsFamily } from '../owner-audit'

export type PaceSide = { nights: number; revenue: number; stays: number }
export type PaceWindow = {
  days: number
  /** This year's window, [from, to] inclusive, and the same dates a year earlier. */
  from: string; to: string; lyFrom: string; lyTo: string
  now: PaceSide
  lastYear: PaceSide
  /** % change vs last year; null when last year had nothing to compare with. */
  nightsPct: number | null
  revenuePct: number | null
  /** The same comparison over the units listed a year ago — null when that is not known. */
  sameUnits: { units: number; now: PaceSide; lastYear: PaceSide; nightsPct: number | null; revenuePct: number | null } | null
}
export type Pacing = {
  ok: true
  generatedAt: string
  today: string
  /** "As of" a year ago: last year's stays booked on or before this ET day. */
  asOfLastYear: string
  windows: PaceWindow[]
  basis: string
  notes: string[]
}

const TZ = 'America/New_York'
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const LIVE = ['confirmed', 'checked_in', 'checked_out', 'closed']
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null)

export const PACING_BASIS = 'On the books = live stays (owner and friends & family out), nights and net room revenue (accommodation after channel fees, no cleaning) falling inside each window. Last year = the same dates a year earlier, counting only stays booked by this day last year. Directional — we do not hold cancellation dates, so this year\'s count still includes stays that may cancel.'

/** The UTC instant of 00:00 in New York on `ymd` — "booked by the end of that ET day" is before it. */
function etMidnightUtc(ymd: string): string {
  const guess = Date.parse(ymd + 'T05:00:00Z')           // midnight EST
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date(guess))) % 24
  return new Date(guess - h * 3600000).toISOString()      // 1am EDT → back an hour
}

const COLS = 'id,listing_id,check_in,check_out,nights,status,source,guest_name,money_total,created_at,' +
  'fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,fee:raw->money->>hostServiceFee,tags:raw->tags'

async function staysOverlapping(from: string, to: string, bookedBefore?: string): Promise<{ rows: any[]; truncated: boolean }> {
  return pageRows<any>((a, b) => {
    // ilike with no wildcard = equality that ignores case, so 'Confirmed' and 'confirmed' both count.
    let q = supabaseAdmin().from('guesty_reservations').select(COLS)
      .lte('check_in', to).gt('check_out', from).or(LIVE.map(s => `status.ilike.${s}`).join(','))
    if (bookedBefore) q = q.lt('created_at', bookedBefore)
    return q.order('id').range(a, b)
  }, 20)
}

function sideOf(rows: any[], from: string, to: string, keep: (r: any) => boolean): PaceSide {
  const end = shift(to, 1)                                // exclusive: nights of [from, to]
  let nights = 0, revenue = 0, stays = 0
  for (const r of rows) {
    if (!keep(r)) continue
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    if (!ci || !co) continue
    const s = ci > from ? ci : from, e = co < end ? co : end
    const n = Math.round((Date.parse(e + 'T12:00:00Z') - Date.parse(s + 'T12:00:00Z')) / 86400000)
    if (n <= 0) continue
    const total = Math.max(1, num(r.nights) || Math.round((Date.parse(co + 'T12:00:00Z') - Date.parse(ci + 'T12:00:00Z')) / 86400000) || 1)
    const fare = num(r.fare) || num(r.fareBase) || num(r.money_total)
    const net = Math.max(0, fare - num(r.fee))
    nights += n; revenue += (net / total) * n; stays++
  }
  return { nights, revenue: Math.round(revenue), stays }
}

const notOwner = (r: any) => {
  const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
  return !isOwnerOrFriendsFamily(str(r.source), tagBlob, str(r.guest_name))
}

async function compute(today: string, windows: number[]): Promise<Pacing> {
  const notes: string[] = []
  const longest = Math.max(...windows)
  const asOf = shift(today, -365)
  const lyStart = asOf
  const [now, ly, lRes] = await Promise.all([
    staysOverlapping(today, shift(today, longest - 1)),
    staysOverlapping(lyStart, shift(lyStart, longest - 1), etMidnightUtc(shift(asOf, 1))),
    pageRows<any>((a, b) => supabaseAdmin().from('guesty_listings').select('id,created:raw->>createdAt').order('id').range(a, b), 4),
  ])
  if (now.truncated) notes.push('this year\'s stays read stopped early — figures are floors')
  if (ly.truncated) notes.push('last year\'s stays read stopped early — figures are floors')
  const lyNoDate = ly.rows.filter(r => !r.created_at).length
  if (lyNoDate) notes.push(`${lyNoDate} of last year's stays carry no booking date and are left out`)
  // Units already listed when last year's window began — the like-for-like set.
  const listedBy: Record<string, string> = {}
  let dated = 0
  for (const l of lRes.rows) { const c = str(l.created).slice(0, 10); if (c) { listedBy[str(l.id)] = c; dated++ } }
  const knowUnits = lRes.rows.length > 0 && dated / lRes.rows.length >= 0.8
  if (!knowUnits) notes.push('listing dates are missing for too many units to compare the same units')

  const out: PaceWindow[] = windows.slice().sort((a, b) => a - b).map(days => {
    const from = today, to = shift(today, days - 1)
    const lyFrom = lyStart, lyTo = shift(lyStart, days - 1)
    const nowSide = sideOf(now.rows, from, to, notOwner)
    const lySide = sideOf(ly.rows, lyFrom, lyTo, notOwner)
    let sameUnits: PaceWindow['sameUnits'] = null
    if (knowUnits) {
      const old = (r: any) => { const c = listedBy[str(r.listing_id)]; return !!c && c <= lyFrom }
      const n2 = sideOf(now.rows, from, to, r => notOwner(r) && old(r))
      const l2 = sideOf(ly.rows, lyFrom, lyTo, r => notOwner(r) && old(r))
      sameUnits = {
        units: Object.keys(listedBy).filter(id => listedBy[id] <= lyFrom).length,
        now: n2, lastYear: l2, nightsPct: pct(n2.nights, l2.nights), revenuePct: pct(n2.revenue, l2.revenue),
      }
    }
    return {
      days, from, to, lyFrom, lyTo, now: nowSide, lastYear: lySide,
      nightsPct: pct(nowSide.nights, lySide.nights), revenuePct: pct(nowSide.revenue, lySide.revenue), sameUnits,
    }
  })
  return { ok: true, generatedAt: new Date().toISOString(), today, asOfLastYear: asOf, windows: out, basis: PACING_BASIS, notes }
}

const cached = unstable_cache(compute, ['forecast-pacing-v1'], { revalidate: 3600, tags: ['forecast'] })

/** Pacing for the next 30 / 60 / 90 days (or `windows`), cached an hour — bookings move slowly. */
export async function buildPacing(opts: { windows?: number[]; fresh?: boolean } = {}): Promise<Pacing> {
  const windows = (opts.windows && opts.windows.length ? opts.windows : [30, 60, 90])
    .map(n => Math.max(7, Math.min(180, Math.round(Number(n) || 0)))).filter((n, i, a) => a.indexOf(n) === i)
  const today = ymdET()
  return opts.fresh ? compute(today, windows) : cached(today, windows)
}

/** "▲ 8%" / "▼ 3%" / "flat" / "—" — change as words, for briefs. */
export function paceWord(p: number | null): string {
  if (p == null) return '—'
  if (Math.abs(p) < 0.5) return 'flat'
  return (p > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(p)) + '%'
}
