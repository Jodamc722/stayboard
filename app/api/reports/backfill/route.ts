// Historical reservation backfill for Owner Reports. The regular sync only keeps the
// current window (checkouts from ~45 days back), so closed months earlier in the year
// under-count. POST { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', maxPages?: number }
// pulls reservations by CHECK-IN date range from Guesty and upserts them into the
// guesty_reservations mirror. Idempotent; call again to continue if pages hit the cap.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const FIELDS = encodeURIComponent('status guest listing checkIn checkOut checkInDateLocalized checkOutDateLocalized nightsCount money source customFields confirmationCode createdAt note')

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v); return isNaN(n) ? null : n
}
function nightsBetween(ci?: string, co?: string): number | null {
  if (!ci || !co) return null
  const a = new Date(ci).getTime(); const b = new Date(co).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}
// Same shape as lib/guesty mapReservation (kept local; that mapper is not exported).
function mapReservation(r: any) {
  const m = r.money || {}
  return {
    id:                r._id || r.id,
    listing_id:        r.listingId || r.listing?._id || r.listing?.id || null,
    listing_name:      r.listing?.nickname || r.listing?.title || null,
    guest_id:          r.guest?._id || r.guest?.id || r.guestId || null,
    guest_name:        r.guest?.fullName || [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(' ') || null,
    guest_email:       r.guest?.email || null,
    guest_phone:       r.guest?.phone || null,
    check_in:          r.checkInDateLocalized  || (r.checkIn  ? String(r.checkIn).slice(0, 10)  : null),
    check_out:         r.checkOutDateLocalized || (r.checkOut ? String(r.checkOut).slice(0, 10) : null),
    nights:            r.nightsCount ?? r.nights ?? nightsBetween(r.checkIn, r.checkOut),
    status:            (r.status || '').toLowerCase() || null,
    source:            (r.source || r.channel || '').toLowerCase() || null,
    confirmation_code: r.confirmationCode || r.confirmation_code || null,
    money_total:       num(m.hostPayout ?? m.totalPaid ?? m.fareAccommodation ?? m.netIncome),
    money_paid:        num(m.totalPaid),
    money_balance:     num(m.balanceDue),
    money_currency:    m.currency || 'USD',
    notes:             r.note || r.notes || null,
    custom_fields:     Array.isArray(r.customFields) ? r.customFields : null,
    conversation_id:   r.conversation?._id || r.conversationId || null,
    created_at:        r.createdAt || null,
    raw:               r,
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const year = new Date().getFullYear()
  const from = typeof body?.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : year + '-01-01'
  const to = typeof body?.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : year + '-12-31'
  const maxPages = Math.min(40, Math.max(1, Number(body?.maxPages) || 30))
  const skipStart = Math.max(0, Number(body?.skip) || 0)

  const db = supabaseAdmin()
  const token = await getToken()
  const filters = encodeURIComponent(JSON.stringify([
    { field: 'checkIn', operator: '$gte', value: from + 'T00:00:00.000Z' },
    { field: 'checkIn', operator: '$lte', value: to + 'T23:59:59.999Z' },
  ]))
  let total = 0
  let pages = 0
  let done = false
  for (let page = 0; page < maxPages; page++) {
    const skip = skipStart + page * 100
    const r = await fetch(BASE + '/reservations?limit=100&skip=' + skip + '&fields=' + FIELDS + '&sort=checkIn&filters=' + filters, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); page--; continue }
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return NextResponse.json({ error: 'Guesty ' + r.status + ': ' + t.slice(0, 200), upserted: total, pages }, { status: 502 })
    }
    const data: any = await r.json()
    const results: any[] = Array.isArray(data?.results) ? data.results : []
    pages++
    if (!results.length) { done = true; break }
    const rows = results.map(mapReservation).filter((x: any) => x.id)
    const { error } = await db.from('guesty_reservations').upsert(rows, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: 'upsert: ' + error.message, upserted: total, pages }, { status: 500 })
    total += rows.length
    if (results.length < 100) { done = true; break }
  }
  return NextResponse.json({ ok: true, upserted: total, pages, done, from, to, nextSkip: skipStart + pages * 100 })
}
