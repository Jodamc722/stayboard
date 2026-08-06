// app/api/labor/kpi/route.ts  (v2)
//
//   GET /api/labor/kpi?days=7
//
// v1: hours, OT, flags, per-person labor.
// v2 adds:
//   tasks       — all Breezeway tasks completed in the window, by type
//   economics   — portfolio cleaning revenue vs cleaning labor cost
//   perCleaner  — THE headline KPI: revenue each cleaner generated
//                 (cleaning fees of the checkouts they turned) vs their
//                 labor cost, with an explicit attribution audit trail.
//
// ACCURACY CONTRACT (this number gets managed by, so it must be honest):
//   1. Revenue is attributed ONLY through an explicit join:
//      clean task (assignee, listing, date) -> reservation checking out of
//      that listing that day -> its cleaning fee. No proration, no averages.
//   2. Whatever cannot be attributed is REPORTED, never silently dropped:
//      `unattributed` carries fees with no matched clean and cleans with no
//      matched checkout, so attributed + unattributed always reconciles to
//      the portfolio total.
//   3. `attribution.rate` says how much of the revenue the per-cleaner view
//      actually explains. Below ~0.85, fix the data (assignees missing in
//      Breezeway, listing id mismatches) before comparing people.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getShifts, nameMatches } from '@/lib/homebase'
import { getTimecards, computeLaborKpis } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const round2 = (n: number) => Math.round(n * 100) / 100

function currentWorkweek(now: Date) {
  const localDow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay()
  const sinceMonday = (localDow + 6) % 7
  return { start: dISO(addDays(now, -sinceMonday)), end: dISO(addDays(now, 6 - sinceMonday)) }
}

const pickNum = (o: any, ...ks: string[]) => {
  for (const k of ks) { const n = Number(o?.[k]); if (Number.isFinite(n) && n > 0) return n }
  return null
}

function cleaningFeeOf(r: any): number | null {
  let fee = pickNum(r, 'cleaning_fee', 'cleaningFee')
  for (const field of ['fees', 'money']) {
    if (fee != null) break
    if (!r[field]) continue
    try {
      const o = typeof r[field] === 'string' ? JSON.parse(r[field]) : r[field]
      fee = pickNum(o, 'fareCleaning', 'cleaning', 'cleaning_fee', 'cleaningFee')
    } catch {}
  }
  return fee
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const now = new Date()
  const today = dISO(now)
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7))
  const start = dISO(addDays(now, -(days - 1)))
  const end = today

  try {
    const settings = await getLaborSettings(url.searchParams.get('market') || 'default')
    const week = currentWorkweek(now)
    const [dayShifts, timecards, weekShifts] = await Promise.all([
      shiftsForRange(start, end),
      getTimecards(start, end),
      shiftsForRange(week.start, week.end),
    ])
    const sb = supabaseAdmin()

    // ---- All completed tasks in window ------------------------------------
    const { data: taskRows } = await sb
      .from('breezeway_tasks_sync')
      .select('id, type, name, assignee, listing_id, completed_at')
      .gte('completed_at', start)
      .lte('completed_at', end + 'T23:59:59')

    const classify = (t: any): 'clean' | 'inspection' | 'maintenance' | 'other' => {
      const s = `${t.type || ''} ${t.name || ''}`.toLowerCase()
      if (/clean|turn|housekeep/.test(s)) return 'clean'
      if (/inspect|walk/.test(s)) return 'inspection'
      if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s)) return 'maintenance'
      return 'other'
    }
    const tasks = { clean: 0, inspection: 0, maintenance: 0, other: 0, total: 0 }
    const cleanTasks: any[] = []
    for (const t of taskRows || []) {
      const c = classify(t)
      tasks[c]++; tasks.total++
      if (c === 'clean') cleanTasks.push(t)
    }

    // ---- Checkouts + fees in window ---------------------------------------
    const { data: resRows } = await sb
      .from('guesty_reservations')
      .select('id, listing_id, check_in, check_out, cleaning_fee, fees, money')
      .gte('check_out', start)
      .lte('check_out', end)

    // ---- THE JOIN: checkout -> the clean that turned it -------------------
    // Match on listing_id + clean completed on checkout day or the day after
    // (late cleans). Each clean task consumes at most one checkout.
    const usedTask = new Set<string>()
    type Attr = { resId: string; fee: number | null; assignee: string | null; listing: string }
    const attributions: Attr[] = []
    for (const r of resRows || []) {
      const co = String(r.check_out).slice(0, 10)
      const coNext = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
      const match = cleanTasks.find(t =>
        !usedTask.has(t.id) &&
        String(t.listing_id) === String(r.listing_id) &&
        [co, coNext].includes(String(t.completed_at).slice(0, 10))
      )
      if (match) usedTask.add(match.id)
      attributions.push({
        resId: r.id,
        fee: cleaningFeeOf(r),
        assignee: match?.assignee || null,
        listing: String(r.listing_id),
      })
    }

    const totalFees = round2(attributions.reduce((a, x) => a + (x.fee ?? 0), 0))
    const attributed = attributions.filter(x => x.assignee && x.fee != null)
    const attributedFees = round2(attributed.reduce((a, x) => a + (x.fee as number), 0))

    // ---- Per-cleaner: revenue generated vs labor cost ---------------------
    const cleanerNames = new Set<string>(attributed.map(x => x.assignee as string))
    timecards.forEach(t => { if (!t.role || /clean|housekeep|turn/i.test(t.role)) cleanerNames.add(t.name) })

    const perCleaner = Array.from(cleanerNames).map(name => {
      const mine = attributed.filter(x => nameMatches(x.assignee as string, name))
      const revenue = round2(mine.reduce((a, x) => a + (x.fee as number), 0))
      const myCards = timecards.filter(t => nameMatches(t.name, name))
      const hours = round2(myCards.reduce((a, t) => a + (t.hours ?? 0), 0))
      const cost = myCards.some(t => t.laborCost != null)
        ? round2(myCards.reduce((a, t) => a + (t.laborCost ?? 0), 0))
        : null
      const myCleans = cleanTasks.filter(t => t.assignee && nameMatches(t.assignee, name)).length
      return {
        name,
        cleans: myCleans,
        checkoutsAttributed: mine.length,
        revenueGenerated: revenue,
        hours,
        laborCost: cost,
        margin: cost != null ? round2(revenue - cost) : null,
        // revenue per $1 of labor — the number Jon manages by
        revenuePerLaborDollar: cost ? round2(revenue / cost) : null,
        revenuePerHour: hours ? round2(revenue / hours) : null,
        avgFeePerClean: mine.length ? round2(revenue / mine.length) : null,
      }
    }).sort((a, b) => (b.revenuePerLaborDollar ?? -1) - (a.revenuePerLaborDollar ?? -1))

    // ---- Reconciliation — nothing silently dropped ------------------------
    const unattributed = {
      feesWithNoMatchedClean: round2(
        attributions.filter(x => x.fee != null && !x.assignee).reduce((a, x) => a + (x.fee as number), 0)),
      checkoutsWithNoFeeData: attributions.filter(x => x.fee == null).length,
      cleansWithNoAssignee: cleanTasks.filter(t => !t.assignee).length,
      cleansWithNoMatchedCheckout: cleanTasks.filter(t => !usedTask.has(t.id)).length,
    }
    const attribution = {
      totalCleaningRevenue: totalFees,
      attributedRevenue: attributedFees,
      rate: totalFees > 0 ? round2(attributedFees / totalFees) : 0,
      reliable: totalFees > 0 && attributedFees / totalFees >= (Number(settings.attribution_min) || 0.85),
      note: 'Below 0.85, fix Breezeway assignees / listing mappings before comparing cleaners.',
    }

    // ---- Core labor KPIs + portfolio economics ----------------------------
    const occupiedNights = null // occupancy join unchanged from v1 if wanted
    const kpis = computeLaborKpis({
      start, end, shifts: dayShifts, timecards, weekShifts,
      cleansCompleted: tasks.clean || null, occupiedNights,
      todayISO: now.toISOString(), otWeeklyHours: Number(settings.ot_weekly_hours) || 40,
    })
    const cleaningLaborCost = round2(
      timecards.filter(t => !t.role || /clean|housekeep|turn/i.test(t.role))
        .reduce((a, t) => a + (t.laborCost ?? 0), 0)) || null

    const economics = {
      cleaningRevenue: totalFees,
      cleaningLaborCost,
      cleaningMargin: cleaningLaborCost != null ? round2(totalFees - cleaningLaborCost) : null,
      cleaningMarginPct: cleaningLaborCost != null && totalFees > 0
        ? round2(((totalFees - cleaningLaborCost) / totalFees) * 100) : null,
      revenuePerLaborDollar: cleaningLaborCost ? round2(totalFees / cleaningLaborCost) : null,
    }

    return NextResponse.json({
      ok: true, ...kpis, tasks, economics, perCleaner, attribution, unattributed, settings,
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
