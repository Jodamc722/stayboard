// STARTER KITS — the team side (Jon, 2026-11-10). Gated by the Onboarding key: view lists the links,
// edit creates and changes them. The client side is /api/public/starter-kit/<code>.
//
//   GET                                   view → { ok, links, leads }   (leads: emails from the website need list, /kit/plan)
//   POST { action: 'create', client, property, message, size, sizeLocked, setupFee, preparedBy }  edit → { ok, link }
//   POST { action: 'update', code, ...patch }    edit → { ok }   (patch.revoke true / false turns the link off / on)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listKits, createKit, updateKit } from '@/lib/starter-kit-server'
import { KIT_CODE } from '@/lib/starter-kit'
import { listLeads } from '@/lib/need-list-leads'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('onboarding', 'view')
  if (!g.ok) return g.res
  return NextResponse.json({ ok: true, links: await listKits(), leads: await listLeads(300).catch(() => []) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('onboarding', 'edit')
  if (!g.ok) return g.res
  const who = g.access.email || 'team'
  const b = await req.json().catch(() => ({}))
  if (b?.action === 'create') {
    const r = await createKit(b, who)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (b?.action === 'update') {
    const code = typeof b.code === 'string' ? b.code : ''
    if (!KIT_CODE.test(code)) return NextResponse.json({ ok: false, error: 'Which link?' }, { status: 400 })
    const r = await updateKit(code, b, who)
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === 'not found' ? 404 : 400 })
  }
  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
