// UNPAID BALANCES (Jon, 2026-10-01). Every live reservation in a date window whose folio still
// shows money owed, ordered by how soon it bites: a guest already in the unit, then today's
// arrivals, then the next seven days, then the rest of the range. Paid / not paid is Guesty's
// folio (money.isFullyPaid, balanceDue); what we did about it is ours (unpaid_tracking).
//
// WHAT COUNTS AS UNPAID. balanceDue > $1 on a confirmed / reserved / checked-in stay. Owner and
// friends-&-family stays are skipped (nothing to collect). A channel that collects for us (Airbnb,
// Expedia collect, Booking.com with payment by Booking) often shows a balance Guesty will settle at
// check-in — those stay on the list but are tagged CHANNEL PAYS so the desk chases the right ones.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { isOwnerOrFriendsFamily } from './owner-audit'
import { isLiveStay } from './stay-status'

const TZ = 'America/New_York'
export const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
export const shiftDay = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdET(d) }
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export type UnpaidStatus = 'open' | 'contacted' | 'promised' | 'disputed' | 'waived'
export const UNPAID_STATUSES: UnpaidStatus[] = ['open', 'contacted', 'promised', 'disputed', 'waived']
export type UnpaidNote = { at: string; by: string; text: string }
export type UnpaidRow = {
  id: string; unit: string; listingId: string | null; building: string
  guest: string; phone: string | null; email: string | null
  checkIn: string; checkOut: string; nights: number; status: string
  source: string; channelPays: boolean
  total: number; paid: number; balance: number; currency: string
  daysUntil: number                      // negative = in house (arrived), 0 = today
  bucket: 'in_house' | 'today' | 'week' | 'later'
  guestyUrl: string
  tracking: { status: UnpaidStatus; notes: UnpaidNote[]; updatedAt: string | null; updatedBy: string | null }
}
export type UnpaidReport = {
  from: string; to: string; today: string
  rows: UnpaidRow[]
  summary: { count: number; balance: number; inHouse: number; today: number; week: number; later: number; channelPays: number; chased: number }
}

// Channels that collect the guest's money themselves. The balance Guesty shows is what the channel
// still owes US, not what the guest owes — a different phone call.
const CHANNEL_PAYS = /airbnb|expedia|booking\.?com|vrbo|homeaway|marriott|hotels\.com/i
const channelPaysFor = (source: string, raw: any): boolean => {
  if (!CHANNEL_PAYS.test(source)) return false
  // Booking.com "payment by hotel" and Vrbo "pay at property" put the guest on the hook — Guesty
  // marks those with a payment provider / paymentMethod on the money object. Best effort.
  const m = raw?.money || {}
  const pm = str(m.paymentMethod || m.payment_method || raw?.paymentMethod)
  if (/property|hotel|at_check_in|cash/i.test(pm)) return false
  return true
}

export async function loadUnpaid(opts: { from?: string; to?: string } = {}): Promise<UnpaidReport> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.from)) ? str(opts.from) : today
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.to)) ? str(opts.to) : shiftDay(today, 7)
  // Stays touching the window: arriving inside it, or already in house during it.
  const { data: res } = await db.from('guesty_reservations')
    .select('id, listing_id, listing_name, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, confirmation_code, money_total, money_paid, money_balance, money_currency, custom_fields, raw')
    .lte('check_in', to).gte('check_out', from)
    .limit(3000)
  const rows0 = (res || []) as any[]
  const lids = Array.from(new Set(rows0.map(r => str(r.listing_id)).filter(Boolean)))
  const names: Record<string, { name: string; building: string }> = {}
  for (let i = 0; i < lids.length; i += 200) {
    const { data: ls } = await db.from('guesty_listings').select('id, nickname, title, building').in('id', lids.slice(i, i + 200))
    for (const l of ls || []) names[str(l.id)] = { name: str(l.nickname || l.title || l.id), building: str(l.building) }
  }
  const ids = rows0.map(r => str(r.id))
  const tracking: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data: tr } = await db.from('unpaid_tracking').select('*').in('reservation_id', ids.slice(i, i + 200))
    for (const t of tr || []) tracking[str(t.reservation_id)] = t
  }

  const out: UnpaidRow[] = []
  for (const r of rows0) {
    if (!isLiveStay(r.status)) continue
    const raw: any = r.raw && typeof r.raw === 'object' ? r.raw : {}
    const m: any = raw.money && typeof raw.money === 'object' ? raw.money : {}
    const tagBlob = JSON.stringify(raw.tags || '') + ' ' + JSON.stringify(r.custom_fields || '')
    if (isOwnerOrFriendsFamily(str(r.source), tagBlob, str(r.guest_name))) continue
    const balance = typeof m.balanceDue === 'number' ? m.balanceDue : num(r.money_balance)
    const fullyPaid = m.isFullyPaid === true
    if (fullyPaid || balance <= 1) continue
    const total = num(m.hostPayout ?? m.totalPrice ?? m.fareAccommodation) || num(r.money_total)
    const paid = typeof m.totalPaid === 'number' ? m.totalPaid : num(r.money_paid)
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    const daysUntil = Math.round((Date.parse(ci + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86400000)
    const inHouse = ci <= today && co > today
    const bucket: UnpaidRow['bucket'] = inHouse ? 'in_house' : daysUntil <= 0 ? 'today' : daysUntil <= 7 ? 'week' : 'later'
    const t = tracking[str(r.id)]
    const li = names[str(r.listing_id)]
    out.push({
      id: str(r.id), unit: li?.name || str(r.listing_name) || 'Unit', listingId: r.listing_id ? str(r.listing_id) : null, building: li?.building || '',
      guest: str(r.guest_name) || 'Guest', phone: r.guest_phone ? str(r.guest_phone) : null, email: r.guest_email ? str(r.guest_email) : null,
      checkIn: ci, checkOut: co, nights: num(r.nights), status: str(r.status),
      source: str(r.source), channelPays: channelPaysFor(str(r.source), raw),
      total: Math.round(total * 100) / 100, paid: Math.round(paid * 100) / 100, balance: Math.round(balance * 100) / 100, currency: str(r.money_currency) || 'USD',
      daysUntil, bucket,
      guestyUrl: `https://app.guesty.com/reservations/${encodeURIComponent(str(r.id))}`,
      tracking: { status: (UNPAID_STATUSES as string[]).includes(str(t?.status)) ? t.status : 'open', notes: Array.isArray(t?.notes) ? t.notes : [], updatedAt: t?.updated_at ? str(t.updated_at) : null, updatedBy: t?.updated_by ? str(t.updated_by) : null },
    })
  }
  const ORDER: Record<UnpaidRow['bucket'], number> = { in_house: 0, today: 1, week: 2, later: 3 }
  out.sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || a.checkIn.localeCompare(b.checkIn) || b.balance - a.balance)
  const sum = (f: (r: UnpaidRow) => boolean) => out.filter(f).length
  return {
    from, to, today, rows: out,
    summary: {
      count: out.length, balance: Math.round(out.reduce((a, r) => a + r.balance, 0)),
      inHouse: sum(r => r.bucket === 'in_house'), today: sum(r => r.bucket === 'today'), week: sum(r => r.bucket === 'week'), later: sum(r => r.bucket === 'later'),
      channelPays: sum(r => r.channelPays), chased: sum(r => r.tracking.status !== 'open'),
    },
  }
}

/** The checklist number: unpaid stays in house, arriving today or in the next 7 days, that the guest (not a channel) owes. */
export async function countUnpaidDue(): Promise<number | null> {
  try { const rep = await loadUnpaid(); return rep.rows.filter(r => r.bucket !== 'later' && !r.channelPays && r.tracking.status !== 'waived').length } catch { return null }
}

export async function updateTracking(reservationId: string, by: string, patch: { status?: UnpaidStatus; note?: string }): Promise<{ ok: boolean; error?: string; tracking?: any }> {
  const db = supabaseAdmin()
  const { data: cur } = await db.from('unpaid_tracking').select('*').eq('reservation_id', reservationId).maybeSingle()
  const notes: UnpaidNote[] = Array.isArray(cur?.notes) ? cur!.notes : []
  const text = str(patch.note).trim().slice(0, 600)
  if (text) notes.push({ at: new Date().toISOString(), by, text })
  const status: UnpaidStatus = patch.status && (UNPAID_STATUSES as string[]).includes(patch.status) ? patch.status : (cur?.status || 'open')
  if (!text && !patch.status) return { ok: false, error: 'nothing to save' }
  const row = { reservation_id: reservationId, status, notes: notes.slice(-40), updated_at: new Date().toISOString(), updated_by: by }
  const { error } = await db.from('unpaid_tracking').upsert(row, { onConflict: 'reservation_id' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, tracking: { status, notes: row.notes, updatedAt: row.updated_at, updatedBy: by } }
}
