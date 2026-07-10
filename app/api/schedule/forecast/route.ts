import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cleaner-demand forecast for a Sunday-start week (Sun -> Sat, how the team builds the schedule).
// A clean = a confirmed/checked Guesty checkout, deduped per unit/day (same rule as /api/schedule).
// Botanica is vendor-cleaned (hotel staff) - tracked separately, not counted in OUR needs. ET dates.
const LIVE = /confirm|checked/i
const VENDOR = /botanica|park\s*towers?|\bpt\b|amrit|capri|lucerne/i
const MARKETS = ['Miami', 'Broward', 'North']
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function dow(s: string) { return new Date(s + 'T12:00:00').getDay() }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function zeros() { return [0, 0, 0, 0, 0, 0, 0] }
function minD(a: string, b: string) { return a < b ? a : b }
function maxD(a: string, b: string) { return a > b ? a : b }
// Sunday on or before a date (week starts Sunday).
function sunOf(s: string) { return addDays(s, -dow(s)) }

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

export async function GET(req: NextRequest) {
  const HIST = 60
  const today = ymd(new Date())
  const histStart = addDays(today, -HIST)

  const sp = new URL(req.url).searchParams
  const wsParam = sp.get('weekStart') || ''
  const weekStart = sunOf(/^\d{4}-\d{2}-\d{2}$/.test(wsParam) ? wsParam : today)
  const weekEnd = addDays(weekStart, 6)

  const qFrom = minD(histStart, weekStart)
  const qTo = maxD(addDays(today, 6), weekEnd)

  const db = supabaseAdmin()
  const [outs, { data: listings }] = await Promise.all([
    fetchCheckouts(db, qFrom, qTo),
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
  const wkBy: Record<string, Record<string, number>> = {}
  const wkVendorBy: Record<string, Record<string, number>> = {}

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
    if (date >= histStart && date < today) {
      (m.vendor ? histVendor : hist)[m.market][dow(date)]++
    }
    if (date >= weekStart && date <= weekEnd) {
      const b = m.vendor ? wkVendorBy : wkBy
      if (!b[date]) b[date] = {}
      b[date][m.market] = (b[date][m.market] || 0) + 1
    }
  }
  // Fold in Breezeway departure cleans for the current week (status-filtered like the daily
  // board) and reconcile MOVED cleans so each turnover counts once, on its actual Breezeway day.
  const bzWeekRaw = (await db.from('breezeway_tasks_sync').select('reference_property_id, scheduled_date, name, status').ilike('name', '%Departure%').gte('scheduled_date', weekStart).lte('scheduled_date', weekEnd)).data as any[] | null;
  const bzWeek = (bzWeekRaw || []).filter((t: any) => !/cancel|delet/i.test(String(t.status || '')));
  const bzDates: Record<string, string[]> = {};
  for (const t of bzWeek) {
    const bid = String((t as any).reference_property_id || '');
    const bdate = str((t as any).scheduled_date).slice(0, 10);
    if (!bid || !bdate) continue;
    if (!bzDates[bid]) bzDates[bid] = [];
    if (bzDates[bid].indexOf(bdate) < 0) bzDates[bid].push(bdate);
  }
  // This week's Guesty checkout dates per listing (same filters as the counting loop above)
  const gDates: Record<string, string[]> = {};
  for (const r of outs) {
    if (!LIVE.test(str(r.status))) continue;
    const id = String(r.listing_id);
    const date = str(r.check_out).slice(0, 10);
    if (!date || date < weekStart || date > weekEnd) continue;
    if (!gDates[id]) gDates[id] = [];
    if (gDates[id].indexOf(date) < 0) gDates[id].push(date);
  }
  for (const t of bzWeek) {
    const bid = String((t as any).reference_property_id || '');
    const bdate = str((t as any).scheduled_date).slice(0, 10);
    if (!bid || !bdate) continue;
    const bkey = bid + '__' + bdate;
    if (seen.has(bkey)) continue;
    seen.add(bkey);
    const bm = meta[bid];
    if (!bm) continue;
    const bb = bm.vendor ? wkVendorBy : wkBy;
    if (!bb[bdate]) bb[bdate] = {};
    bb[bdate][bm.market] = (bb[bdate][bm.market] || 0) + 1;
  }
  // MOVED dedupe: a checkout whose departure task sits on a DIFFERENT day was counted twice
  // (checkout day + task day). Uncount the checkout day — the daily board shows the clean only
  // on its Breezeway day. Guarded so a genuinely missing task (no bz row) still counts.
  for (const id of Object.keys(gDates)) {
    const bz = bzDates[id];
    if (!bz || !bz.length) continue;
    const spare = bz.filter(b => gDates[id].indexOf(b) < 0).length;
    let deducted = 0;
    for (const gd of gDates[id]) {
      if (bz.indexOf(gd) >= 0) continue;
      if (deducted >= spare) break;
      const m = meta[id];
      if (!m) continue;
      const bb = m.vendor ? wkVendorBy : wkBy;
      if (bb[gd] && bb[gd][m.market] > 0) { bb[gd][m.market] = bb[gd][m.market] - 1; deducted++; }
    }
  }

  const dowOcc = zeros()
  for (let d = histStart; d < today; d = addDays(d, 1)) dowOcc[dow(d)]++
  const avgOf = (src: Record<string, number[]>) => {
    const out: Record<string, number[]> = {}
    MARKETS.forEach(m => { out[m] = src[m].map((c, i) => (dowOcc[i] ? Math.round((c / dowOcc[i]) * 10) / 10 : 0)) })
    return out
  }

  const week: any[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const actual: Record<string, number> = {}
    const vendor: Record<string, number> = {}
    MARKETS.forEach(m => {
      actual[m] = (wkBy[d] && wkBy[d][m]) || 0
      vendor[m] = (wkVendorBy[d] && wkVendorBy[d][m]) || 0
    })
    week.push({ date: d, dow: dow(d), day: DAYLABEL[dow(d)], actual, vendor, isToday: d === today, isPast: d < today })
  }

  return NextResponse.json({
    ok: true,
    today,
    histDays: HIST,
    markets: MARKETS,
    dayLabels: DAYLABEL,
    weekStart,
    weekEnd,
    prevWeekStart: addDays(weekStart, -7),
    nextWeekStart: addDays(weekStart, 7),
    isCurrentWeek: weekStart === sunOf(today),
    dowOccurrences: dowOcc,
    avgByMarketDow: avgOf(hist),
    vendorAvgByMarketDow: avgOf(histVendor),
    week,
    note: 'Week runs Sun->Sat. avg/actual = our team; vendor = Botanica (hotel-cleaned).',
    generatedAt: new Date().toISOString(),
  })
}
