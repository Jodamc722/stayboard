// BOTANICA FROM GUESTY, UNTIL CLOUDBEDS HAS IT ALL (Jon, 2026-11-11: "make sure reviews import and
// have ability to respond here … improve reporting, visibility in bookings, lets also pull botanica
// booking too so we can complete reporting until we move to cloudbeds").
//
// The Garden side reads Cloudbeds (garden_*), but Botanica's bookings and reviews still live in Guesty
// while the move happens. This file is the bridge, READ-ONLY toward operations:
//
//   reservations   Guesty Botanica stays mapped to the garden reservation shape, for REPORTING ONLY
//                  (report datasets, revenue, the bookings list). They are never written into
//                  garden_reservations, so the call desk, triggers, door codes and the schedule never
//                  act on them — those still belong to the VR side while the unit is in Guesty.
//                  A stay Cloudbeds also has (same guest, same check-in) is dropped, so nothing counts twice.
//   reviews        Guesty reviews on Botanica units copied into garden_reviews (id gy-<guesty id>), so
//                  they sit with the rest; a reply posted from the Garden Reviews page goes back to the
//                  channel through Guesty (lib/review-reply), the same call the VR Reviews page makes.
//
// Money follows the Botanica deal (areas/botanica): the owner keeps cleaning, so a stay's revenue is
// accommodation as the guest paid it (fareAccommodationAdjusted) + cleaning — the same basis as the
// /report/botanica link Margaux reads.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { pageRows } from '../db-page'
import { importReviews } from './reviews'

const s = (v: any) => (v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const LIVE = ['confirmed', 'checked_in', 'checked_out']

export type BridgeRes = {
  id: string; status: string; check_in: string; check_out: string; nights: number | null; total: number | null; balance: number | null
  source: string | null; room_ids: string[]; room_names: string[]; guest_name: string | null; booked_at: string | null; origin: 'guesty'
}

/** The Botanica units in Guesty — the same rule as the Botanica report: name says Botanica, not a "full" listing, not inactive. */
export async function botanicaListings(): Promise<{ id: string; name: string; building: string | null }[]> {
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(1000)
  return ((data || []) as any[])
    .filter(l => /botanica/i.test(s(l.nickname) + ' ' + s(l.title) + ' ' + s(l.building)))
    .filter(l => !/\bfull\b/i.test(s(l.nickname || l.title)))
    .filter(l => ['inactive', 'disabled', 'archived', 'deleted'].indexOf(s(l.status).toLowerCase()) < 0)
    .map(l => ({ id: s(l.id), name: s(l.nickname || l.title), building: l.building ? s(l.building) : null }))
}

/** Guesty Botanica stays touching [from, to], minus any Cloudbeds already holds. */
export async function botanicaGuestyReservations(from: string, to: string): Promise<BridgeRes[]> {
  const units = await botanicaListings()
  if (!units.length) return []
  const name: Record<string, string> = {}
  for (const u of units) name[u.id] = u.name
  const db = supabaseAdmin()
  const [gy, cb] = await Promise.all([
    pageRows<any>((a, b) => db.from('guesty_reservations')
      .select('id,listing_id,status,check_in,check_out,nights,source,guest_name,created_at,accom:raw->money->>fareAccommodationAdjusted,clean:raw->money->>fareCleaning,balance:raw->money->>balanceDue')
      .in('listing_id', units.map(u => u.id)).in('status', LIVE).lte('check_in', to).gt('check_out', from).order('id').range(a, b), 10),
    db.from('garden_reservations').select('guest_name,check_in').lte('check_in', to).gte('check_out', from).limit(5000),
  ])
  const inCloudbeds = new Set(((cb.data || []) as any[]).map(r => s(r.guest_name).trim().toLowerCase() + '|' + s(r.check_in).slice(0, 10)))
  const out: BridgeRes[] = []
  for (const r of (gy.rows as any[])) {
    const ci = s(r.check_in).slice(0, 10), co = s(r.check_out).slice(0, 10)
    if (!ci || !co) continue
    if (inCloudbeds.has(s(r.guest_name).trim().toLowerCase() + '|' + ci)) continue
    out.push({
      id: 'gy:' + s(r.id), status: s(r.status), check_in: ci, check_out: co,
      nights: r.nights != null ? num(r.nights) : Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000)),
      total: Math.round((num(r.accom) + num(r.clean)) * 100) / 100,
      balance: r.balance != null ? num(r.balance) : null,
      source: r.source ? s(r.source) : null,
      room_ids: ['gy:' + s(r.listing_id)], room_names: [name[s(r.listing_id)] || 'Botanica unit'],
      guest_name: r.guest_name ? s(r.guest_name) : null, booked_at: r.created_at ? s(r.created_at) : null, origin: 'guesty',
    })
  }
  return out
}

/** Copy Guesty reviews on Botanica units into garden_reviews. New ones emit review_received (drafts, low-score alerts). */
export async function syncBotanicaReviews(days = 365): Promise<{ added: number; updated: number; errors: string[]; units: number }> {
  const units = await botanicaListings()
  if (!units.length) return { added: 0, updated: 0, errors: [], units: 0 }
  const db = supabaseAdmin()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { rows } = await pageRows<any>((a, b) => db.from('guesty_reviews')
    .select('id,listing_id,rating,content,channel,guest_name,created_at,has_reply,reply,excluded_from_score,res:raw->>reservationId')
    .in('listing_id', units.map(u => u.id)).gte('created_at', since).order('id').range(a, b), 10)
  const list = (rows as any[]).filter(r => r.rating != null).map(r => {
    const rating = num(r.rating)
    const channel = s(r.channel) || 'guesty'
    const max = /booking/i.test(channel) && rating > 5 ? 10 : 5
    return {
      source: channel.toLowerCase(), externalId: 'gy-' + s(r.id), guestName: r.guest_name || null, rating, maxRating: max,
      title: null, body: r.content || null, receivedAt: r.created_at || null, reservationId: r.res ? 'gy:' + s(r.res) : null,
      raw: { guestyReviewId: s(r.id), listingId: s(r.listing_id), hasReply: !!r.has_reply, reply: r.reply || null },
    }
  })
  const res = await importReviews(list, 'guesty-sync')
  // A review already answered in Guesty (or on the channel) is answered here too — never offered again.
  const answered = (rows as any[]).filter(r => r.has_reply)
  for (const r of answered) {
    await db.from('garden_reviews').update({ reply: r.reply || null, reply_status: 'sent' })
      .eq('id', s(r.channel || 'guesty').toLowerCase() + ':gy-' + s(r.id)).neq('reply_status', 'sent')
  }
  return { ...res, units: units.length }
}
