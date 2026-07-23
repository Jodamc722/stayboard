// Task actions from Today in Ops: delete a NON-departure-clean task, or toggle the
// "VENDOR NEEDED" flag in the task title (so vendor work is tracked and never billed
// to the owner by mistake). Departure cleans can only be deleted from the scheduler,
// which requires the admin password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bzApi, updateBreezewayTask, breezewayConfigured } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VENDOR_TAG = 'VENDOR NEEDED - '
const CLEAN = /departure clean|strip & walkthrough/i
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  try {
    const body = await req.json().catch(() => ({} as any))
    const taskId = str(body.taskId)
    const action = str(body.action)
    if (!taskId || !action) return NextResponse.json({ ok: false, error: 'taskId and action required.' }, { status: 400 })
    const db = supabaseAdmin()
    const { data: row } = await db.from('breezeway_tasks_sync').select('id,name').eq('id', taskId).maybeSingle()
    const name = str(row && row.name)

    if (action === 'delete') {
      if (CLEAN.test(name)) return NextResponse.json({ ok: false, error: 'Departure cleans can only be deleted from the scheduler (admin password required).' }, { status: 403 })
      const r = await bzApi('/task/' + encodeURIComponent(taskId), { method: 'DELETE' })
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      try { await db.from('breezeway_tasks_sync').delete().eq('id', taskId) } catch {}
      return NextResponse.json({ ok: true, deleted: true })
    }

    if (action === 'vendor') {
      const on = body.on !== false
      const has = name.toUpperCase().startsWith(VENDOR_TAG.toUpperCase()) || /vendor needed/i.test(name)
      let newName = name
      if (on && !has) newName = VENDOR_TAG + name
      if (!on && has) newName = name.replace(/^\s*vendor needed\s*[-:]?\s*/i, '')
      if (newName !== name && newName.trim()) {
        const r = await updateBreezewayTask(taskId, { name: newName })
        if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
        // mirror immediately so the board shows the flag without waiting for the next sync
        try { await db.from('breezeway_tasks_sync').update({ name: newName }).eq('id', taskId) } catch {}
      }
      return NextResponse.json({ ok: true, name: newName, vendor: on })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
