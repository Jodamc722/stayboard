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
  const r = await updateBreezewayTask(taskId, { assignments: assigneeIds })
  if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
  return NextResponse.json({ ok: true, taskId, assigneeIds })
}


// TEMP read-only inspector: GET ?id=TASKID -> raw Breezeway task (verify note field). Remove after.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const id = String(new URL(req.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const r = await retrieveBreezewayTask(id)
  const keys = r && r.data && typeof r.data === 'object' ? Object.keys(r.data) : null
  return NextResponse.json({ ok: r.ok, status: r.status, keys, data: r.data })
}
