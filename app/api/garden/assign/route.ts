// ASSIGN CLEANERS (lib/garden/assign).
//   POST { op: 'assign', date, roomIds, to }    rooms → a housekeeper (to: null = unassigned)
//   POST { op: 'auto', date, people }           split the unassigned rooms across these people
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { assignRooms, autoAssign } from '@/lib/garden/assign'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireGarden('rooms', 'edit')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  const date = String(b?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'date required' }, { status: 400 })
  try {
    if (b?.op === 'assign') return NextResponse.json(await assignRooms(date, Array.isArray(b.roomIds) ? b.roomIds : [], b.to ? String(b.to).slice(0, 80) : null))
    if (b?.op === 'auto') return NextResponse.json(await autoAssign(date, Array.isArray(b.people) ? b.people.map(String) : []))
    return NextResponse.json({ ok: false, error: 'unknown op' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
