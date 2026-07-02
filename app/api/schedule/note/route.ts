// Append a NOTE onto a Breezeway task from the schedule board - housekeeping sees it in the task
// description (e.g. why a clean was moved, special instructions). Stamps who wrote it and when.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, retrieveBreezewayTask, updateBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const body = await req.json().catch(() => ({} as any))
  const taskId = String(body?.taskId || '').trim()
  const note = String(body?.note || '').trim().slice(0, 500)
  if (!taskId || !note) return NextResponse.json({ error: 'taskId and note required' }, { status: 400 })
  const cur = await retrieveBreezewayTask(taskId)
  if (!cur.ok || !cur.data) return NextResponse.json({ error: 'Task not found in Breezeway (' + cur.status + ')' }, { status: 502 })
  const t: any = cur.data.task || cur.data
  const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
  const who = String(user.email || 'team').split('@')[0]
  const existing = String(t.description || '')
  const description = ('NOTE (' + who + ', ' + stamp + '): ' + note + (existing ? '\n' + existing : '')).slice(0, 4000)
  const r = await updateBreezewayTask(taskId, { name: t.name || 'Clean', description })
  if (!r.ok) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + r.text.slice(0, 140) }, { status: 502 })
  return NextResponse.json({ ok: true })
}
