// GET /api/eve/needs — every proposal waiting for a yes and every hot Slack loop, each with the
// context to decide (what she will do, why, evidence, links to the booking / thread / task / glitch /
// Slack), most urgent first. lib/eve/needs.ts.
import { NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { loadNeeds } from '@/lib/eve/needs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const r = await loadNeeds()
  return NextResponse.json({ ok: true, ...r })
}
