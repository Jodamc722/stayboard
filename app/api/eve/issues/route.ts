// GET /api/eve/issues — every guest issue followed to done: reported → glitch → Breezeway task →
// assigned → started → fixed → guest told, the missing link named, most urgent first.
// lib/eve/issue-chains.ts.
import { NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { loadIssueChains } from '@/lib/eve/issue-chains'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const r = await loadIssueChains()
  return NextResponse.json({ ok: true, ...r })
}
