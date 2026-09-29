import { NextRequest, NextResponse } from 'next/server'
import { buildSchedule } from '@/lib/schedule-build'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The board's data. The computation lives in lib/schedule-build.ts (shared with the public team
// scheduler link); this file only checks the session.
export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  // A throw here used to escape as a bare 500 with no body, so the board could only say "Could not
  // load the schedule." The reason now comes back as the JSON error the board already displays.
  try {
    const payload = await buildSchedule(sp.get('view'), sp.get('date'))
    return NextResponse.json(payload)
  } catch (e: any) {
    console.error('[api/schedule]', e)
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
