// app/api/labor/kpi/route.ts  (v3)
//
//   GET /api/labor/kpi?days=7&market=all|miami|broward|north
//
// Real schema (from lib/breezeway.ts, lib/kpi.ts, lib/segments.ts):
//   breezeway_tasks_sync: finished_at, type_department, name, assignee_name,
//     finished_by_name, reference_property_id (guesty listing id), rate_paid,
//     total_minutes
//   guesty_reservations: check_out, listing_id, status, raw->money->>fareCleaning
//   guesty_listings: id, nickname, title, building, address_city -> marketOf()
//
// Cost basis: rate_paid (what the cleaner was actually paid per task) is the
// primary labor-cost source — real dollars per task, independent of Homebase
// wage visibility. Homebase supplies hours / OT / no-shows.
//
// Workweek: Sunday–Saturday by default ((settings as any).week_start = 'monday'
// to override). OT projection is week-to-date within THIS workweek + remaining
// scheduled shifts, not the rolling window.
//
// ACCURACY CONTRACT unchanged: revenue attributes only through the explicit
// checkout -> clean-task join; everything unattributable is reported, and
// attributed + unattributed reconciles to the total.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getShifts, nameMatches } from '@/lib/homebase'
import { getTimecards, computeLaborKpis } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function currentWorkweek(now: Date, weekStart: 'sunday' | 'monday') {
  const localDow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay() // 0=Sun
  const offset = weekStart === 'sunday' ? localDow : (localDow + 6) % 7
  return { start: dISO(addDays(now, -offset)), end: dISO(addDays(now, 6 - offset)) }
}

async function pageAll(q: (a: number, b: number) => any, pages = 5): Promise<any[]> {
  const out: any[] = []
  for (let p = 0; p < pages; p++) {
    const { data } = await q(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const now = new Date()
  const today = dISO(now)
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7))
  const marketParam = String(url.searchParams.get('market') || 'all').toLowerCase()
  const start = dISO(addDays(now, -(days - 1)))
  const end = today

  try {
    const settings = await getLaborSettings(marketParam === 'all' ? 'default' : marketParam)
    const weekStart = ((settings as any).week_start === 'monday' ? 'monday' : 'sunday') as 'sunday' | 'monday'
    const week = currentWorkweek(now, weekStart)
    const sb = supabaseAdmin()

    const [dayShifts, timecards, weekShifts, listingRows] = await Promise.all([
      shiftsForRange(start, end),
      getTimecards(start, end),
      shiftsForRange(week.start, week.end),
      pageAll((a, b) => sb.from('guesty_listings')
        .select('id,nickname,title,building,address_city').range(a, b)),
    ])

    // listing id -> { market, name }
    const lmap: Record<string, { market: string; name: string }> = {}
    for (const l of listingRows) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = { market: marketOf(l.building, l.address_city, name).toLowerCase(), name }
    }
    const marketFilter = (listingId: any) =>
      marketParam === 'all' || (lmap[String(listingId)]?.market === marketParam)

    // ---- Tasks: everything finished in the window (real columns) ----------
    const taskRows = (await pageAll((a, b) => sb.from('breezeway_tasks_sync')
      .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid,total_minutes')
      .gte('finished_at', start).lte('finished_at', end + 'T23:59:59')
      .range(a, b)))
      .filter(t => marketFilter(t.reference_property_id))

    const classify = (t: any): 'clean' | 'inspection' | 'maintenance' | 'other' => {
      const s = `${t.type_department || ''} ${t.name || ''}`.toLowerCase()
      if (/clean|housekeep|turn/.test(s)) return 'clean'
      if (/inspect|walk/.test(s)) return 'inspection'
      if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s)) return 'maintenance'
      return 'other'
    }
    const doer = (t: any): string | null => t.assignee_name || t.finished_by_name || null

    const tasks = { clean: 0, inspection: 0, maintenance: 0, other: 0, total: 0 }
    const cleanTasks: any[] = []
    let taskPayTotal = 0, taskMinutesTotal = 0
    for (const t of taskRows) {
      const c = classify(t)
      ;(tasks as any)[c]++; tasks.total++
      taskPayTotal += num(t.rate_paid) ?? 0
      taskMinutesTotal += num(t.total_minutes) ?? 0
      if (c === 'clean') cleanTasks.push(t)
    }
    const cleaningTaskPay = round2(cleanTasks.reduce((a, t) => a + (num(t.rate_paid) ?? 0), 0))

    // ---- Checkouts + cleaning fees (raw->money->>fareCleaning) ------------
    const resRows = (await pageAll((a, b) => sb.from('guesty_reservations')
      .select('id,listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
      .gte('check_out', start).lte('check_out', end)
      .not('status', 'in', '("canceled","cancelled","declined")')
      .range(a, b)))
      .filter(r => marketFilter(r.listing_id))

    // ---- Join: checkout -> the clean that turned it ------------------------
    const usedTask = new Set<string>()
    type Attr = { fee: number | null; assignee: string | null }
    const attributions: Attr[] = []
    for (const r of resRows) {
      const co = String(r.check_out).slice(0, 10)
      const coNext = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
      const match = cleanTasks.find(t =>
        !usedTask.has(String(t.id)) &&
        String(t.reference_property_id) === String(r.listing_id) &&
        [co, coNext].includes(String(t.finished_at).slice(0, 10))
      )
      if (match) usedTask.add(String(match.id))
      attributions.push({ fee: num(r.cleaning), assignee: match ? doer(match) : null })
    }

    const totalFees = round2(attributions.reduce((a, x) => a + (x.fee ?? 0), 0))
    const attributed = attributions.filter(x => x.assignee && x.fee != null)
    const attributedFees = round2(attributed.reduce((a, x) => a + (x.fee as number), 0))

    // ---- Per-cleaner: revenue generated vs what they were paid ------------
    const cleanerNames = new Set<string>()
    cleanTasks.forEach(t => { const d = doer(t); if (d) cleanerNames.add(d) })

    const perCleaner = Array.from(cleanerNames).map(name => {
      const myTasks = cleanTasks.filter(t => doer(t) && nameMatches(doer(t) as string, name))
      const myPay = round2(myTasks.reduce((a, t) => a + (num(t.rate_paid) ?? 0), 0))
      const myMinutes = myTasks.reduce((a, t) => a + (num(t.total_minutes) ?? 0), 0)
      const mine = attributed.filter(x => nameMatches(x.assignee as string, name))
      const revenue = round2(mine.reduce((a, x) => a + (x.fee as number), 0))
      const myCards = timecards.filter(t => nameMatches(t.name, name))
      const hbHours = round2(myCards.reduce((a, t) => a + (t.hours ?? 0), 0))
      return {
        name,
        cleans: myTasks.length,
        checkoutsAttributed: mine.length,
        revenueGenerated: revenue,
        taskPay: myPay,
        taskHours: round2(myMinutes / 60),
        homebaseHours: hbHours,
        margin: round2(revenue - myPay),
        revenuePerLaborDollar: myPay > 0 ? round2(revenue / myPay) : null,
        avgFeePerClean: mine.length ? round2(revenue / mine.length) : null,
        avgPayPerClean: myTasks.length ? round2(myPay / myTasks.length) : null,
      }
    }).sort((a, b) => (b.revenuePerLaborDollar ?? -1) - (a.revenuePerLaborDollar ?? -1))

    // ---- Reconciliation ----------------------------------------------------
    const unattributed = {
      feesWithNoMatchedClean: round2(
        attributions.filter(x => x.fee != null && !x.assignee).reduce((a, x) => a + (x.fee as number), 0)),
      checkoutsWithNoFeeData: attributions.filter(x => x.fee == null).length,
      cleansWithNoAssignee: cleanTasks.filter(t => !doer(t)).length,
      cleansWithNoMatchedCheckout: cleanTasks.filter(t => !usedTask.has(String(t.id))).length,
    }
    const attribution = {
      totalCleaningRevenue: totalFees,
      attributedRevenue: attributedFees,
      rate: totalFees > 0 ? round2(attributedFees / totalFees) : 0,
      reliable: totalFees > 0 && attributedFees / totalFees >= (Number(settings.attribution_min) || 0.85),
      note: 'Below the gate, fix Breezeway assignees / listing mappings before comparing cleaners.',
    }

    // ---- Homebase hours/OT (workweek-aligned) ------------------------------
    const kpis = computeLaborKpis({
      start, end, shifts: dayShifts, timecards, weekShifts,
      cleansCompleted: tasks.clean || null, occupiedNights: null,
      todayISO: now.toISOString(),
      otWeeklyHours: Number(settings.ot_weekly_hours) || 40,
      weekStartDate: week.start,
    } as any)

    const economics = {
      cleaningRevenue: totalFees,
      cleaningLaborCost: cleaningTaskPay,           // real: sum of rate_paid on cleans
      allTaskPay: round2(taskPayTotal),
      cleaningMargin: round2(totalFees - cleaningTaskPay),
      cleaningMarginPct: totalFees > 0 ? round2(((totalFees - cleaningTaskPay) / totalFees) * 100) : null,
      revenuePerLaborDollar: cleaningTaskPay > 0 ? round2(totalFees / cleaningTaskPay) : null,
      avgMinutesPerTask: tasks.total ? Math.round(taskMinutesTotal / tasks.total) : null,
      costBasis: 'breezeway rate_paid (per-task pay)',
    }

    return NextResponse.json({
      ok: true, market: marketParam, week: { ...week, weekStart },
      ...kpis, tasks, economics, perCleaner, attribution, unattributed, settings,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}

async function shiftsForRange(start: string, end: string) {
  const all = []
  for (let d = new Date(start + 'T12:00:00Z'); dISO(d) <= end; d = addDays(d, 1)) {
    const date = dISO(d)
    try { all.push(...(await getShifts(date, TZ)).map(x => ({ ...x, date }))) }
    catch {}
  }
  return all
}
