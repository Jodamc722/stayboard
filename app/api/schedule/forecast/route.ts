import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cleaner-demand forecast for the weekly schedule. A clean = a confirmed/checked Guesty
// checkout, deduped per unit/day (same rule as /api/schedule). Botanica is vendor-cleaned
// (hotel staff) so it is tracked separately, not counted toward OUR cleaner needs.
// Dates are America/New_York.
const LIVE = /confirm|checked/i
const VENDOR = /botanica/i
const MARKETS = ['Miami', 'Broward', 'North']
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function dow(s: string) { return new Date(s + 'T12:00:00').getDay() }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function zeros() { return [0, 0, 0, 0, 0, 0, 0] }

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

  const hist: Record<string, number[]> = {}
  const histVendor: Record<string, number[]> = {}
  MARKETS.forEach(m => { hist[m] = zeros(); histVendor[m] = zeros() })
  const upBy: Record<string, Record<string, number>> = {}
  const upVendorBy: Record<string, Record<string, number>> = {}

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
    if (!m) continue
    const bucketHist = m.vendor ? histVendor : hist
    const bucketUp = m.vendor ? upVendorBy : upBy
    if (date < today) {
      bucketHist[m.market][dow(date)]++
    } else if (date <= upEnd) {
      if (!bucketUp[date]) bucketUp[date] = {}
      bucketUp[date][m.market] = (bucketUp[date][m.market] || 0) + 1
    }
  }

  const dowOcc = zeros()
  for (let d = histStart; d < today; d = addDays(d, 1)) dowOcc[dow(d)]++
  const avgOf = (src: Record<string, number[]>) => {
    const out: Record<string, number[]> = {}
    MARKETS.forEach(m => { out[m] = src[m].map((c, i) => (dowOcc[i] ? Math.round((c / dowOcc[i]) * 10) / 10 : 0)) })
    return out
  }

  const upcoming: any[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    const actual: Record<string, number> = {}
    const vendor: Record<string, number> = {}
    MARKETS.forEach(m => {
      actual[m] = (upBy[d] && upBy[d][m]) || 0
      vendor[m] = (upVendorBy[d] && upVendorBy[d][m]) || 0
    })
    upcoming.push({ date: d, dow: dow(d), day: DAYLABEL[dow(d)], actual, vendor })
  }

  return NextResponse.json({
    ok: true,
    today,
    histStart,
    histDays: HIST,
    markets: MARKETS,
    dayLabels: DAYLABEL,
    dowOccurrences: dowOcc,
    avgByMarketDow: avgOf(hist),
    vendorAvgByMarketDow: avgOf(histVendor),
    upcoming,
    note: 'Confirmed/checked checkouts, deduped per unit/day. avg/actual = our team; vendor = Botanica (hotel-cleaned).',
    generatedAt: new Date().toISOString(),
  })
}
