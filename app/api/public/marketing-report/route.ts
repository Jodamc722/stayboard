// DIRECT BOOKING TRACKER — data for the internal /marketing page AND the partner share link.
//
// Auth is either/or: a signed-in Lighthouse user, OR the marketing share cookie. The partner link
// gets the same numbers with guest names reduced to "First L." and no email/phone, so a marketing
// agency can measure the funnel without holding guest PII.
//
// EVERY number on this route is keyed on guesty_reservations.created_at (when the booking was
// MADE), never on the stay date. Bucketed in Eastern time.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MKT_COOKIE, marketingCookieValid } from '@/lib/shareAuth'
import {
  Bucket, Family, State, Pay,
  bucketFor, familyFor, isUnmappedSource, stateFor, isWon, payFor,
  accomOf, cleaningOf, num, etDay, addDaysIso, daysBetweenIso,
} from '@/lib/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Row = {
  id: string
  created: string        // ET day the booking was made
  createdTs: string
  guest: string
  property: string
  source: string
  bucket: Bucket
  family: Family
  state: State
  status: string
  pay: Pay
  checkIn: string
  checkOut: string
  nights: number
  lead: number | null    // days between booking and check-in
  accom: number
  cleaning: number
  total: number
  paid: number
  balance: number
  conf: string
}

type Agg = {
  key: string
  label: string
  bookings: number       // every reservation created in the window, any state
  won: number            // confirmed / in-house / stayed
  canceled: number
  pending: number
  nights: number
  accom: number
  cleaning: number
  paidAmt: number
  balanceAmt: number
  unpaidCount: number
  leadSum: number
  leadN: number
}

function emptyAgg(key: string, label: string): Agg {
  return { key, label, bookings: 0, won: 0, canceled: 0, pending: 0, nights: 0, accom: 0, cleaning: 0, paidAmt: 0, balanceAmt: 0, unpaidCount: 0, leadSum: 0, leadN: 0 }
}

function addTo(a: Agg, r: Row) {
  a.bookings += 1
  if (r.state === 'canceled') { a.canceled += 1; return }   // lost bookings carry no revenue
  if (r.state === 'pending') { a.pending += 1; return }     // an inquiry is not money either
  a.won += 1
  a.nights += r.nights
  a.accom += r.accom
  a.cleaning += r.cleaning
  a.paidAmt += r.paid
  a.balanceAmt += r.balance
  if (r.pay !== 'paid') a.unpaidCount += 1
  if (r.lead !== null) { a.leadSum += r.lead; a.leadN += 1 }
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// "Jonathan McGill" -> "Jonathan M." for the partner link.
function maskName(n: string): string {
  const parts = n.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Guest'
  if (parts.length === 1) return parts[0]
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.'
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  // ── who is asking ────────────────────────────────────────────────────────
  let internal = false
  try {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    internal = !!user
  } catch { internal = false }
  if (!internal) {
    const ok = await marketingCookieValid(cookies().get(MKT_COOKIE)?.value)
    if (!ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  }

  const today = etDay(new Date().toISOString())
  let to = str(url.searchParams.get('to')).slice(0, 10) || today
  let from = str(url.searchParams.get('from')).slice(0, 10) || addDaysIso(to, -29)
  if (from > to) { const t = from; from = to; to = t }

  // Comparison = the equally long window immediately before `from`, so "+18% vs prior 30 days"
  // is always apples to apples whatever range is picked.
  const span = Math.max(1, daysBetweenIso(from, to) + 1)
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(prevTo, -(span - 1))

  try {
    const db = supabaseAdmin()

    // Pull one day wide on each side in UTC, then bucket precisely by ET day in JS. Guesty stamps
    // created_at in UTC, so an ET-day filter done in SQL would clip evening bookings.
    const loIso = prevFrom + 'T00:00:00.000Z'
    const hiIso = addDaysIso(to, 2) + 'T00:00:00.000Z'

    const cols = 'id, listing_name, guest_name, check_in, check_out, nights, status, source, confirmation_code, money_total, money_paid, money_balance, created_at, money:raw->money'
    let raw: any[] = []
    let truncated = false
    for (let i = 0; i < 8; i++) {
      const { data, error } = await db
        .from('guesty_reservations')
        .select(cols)
        .gte('created_at', loIso)
        .lt('created_at', hiIso)
        .order('created_at', { ascending: false })
        .range(i * 1000, i * 1000 + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      raw = raw.concat(data)
      if (data.length < 1000) break
      if (i === 7) truncated = true
    }

    const rows: Row[] = []
    const prevRows: Row[] = []
    const unmapped: Record<string, number> = {}

    for (const x of raw) {
      const created = etDay(str(x.created_at))
      if (!created) continue
      const inCur = created >= from && created <= to
      const inPrev = created >= prevFrom && created <= prevTo
      if (!inCur && !inPrev) continue

      const money = x.money || null
      const src = str(x.source).toLowerCase() || 'unknown'
      const bucket = bucketFor(src)
      const ci = str(x.check_in).slice(0, 10)
      const co = str(x.check_out).slice(0, 10)
      const nights = Math.max(0, num(x.nights) || (ci && co ? daysBetweenIso(ci, co) : 0))
      const state = stateFor(x.status)
      const guestFull = str(x.guest_name) || 'Guest'
      const row: Row = {
        id: str(x.id),
        created,
        createdTs: str(x.created_at),
        guest: internal ? guestFull : maskName(guestFull),
        property: str(x.listing_name) || '—',
        source: src,
        bucket,
        family: familyFor(bucket),
        state,
        status: str(x.status),
        pay: payFor(money, num(x.money_paid), num(x.money_balance)),
        checkIn: ci,
        checkOut: co,
        nights,
        lead: ci && created <= ci ? daysBetweenIso(created, ci) : null,
        accom: accomOf(money),
        cleaning: cleaningOf(money),
        total: num(money && money.hostPayout !== undefined ? money.hostPayout : x.money_total),
        paid: num(money && money.totalPaid !== undefined ? money.totalPaid : x.money_paid),
        balance: num(money && money.balanceDue !== undefined ? money.balanceDue : x.money_balance),
        conf: str(x.confirmation_code),
      }
      if (inCur) {
        rows.push(row)
        if (isUnmappedSource(src)) unmapped[src] = (unmapped[src] || 0) + 1
      } else {
        prevRows.push(row)
      }
    }

    // ── aggregates ──────────────────────────────────────────────────────────
    const roll = (list: Row[]) => {
      const bySource: Record<string, Agg> = {}
      const byFamily: Record<string, Agg> = {}
      const byBucket: Record<string, Agg> = {}
      const all = emptyAgg('all', 'All bookings')
      for (const r of list) {
        addTo(all, r)
        const s = bySource[r.source] || (bySource[r.source] = emptyAgg(r.source, r.source))
        addTo(s, r)
        const f = byFamily[r.family] || (byFamily[r.family] = emptyAgg(r.family, r.family))
        addTo(f, r)
        const b = byBucket[r.bucket] || (byBucket[r.bucket] = emptyAgg(r.bucket, r.bucket))
        addTo(b, r)
      }
      return { all, bySource, byFamily, byBucket }
    }

    const cur = roll(rows)
    const prev = roll(prevRows)

    // Daily created-booking counts, split direct / manual+owner / OTA — the marketing trend line.
    const trend: { d: string; direct: number; manual: number; ota: number; directRev: number; otaRev: number }[] = []
    const tIdx: Record<string, number> = {}
    for (let d = from; d <= to; d = addDaysIso(d, 1)) {
      tIdx[d] = trend.length
      trend.push({ d, direct: 0, manual: 0, ota: 0, directRev: 0, otaRev: 0 })
    }
    for (const r of rows) {
      const i = tIdx[r.created]
      if (i === undefined) continue
      const t = trend[i]
      const dead = r.state === 'canceled' || r.state === 'pending'
      if (r.family === 'direct') { t.direct += 1; if (!dead) t.directRev += r.accom }
      else if (r.family === 'ota') { t.ota += 1; if (!dead) t.otaRev += r.accom }
      else { t.manual += 1 }
    }

    const { data: syncSt } = await db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()

    return NextResponse.json({
      ok: true,
      internal,
      today,
      range: { from, to, span },
      compare: { from: prevFrom, to: prevTo },
      lastSync: syncSt && syncSt.last_sync_at ? String(syncSt.last_sync_at) : null,
      truncated,
      unmapped,
      current: cur,
      previous: prev,
      trend,
      rows,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
