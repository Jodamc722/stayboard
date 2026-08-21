// THE CLEAN LOG — every departure clean in a window, as a row: which unit, which day, who turned
// it, how long it took against the benchmark for that size of unit, what it earned, and HOW LONG
// THE GUEST HAD BEEN THERE.
//
// Jon, 2026-08-21, after the weekly view showed hours-per-clean climbing 2.47h → 3.13h while
// volume fell: "can you see what units cleaned or completed and assigned" and "use Indicator, like
// long stay clean, meaning LOS tracking". A 3-hour turn after a 21-night stay is not the same
// event as a 3-hour turn after two nights, and an average that mixes them explains nothing.
//
// The long-stay threshold is NOT invented here — it is the operator-set `longStayNights` from
// /users → Ops presets (default 10), the same one the schedule and the Slack alerts use. Likewise
// the per-clean minute benchmark comes from `benchmarkMinutes()` by bedroom count.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex, benchmarkMinutes } from '@/lib/ops-presets'
import { isDepartureCleanName } from '@/lib/breezeway'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const dOf = (v: any) => str(v).slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

async function pageAll(q: (a: number, b: number) => any, pages = 6): Promise<any[]> {
  const out: any[] = []
  for (let p = 0; p < pages; p++) {
    const { data } = await q(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const money = canSeeMoney(access)

  const sp = new URL(req.url).searchParams
  const from = dOf(sp.get('from')); const to = dOf(sp.get('to'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from and to are required as YYYY-MM-DD' }, { status: 400 })
  }
  const market = String(sp.get('market') || 'all').toLowerCase()
  const unitFilter = str(sp.get('unit'))

  const sb = supabaseAdmin()
  const presets = await getOpsPresets()
  const timing = (presets as any).timing || {}
  const longNights = Math.max(2, Number(timing.longStayNights) || 10)
  const VENDOR_RE = vendorRegex((presets as any).vendorBuildings)

  const [listings, tasks, reservations] = await Promise.all([
    pageAll((a, b) => sb.from('guesty_listings')
      .select('id, title, nickname, building, unit, bedrooms, address_city, status').order('id').range(a, b), 3),
    pageAll((a, b) => sb.from('breezeway_tasks_sync')
      .select('id, reference_property_id, name, status, scheduled_date, assignees, started_at, finished_at, total_minutes, linked_reservation_id, rate_paid')
      .gte('scheduled_date', from).lte('scheduled_date', to).order('scheduled_date').range(a, b)),
    // A stay that ENDED in the window is the one a departure clean follows. Cleaning fee comes from
    // the same `->>` scalars the rest of the app uses (never select raw->money in bulk).
    pageAll((a, b) => sb.from('guesty_reservations')
      .select('id, listing_id, guest_name, check_in, check_out, nights, status, source, cleaning:raw->money->>fareCleaning')
      .gte('check_out', from).lte('check_out', to).order('check_out').range(a, b)),
  ])

  const lmap: Record<string, any> = {}
  for (const l of listings) {
    const name = str(l.title) || str(l.nickname) || str(l.unit) || str(l.id)
    const vendor = VENDOR_RE ? VENDOR_RE.test(str(l.building) + ' ' + name) : false
    lmap[String(l.id)] = {
      name, building: str(l.building), bedrooms: l.bedrooms == null ? null : Number(l.bedrooms),
      vendor, dead: DEAD.includes(str(l.status).toLowerCase()),
      market: vendor ? 'vendor' : String(marketOf(l.building, l.address_city, name) || '').toLowerCase(),
    }
  }

  // Reservations indexed both ways: by id for a linked task, and by unit+checkout day for the rest.
  const resById: Record<string, any> = {}
  const resByUnitDay: Record<string, any[]> = {}
  for (const r of reservations) {
    if (/cancel|declin|expir|denied|inquiry/i.test(str(r.status))) continue
    resById[String(r.id)] = r
    const k = String(r.listing_id) + '|' + dOf(r.check_out)
    ;(resByUnitDay[k] = resByUnitDay[k] || []).push(r)
  }

  const doer = (t: any): string[] => {
    const a = Array.isArray(t?.assignees) ? t.assignees : []
    return a.map((x: any) => str(typeof x === 'string' ? x : x?.name).trim()).filter(Boolean)
  }
  const isDone = (t: any) => /complete|finish|close|approv|done/i.test(str(t.status)) || !!t.finished_at

  const rows: any[] = []
  for (const t of tasks) {
    if (!isDepartureCleanName(t.name)) continue
    const li = lmap[String(t.reference_property_id)]
    if (market !== 'all' && (li?.market || 'unassigned') !== market) continue
    if (unitFilter && String(t.reference_property_id) !== unitFilter) continue

    const day = dOf(t.finished_at) || dOf(t.scheduled_date)
    // Link first, then the unit's checkout that day, then the day before — a clean is often
    // scheduled the morning after a late checkout.
    let res = t.linked_reservation_id ? resById[String(t.linked_reservation_id)] : null
    if (!res) {
      const k = String(t.reference_property_id) + '|' + day
      res = (resByUnitDay[k] || [])[0]
      if (!res) {
        const prev = new Date(Date.parse(day + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10)
        res = (resByUnitDay[String(t.reference_property_id) + '|' + prev] || [])[0]
      }
    }
    const nights = res ? (Number(res.nights) > 0 ? Number(res.nights) : null) : null
    const minutes = num(t.total_minutes) || null
    const bench = benchmarkMinutes(timing as any, li?.bedrooms)

    rows.push({
      id: String(t.id),
      unitId: String(t.reference_property_id || ''),
      unit: li?.name || String(t.reference_property_id || 'Unknown unit'),
      building: li?.building || '',
      bedrooms: li?.bedrooms ?? null,
      market: li?.market || 'unassigned',
      vendorUnit: !!li?.vendor,
      date: day,
      task: str(t.name),
      done: isDone(t),
      who: doer(t),
      minutes,
      benchmarkMinutes: bench,
      // Over the benchmark for a unit of this size — the honest way to read a long clean.
      overBenchmark: minutes != null && bench > 0 ? round2(minutes - bench) : null,
      // ── LOS ───────────────────────────────────────────────────────────────
      nights,
      longStay: nights != null ? nights >= longNights : false,
      losBand: nights == null ? 'unknown'
        : nights <= 2 ? 'short'
          : nights < longNights ? 'normal'
            : nights >= 30 ? 'monthly' : 'long',
      guest: str(res?.guest_name) || null,
      source: str(res?.source) || null,
      fee: money && res ? round2(num(res.cleaning)) : null,
      charge: money ? round2(num(t.rate_paid)) : null,
      matched: !!res,
    })
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.unit.localeCompare(b.unit))

  const done = rows.filter(r => r.done)
  const withMin = done.filter(r => r.minutes != null)
  const longOnes = done.filter(r => r.longStay)
  const shortOnes = done.filter(r => r.losBand === 'short' || r.losBand === 'normal')
  const avgMin = (list: any[]) => (list.length ? Math.round(list.reduce((s, r) => s + (r.minutes || 0), 0) / list.length) : null)

  // BY UNIT — the other direction Jon asked for.
  const byUnitMap: Record<string, any> = {}
  for (const r of done) {
    const u = byUnitMap[r.unitId] || (byUnitMap[r.unitId] = {
      unitId: r.unitId, unit: r.unit, building: r.building, bedrooms: r.bedrooms,
      cleans: 0, minutes: 0, withMinutes: 0, longStays: 0, benchmark: r.benchmarkMinutes, people: {} as Record<string, number>,
    })
    u.cleans++
    if (r.minutes != null) { u.minutes += r.minutes; u.withMinutes++ }
    if (r.longStay) u.longStays++
    for (const w of r.who) u.people[w] = (u.people[w] || 0) + 1
  }
  const byUnit = Object.values(byUnitMap).map((u: any) => ({
    ...u,
    avgMinutes: u.withMinutes ? Math.round(u.minutes / u.withMinutes) : null,
    overBenchmark: u.withMinutes && u.benchmark ? Math.round(u.minutes / u.withMinutes - u.benchmark) : null,
    cleaners: Object.keys(u.people).sort((a, b) => u.people[b] - u.people[a]),
    people: undefined,
  })).sort((a: any, b: any) => (b.overBenchmark ?? -9999) - (a.overBenchmark ?? -9999) || b.cleans - a.cleans)

  return NextResponse.json({
    ok: true,
    from, to, market, longStayNights: longNights,
    rows,
    byUnit,
    summary: {
      cleans: done.length,
      notFinished: rows.length - done.length,
      unassigned: done.filter(r => r.who.length === 0).length,
      unmatched: done.filter(r => !r.matched).length,
      withMinutes: withMin.length,
      avgMinutes: avgMin(withMin),
      // The comparison that explains a drifting average.
      longStayCleans: longOnes.length,
      avgMinutesLongStay: avgMin(longOnes.filter(r => r.minutes != null)),
      avgMinutesShorter: avgMin(shortOnes.filter(r => r.minutes != null)),
    },
    note: 'Minutes are Breezeway; the benchmark is the per-bedroom target in Ops presets. A clean with no minutes logged is counted but cannot be timed.',
  })
}
