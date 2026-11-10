// The memory audit: what Eve believes that is duplicated, contradictory, vague or unused — and the
// Memory clean-up card's two bulk actions (2026-11-10): merge every duplicate group, and retire what
// she overheard in Slack and never used. Nothing is deleted; a person's memory is never touched.
import { NextRequest, NextResponse } from 'next/server'
import { auditMemory, applyMemoryDecision, mergeAllDuplicates, retireStaleSlack, cleanupLog, STALE_SLACK_DAYS } from '@/lib/eve/memory-audit'
import { eveGate } from '../../agent/route'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  try {
    const [audit, log] = await Promise.all([auditMemory(), cleanupLog(8)])
    return NextResponse.json({ ok: true, ...audit, staleSlackDays: STALE_SLACK_DAYS, log })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const body = await req.json().catch(() => ({} as any))
  const op = String(body?.op || '')
  const by = String(gate.access.email || 'unknown')
  if (op === 'merge_all') {
    const r = await mergeAllDuplicates(by)
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }
  if (op === 'retire_slack') {
    const r = await retireStaleSlack(by)
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }
  if (op !== 'expire' && op !== 'merge' && op !== 'keep') {
    return NextResponse.json({ ok: false, error: 'op must be expire, merge, keep, merge_all or retire_slack' }, { status: 400 })
  }
  const r = await applyMemoryDecision({ op, ids: Array.isArray(body?.ids) ? body.ids : [], by })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
