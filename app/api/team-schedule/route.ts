// THE WEEKLY PLANNER, for signed-in staff. The public half lives in /api/share/[code], which calls
// the same builder — one set of numbers, two doors.
import { NextRequest, NextResponse } from 'next/server'
import { buildTeamSchedule, ymdET, addDays } from '@/lib/team-schedule'
import { scheduleLabor } from '@/lib/schedule-labor'
import { requireLevel, canSeeMoney } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('team-schedule', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const from = (sp.get('from') || '').slice(0, 10) || ymdET(new Date())
  // `to` wins over `days` when given, so the planner can show any span you pick rather than a
  // fixed fortnight (Jon, 2026-09-09: "shows the schedule for whatever dates you select").
  const toParam = (sp.get('to') || '').slice(0, 10)
  const days = Math.min(28, Math.max(7, Number(sp.get('days')) || 14))
  const markets = (sp.get('markets') || '').split(',').map(s => s.trim()).filter(Boolean)
  const crewRaw = String(sp.get('crew') || 'inhouse')
  const crew = crewRaw === 'vendor' || crewRaw === 'all' ? crewRaw : 'inhouse'
  const deptRaw = String(sp.get('dept') || 'cleaning')
  const dept = deptRaw === 'maintenance' || deptRaw === 'all' ? deptRaw : 'cleaning'
  try {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(toParam) && toParam >= from
      ? (toParam > addDays(from, 41) ? addDays(from, 41) : toParam)   // 6 weeks is plenty and keeps the read bounded
      : addDays(from, days - 1)
    const data = await buildTeamSchedule({ from, to, markets, dept, crew })
    // Money is a separate pass so the planner itself never depends on Homebase answering, and so a
    // viewer without money access gets exactly the same schedule with the dollars absent.
    // Labor belongs to OUR crew. Pricing a vendor building's cleans with our payroll would invent a
    // margin on work we neither staff nor pay for.
    const wantMoney = sp.get('money') === '1' && dept !== 'maintenance' && crew === 'inhouse'
    const labor = wantMoney && canSeeMoney(gate.access)
      ? await scheduleLabor(data, ymdET(new Date())).catch(() => null)
      : null
    return NextResponse.json({ ok: true, ...data, labor })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
