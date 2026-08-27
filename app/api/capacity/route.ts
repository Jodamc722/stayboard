// THE EFFICIENCY MODEL, served to whoever is about to make a decision.
//
// Jon, 2026-08-27: "the suggestion should live at the unit level, at the people level, and at the
// push level. I should be able to assign and schedule the tasks as well ... there should be a model
// that's calculating and sharing with our team, to help us think through our KPI and efficiency."
//
// So this one endpoint answers all three, from one computation:
//   people[]      every person on shift, their day priced, what they can still take
//   unassigned[]  every unowned unit with what it costs and who it costs least
//   suggestions[] the specific moves, each showing what it does to BOTH people
//   kpi           the day in one line — utilisation, spread, who is over, who is idle
//
// It writes nothing. Assignment stays where it already lives (/api/schedule/stage to stage,
// /api/schedule/assign to push), because a model that both recommends and commits is a model
// nobody can overrule.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { buildDayPicture } from '@/lib/capacity-day'
import { todayET } from '@/lib/eve/ctx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const raw = String(sp.get('date') || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayET()
  const market = String(sp.get('market') || '').trim() || undefined

  try {
    const picture = await buildDayPicture(date, market)
    return NextResponse.json({ ok: true, ...picture })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
