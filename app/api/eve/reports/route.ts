// THE REPORTS DESK (Jon, 2026-10-12: long posts out of Slack, onto a page).
//   GET            → the last 30 days of reports (?kind=, ?days=, ?limit=), with the routing table and the kinds
//   GET ?id=       → one report
//   PUT            → owner: patch the routing table { routing: { quality_week: 'pointer', … } }
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, requireAdmin } from '@/lib/access'
import { canUseEve } from '@/lib/eve/run'
import { listReports, getReport, getRouting, setRouting, REPORT_KINDS } from '@/lib/eve/reports'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  if (!canUseEve(access)) return NextResponse.json({ error: 'no access' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const id = sp.get('id')
  if (id) { const r = await getReport(id); return r ? NextResponse.json({ ok: true, report: r }) : NextResponse.json({ error: 'not found' }, { status: 404 }) }
  const [reports, routing] = await Promise.all([
    listReports({ kind: sp.get('kind') || undefined, days: Math.min(Math.max(Number(sp.get('days')) || 30, 1), 90), limit: Math.min(Math.max(Number(sp.get('limit')) || 200, 1), 500) }),
    getRouting(),
  ])
  return NextResponse.json({ ok: true, reports, routing, kinds: REPORT_KINDS, canRoute: access.role === 'admin' })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin('owner')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const routing = await setRouting(body?.routing && typeof body.routing === 'object' ? body.routing : {}, String(gate.access.email || 'owner'))
  return NextResponse.json({ ok: true, routing })
}
