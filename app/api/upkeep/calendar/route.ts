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
//   block  a Guesty block for an owner or someone staying (owner block, or a label that says so) — not workable
//   hold   any other Guesty block (maintenance hold, "Other"…) — nobody is in, so it is workable; label shown
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildUnitCells, type CalUnit } from '@/lib/upkeep-cells'
export type { CalKind, CalCell } from '@/lib/upkeep-schedule'
export type { CalUnit } from '@/lib/upkeep-cells'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const str = (v: any) => String(v ?? '').trim()

export type UpkeepCalendar = {
  ok: true; today: string; days: string[]; units: CalUnit[]
  /** Everybody of the trade with work on the books in the window, with their jobs per day — for "assign someone else". */
  people: { name: string; trade: string; perDay: Record<string, number> }[]
  unsure: string[]
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const ids = Array.from(new Set(str(req.nextUrl.searchParams.get('ids')).split(',').map(str).filter(Boolean))).slice(0, 200)
  const dept = str(req.nextUrl.searchParams.get('dept')) || 'maintenance'
  const n = Math.min(28, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 14))
  const today = ymd(new Date())
  try {
    const out = await buildUnitCells(ids, dept, today, n)
    return NextResponse.json({ ok: true, ...out } satisfies UpkeepCalendar)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
