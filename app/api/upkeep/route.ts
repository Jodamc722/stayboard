// UPKEEP — the recurring programs, as a daily KPI page (Jon, 2026-10-03: "take the today page and
// build an operation page … this should track PM, deep cleans, AC filter changes, battery changes,
// inspections, FFE audits … late, coming soon, etc. Deep cleans every 6 months, AC filter change for
// central AC every 35 days, mini splits and wall units deep cleaned every 6 months, central AC coils
// cleaned every 6 months").
//
// Nothing new is recorded here. The cadence catalogue (lib/cadences, edited in Settings → Cadences)
// says what the programs are and how often; the ledger (lib/pm-calendar) works out, per unit × per
// program, when it was last done from the completed Breezeway task (and /ffe for FF&E audits), so
// when it is next due. This route only reshapes that ledger by PROGRAM instead of by building, with
// the horizon pushed out far enough that "on track" is a number and not an absence.
//
//   GET /api/upkeep?market=all|Miami|Broward
//   → programs[]: per program — late, due soon (14 days), on track, booked, no record — and rows.
import { NextRequest, NextResponse } from 'next/server'
import { buildDueCalendar, type DueItem } from '@/lib/pm-calendar'
import { CADENCE_KEY, resolveCadences } from '@/lib/cadences'
import { getSetting } from '@/lib/app-settings'
import { requireLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const SOON_DAYS = 14

export type UpkeepState = 'late' | 'soon' | 'ok' | 'booked' | 'none'
export type UpkeepRow = {
  id: string; listingId: string; unit: string; building: string; market: string
  lastDone: string | null; dueOn: string; daysOver: number
  state: UpkeepState
  task: { id: string; date: string } | null
  dept: DueItem['dept']; minutes: number; label: string
}
export type UpkeepProgram = {
  key: string; label: string; everyDays: number; dept: string; equipment: string
  /** The group the tile sits in on the page. */
  group: 'ac' | 'housekeeping' | 'maintenance' | 'quality' | 'other'
  inert: string | null
  units: number
  late: number; soon: number; ok: number; booked: number; none: number
  /** How many are current: (ok + booked + soon) over everything with a record. 0–100. */
  healthPct: number
  rows: UpkeepRow[]
}
export type Upkeep = {
  ok: true; today: string; market: string; soonDays: number
  markets: string[]; buildings: string[]
  programs: UpkeepProgram[]
  totals: { late: number; soon: number; ok: number; booked: number; none: number; lateUnits: number }
  degraded: string[]; enabled: boolean; canEdit: boolean
}

const GROUP_OF: Record<string, UpkeepProgram['group']> = {
  ac_filter: 'ac', ac_deep: 'ac', ac_split_clean: 'ac',
  deep_clean: 'housekeeping',
  pm_audit: 'maintenance', batteries: 'maintenance', dryer_vent: 'maintenance', water_heater: 'maintenance', pest_inhouse: 'maintenance', pest_vendor: 'maintenance', pressure_wash: 'maintenance',
  unit_inspection: 'quality', ffe_audit: 'quality',
}
// The order Jon named them, roughly: the A/C programs, the deep clean, the maintenance walks, the quality walks.
const ORDER = ['pm_audit', 'deep_clean', 'ac_filter', 'ac_deep', 'ac_split_clean', 'batteries', 'unit_inspection', 'ffe_audit']

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const canEdit = atLeast(gate.access.levels['upkeep'], 'edit')
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const today = ymd(new Date())
  try {
    const [cal, raw] = await Promise.all([
      buildDueCalendar(today, { market, horizonDays: 400 }),
      getSetting<any>(CADENCE_KEY, null).catch(() => null),
    ])
    const cfg = resolveCadences(raw)
    const inertWhy = new Map(cal.inert.map(i => [i.key, i.why]))
    const byKey = new Map<string, UpkeepProgram>()
    for (const c of cfg.cadences) {
      byKey.set(c.key, {
        key: c.key, label: c.label, everyDays: c.everyDays, dept: c.dept, equipment: c.equipment || 'any',
        group: GROUP_OF[c.key] || 'other', inert: inertWhy.get(c.key) || null,
        units: 0, late: 0, soon: 0, ok: 0, booked: 0, none: 0, healthPct: 0, rows: [],
      })
    }
    const markets = new Set<string>(), buildings = new Set<string>()
    for (const b of cal.buildings) {
      for (const it of b.items) {
        const p = byKey.get(it.cadenceKey); if (!p) continue
        const state: UpkeepState = it.scheduled ? 'booked' : it.band === 'unknown' ? 'none' : it.daysOver > 0 ? 'late' : it.daysOver >= -SOON_DAYS ? 'soon' : 'ok'
        p[state]++
        p.rows.push({
          id: it.id, listingId: it.listingId, unit: it.unit, building: it.building || b.building, market: it.market,
          lastDone: it.lastDone, dueOn: it.dueOn, daysOver: it.daysOver, state, task: it.scheduled ? { id: it.scheduled.taskId, date: it.scheduled.date } : null, dept: it.dept, minutes: it.minutes, label: it.label,
        })
        markets.add(it.market); buildings.add(it.building || b.building)
      }
    }
    const rank: Record<UpkeepState, number> = { late: 0, soon: 1, none: 2, booked: 3, ok: 4 }
    for (const p of Array.from(byKey.values())) {
      p.units = new Set(p.rows.map(r => r.listingId)).size
      const known = p.late + p.soon + p.ok + p.booked
      p.healthPct = known ? Math.round(((p.ok + p.booked + p.soon) / known) * 100) : 0
      p.rows.sort((a, b) => rank[a.state] - rank[b.state] || b.daysOver - a.daysOver || a.unit.localeCompare(b.unit))
    }
    const programs = Array.from(byKey.values())
      .filter(p => p.rows.length || ORDER.includes(p.key) || p.inert)
      .sort((a, b) => (ORDER.indexOf(a.key) < 0 ? 99 : ORDER.indexOf(a.key)) - (ORDER.indexOf(b.key) < 0 ? 99 : ORDER.indexOf(b.key)) || a.label.localeCompare(b.label))
    const sum = (k: UpkeepState) => programs.reduce((n, p) => n + p[k], 0)
    const lateUnits = new Set(programs.flatMap(p => p.rows.filter(r => r.state === 'late').map(r => r.listingId))).size
    const out: Upkeep = {
      ok: true, today, market, soonDays: SOON_DAYS,
      markets: Array.from(markets).sort(), buildings: Array.from(buildings).sort(),
      programs,
      totals: { late: sum('late'), soon: sum('soon'), ok: sum('ok'), booked: sum('booked'), none: sum('none'), lateUnits },
      degraded: cal.degraded, enabled: cal.enabled, canEdit,
    }
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
