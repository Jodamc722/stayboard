// Move an existing Breezeway task to another day. Body { taskId, date: 'YYYY-MM-DD' }.
//
// Jon, 2026-10-21, on the GE Log: "Should be able to update the breezeway task, ect." Moving a
// clean is the edit a supervisor makes most often that was not possible anywhere in Lighthouse —
// the day board SHOWS a moved clean ("Moved -> 10-18") but could only ever report what somebody
// had already done in Breezeway itself. This writes it.
//
// Deliberately narrow: it changes the scheduled date and nothing else. Renaming, reassigning and
// closing have their own routes with their own gates; one endpoint that could edit any field of
// any task is a much bigger thing to get wrong.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'
import { requireLevel } from '@/lib/access'
import { bustBoards } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const __gate = await requireLevel('schedule', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const taskId = String(body?.taskId || '').trim()
  const date = String(body?.date || '').trim()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })

  // A FINISHED TASK IS NOT MOVED, it is history. Breezeway would take the write; the crew's
  // completed work would then sit on a future day as though it were still to do.
  const cur = await retrieveBreezewayTask(taskId)
  const curT: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
  if (curT?.finished_at) return NextResponse.json({ error: 'That task is already finished - moving it would put completed work back on a future day.' }, { status: 400 })
  const was = String(curT?.scheduled_date || '').slice(0, 10) || null
  if (was === date) return NextResponse.json({ ok: true, taskId, date, unchanged: true })

  const r = await updateBreezewayTask(taskId, { scheduled_date: date })
  if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })

  // VERIFY, then write through to the mirror. Same reason as the assign route: the boards read our
  // mirror, which refreshes on a 30-minute cron, and a row still showing the old date after a
  // successful move looks exactly like a move that failed.
  let landed = date
  try {
    const back = await retrieveBreezewayTask(taskId)
    const t: any = back.ok && back.data ? (back.data.task || back.data) : null
    if (t?.scheduled_date) landed = String(t.scheduled_date).slice(0, 10)
    await supabaseAdmin().from('breezeway_tasks_sync').update({ scheduled_date: landed }).eq('id', taskId)
  } catch { /* the 30-minute sync still catches up; the write itself succeeded */ }
  bustBoards()
  return NextResponse.json({ ok: true, taskId, was, date: landed })
}
