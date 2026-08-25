// The audit tab: read it, and acknowledge or snooze an item.
import { NextRequest, NextResponse } from 'next/server'
import { listAudits, decideAudit, runAudit } from '@/lib/eve/audit'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const items = await listAudits({ status: sp.get('status') || 'open', limit: Number(sp.get('limit')) || 120 })
  return NextResponse.json({ ok: true, items })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const by = String(gate.access.email || 'unknown')

  if (body?.op === 'run') {
    const res = await runAudit()
    return NextResponse.json({ ...res, ok: true, items: await listAudits({ status: 'open', limit: 120 }) })
  }
  const op = String(body?.op || '')
  if (op !== 'ack' && op !== 'snooze' && op !== 'reopen') {
    return NextResponse.json({ ok: false, error: 'op must be run, ack, snooze or reopen' }, { status: 400 })
  }
  const res = await decideAudit(String(body?.id || ''), op, by, Number(body?.days) || 7)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
