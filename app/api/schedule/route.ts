import { NextRequest, NextResponse } from 'next/server'
import { buildSchedule } from '@/lib/schedule-build'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The board's data. The computation lives in lib/schedule-build.ts (shared with the public team
// scheduler link); this file only checks the session.
export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const sp = new URL(req.url).searchParams
  const payload = await buildSchedule(sp.get('view'), sp.get('date'))
  return NextResponse.json(payload)
}
