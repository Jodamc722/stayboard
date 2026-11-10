// THE STARTER KIT LINK (Jon, 2026-11-10). No sign-in: the 20-hex code is the capability, and an
// unknown or turned-off code is a 404. The client can only change their own selection (and the
// home's size, unless the team locked it) — never the products, prices or wording.
//   GET                                                  → the kit as the client sees it
//   POST { selection, size?, submit?, name?, email?, note? } → saves; submit stamps it as sent to Stay
import { NextRequest, NextResponse } from 'next/server'
import { openKit, saveKit } from '@/lib/starter-kit-server'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), false)
  if (!kit) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers: NO_STORE })
  return NextResponse.json({ ok: true, kit }, { headers: NO_STORE })
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const b = await req.json().catch(() => ({}))
  const r = await saveKit(String(params.code || ''), b)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: NO_STORE })
  return NextResponse.json({ ok: true, kit: r.kit }, { headers: NO_STORE })
}
