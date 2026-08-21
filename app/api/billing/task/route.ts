// BILLING TASK ACTIONS.
//
// action:'update' — the edits Breezeway's API accepts write STRAIGHT BACK to the task
//   (rate_paid, rate_type, scheduled_date, name, priority). PATCH requires `name`, so the
//   mirror's name rides along when the caller doesn't send one. After the PATCH we re-retrieve
//   the task and refresh mirror + billing detail so the board shows what Breezeway now says.
//
// action:'adjust' — OUR overlay only (billing_adjustments): exclude from billing, note,
//   override the billed total, override billed hours, extra line items. Never sent to
//   Breezeway — their API cannot edit cost/supply line items.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateBreezewayTask, retrieveBreezewayTask, mapBreezewayTask, breezewayConfigured, createBreezewayComment } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const num = (v: any): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

async function refreshFromBreezeway(db: any, taskId: string) {
  const r = await retrieveBreezewayTask(taskId)
  if (!r.ok || !r.data) return
  const t = r.data
  await db.from('breezeway_billing_details').upsert({
    task_id: taskId,
    bill_to: t?.bill_to ? String(t.bill_to) : null,
    rate_type: t?.rate_type ? String(t.rate_type) : null,
    costs: Array.isArray(t?.costs) ? t.costs : [],
    supplies: Array.isArray(t?.supplies) ? t.supplies : [],
    synced_at: new Date().toISOString(),
  }, { onConflict: 'task_id' })
  const m: any = mapBreezewayTask(t)
  if (m?.id) {
    const rp = Number(m.rate_paid)
    m.rate_paid = Number.isFinite(rp) ? rp : null
    m.synced_at = new Date().toISOString()
    await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const taskId = String(body?.taskId || '')
  const action = String(body?.action || '')
  if (!taskId) return NextResponse.json({ ok: false, error: 'taskId required' }, { status: 400 })

  if (action === 'update') {
    if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured.' }, { status: 400 })
    const patch: Record<string, any> = {}
    const rate = num(body?.rate_paid)
    if (rate != null) patch.rate_paid = rate
    const rt = String(body?.rate_type || '').toLowerCase()
    if (rt === 'hourly' || rt === 'piece') patch.rate_type = rt
    const sd = String(body?.scheduled_date || '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) patch.scheduled_date = sd
    if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200)
    if (typeof body?.description === 'string') patch.description = body.description.slice(0, 4000)
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 })
    if (!patch.name) {
      // Breezeway's PATCH requires name — send the current one back unchanged.
      const { data } = await db.from('breezeway_tasks_sync').select('name').eq('id', taskId).limit(1)
      const cur = (data || [])[0] as any
      if (cur?.name) patch.name = String(cur.name)
    }
    const r = await updateBreezewayTask(taskId, patch)
    if (!r.ok) return NextResponse.json({ ok: false, error: `Breezeway ${r.status}: ${String(r.text || '').slice(0, 200)}` }, { status: 502 })
    try { await refreshFromBreezeway(db, taskId) } catch { /* board refresh will catch up */ }
    return NextResponse.json({ ok: true })
  }

  if (action === 'adjust') {
    // Partial upsert: only the keys the caller sent change; the rest keep their stored value.
    const { data } = await db.from('billing_adjustments').select('*').eq('task_id', taskId).limit(1)
    const cur = ((data || [])[0] as any) || {}
    const row: Record<string, any> = {
      task_id: taskId,
      excluded: typeof body?.excluded === 'boolean' ? body.excluded : !!cur.excluded,
      note: body?.note !== undefined ? (String(body.note || '').slice(0, 500) || null) : (cur.note ?? null),
      override_amount: body?.override_amount !== undefined ? num(body.override_amount) : (cur.override_amount ?? null),
      billed_hours: body?.billed_hours !== undefined ? num(body.billed_hours) : (cur.billed_hours ?? null),
      // Per-line-item amount overrides ('cost:<id>'/'supply:<id>' → dollars). Client sends the
      // FULL map each time; an empty object clears every override on the task.
      item_overrides: (() => {
        if (body?.item_overrides === undefined) return cur.item_overrides ?? {}
        const clean: Record<string, number> = {}
        const src = body.item_overrides
        if (src && typeof src === 'object') {
          for (const k of Object.keys(src)) {
            const v = num(src[k])
            if (k && v != null && v >= 0) clean[String(k).slice(0, 60)] = v
          }
        }
        return clean
      })(),
      extra_items: body?.extra_items !== undefined
        ? (Array.isArray(body.extra_items) ? body.extra_items.slice(0, 30).map((x: any) => ({
            description: String(x?.description || '').slice(0, 200),
            amount: num(x?.amount) || 0,
            bill_to: String(x?.bill_to || 'owner'),
            // 'supply' marks a supplies cost added on the board (Jon, 2026-08-21) so it renders
            // as a supply line; anything else stays a plain adjustment.
            kind: x?.kind === 'supply' ? 'supply' : 'extra',
          })).filter((x: any) => x.description && x.amount) : [])
        : (cur.extra_items ?? []),
      // Per-task review mark (migration 029): review as you go, skim the leftovers at close-out.
      reviewed_by: typeof body?.reviewed === 'boolean'
        ? (body.reviewed ? (gate.access.email || 'unknown') : null)
        : (cur.reviewed_by ?? null),
      reviewed_at: typeof body?.reviewed === 'boolean'
        ? (body.reviewed ? new Date().toISOString() : null)
        : (cur.reviewed_at ?? null),
      updated_by: gate.access.email || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('billing_adjustments').upsert(row, { onConflict: 'task_id' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // PUSH TO BREEZEWAY, the only way their API allows (Jon, 2026-08-21: "be able to add labor
    // cost and supplies cost as a field in breezeway"). Their public API has no writable
    // cost/supply line items — rate_paid is the single billing field it accepts — so a supplies
    // cost added here is ALSO posted onto the Breezeway task as a comment. The dollars live in
    // our overlay (they bill correctly on the export); the comment makes the task in Breezeway
    // itself say what was spent. Best-effort: a comment failure never loses the saved item.
    let commented = false
    const bzNote = typeof body?.bz_note === 'string' ? body.bz_note.trim().slice(0, 300) : ''
    if (bzNote && breezewayConfigured()) {
      const c = await createBreezewayComment(taskId, bzNote).catch(() => ({ ok: false } as any))
      commented = !!c.ok
    }
    return NextResponse.json({ ok: true, commented })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
}
