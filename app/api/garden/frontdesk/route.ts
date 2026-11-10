// GARDEN HOTEL FRONT DESK — the Today page's one read (lib/garden/frontdesk).
//
//   GET → { ok: true, date, summary, arrivals, departures, inHouse, unpaid, verifications, rooms, tasks, housekeepers, team, available, syncs }
//
// Mutations stay where they already live: verifications and calls on /api/garden/calls, tasks on
// /api/garden/tasks, a Cloudbeds pull on POST /api/garden { action: 'sync' }.
import { NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gardenFrontDesk } from '@/lib/garden/frontdesk'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Today (the front desk) or Rooms & cleans (the housekeeping board reads the same data).
  let gate = await requireGarden('today', 'view')
  if (!gate.ok) { const g2 = await requireGarden('rooms', 'view'); if (g2.ok) gate = g2 }
  if (!gate.ok) return gate.res
  try {
    return NextResponse.json({ ok: true, ...(await gardenFrontDesk()) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) })
  }
}
