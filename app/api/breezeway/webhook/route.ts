// Breezeway task webhooks: keep breezeway_tasks_sync live after the one-time backfill.
// Breezeway POSTs the full current task object on task events (created/assigned/started/completed).
// We do NOT trust the payload: we re-fetch the task from the Breezeway API (authoritative +
// validates the sender) and upsert that copy. Plain GET answers Breezeway's URL-validation ping.
// One-time setup (logged-in): GET ?subscribe=1 registers this URL for 'task' events.
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, getBreezewayToken, retrieveBreezewayTask, mapBreezewayTask, updateBreezewayTask } from '@/lib/breezeway'
import { withTroubleshoot, optedOut, TROUBLESHOOT_MARKER } from '@/lib/troubleshoot'
import { requireVrAdmin } from '@/lib/vr-gate'
import { bustBoards } from '@/lib/bust'
import { isTaskDone } from '@/lib/task-categories'
import { walkReportForTask } from '@/lib/walk-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WEBHOOK_BASE = process.env.BREEZEWAY_WEBHOOK_URL || 'https://api.breezeway.io/public/webhook/v1'
// The app's own address, the same base every other link the app sends uses (was the old
// stayboard-three alias, 2026-09-29). Only the admin-only ?subscribe=1 reads it.
const RECEIVER_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '') + '/api/breezeway/webhook'

// AT MOST ONE BUST EVERY 15 SECONDS PER INSTANCE (2026-09-29 review, R1-8). Events come in bursts —
// a cleaner closing a unit fires started / checklist / finished within seconds, a morning's
// assignments arrive by the dozen — and every delivery busted the day and the Scheduler, so each
// board rebuilt its whole picture again and again. Both tags ('day' and 'schedule') are busted, as
// before. The trade: an event that lands inside a window shows with the next bust, or when the
// board's own cache runs out (the day in under a minute, the Scheduler's snapshot in five).
const BUST_EVERY_MS = 15_000
let lastBustAt = 0

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  if (!p.get('subscribe') && !p.get('list')) return NextResponse.json({ ok: true }) // validation ping
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const token = await getBreezewayToken()
  if (p.get('list')) {
    const r = await fetch(WEBHOOK_BASE + '/subscribe', { headers: { Authorization: 'JWT ' + token, Accept: 'application/json' }, cache: 'no-store' })
    return NextResponse.json({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })
  }
  const r = await fetch(WEBHOOK_BASE + '/subscribe', { method: 'POST', headers: { Authorization: 'JWT ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ url: RECEIVER_URL, webhook_type: 'task' }), cache: 'no-store' })
  return NextResponse.json({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const t = body && (body.task || body.data || body)
  const id = t && (t.id ?? t.task_id)
  if (id == null) return NextResponse.json({ ok: true, ignored: true })
  try {
    const r = await retrieveBreezewayTask(String(id))
    const task = r.ok ? (r.data && (r.data.task || r.data)) : null
    if (!task || task.id == null) return NextResponse.json({ ok: true, ignored: true })
    const row: any = { ...mapBreezewayTask(task), synced_at: new Date().toISOString() }
    const { error } = await supabaseAdmin().from('breezeway_tasks_sync').upsert(row, { onConflict: 'id' })
    // A field change in Breezeway (started, finished, reassigned) reaches the boards on the next
    // read, not when their cache happens to expire — throttled per instance (BUST_EVERY_MS).
    if (!error && Date.now() - lastBustAt >= BUST_EVERY_MS) { lastBustAt = Date.now(); bustBoards({ daysheet: false }) }
    // A FINISHED PROGRAM TASK BECOMES ITS REPORT (lib/walk-reports; Jon, 2026-11-02, the Eden
    // exterior walk). After Breezeway has its 200 — the answers, photos and the owners' email take
    // seconds, and a delivery that waits on them is a delivery Breezeway retries. Idempotent per
    // task, and a task that is not a reporting program's is answered in one settings read.
    if (isTaskDone(row.status, row.finished_at)) {
      waitUntil(walkReportForTask(task).then(r => { if (r.code && !r.skipped) console.info('[walk-reports] filed', r.code, 'for task', String(task.id)); else if (r.error) console.error('[walk-reports]', String(task.id), r.error) }).catch(e => console.error('[walk-reports] unhandled', String(e?.message || e).slice(0, 300))))
    }
    // TROUBLESHOOT FIRST for maintenance tasks made straight in Breezeway (lib/troubleshoot). Once:
    // only open tasks created in the last 48 h whose description lacks the marker — the PATCH below
    // fires another webhook, which then sees the marker and stops.
    else if (/maint/.test(String(row.type_department || '')) && !String(task.description || '').includes(TROUBLESHOOT_MARKER)) {
      const made = Date.parse(String(task.created_at ?? task.created ?? ''))
      const notStarted = !task.started_at && !/start|progress/.test(String(row.status || ''))
      if (Number.isFinite(made) && Date.now() - made < 48 * 3600_000 && notStarted) {
        waitUntil((async () => {
          if (await optedOut(String(task.id))) return
          const d = await withTroubleshoot({ type_department: row.type_department, name: task.name, description: task.description, template_id: task.template_id ?? task.template?.id, home_id: task.home_id })
          if (!d) return
          const u = await updateBreezewayTask(String(task.id), { description: d })
          if (u.ok) console.info('[troubleshoot] added to task', String(task.id))
          else console.warn('[troubleshoot] patch failed', String(task.id), u.status, String(u.text || '').slice(0, 160))
        })().catch(e => console.error('[troubleshoot]', String(e?.message || e).slice(0, 300))))
      }
    }
  } catch { /* never fail the webhook delivery */ }
  return NextResponse.json({ ok: true })
}
