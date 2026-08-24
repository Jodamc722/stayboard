// THE WEEKLY PLANNER, for signed-in staff. The public half lives in /api/share/[code], which calls
// the same builder — one set of numbers, two doors.
import { NextRequest, NextResponse } from 'next/server'
import { buildTeamSchedule, ymdET, addDays } from '@/lib/team-schedule'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('team-schedule', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const from = (sp.get('from') || '').slice(0, 10) || ymdET(new Date())
  const days = Math.min(28, Math.max(7, Number(sp.get('days')) || 14))
  const markets = (sp.get('markets') || '').split(',').map(s => s.trim()).filter(Boolean)
  const deptRaw = String(sp.get('dept') || 'cleaning')
  const dept = deptRaw === 'maintenance' || deptRaw === 'all' ? deptRaw : 'cleaning'
  try {
    const data = await buildTeamSchedule({ from, to: addDays(from, days - 1), markets, dept })
    return NextResponse.json({ ok: true, ...data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
