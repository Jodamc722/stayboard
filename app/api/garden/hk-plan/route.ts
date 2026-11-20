// THE HOUSEKEEPING DAY PLAN (lib/garden/hk-plan).  GET ?date=YYYY-MM-DD → rows, summary, people, week, the Cloudbeds check.
//                                                 GET ?performance=<days> → the KPIs (lib/garden/hk-perf).
// Assigning goes through /api/garden/assign; a room's condition through /api/garden/rooms (both write Cloudbeds).
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { hkPlan } from '@/lib/garden/hk-plan'
import { hkPerformance } from '@/lib/garden/hk-perf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireGarden('schedule', 'view')
  if (!gate.ok) return gate.res
  const perf = req.nextUrl.searchParams.get('performance')
  if (perf) { try { return NextResponse.json({ ok: true, ...(await hkPerformance(Number(perf) || 14)) }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) } }
  try { return NextResponse.json({ ok: true, ...(await hkPlan(req.nextUrl.searchParams.get('date') || undefined)) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
