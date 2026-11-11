// ONE RESERVATION IN FULL, LIVE (lib/garden/res-live).  GET ?id=<Cloudbeds id | gy:<guesty id>>
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { liveReservation } from '@/lib/garden/res-live'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireGarden('guests', 'view')
  if (!gate.ok) return gate.res
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  try {
    const r = await liveReservation(id)
    return r ? NextResponse.json({ ok: true, res: r }) : NextResponse.json({ ok: false, error: 'Reservation not found' }, { status: 404 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
