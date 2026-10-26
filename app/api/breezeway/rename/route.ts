// Rename an existing Breezeway task. Body { taskId, name }.
//
// Jon, 2026-10-26, on the GE Log: "edit / create breezewya tasks and assign". The task LINE is
// what the crew reads in the field app, and until now it could only be fixed in Breezeway itself -
// so a task created with the wrong unit in its title, or a line that needed "bring the 20x23
// filter" added, meant leaving the board.
//
// Narrow on purpose, like the move route beside it: the name, nothing else. Department, priority
// and schedule each change what the task IS, and each has its own route and its own gate.
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
  const name = String(body?.name || '').trim().slice(0, 200)
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'The task line cannot be empty.' }, { status: 400 })

  // A FINISHED TASK KEEPS ITS NAME. It is the record of what the crew was asked to do and signed
  // off; rewriting it after the fact makes the history a lie.
  const cur = await retrieveBreezewayTask(taskId)
  const curT: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
  if (curT?.finished_at) return NextResponse.json({ error: 'That task is already finished - its line is the record of what was done, so it is not renamed.' }, { status: 400 })
  const was = String(curT?.name || '')
  if (was === name) return NextResponse.json({ ok: true, taskId, name, unchanged: true })

  const r = await updateBreezewayTask(taskId, { name })
  if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
  // Write through to the mirror the boards read, then bust their caches - same reason as move and
  // assign: on a 30-minute sync a successful rename looks exactly like one that failed.
  try { await supabaseAdmin().from('breezeway_tasks_sync').update({ name }).eq('id', taskId) } catch { /* the sync catches up */ }
  bustBoards()
  return NextResponse.json({ ok: true, taskId, was, name })
}
