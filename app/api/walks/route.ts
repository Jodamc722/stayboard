// WALK REPORTS for the team (lib/walk-reports). GET: the latest reports of a program (?program=<id>,
// ?limit=). POST { op }: file | resend | weekly.
//   file    { taskId }        build (or rebuild with force) the report for a finished Breezeway task
//   resend  { code, to? }     send a filed report again — to its owners, or to the addresses given
//   weekly  { program?, dry? } the Monday roll-up now, for one program or all
// Reading needs Upkeep view; anything that sends or files needs Upkeep edit.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { retrieveBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { listReports, walkReportForTask, resendReport, sendWeeklyDigests, sampleReportForTask } from '@/lib/walk-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const rows = await listReports({ programId: str(sp.get('program')) || undefined, since: str(sp.get('since')) || undefined, limit: Number(sp.get('limit')) || 30 })
  return NextResponse.json({ ok: true, reports: rows })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const op = str(body?.op)
  if (op === 'file') {
    const id = str(body?.taskId).trim()
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'taskId must be a Breezeway task id' }, { status: 400 })
    if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured' }, { status: 503 })
    const cur = await retrieveBreezewayTask(id)
    const task = cur.ok ? (cur.data && (cur.data.task || cur.data)) : null
    if (!task || task.id == null) return NextResponse.json({ error: 'Breezeway did not return task ' + id + ' (' + cur.status + ')' }, { status: 404 })
    const r = await walkReportForTask(task, { force: body?.force === true })
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  // A sample of the owner email from a real task, to the signed-in person (or the addresses given).
  if (op === 'preview') {
    const to = (Array.isArray(body?.to) ? body.to : []).map((x: any) => str(x).trim()).filter(Boolean)
    const r = await sampleReportForTask(str(body?.taskId), to.length ? to : [str(gate.access.email)])
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'resend') {
    const to = (Array.isArray(body?.to) ? body.to : []).map((x: any) => str(x).trim()).filter(Boolean)
    const r = await resendReport(str(body?.code), to.length ? to : undefined)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'weekly') {
    const r = await sendWeeklyDigests({ force: true, dryRun: body?.dry === true, onlyProgram: str(body?.program) || undefined })
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
