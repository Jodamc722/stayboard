import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { bzApi, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Instant, targeted mirror refresh for just the units shown on a given day, so a
// fresh Breezeway assignment appears in seconds when the user hits Refresh -
// instead of waiting for the 30-minute background cron. Then busts the board cache.

function asArray(d: any): any[] {
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.data)) return d.data
  return []
}
function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

async function run(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const raw = String(body?.date || '')
  const date = raw.length === 10 && raw[4] === '-' && raw[7] === '-' ? raw : etToday()

  if (!breezewayConfigured()) {
    try { revalidateTag('schedule') } catch {}
    return NextResponse.json({ ok: false, reason: 'not configured' })
  }

  const [{ data: res }, { data: mir }] = await Promise.all([
    db.from('guesty_reservations').select('listing_id').eq('check_out', date).limit(2000),
    db.from('breezeway_tasks_sync').select('reference_property_id').eq('scheduled_date', date).limit(4000),
  ])
  const ids = new Set<string>()
  for (const r of (res || []) as any[]) { const k = String(r.listing_id || ''); if (k) ids.add(k) }
  for (const r of (mir || []) as any[]) { const k = String(r.reference_property_id || ''); if (k) ids.add(k) }
  if (!ids.size) {
    try { revalidateTag('schedule') } catch {}
    return NextResponse.json({ ok: true, date, units: 0, upserted: 0 })
  }

  const { data: props } = await db
    .from('breezeway_properties')
    .select('home_id, reference_property_id, status')
    .in('reference_property_id', Array.from(ids))
  const active = ((props || []) as any[]).filter((p) => String(p.status || '').toLowerCase() === 'active')

  let upserted = 0
  for (const p of active) {
    let r: any
    try { r = await bzApi('/task/?home_id=' + encodeURIComponent(String(p.home_id)) + '&limit=500') } catch { continue }
    if (!r?.ok) continue
    const arr = asArray(r.data)
    if (!arr.length) continue
    const now = new Date().toISOString()
    const rows = arr.map(mapBreezewayTask).filter((t: any) => t?.id).map((t: any) => {
      const rp = Number(t.rate_paid)
      return { ...t, rate_paid: Number.isFinite(rp) ? rp : null, home_id: p.home_id, reference_property_id: p.reference_property_id, synced_at: now }
    })
    if (!rows.length) continue
    try { const { error } = await db.from('breezeway_tasks_sync').upsert(rows, { onConflict: 'id' }); if (!error) upserted += rows.length } catch {}
  }
  try { revalidateTag('schedule') } catch {}
  return NextResponse.json({ ok: true, date, units: active.length, upserted })
}

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }
