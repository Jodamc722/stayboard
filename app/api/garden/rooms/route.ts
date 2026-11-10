// GARDEN HOTEL — set a room's condition from the housekeeping board (Jon, 2026-11-10: "improve hk
// visibility"). PATCH { roomId, condition: clean|dirty|inspected } writes Cloudbeds first (it is the
// system of record), then the mirror, so the board and Cloudbeds never disagree for long.
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cloudbedsConfigured, setHousekeeping } from '@/lib/garden/cloudbeds'

export const dynamic = 'force-dynamic'
const CONDS = ['clean', 'dirty', 'inspected'] as const

export async function PATCH(req: NextRequest) {
  const gate = await requireGarden('rooms', 'edit')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  const roomId = String(b?.roomId || '').trim()
  const condition = String(b?.condition || '').toLowerCase() as typeof CONDS[number]
  if (!roomId || !CONDS.includes(condition)) return NextResponse.json({ ok: false, error: 'roomId and condition (clean, dirty or inspected) required' }, { status: 400 })
  if (cloudbedsConfigured()) {
    try { await setHousekeeping(roomId, condition) }
    catch (e: any) { return NextResponse.json({ ok: false, error: 'Cloudbeds refused: ' + String(e?.message || e).slice(0, 200) }, { status: 502 }) }
  }
  const { error } = await supabaseAdmin().from('garden_rooms').update({ hk_status: condition, hk_updated_at: new Date().toISOString() }).eq('id', roomId)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
