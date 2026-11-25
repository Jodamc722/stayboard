// NEW HIRE FORMS — the manager's side (lib/hire). Feature key `training`, edit level: approving
// creates a person and emails them.
//   GET                                  the link, what is waiting, what was decided lately
//   POST { action: 'approve', id, name?, email?, phone?, track?, market?, startDate? }
//   POST { action: 'decline', id, note? }
//   POST { action: 'rotate' }            a new link; the old one stops working
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listHires, approveHire, declineHire, rotateHireLink } from '@/lib/hire'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })

export async function GET() {
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, ...(await listHires(who(gate))) }) } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  const b = await req.json().catch(() => ({} as any))
  try {
    if (b.action === 'approve') { const r = await approveHire(String(b.id || ''), { name: b.name, email: b.email, phone: b.phone, track: b.track, market: b.market, startDate: b.startDate }, by); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
    if (b.action === 'decline') { const r = await declineHire(String(b.id || ''), String(b.note || ''), by); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
    if (b.action === 'rotate') return NextResponse.json({ ok: true, link: await rotateHireLink(by) })
    return bad('Unknown action.')
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
