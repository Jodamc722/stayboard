// MONTH-BY-MONTH DIRECT BOOKING TIMELINE.
//
// One row per calendar month, counting bookings by the month they were CREATED. This is the
// "is marketing trending up across the year" view; the main report answers "what happened in this
// window". Loaded separately from the board so the board never waits on a year of rows.
//
// HONESTY GUARD: the reservations mirror only ever pulled stays checking out from ~3 days before
// its first sync, so a booking made long ago for a stay that already ended is simply not in the
// table. Rather than draw a flattering hockey stick out of missing history, every month earlier
// than the mirror's own floor is returned with partial:true and the UI greys it out.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MKT_COOKIE, marketingCookieValid } from '@/lib/shareAuth'
import { bucketFor, familyFor, stateFor, accomOf, num, etDay } from '@/lib/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Month = {
  m: string            // YYYY-MM
  created: number      // every reservation created that month, any status
  won: number          // confirmed / in house / stayed
  canceled: number
  pending: number      // open inquiries
  revenue: number      // net accommodation on won bookings
  direct: number
  directRev: number
  manual: number
  owner: number
  ota: number
  otaRev: number
  partial: boolean
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// YYYY-MM arithmetic without Date math (no timezone traps).
function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7)) - 1 + n
  const y2 = y + Math.floor(m / 12)
  const m2 = ((m % 12) + 12) % 12
  return String(y2) + '-' + String(m2 + 1).padStart(2, '0')
}

export async function GET(req: NextRequest) {
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

  const url = new URL(req.url)
  const backRaw = Number(url.searchParams.get('back') || 13)
  const back = Math.max(2, Math.min(36, Number.isFinite(backRaw) ? backRaw : 13))

  try {
    const db = supabaseAdmin()
    const today = etDay(new Date().toISOString())
    const thisMonth = today.slice(0, 7)
    const firstMonth = addMonths(thisMonth, -(back - 1))

    // The mirror's coverage floor: the earliest stay it holds. Anything created before this month
    // is necessarily incomplete, because bookings whose stay ended earlier were never synced.
    let floorMonth = ''
    try {
      const { data: fl } = await db
        .from('guesty_reservations')
        .select('check_out')
        .not('check_out', 'is', null)
        .order('check_out', { ascending: true })
        .limit(1)
      const row: any = Array.isArray(fl) ? fl[0] : null
      if (row && row.check_out) floorMonth = str(row.check_out).slice(0, 7)
    } catch { /* no floor detected — every month is then reported as complete */ }

    const loIso = firstMonth + '-01T00:00:00.000Z'
    const cols = 'created_at, source, status, nights, money:raw->money'
    const MAX_PAGES = 40
    let raw: any[] = []
    let truncated = false
    for (let i = 0; i < MAX_PAGES; i++) {
      const { data, error } = await db
        .from('guesty_reservations')
        .select(cols)
        .gte('created_at', loIso)
        .order('created_at', { ascending: false })
        .range(i * 1000, i * 1000 + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      raw = raw.concat(data)
      if (data.length < 1000) break
      if (i === MAX_PAGES - 1) truncated = true
    }

    const byMonth: Record<string, Month> = {}
    const months: Month[] = []
    for (let m = firstMonth; m <= thisMonth; m = addMonths(m, 1)) {
      const row: Month = {
        m, created: 0, won: 0, canceled: 0, pending: 0, revenue: 0,
        direct: 0, directRev: 0, manual: 0, owner: 0, ota: 0, otaRev: 0,
        partial: floorMonth ? m < floorMonth : false,
      }
      byMonth[m] = row
      months.push(row)
    }

    for (const x of raw) {
      const day = etDay(str(x.created_at))
      if (!day) continue
      const key = day.slice(0, 7)
      const row = byMonth[key]
      if (!row) continue
      const state = stateFor(x.status)
      const fam = familyFor(bucketFor(str(x.source).toLowerCase()))
      row.created += 1
      if (state === 'canceled') { row.canceled += 1; continue }
      if (state === 'pending') { row.pending += 1; continue }
      const accom = accomOf(x.money || null)
      row.won += 1
      row.revenue += accom
      if (fam === 'direct') { row.direct += 1; row.directRev += accom }
      else if (fam === 'manual') { row.manual += 1 }
      else if (fam === 'owner') { row.owner += 1 }
      else { row.ota += 1; row.otaRev += accom }
    }

    return NextResponse.json({ ok: true, today, floorMonth, truncated, months })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
