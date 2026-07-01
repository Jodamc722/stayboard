// Create missing DEPARTURE CLEAN tasks in Breezeway for cleans that exist in Guesty but
// never got auto-created by the Guesty->Breezeway integration (flagged 'guesty-only' on
// the schedule board). Idempotent: skips when a housekeeping clean already exists for the
// unit + date. GET diagnoses one unit/date (existing tasks + whether Breezeway even has
// the reservation). Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, bzApi, createBreezewayTask, listPropertyHousekeeping, pickDepartureClean } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function homeIdFor(listingId: string): Promise<number | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const n = Number((data || [])[0]?.home_id)
  return Number.isFinite(n) ? n : null
}

function asArr(d: any): any[] {
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.data)) return d.data
  return []
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const p = new URL(req.url).searchParams
  const listingId = String(p.get('listingId') || '').trim()
  const date = String(p.get('date') || '').slice(0, 10)
  if (!listingId || !date) return NextResponse.json({ error: 'Pass ?listingId=<guesty id>&date=YYYY-MM-DD' }, { status: 400 })
  const tasks = await listPropertyHousekeeping(listingId, date, date)
  const r = await bzApi('/reservation/external-id?reference_property_id=' + encodeURIComponent(listingId) + '&checkout_date_ge=' + date + '&checkout_date_le=' + date)
  const res = asArr(r.data).map((x: any) => ({
    id: x?.id ?? null,
    status: x?.status ?? null,
    checkin: x?.checkin_date ?? null,
    checkout: x?.checkout_date ?? null,
    guest: Array.isArray(x?.guests) && x.guests[0] ? [x.guests[0].first_name, x.guests[0].last_name].filter(Boolean).join(' ') : null,
  }))
  return NextResponse.json({ ok: true, listingId, date, housekeepingTasksOnDate: tasks.map((t: any) => ({ id: t.id, name: t.name, status: t.status, scheduled_date: t.scheduled_date })), reservationsCheckingOut: res, reservationLookup: r.ok ? 'ok' : 'Breezeway ' + r.status })
}

// Undo: delete tasks this route created. Body { taskIds: [id, ...] }.
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const body = await req.json().catch(() => ({} as any))
  const ids = (Array.isArray(body?.taskIds) ? body.taskIds : []).map((x: any) => String(x)).filter(Boolean).slice(0, 40)
  if (!ids.length) return NextResponse.json({ error: 'No taskIds.' }, { status: 400 })
  const results: any[] = []
  for (const id of ids) {
    try {
      const r = await bzApi('/task/' + encodeURIComponent(id), { method: 'DELETE' })
      results.push({ taskId: id, ok: r.ok, status: r.status, error: r.ok ? undefined : r.text.slice(0, 160) })
    } catch (e: any) {
      results.push({ taskId: id, ok: false, error: String(e?.message || e).slice(0, 160) })
    }
  }
  try { revalidateTag('schedule') } catch {}
  return NextResponse.json({ ok: true, deleted: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, results })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const items = Array.isArray(body?.items) ? body.items.slice(0, 40) : []
  if (!items.length) return NextResponse.json({ error: 'No items. Body: { items: [{ listingId, date, guest?, description?, assigneeIds? }] }' }, { status: 400 })

  const results: any[] = []
  for (const it of items) {
    const listingId = String(it?.listingId || '').trim()
    const date = String(it?.date || '').slice(0, 10)
    if (!listingId || !date) { results.push({ listingId, date, ok: false, error: 'missing listingId/date' }); continue }
    try {
      const existing = pickDepartureClean(await listPropertyHousekeeping(listingId, date, date), date)
      if (existing && existing.id) { results.push({ listingId, date, ok: true, taskId: existing.id, skipped: true }); continue }
      const assigneeIds = (Array.isArray(it?.assigneeIds) ? it.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
      const guest = typeof it?.guest === 'string' ? it.guest.slice(0, 60) : ''
      const description = (typeof it?.description === 'string' && it.description.trim())
        ? it.description.slice(0, 1500)
        : 'Departure clean ' + date + (guest ? ' - ' + guest + ' checking out.' : '.') + ' Created from StayBoard (clean was in Guesty but missing from Breezeway).'
      const homeId = await homeIdFor(listingId)
      const payload: Record<string, any> = { name: 'Departure Clean', type_department: 'housekeeping', type_priority: 'normal', scheduled_date: date, description }
      if (homeId) payload.home_id = homeId
      else payload.reference_property_id = listingId
      if (assigneeIds.length) payload.assignments = assigneeIds
      const r = await createBreezewayTask(payload)
      if (!r.ok || !r.data?.id) { results.push({ listingId, date, ok: false, error: 'Breezeway ' + r.status + ': ' + r.text.slice(0, 160) }); continue }
      results.push({ listingId, date, ok: true, taskId: String(r.data.id), reportUrl: r.data?.report_url || null, created: true })
    } catch (e: any) {
      results.push({ listingId, date, ok: false, error: String(e?.message || e).slice(0, 160) })
    }
  }
  try { revalidateTag('schedule') } catch {}
  return NextResponse.json({
    ok: true,
    created: results.filter(x => x.created).length,
    skipped: results.filter(x => x.skipped).length,
    failed: results.filter(x => !x.ok).length,
    results,
  })
}
