// The South Florida event calendar. Hand-maintained on purpose — see lib/eve/signals.ts for why
// (short answer: no usable API, Ticketmaster's terms forbid this use, PredictHQ is enterprise-priced,
// and ~20 recurring events curated once a year beats all of them on accuracy).
import { NextRequest, NextResponse } from 'next/server'
import { getEvents, setEvents, upcomingEvents, stormRisk } from '@/lib/eve/signals'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const [all, upcoming, weather] = await Promise.all([
    getEvents(),
    upcomingEvents(Number(sp.get('days')) || 120),
    sp.get('weather') === '0' ? Promise.resolve(null) : stormRisk(),
  ])
  return NextResponse.json({ ok: true, events: all, upcoming, weather })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  if (!Array.isArray(body?.events)) return NextResponse.json({ error: 'events array required' }, { status: 400 })
  const clean = body.events
    .filter((e: any) => e && e.name && /^\d{4}-\d{2}-\d{2}$/.test(String(e.start)))
    .map((e: any) => ({
      name: String(e.name).slice(0, 120),
      start: String(e.start).slice(0, 10),
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(e.end)) ? String(e.end).slice(0, 10) : String(e.start).slice(0, 10),
      markets: Array.isArray(e.markets) ? e.markets.slice(0, 4).map((m: any) => String(m).slice(0, 20)) : [],
      impact: ['high', 'medium', 'low'].indexOf(String(e.impact)) >= 0 ? String(e.impact) : 'medium',
      note: e.note ? String(e.note).slice(0, 300) : undefined,
    }))
  const r = await setEvents(clean as any, String(gate.access.email || ''))
  if (!r.ok) return NextResponse.json({ error: r.error || 'save failed' }, { status: 500 })
  return NextResponse.json({ ok: true, saved: clean.length })
}
