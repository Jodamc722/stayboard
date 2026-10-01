// THE SCHEDULE CHECK, ON DEMAND (lib/eve/schedule-check). Admins who may use Eve.
//   GET ?preview=1            → tomorrow's text per market, nothing posted
//   GET ?preview=1&date=…     → another day
//   GET ?run=1                → post it now (outside the 5pm window)
//   GET ?learn=1              → rebuild what she knows about the schedule and return the facts
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function GET(req: NextRequest) {
  const g = await eveGate()
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('learn') === '1') { const { scheduleKnowledge } = await import('@/lib/eve/schedule-knowledge'); const k = await scheduleKnowledge({ force: true }); return NextResponse.json({ ok: true, asOf: k.asOf, cleansRead: k.cleansRead, timedCleans: k.timedCleans, people: Object.keys(k.people).length, buildings: Object.keys(k.buildings).length, units: Object.keys(k.units).length, week: k.week, facts: k.facts }) }
    const { runScheduleCheck } = await import('@/lib/eve/schedule-check')
    const r = await runScheduleCheck({ preview: sp.get('run') !== '1', force: sp.get('run') === '1', date: sp.get('date') || undefined })
    return NextResponse.json(r)
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
