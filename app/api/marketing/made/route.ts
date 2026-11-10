// DIRECT BOOKINGS MADE — counted on the server, for the two comparisons on /marketing (2026-11-10).
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
//     → { ok, showMoney, range, prior, lastYear, now, before, ly }
//
// "MADE" is the Sales report's count (lib/marketing madeKind): a direct booking created in the
// window that is a real stay today (confirmed / checked in / checked out) OR was one and has been
// cancelled since. Inquiries, declined, expired and Guesty's `closed` never were bookings. Counting
// what was made — not only what is still standing — is what makes "vs the previous period" and
// "vs last year" fair: an older window has had longer to cancel.
//
// Three windows, the same length, the same rule:
//   now      [from, to]
//   before   the equally long window immediately before `from`   (the board's "vs previous N days")
//   ly       the same weekdays 52 weeks earlier (−364 days)
//
// WHY THIS ROUTE EXISTS. The board first worked these out in the browser from the booking list of
// /api/public/marketing-report, which ships at most 6,000 rows and none at all for the prior window —
// so a long range showed no last-year figure, and the prior comparison could not use this count.
// Here they are counted in the database's answer: direct sources only (filtered in the query), four
// scalars a row, paged to the end, no row list sent.
//
// Auth mirrors /api/public/marketing-report exactly: a signed-in team member who holds the Direct
// bookings tab, OR the marketing share link's own cookie. Dollars follow that person's money
// permission, or the link's scope. A link pinned to a period keeps its pin on `now`; `before` and
// `ly` are derived from it, as the report's own prior window is.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { linkGate } from '@/lib/passcode-gate'
import type { LinkScope } from '@/lib/share-links'
import { bucketFor, familyFor, madeKind, accomOf, etDay, addDaysIso, daysBetweenIso } from '@/lib/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Made = { made: number; cancelled: number; accom: number | null; cancelledAccom: number | null }

// Every raw source value lib/marketing buckets as direct (bucketFor → be / website / direct). The
// query narrows to these; bucketFor still has the last word on each row.
const DIRECT_SOURCES = ['be-api', 'be_api', 'beapi', 'booking engine', 'bookingengine', 'website', 'web', 'widget', 'direct']
const STATUSES = ['confirmed', 'checked_in', 'checked_out', 'canceled', 'cancelled']
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Direct bookings made on the Eastern days [from, to]. Throws when the read comes back short. */
async function madeBetween(from: string, to: string, withMoney: boolean): Promise<Made> {
  const db = supabaseAdmin()
  // A day wide on each side in UTC, then bucketed by the Eastern day — created_at is stamped in UTC.
  const lo = addDaysIso(from, -1) + 'T00:00:00.000Z'
  const hi = addDaysIso(to, 2) + 'T00:00:00.000Z'
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select('id,status,source,created_at,accomAdj:raw->money->>fareAccommodationAdjusted,accomBase:raw->money->>fareAccommodation')
    .gte('created_at', lo).lt('created_at', hi)
    .in('status', STATUSES)
    // ilike with no wildcard = equality that ignores case; quoted because one value has a space.
    .or(DIRECT_SOURCES.map(s => `source.ilike."${s}"`).join(','))
    .order('id').range(a, b), 20)
  if (truncated) throw new Error('the bookings read for ' + from + ' – ' + to + ' came back short')
  let made = 0, cancelled = 0, accom = 0, cancelledAccom = 0
  for (const r of rows) {
    const day = etDay(String(r.created_at || ''))
    if (!day || day < from || day > to) continue
    if (familyFor(bucketFor(String(r.source || ''))) !== 'direct') continue
    const kind = madeKind(r.status)
    if (!kind) continue
    // The same accommodation figure the board's Revenue uses (lib/marketing accomOf).
    const v = accomOf({ fareAccommodationAdjusted: r.accomAdj == null || r.accomAdj === '' ? undefined : r.accomAdj, fareAccommodation: r.accomBase })
    made += 1; accom += v
    if (kind === 'cancelled') { cancelled += 1; cancelledAccom += v }
  }
  return { made, cancelled, accom: withMoney ? Math.round(accom) : null, cancelledAccom: withMoney ? Math.round(cancelledAccom) : null }
}

export async function GET(req: NextRequest) {
  // ── who is asking — the same two doors as the report ──
  let internal = false, canMoney = false, signedIn = false
  try {
    const a = await getAccess()
    signedIn = !!a.user && !!a.allowed
    internal = signedIn && atLeast(a.levels.marketing, 'view')
    canMoney = internal && canSeeMoney(a)
  } catch { internal = false; canMoney = false }
  let linkScope: LinkScope = {}
  if (!internal) {
    const gate = await linkGate('marketing', { kinds: ['marketing'], cookieOnly: signedIn })
    if (!gate.ok) return gate.res
    linkScope = gate.link.scope || {}
  }
  const showMoney = internal ? canMoney : linkScope.showMoney !== false

  const sp = req.nextUrl.searchParams
  const today = etDay(new Date().toISOString())
  let to = String(sp.get('to') || '').slice(0, 10)
  let from = String(sp.get('from') || '').slice(0, 10)
  if (!isDay(to)) to = today
  if (!isDay(from)) from = addDaysIso(to, -29)
  if (from > to) { const t = from; from = to; to = t }
  // A link built for one period cannot be widened from the address bar.
  if (linkScope.from && from < linkScope.from) from = linkScope.from
  if (linkScope.to && to > linkScope.to) to = linkScope.to
  if (linkScope.from && to < linkScope.from) to = linkScope.from

  const span = Math.max(1, daysBetweenIso(from, to) + 1)
  const priorTo = addDaysIso(from, -1), priorFrom = addDaysIso(priorTo, -(span - 1))
  const lyFrom = addDaysIso(from, -364), lyTo = addDaysIso(to, -364)

  try {
    const [now, before, ly] = await Promise.all([
      madeBetween(from, to, showMoney),
      madeBetween(priorFrom, priorTo, showMoney),
      madeBetween(lyFrom, lyTo, showMoney),
    ])
    return NextResponse.json({
      ok: true, showMoney,
      range: { from, to, span },
      prior: { from: priorFrom, to: priorTo },
      lastYear: { from: lyFrom, to: lyTo },
      now, before, ly,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 })
  }
}
