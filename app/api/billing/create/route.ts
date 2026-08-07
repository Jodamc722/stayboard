// ADD A BILLABLE TASK from the billing page. Creates a REAL task in Breezeway (so the field
// record lives where all work lives), mirrors it immediately, and — when an amount is given —
// bills it right away via our overlay (override_amount + hours at the charge rate). Flat-fee
// friendly: an owner-onboarding clean can be charged whatever was agreed.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEPTS = ['maintenance', 'housekeeping', 'inspection', 'safety']

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured.' }, { status: 400 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '').trim()
  const name = String(body?.name || '').trim().slice(0, 200)
  const department = DEPTS.indexOf(String(body?.department || '')) >= 0 ? String(body.department) : 'maintenance'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : null
  const amount = Number(body?.amount)
  const description = typeof body?.description === 'string' ? body.description.slice(0, 4000) : ''
  if (!listingId || !name) return NextResponse.json({ ok: false, error: 'Unit and title are required.' }, { status: 400 })

  const { data: prop } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const homeId = Number((prop || [])[0]?.home_id)
  const payload: Record<string, any> = { name, type_department: department }
  if (Number.isFinite(homeId)) payload.home_id = homeId
  else payload.reference_property_id = listingId
  if (date) payload.scheduled_date = date
  if (description) payload.description = description

  const r = await createBreezewayTask(payload)
  if (!r.ok || !r.data) return NextResponse.json({ ok: false, error: `Breezeway ${r.status}: ${String(r.text || '').slice(0, 200)}` }, { status: 502 })
  const created: any = r.data
  const id = String(created?.id || '')
  if (!id) return NextResponse.json({ ok: false, error: 'Breezeway returned no task id.' }, { status: 502 })

  // Mirror it now (the 15-min cron would pick it up eventually; billing wants it immediately).
  try {
    const m: any = mapBreezewayTask(created)
    if (m?.id) {
      const rp = Number(m.rate_paid)
      m.rate_paid = Number.isFinite(rp) ? rp : null
      m.home_id = Number.isFinite(homeId) ? homeId : m.home_id
      m.reference_property_id = listingId
      m.synced_at = new Date().toISOString()
      await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
    }
    await db.from('breezeway_billing_details').upsert({
      task_id: id,
      bill_to: created?.bill_to ? String(created.bill_to) : null,
      rate_type: created?.rate_type ? String(created.rate_type) : null,
      costs: [], supplies: [],
      synced_at: new Date().toISOString(),
    }, { onConflict: 'task_id' })
  } catch { /* mirror catch-up is best effort — the task exists in Breezeway either way */ }

  if (Number.isFinite(amount) && amount > 0) {
    const def = await getSetting<{ rate: number }>('billing_default_rate', { rate: 40 })
    const chargeRate = Number(def?.rate) > 0 ? Number(def.rate) : 40
    const { error } = await db.from('billing_adjustments').upsert({
      task_id: id,
      excluded: false,
      note: 'Added from Billable Hours',
      override_amount: Math.round(amount * 100) / 100,
      billed_hours: Math.round((amount / chargeRate) * 100) / 100,
      extra_items: [], item_overrides: {},
      updated_by: gate.access.email || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'task_id' })
    if (error) return NextResponse.json({ ok: true, id, warning: 'Task created but billing amount failed: ' + error.message })
  }
  return NextResponse.json({ ok: true, id })
}
