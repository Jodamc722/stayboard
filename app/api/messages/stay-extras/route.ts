// THE DECISION CARD BESIDE A GUEST THREAD (lib/inbox-stay-extras).
//   GET ?reservationId=<id>            the unit's clean / inspection, the guest's issues on other stays  (Messages view)
//   GET ?reservationId=<id>&codes=1    …plus the door codes for this stay — Messages EDIT only, and logged
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadStayExtras } from '@/lib/inbox-stay-extras'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const wantCodes = req.nextUrl.searchParams.get('codes') === '1'
  const g = await requireLevel('messages', wantCodes ? 'edit' : 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('reservationId') || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'reservationId required' }, { status: 400 })
  try {
    const x = await loadStayExtras(supabaseAdmin(), id, { codes: wantCodes })
    if (!x) return NextResponse.json({ ok: false, error: 'That booking is not cached here.' }, { status: 404 })
    if (wantCodes) logActivity({ email: String(g.access.email || ''), kind: 'api', path: '/api/messages/stay-extras', feature: 'messages:door-code', need: 'edit', allowed: true, meta: { reservationId: id, system: x.codes?.system, found: !!x.codes?.current } })
    return NextResponse.json({ ok: true, ...x }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
