// Unpaid balances — the report (GET) and the follow-up record (POST). View on Reservations to read;
// edit to change a status or add a note. Guesty is never written here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { loadUnpaid, updateTracking, type UnpaidStatus } from '@/lib/unpaid'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reservations', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  try {
    const rep = await loadUnpaid({ from: sp.get('from') || undefined, to: sp.get('to') || undefined })
    return NextResponse.json({ ok: true, ...rep, canEdit: ['edit', 'full'].includes(String(gate.access.levels['reservations'] || '')) || gate.access.role === 'admin' })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reservations', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.reservationId || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'reservationId required' }, { status: 400 })
  const by = String(gate.access.profile?.name || gate.access.profile?.full_name || gate.access.email || 'someone')
  const r = await updateTracking(id, by, { status: body?.status as UnpaidStatus | undefined, note: body?.note })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
