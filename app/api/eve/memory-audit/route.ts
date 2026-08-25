// The memory audit: what Eve believes that is duplicated, contradictory, vague or unused.
import { NextRequest, NextResponse } from 'next/server'
import { auditMemory, applyMemoryDecision } from '@/lib/eve/memory-audit'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, ...(await auditMemory()) })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const op = String(body?.op || '')
  if (op !== 'expire' && op !== 'merge' && op !== 'keep') {
    return NextResponse.json({ ok: false, error: 'op must be expire, merge or keep' }, { status: 400 })
  }
  const r = await applyMemoryDecision({ op, ids: Array.isArray(body?.ids) ? body.ids : [], by: String(gate.access.email || 'unknown') })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
