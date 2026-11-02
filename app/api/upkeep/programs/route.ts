// PROPERTY PROGRAMS on the Upkeep page (lib/site-programs). GET: the programs, today's plan for each
// place, and what the editor offers (buildings, units). POST { op }: save | delete | toggle | run.
// Running is the same pass the morning cron makes — it never files a second open task for a place.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { loadPrograms, planPrograms, placeOptions, upsertProgram, deleteProgram, runPrograms, savePrograms, retireProgramTasks, titlePrefix } from '@/lib/site-programs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const withOptions = req.nextUrl.searchParams.get('options') === '1'
  const [programs, plan, options] = await Promise.all([
    loadPrograms(), planPrograms().catch(() => ({ day: '', plans: [] })), withOptions ? placeOptions() : Promise.resolve(null),
  ])
  return NextResponse.json({ ok: true, programs, ...plan, options })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const op = String(body?.op || '')
  const by = String(gate.access.email || '')
  if (op === 'save') {
    const r = await upsertProgram(body.program, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'delete') {
    const r = await deleteProgram(String(body.id || ''), by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'toggle') {
    const all = await loadPrograms()
    const next = all.map(p => (p.id === body.id ? { ...p, active: !p.active, updatedAt: new Date().toISOString(), updatedBy: by } : p))
    const r = await savePrograms(next, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'run') {
    const r = await runPrograms({ dryRun: body.dry === true, only: body.id ? String(body.id) : undefined })
    return NextResponse.json(r)
  }
  // RETIRE one of a program's open tasks (cancelled in Breezeway, never closed): a task created by
  // mistake, or one on an old checklist that the next run should replace. Only a task carrying the
  // program's own title prefix — anything else on the board is not this page's to touch.
  if (op === 'retire') {
    const all = await loadPrograms()
    const p = all.find(x => x.id === body.id)
    if (!p) return NextResponse.json({ ok: false, error: 'No such program.' }, { status: 400 })
    const taskId = String(body.taskId || '').trim()
    if (!/^\d+$/.test(taskId)) return NextResponse.json({ ok: false, error: 'taskId must be a Breezeway task id.' }, { status: 400 })
    const r = await retireProgramTasks([titlePrefix(p)], { only: [taskId] })
    const ok = r.cancelled.indexOf(taskId) >= 0
    return NextResponse.json({ ok, ...r, error: ok ? undefined : (r.failed[0]?.error || 'That task is not an open task of this program.') }, { status: ok ? 200 : 400 })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
