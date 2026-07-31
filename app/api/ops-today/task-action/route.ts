// Task actions from Today in Ops: delete a NON-departure-clean task, or toggle the
// "VENDOR NEEDED" flag in the task title (so vendor work is tracked and never billed
// to the owner by mistake). Departure cleans can only be deleted from the scheduler,
// which requires the admin password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bzApi, updateBreezewayTask, retrieveBreezewayTask, completeBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { adminPasswordOk } from '@/lib/shareAuth'

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
    // THE LIVE NAME, not the mirror's. The mirror can be stale or missing this task entirely —
    // trusting it once renamed a real task to literally "VENDOR NEEDED - " and let the
    // no-deleting-cleans guard pass on an empty string. Breezeway is the truth; mirror is fallback.
    let name = ''
    try {
      const cur = await retrieveBreezewayTask(taskId)
      const t: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
      name = str(t && t.name)
    } catch { /* fall back to the mirror */ }
    if (!name) {
      const { data: row } = await db.from('breezeway_tasks_sync').select('id,name').eq('id', taskId).maybeSingle()
      name = str(row && row.name)
    }
    if (!name) return NextResponse.json({ ok: false, error: 'Could not read the task from Breezeway — not acting on a task we cannot see.' }, { status: 502 })

    if (action === 'delete') {
      // NOTHING gets deleted without the embedded admin password (set in Users & access).
      const gate = await adminPasswordOk(str(body.adminPassword))
      if (!gate.ok) return NextResponse.json({ ok: false, error: 'Admin password required to delete tasks' + (gate.reason ? ' (' + gate.reason + ')' : '') + '.' }, { status: 403 })
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
      // strip the phrase WHEREVER it sits — "Fix AC — vendor needed" used to survive removal
      // (anchored regex) while the ok:true response made the click look like it worked
      if (!on && has) newName = name.replace(/\s*[-:\u2014]?\s*vendor needed\s*[-:\u2014]?\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim()
      if (newName === name || !newName.trim()) {
        return NextResponse.json({ ok: false, error: on ? 'Already flagged for a vendor.' : 'Could not remove the flag from this task name — open it in Breezeway.' }, { status: 409 })
      }
      const r = await updateBreezewayTask(taskId, { name: newName })
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      // mirror immediately so the board shows the flag without waiting for the next sync
      try { await db.from('breezeway_tasks_sync').update({ name: newName }).eq('id', taskId) } catch {}
      return NextResponse.json({ ok: true, name: newName, vendor: on })
    }

    if (action === 'complete') {
      // Close a task the crew finished but never closed. Verified by reading the status back —
      // "the call returned 200" and "it is actually complete" are different facts in Breezeway.
      const r = await completeBreezewayTask(taskId)
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + str(r.text).slice(0, 140) }, { status: 502 })
      let liveStatus = ''
      try {
        const back = await retrieveBreezewayTask(taskId)
        const t: any = back.ok && back.data ? (back.data.task || back.data) : null
        const st: any = t && (t.type_task_status || t.status)
        liveStatus = str(typeof st === 'object' ? (st.code || st.name) : st).toLowerCase()
      } catch { /* verified below as best effort */ }
      const done = /complete|finish|close|approv/.test(liveStatus)
      if (done) { try { await db.from('breezeway_tasks_sync').update({ status: liveStatus || 'completed', finished_at: new Date().toISOString() }).eq('id', taskId) } catch {} }
      return NextResponse.json({ ok: done, status: liveStatus || null, error: done ? undefined : 'Breezeway accepted the call but the task still reads "' + (liveStatus || 'unknown') + '" — close it in Breezeway.' }, { status: done ? 200 : 502 })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
