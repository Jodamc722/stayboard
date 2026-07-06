import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cleaner-demand forecast for the weekly schedule. A clean = a confirmed/checked Guesty
// checkout, deduped per unit/day (same rule as /api/schedule). Botanica is vendor-cleaned
// (hotel staff) so it is excluded from OUR cleaner needs. Dates are America/New_York.
const LIVE = /confirm|checked/i
const VENDOR = /botanica/i
const MARKETS = ['Miami', 'Broward', 'North']
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function dow(s: string) { return new Date(s + 'T12:00:00').getDay() }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function fetchCheckouts(db: any, from: string, to: string) {
  const rows: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('guesty_reservations')
      .select('listing_id,check_out,status')
      .gte('check_out', from).lte('check_out', to)
      .order('check_out', { ascending: true })
      .range(off, off + 999)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

export async function GET(_req: NextRequest) {
  const HIST = 60
  const today = ymd(new Date())
  const histStart = addDays(today, -HIST)
  const upEnd = addDays(today, 6)

  const db = supabaseAdmin()
  const [outs, { data: listings }] = await Promise.all([
    fetchCheckouts(db, histStart, upEnd),
    db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(5000),
  ])
  if (!listings || !listings.length) return NextResponse.json({ ok: false, error: 'Listing data unavailable - hit Sync and retry.' }, { status: 503 })

  const meta: Record<string, { market: string; vendor: boolean }> = {}
  for (const l of listings as any[]) {
    const id = String(l.id)
    const building = str(l.building)
    const name = l.nickname || l.title || 'Unit'
    let market = String(marketOf(building, l.address_city, name) || 'Miami')
    if (!MARKETS.includes(market)) market = 'Miami'
    meta[id] = { market, vendor: VENDOR.test(building) || VENDOR.test(name) }
  }

  const histCount: Record<string, number[]> = {}
  MARKETS.forEach(m => (histCount[m] = [0, 0, 0, 0, 0, 0, 0]))
  const upByDate: Record<string, Record<string, number>> = {}

  const seen = new Set<string>()
  for (const r of outs) {
    if (!LIVE.test(str(r.status))) continue
    const id = String(r.listing_id)
    const date = str(r.check_out).slice(0, 10)
    if (!date) continue
    const key = id + '__' + date
    if (seen.has(key)) continue
    seen.add(key)
    const m = meta[id]
    if (!m || m.vendor) continue
    if (date < today) {
      histCount[m.market][dow(date)]++
    } else if (date <= upEnd) {
      if (!upByDate[date]) upByDate[date] = {}
      upByDate[date][m.market] = (upByDate[date][m.market] || 0) + 1
    }
  }

  const dowOcc = [0, 0, 0, 0, 0, 0, 0]
  for (let d = histStart; d < today; d = addDays(d, 1)) dowOcc[dow(d)]++

  const avgByMarketDow: Record<string, number[]> = {}
  MARKETS.forEach(m => {
    avgByMarketDow[m] = histCount[m].map((c, i) => (dowOcc[i] ? Math.round((c / dowOcc[i]) * 10) / 10 : 0))
  })

  const upcoming: any[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    const actual: Record<string, number> = {}
    MARKETS.forEach(m => (actual[m] = (upByDate[d] && upByDate[d][m]) || 0))
    upcoming.push({ date: d, dow: dow(d), day: DAYLABEL[dow(d)], actual })
  }

  return NextResponse.json({
    ok: true,
    today,
    histStart,
    histDays: HIST,
    markets: MARKETS,
    dayLabels: DAYLABEL,
    dowOccurrences: dowOcc,
    avgByMarketDow,
    upcoming,
    note: 'Confirmed/checked checkouts, deduped per unit/day, excludes Botanica (vendor).',
    generatedAt: new Date().toISOString(),
  })
}
