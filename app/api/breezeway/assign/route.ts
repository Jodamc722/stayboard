// Reassign people on an existing Breezeway task. Body { taskId, assigneeIds:[number] }.
// Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'schedule' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('schedule', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const body = await req.json().catch(() => ({} as any))
  const taskId = String(body?.taskId || '').trim()
  const assigneeIds = (Array.isArray(body?.assigneeIds) ? body.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  // Same-day-turn note -> Breezeway task summary (idempotent, non-destructive). Body { taskId, sdtNote }.
  const sdtNote = String(body?.sdtNote || '').trim()
  if (sdtNote) {
    const cur = await retrieveBreezewayTask(taskId)
    const curName = String((cur.data && cur.data.name) || 'Departure Clean')
    if (curName.includes('SAME-DAY TURN')) return NextResponse.json({ ok: true, taskId, alreadyFlagged: true, name: curName })
    const nextName = curName + '  ⚠ SAME-DAY TURN'
    const w = await updateBreezewayTask(taskId, { name: nextName })
    if (!w.ok) return NextResponse.json({ error: `Breezeway ${w.status}: ${w.text.slice(0, 200)}` }, { status: 502 })
    return NextResponse.json({ ok: true, taskId, wroteName: nextName })
  }
  const r = await updateBreezewayTask(taskId, { assignments: assigneeIds })
  if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
  // VERIFY + WRITE THROUGH. The board reads our mirror, which refreshes every 15 minutes — without
  // this the row still said "Unassigned" after a successful assign, which looks identical to a
  // failure. Read the task back from Breezeway (the truth), then stamp the mirror with what it says.
  let verified: string[] = []
  try {
    const back = await retrieveBreezewayTask(taskId)
    const t: any = back.ok && back.data ? (back.data.task || back.data) : null
    const asg = Array.isArray(t?.assignments) ? t.assignments : []
    const people = asg.map((a: any) => ({ id: a?.assignee_id ?? a?.id ?? null, name: a?.name ?? null })).filter((a: any) => a.id || a.name)
    verified = people.map((p: any) => String(p.name || '')).filter(Boolean)
    await supabaseAdmin().from('breezeway_tasks_sync').update({ assignees: people }).eq('id', taskId)
  } catch { /* the 15-min sync still catches up; the write itself succeeded */ }
  return NextResponse.json({ ok: true, taskId, assigneeIds, assignees: verified })
}
