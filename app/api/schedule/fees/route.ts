import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cleaning-fee revenue per day per market for a week. Isolated on purpose — if this fails,
// the scheduler just shows no fee, and nothing else breaks. Fee = raw.money.fareCleaning (guest-charged).
const LIVE = /confirm|checked/i
const VENDOR = /botanica|park\s*towers?|\bpt\b|amrit|capri|lucerne/i
const MARKETS = ['Miami', 'Broward', 'North']

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function dow(s: string) { return new Date(s + 'T12:00:00').getDay() }
function sunOf(s: string) { return addDays(s, -dow(s)) }

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const ws = searchParams.get('weekStart') || sunOf(today)
    const we = addDays(ws, 6)

    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(5000)
    const meta: Record<string, { market: string; vendor: boolean }> = {}
    for (const l of (listings || []) as any[]) {
      const id = String(l.id)
      const building = str(l.building)
      const name = l.nickname || l.title || 'Unit'
      let market = String(marketOf(building, l.address_city, name) || 'Miami')
      if (!MARKETS.includes(market)) market = 'Miami'
      meta[id] = { market, vendor: VENDOR.test(building) || VENDOR.test(name) }
    }

    const rows: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from('guesty_reservations')
        .select('listing_id,check_out,status,fee:raw->money->>fareCleaning')
        .gte('check_out', ws).lte('check_out', we)
        .order('check_out', { ascending: true })
        .range(off, off + 999)
      if (!data || !data.length) break
      rows.push(...data)
      if (data.length < 1000) break
    }

    const fee: Record<string, Record<string, number>> = {}
    const seen = new Set<string>()
    for (const r of rows as any[]) {
      if (!LIVE.test(str(r.status))) continue
      const id = String(r.listing_id)
      const m = meta[id]
      if (!m || m.vendor) continue
      const date = str(r.check_out).slice(0, 10)
      const dedup = id + '__' + date
      if (seen.has(dedup)) continue
      seen.add(dedup)
      const f = Number(r.fee) || 0
      if (!fee[date]) fee[date] = {}
      fee[date][m.market] = Math.round(((fee[date][m.market] || 0) + f) * 100) / 100
    }

    return NextResponse.json({ ok: true, weekStart: ws, weekEnd: we, fee })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: str(e && e.message), fee: {} })
  }
}
