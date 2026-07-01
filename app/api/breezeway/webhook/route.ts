// Breezeway task webhooks: keep breezeway_tasks_sync live after the one-time backfill.
// Breezeway POSTs the full current task object on task events (created/assigned/started/completed).
// We do NOT trust the payload: we re-fetch the task from the Breezeway API (authoritative +
// validates the sender) and upsert that copy. Plain GET answers Breezeway's URL-validation ping.
// One-time setup (logged-in): GET ?subscribe=1 registers this URL for 'task' events.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, getBreezewayToken, retrieveBreezewayTask, mapBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const WEBHOOK_BASE = process.env.BREEZEWAY_WEBHOOK_URL || 'https://api.breezeway.io/public/webhook/v1'
const RECEIVER_URL = 'https://stayboard-three.vercel.app/api/breezeway/webhook'

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  if (!p.get('subscribe') && !p.get('list')) return NextResponse.json({ ok: true }) // validation ping
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
    await supabaseAdmin().from('breezeway_tasks_sync').upsert(row, { onConflict: 'id' })
  } catch { /* never fail the webhook delivery */ }
  return NextResponse.json({ ok: true })
}
