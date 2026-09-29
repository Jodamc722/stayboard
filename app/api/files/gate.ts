// Who may upload to / open files for each agent. Shared by /api/files/extract and /api/files/open.
import { NextResponse } from 'next/server'
import { isSuperadmin } from '@/lib/access'
import { requireGarden } from '@/lib/garden/access'
import { eveGate } from '../agent/route'

export async function gateFor(who: string, read = false): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (who === 'eve') {
    const g = await eveGate()
    if (!g.ok) return { ok: false, res: g.res }
    if (!read && !(isSuperadmin(g.access.email) || g.access.role === 'admin')) return { ok: false, res: NextResponse.json({ error: 'forbidden', message: 'Only an admin can add to what Eve treats as written policy.' }, { status: 403 }) }
    return { ok: true }
  }
  if (who === 'adam' || who === 'handbook') {
    const g = await requireGarden(who, read ? 'view' : 'edit')
    return g.ok ? { ok: true } : { ok: false, res: g.res }
  }
  return { ok: false, res: NextResponse.json({ error: "for must be 'eve', 'adam' or 'handbook'" }, { status: 400 }) }
}
