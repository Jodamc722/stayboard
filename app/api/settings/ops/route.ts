// Ops presets API — the operating rules behind /users → "Ops presets".
//
// GET  : any signed-in user (client components like the scheduler read this to build their rules).
// PUT  : OWNER ONLY. These settings change how the whole team's scheduler, forecast and ops board
//        behave, so they sit alongside workspaces/page-access as an owner-level control.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getOpsPresets, setSetting, OPS_PRESETS_KEY } from '@/lib/app-settings'
import { mergePresets } from '@/lib/ops-presets'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const presets = await getOpsPresets()
  return NextResponse.json({ presets, canEdit: isSuperadmin(access.email) })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Only the owner can change ops presets.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({} as any))
  // Normalise through the same merge the readers use, so a malformed payload can never poison the
  // stored blob — anything missing or the wrong shape is replaced by today's default.
  const presets = mergePresets(body?.presets)
  const res = await setSetting(OPS_PRESETS_KEY, presets, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, presets })
}
