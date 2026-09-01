// Task actions from Today in Ops: delete a NON-departure-clean task, or toggle the
// "VENDOR NEEDED" flag in the task title (so vendor work is tracked and never billed
// to the owner by mistake). Departure cleans can only be deleted from the scheduler,
// which requires the admin password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bzApi, updateBreezewayTask, retrieveBreezewayTask, completeBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { adminPasswordOk } from '@/lib/shareAuth'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VENDOR_TAG = 'VENDOR NEEDED - '
const CLEAN = /departure clean|strip & walkthrough/i
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'plan' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('plan', 'edit')
  if (!__gate.ok) return __gate.res
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

    // ── SCHEDULE (Jon, 2026-08-31: the Review tab's "Move to <day>") ─────────────────────────
    // Move one task onto a chosen date and say on it that Lighthouse did, using the same stamping
    // helpers the trip sweep uses — so a job rescheduled by hand from the board and one moved by
    // the automation carry an identical, dated explanation. A task with no trail is a task somebody
    // will undo tomorrow because nobody knows why it moved.
    if (action === 'schedule') {
      const date = str(body.date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, error: 'A date (YYYY-MM-DD) is required.' }, { status: 400 })
      }
      // Departure cleans are the calendar's, not ours: their date comes from the checkout, and
      // moving one by hand desynchronises it from the reservation that created it.
      if (CLEAN.test(name)) {
        return NextResponse.json({ ok: false, error: 'Departure cleans follow the checkout — reschedule the reservation, not the task.' }, { status: 403 })
      }
      // ASSIGN AND SCHEDULE IN ONE CALL (Jon, 2026-09-01: "lets make it where we can assign, pick
      // date, etc"). Two round trips from the browser could half-succeed — a job moved to Thursday
      // with nobody on it, or assigned but still dated last month — and a coordinator would have no
      // way to tell which half failed. One call, one result.
      const who = str(body.assignee)
      let assignments: number[] | null = null
      if (who) {
        const { matchBreezewayPerson } = await import('@/lib/breezeway')
        try {
          const id = await matchBreezewayPerson(who)
          if (Number.isFinite(id as any)) assignments = [Number(id)]
          else return NextResponse.json({ ok: false, error: `No Breezeway person matches "${who}".` }, { status: 400 })
        } catch {
          return NextResponse.json({ ok: false, error: 'Could not look that person up in Breezeway.' }, { status: 502 })
        }
      }
      const { movedTitle, stampDescription } = await import('@/lib/pending-work')
      let desc = ''
      try {
        const { data: row } = await db.from('breezeway_tasks_sync').select('raw').eq('id', taskId).maybeSingle()
        desc = str((row as any)?.raw?.description)
      } catch { /* a missing description just means we write a fresh stamp */ }
      const r = await updateBreezewayTask(taskId, {
        name: movedTitle(name, date),
        scheduled_date: date,
        description: stampDescription(desc, who
          ? `Moved to ${date} and given to ${who} from the Review tab.`
          : `Moved to ${date} from the Review tab — the unit is empty that day.`, date),
        ...(assignments ? { assignments } : {}),
      })
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      try {
        await db.from('breezeway_tasks_sync')
          .update({ scheduled_date: date, name: movedTitle(name, date), synced_at: new Date().toISOString() })
          .eq('id', taskId)
      } catch { /* the next sync catches up */ }
      return NextResponse.json({ ok: true, scheduled: date, assignee: who || null })
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

    if (action === 'priority') {
      // Escalate (or calm) a task without leaving the board — used by the glitch panel.
      const level = ['urgent', 'high', 'normal', 'low'].indexOf(str(body.level)) >= 0 ? str(body.level) : 'urgent'
      const r = await updateBreezewayTask(taskId, { type_priority: level })
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + str(r.text).slice(0, 140) }, { status: 502 })
      return NextResponse.json({ ok: true, priority: level })
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
