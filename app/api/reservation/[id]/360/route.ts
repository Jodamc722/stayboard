// GET /api/reservation/<id>/360 — the whole picture of one booking (lib/reservation-360), for any
// surface that shows a reservation. Money is stripped for people without money access.
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadReservation360, redactStay } from '@/lib/reservation-360'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const id = String(params?.id || '').trim()
  if (!id || id.length > 64) return NextResponse.json({ error: 'reservation id required' }, { status: 400 })
  const s = await loadReservation360(supabaseAdmin(), id)
  if (!s) return NextResponse.json({ error: 'No reservation with that id.' }, { status: 404 })
  const show = canSeeMoney(gate.access)
  return NextResponse.json({ ok: true, stay: show ? s : redactStay(s), moneyHidden: !show })
}
