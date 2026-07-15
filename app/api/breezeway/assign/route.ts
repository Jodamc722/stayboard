// Reassign people on an existing Breezeway task. Body { taskId, assigneeIds:[number] }.
// Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
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
  return NextResponse.json({ ok: true, taskId, assigneeIds })
}
