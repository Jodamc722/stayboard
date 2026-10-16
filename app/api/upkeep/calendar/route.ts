// UPKEEP CALENDAR — the coordinator's view (Jon, 2026-10-16: "quickly assign, multi-calendar view to
// see open days, assign by day of availability … clean, and the multi needs to be accurate").
//
//   GET /api/upkeep/calendar?ids=<listingId,…>&dept=maintenance&days=14
//   → days[], units[{ listingId, unit, building, cells[{ d, k, label, team[] }] }], people[]
//
// One cell per unit per day, from two sources, never guessed:
//   · the stays (guesty_reservations, live statuses only — lib/stay-status), which say whether a guest
//     is in the unit that day, leaving that day, arriving that day, or both (a turn);
//   · Guesty's own calendar for blocks that are not reservations (owner stay, maintenance hold…), with
//     the label exactly as the team wrote it in Guesty.
// A read that comes back short is reported as `unsure`, and the page says so instead of painting an
// occupied day as open. The team on each day is the open Breezeway work in that building (lib/upkeep-plan).
//
// Cell kinds:
//   open   nobody in, nobody arriving or leaving — the whole day is workable
//   out    a guest leaves that day (from ~11am) and nobody arrives — workable after checkout
//   in     a guest arrives that day and the night before was empty — workable in the morning
//   turn   a guest leaves AND another arrives — housekeeping owns the day; not for upkeep
//   stay   a guest is in all day
//   block  a Guesty block that is not a reservation (label in `label`)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isLiveStay } from '@/lib/stay-status'
import { getMultiCalendar, isOpsBlock } from '@/lib/guesty'
import { teamVisits, tradeOk, buildingKey } from '@/lib/upkeep-plan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const str = (v: any) => String(v ?? '').trim()

export type CalKind = 'open' | 'out' | 'in' | 'turn' | 'stay' | 'block'
export type CalCell = { d: string; k: CalKind; label?: string | null; team: { name: string; atUnit: boolean; jobs: number }[] }
export type CalUnit = { listingId: string; unit: string; building: string; cells: CalCell[] }
export type UpkeepCalendar = {
  ok: true; today: string; days: string[]; units: CalUnit[]
  /** Everybody of the trade with work on the books in the window, with their jobs per day — for "assign someone else". */
  people: { name: string; perDay: Record<string, number> }[]
  unsure: string[]
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const ids = Array.from(new Set(str(req.nextUrl.searchParams.get('ids')).split(',').map(str).filter(Boolean))).slice(0, 200)
  const dept = str(req.nextUrl.searchParams.get('dept')) || 'maintenance'
  const n = Math.min(28, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 14))
  const today = ymd(new Date())
  const days = Array.from({ length: n }, (_, i) => plus(today, i))
  const last = days[days.length - 1]
  if (!ids.length) return NextResponse.json({ ok: true, today, days, units: [], people: [], unsure: [] } satisfies UpkeepCalendar)
  const unsure: string[] = []
  try {
    const db = supabaseAdmin()
    const [stays, tv, cal] = await Promise.all([
      // Any stay touching the window: it ends on/after today and starts on/before the last day.
      pageRows<any>((a, b) => db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status')
        .in('listing_id', ids).gte('check_out', today).lte('check_in', last).order('id').range(a, b), 10),
      teamVisits(today, n),
      getMultiCalendar(ids, today, last).catch(() => null),
    ])
    if (stays.truncated) unsure.push('stays (some reservations could not be read — check Guesty before booking)')
    if (!cal) unsure.push('Guesty blocks (owner stays and holds may be missing)')
    if (tv.truncated) unsure.push('team schedule')

    const byUnit: Record<string, { ci: string; co: string }[]> = {}
    for (const r of (stays.rows as any[])) {
      if (!isLiveStay(r.status)) continue
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      if (ci && co) (byUnit[str(r.listing_id)] = byUnit[str(r.listing_id)] || []).push({ ci, co })
    }
    const blockOf: Record<string, string> = {}
    for (const d of (cal || [])) {
      if (!isOpsBlock(d)) continue
      const ref = d.refs?.[0]
      blockOf[d.listingId + '|' + d.date] = (ref?.reason || ref?.note || d.note || 'Blocked in Guesty').slice(0, 60)
    }

    const units: CalUnit[] = ids.map(lid => {
      const unit = tv.nameOf[lid] || lid
      const b = tv.bOf[lid] || buildingKey(unit)
      const ss = byUnit[lid] || []
      const cells: CalCell[] = days.map(d => {
        const inAllDay = ss.some(s => s.ci < d && d < s.co)                   // here the night before AND that night
        const leaves = ss.some(s => s.co === d)
        const arrives = ss.some(s => s.ci === d)
        let k: CalKind = inAllDay ? 'stay' : leaves && arrives ? 'turn' : leaves ? 'out' : arrives ? 'in' : 'open'
        let label: string | null = null
        // A Guesty block on an otherwise empty day (owner stay, hold) — the night of d.
        if ((k === 'open' || k === 'out') && blockOf[lid + '|' + d]) { k = 'block'; label = blockOf[lid + '|' + d] }
        const team = Object.values(tv.visits[b]?.[d] || {})
          .filter(s => Array.from(s.depts).some(x => tradeOk(dept, x)))
          .map(s => ({ name: s.name, atUnit: s.units.has(lid), jobs: s.jobs }))
          .sort((x, y) => Number(y.atUnit) - Number(x.atUnit) || y.jobs - x.jobs)
        return { d, k, label, team }
      })
      return { listingId: lid, unit, building: b, cells }
    })

    const ppl: Record<string, { name: string; perDay: Record<string, number> }> = {}
    for (const byDay of Object.values(tv.visits)) for (const [d, who] of Object.entries(byDay)) for (const s of Object.values(who)) {
      if (!Array.from(s.depts).some(x => tradeOk(dept, x))) continue
      const p = (ppl[s.name.toLowerCase()] = ppl[s.name.toLowerCase()] || { name: s.name, perDay: {} })
      p.perDay[d] = (p.perDay[d] || 0) + s.jobs
    }
    const people = Object.values(ppl).sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ ok: true, today, days, units, people, unsure } satisfies UpkeepCalendar)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
