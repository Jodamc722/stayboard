// THE EXPECTATIONS DESK, for the Eve tab (lib/eve/expectations.ts).
//
//   GET  ?status=open|done|dismissed|all   → { notes }        (anyone who can use Eve)
//   GET  ?count=1                          → { count }
//   POST { op: 'run' }                     → runs the desk now (edit access)
//   POST { op: 'status', id, status: 'open'|'done'|'dismissed', note? }
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { atLeast } from '@/lib/features'
import { isSuperadmin } from '@/lib/access'
import { recordRun } from '@/lib/automation-runs'
import { listExpectations, countOpenExpectations, runExpectationsDesk, setExpectationStatus } from '@/lib/eve/expectations'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  if (sp.get('count')) return NextResponse.json({ ok: true, count: await countOpenExpectations() })
  const st = String(sp.get('status') || 'open')
  const status = (['open', 'done', 'dismissed', 'all'].includes(st) ? st : 'open') as any
  return NextResponse.json({ ok: true, notes: await listExpectations(status) })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const a = gate.access
  const canEdit = isSuperadmin(a.email) || a.role === 'admin' || atLeast(a.levels?.eve, 'edit')
  if (!canEdit) return NextResponse.json({ ok: false, error: 'edit access to Eve is needed' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const by = String(a.email || 'unknown')
  const op = String(body?.op || '')
  if (op === 'run') {
    const t0 = Date.now()
    const r = await runExpectationsDesk({ by })
    await recordRun({ name: 'expectations', ok: r.ok, itemCount: r.ok ? r.written : 0, error: r.ok ? undefined : r.error, detail: r.ok ? { reopened: r.reopened, model: r.model, pack: r.pack, buildings: r.buildings, by } : { pack: r.pack, by }, ms: Date.now() - t0 }).catch(() => {})
    return NextResponse.json(r.ok ? { ...r, notes: await listExpectations('open') } : r, { status: r.ok ? 200 : 500 })
  }
  if (op === 'status') {
    const status = String(body?.status || '')
    if (!['open', 'done', 'dismissed'].includes(status)) return NextResponse.json({ ok: false, error: 'status must be open, done or dismissed' }, { status: 400 })
    const r = await setExpectationStatus(String(body?.id || ''), status as any, by, body?.note)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ ok: false, error: 'op must be run or status' }, { status: 400 })
}
