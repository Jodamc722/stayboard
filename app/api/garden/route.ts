// GARDEN HOTEL — one read route for the five tabs, and the on-demand sync.
//
//   GET  ?view=today|rooms|calls|reports|status  (&from=&to= for reports)
//   POST { action: 'sync', full?: boolean }       → pull Cloudbeds now (edit level)
//        { action: 'test' }                       → prove the key works: hotel name + room count
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gardenToday, gardenRooms, gardenCalls, gardenReport, gardenStatus, gardenRange } from '@/lib/garden/desk'
import { syncGarden } from '@/lib/garden/sync'
import { getHotel, cloudbedsConfigured } from '@/lib/garden/cloudbeds'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const sp0 = req.nextUrl.searchParams
  const v0 = sp0.get('view') || 'today'
  const gate = await requireGarden(v0 === 'status' ? 'setup' : (['rooms', 'calls', 'reports'].includes(v0) ? v0 : 'today') as any, 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const view = sp.get('view') || 'today'
  try {
    if (view === 'rooms') return NextResponse.json({ ok: true, ...(await gardenRooms()) })
    if (view === 'calls') return NextResponse.json({ ok: true, ...(await gardenCalls()) })
    if (view === 'reports') { const { from, to } = gardenRange(sp); return NextResponse.json({ ok: true, ...(await gardenReport(from, to)) }) }
    if (view === 'status') return NextResponse.json({ ok: true, ...(await gardenStatus()) })
    return NextResponse.json({ ok: true, ...(await gardenToday()) })
  } catch (e: any) {
    // Before migration 115 runs the tables do not exist; say so instead of a blank page.
    return NextResponse.json({ ok: false, error: String(e?.message || e) })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('today', 'view')   // a sync is harmless: anyone on the hotel team may pull Cloudbeds now
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const action = String(b?.action || '')
  if (action === 'test') {
    if (!cloudbedsConfigured()) return NextResponse.json({ ok: false, error: 'Not connected — no Cloudbeds key in the environment yet.' })
    try { return NextResponse.json({ ok: true, hotel: await getHotel() }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
  }
  // Totals, ID / card on file and Operto on demand, outside the sync's budget (lib/garden/res-detail).
  if (action === 'enrich') {
    const { pullTotals, pullDetails } = await import('@/lib/garden/res-detail')
    const out: any = {}
    try { out.totals = await pullTotals(120, 365, true) } catch (e: any) { out.totals = 'error: ' + String(e?.message || e).slice(0, 160) }
    try { out.details = await pullDetails() } catch (e: any) { out.details = 'error: ' + String(e?.message || e).slice(0, 160) }
    try { const o = await import('@/lib/garden/operto'); out.operto = o.opertoConfigured() ? (await o.pullOperto()).matched : 'not connected' } catch (e: any) { out.operto = 'error: ' + String(e?.message || e).slice(0, 160) }
    return NextResponse.json({ ok: true, ...out })
  }
  if (action === 'sync') {
    const r = await syncGarden({ full: !!b?.full })
    return NextResponse.json(r)
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
