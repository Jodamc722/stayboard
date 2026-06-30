// Turnover schedule — the cleaning plan built from CONFIRMED Guesty checkouts (each checkout =
// a departure clean that Breezeway auto-creates). Day view + weekly view (Sun-Saturday), grouped
// by market (Miami / Broward / North). Same-day turns (a check-in on the checkout date) are
// flagged. Read-only; assignment happens via /api/schedule/assign. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf, type Market } from '@/lib/segments'
import { breezewayConfigured, listBreezewayPeople } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEAD = /cancel|declin|inquir|expire|denied/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
// Sunday that starts the week containing `iso` (week = Sun..Sat).
function weekStartSunday(iso: string) { const d = new Date(iso + 'T12:00:00'); const dow = d.getDay(); d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10) }
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const view = sp.get('view') === 'day' ? 'day' : 'week'
  const today = ymd(new Date())
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? sp.get('date')! : today
  const start = view === 'day' ? anchor : weekStartSunday(anchor)
  const end = view === 'day' ? anchor : addDays(start, 6)

  const db = supabaseAdmin()
  // Checkouts in window = the departure cleans. Pull a little extra for next-arrival lookup.
  const [{ data: outs }, { data: ins }, { data: listings }] = await Promise.all([
    db.from('guesty_reservations').select('listing_id,listing_name,guest_name,check_out,check_in,status,nights,source').gte('check_out', start).lte('check_out', end).limit(4000),
    db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', start).lte('check_in', addDays(end, 30)).limit(8000),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status'),
  ])

  const meta: Record<string, { name: string; market: Market; active: boolean }> = {}
  for (const l of (listings || [])) {
    const id = String((l as any).id)
    meta[id] = {
      name: (l as any).nickname || (l as any).title || 'Unit',
      market: marketOf((l as any).building, (l as any).address_city, (l as any).nickname || (l as any).title),
      active: !/inactive|disabled|archived|deleted/i.test(String((l as any).status || '')),
    }
  }

  // Check-ins by listing (live only) for same-day-turn + next-arrival.
  const arrivalsByListing: Record<string, string[]> = {}
  for (const r of (ins || [])) {
    if (DEAD.test(String((r as any).status || ''))) continue
    const id = String((r as any).listing_id); const ci = String((r as any).check_in || '').slice(0, 10)
    if (!ci) continue; (arrivalsByListing[id] ||= []).push(ci)
  }
  for (const k of Object.keys(arrivalsByListing)) arrivalsByListing[k].sort()

  type Clean = { listingId: string; unit: string; market: Market; date: string; guestOut: string | null; nights: number | null; source: string | null; sameDayTurn: boolean; nextArrival: string | null }
  const cleans: Clean[] = []
  for (const r of (outs || [])) {
    if (DEAD.test(String((r as any).status || ''))) continue
    const id = String((r as any).listing_id)
    const date = String((r as any).check_out || '').slice(0, 10)
    if (!date) continue
    const m = meta[id]
    const arrivals = arrivalsByListing[id] || []
    const sameDayTurn = arrivals.includes(date)
    const nextArrival = arrivals.find(a => a >= date) || null
    cleans.push({
      listingId: id,
      unit: m?.name || (r as any).listing_name || 'Unit',
      market: m?.market || 'Miami',
      date,
      guestOut: (r as any).guest_name || null,
      nights: (r as any).nights ?? null,
      source: (r as any).source || null,
      sameDayTurn,
      nextArrival,
    })
  }

  // Build day buckets across the window, each grouped by market.
  const MARKETS: Market[] = ['Miami', 'Broward', 'North']
  const dayList: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) dayList.push(d)
  const days = dayList.map(date => {
    const dayCleans = cleans.filter(c => c.date === date).sort((a, b) => (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.unit.localeCompare(b.unit))
    const markets: Record<string, Clean[]> = {}
    for (const m of MARKETS) markets[m] = dayCleans.filter(c => c.market === m)
    const d = new Date(date + 'T12:00:00')
    return { date, dow: DAYLABEL[d.getDay()], count: dayCleans.length, markets }
  })

  // Housekeepers for the assignment dropdown (best-effort; empty if Breezeway not wired).
  let housekeepers: { id: number; name: string; region: string | null }[] = []
  if (breezewayConfigured()) {
    try {
      const people = await listBreezewayPeople()
      housekeepers = people
        .filter(p => p.departments.length === 0 || p.departments.includes('housekeeping'))
        .map(p => ({ id: p.id, name: p.name, region: p.region }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { /* dropdown just stays empty */ }
  }

  return NextResponse.json({
    ok: true,
    view, today,
    weekStart: start, weekEnd: end,
    prev: view === 'day' ? addDays(start, -1) : addDays(start, -7),
    next: view === 'day' ? addDays(start, 1) : addDays(start, 7),
    totals: { cleans: cleans.length, byMarket: MARKETS.map(m => ({ market: m, count: cleans.filter(c => c.market === m).length })) },
    days,
    housekeepers,
    breezeway: breezewayConfigured(),
  })
}
