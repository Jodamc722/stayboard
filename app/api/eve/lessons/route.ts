// GET /api/eve/lessons — what the team has taught Eve about matching reports to tasks, and the
// follow-up questions people had to ask after her Slack posts (lib/eve/match-lessons).
import { NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { listLessons } from '@/lib/eve/match-lessons'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, ...(await listLessons()) })
}
