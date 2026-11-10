// THE OPS SIDE OF ONE LOW REVIEW — read-only, loaded when a person opens the playbook on a row.
//
// GET ?reviewId=…  →  what our own systems already show for this review:
//   • was the unit WALKED since the review landed (lib/review-inspections — the one shared rule),
//     or is an inspection already open on it;
//   • the open tasks on the unit right now (turnover cleans left out);
//   • the glitches filed against the same stay (matched on the reservation the review carries);
//   • where the unit's PUBLIC score on this channel stands against the channel's lines
//     (lib/review-thresholds), counting only reviews left on the listing that is live now;
//   • whose name signs anything written to this guest (lib/host-voice).
//
// The feed does not carry this because it is five reads per review and only a low review needs it.
// Nothing here writes, posts or sends.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { coveredReviewIds } from '@/lib/review-inspections'
import { isCurrentChannelReview } from '@/lib/channel-current-review'
import { isDepartureCleanName } from '@/lib/breezeway'
import { ratingToStars } from '@/lib/optimize-score'
import { standingOf, riskOf, inChannelScale } from '@/lib/review-thresholds'
import { isBookingChannel } from '@/lib/review-scale'

export const dynamic = 'force-dynamic'

const CLOSED = /complet|finish|close|approv|cancel|delet|void/i
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const reviewId = String(req.nextUrl.searchParams.get('reviewId') || '').trim()
  if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 })
  const db = supabaseAdmin()

  // The review. The JSON paths are tried first; a database that refuses them still answers the rest.
  let rv: any = null
  {
    const full = await db.from('guesty_reviews')
      .select('id,listing_id,rating,channel,created_at,has_reply,res:raw->>reservationId,res2:raw->>reservation_id')
      .eq('id', reviewId).maybeSingle()
    if (!full.error) rv = full.data
    else {
      const basic = await db.from('guesty_reviews').select('id,listing_id,rating,channel,created_at,has_reply').eq('id', reviewId).maybeSingle()
      if (basic.error) return NextResponse.json({ error: String(basic.error.message || 'could not read the review').slice(0, 200) }, { status: 500 })
      rv = basic.data
    }
  }
  if (!rv) return NextResponse.json({ error: 'review not found' }, { status: 404 })
  const listingId = String(rv.listing_id || '')
  const channel = String(rv.channel || '')
  const reviewDay = String(rv.created_at || '').slice(0, 10)
  const reservationId = String(rv.res || rv.res2 || '')

  // Whose name is on anything written to this guest.
  let signOff = 'Stay Hospitality'
  let ints: any = null
  if (listingId) {
    try {
      const { data: l } = await db.from('guesty_listings').select('nickname,title,building,address_city,ints:raw->integrations').eq('id', listingId).maybeSingle()
      if (l) {
        const { hostVoiceFor } = await import('@/lib/host-voice')
        const hv = hostVoiceFor((l as any).nickname, (l as any).title, (l as any).building, (l as any).address_city)
        if (hv) signOff = hv.signOff
        ints = Array.isArray((l as any).ints) ? (l as any).ints : null
      }
    } catch { /* house sign-off */ }
  }

  // Walked since the review, by the one shared rule.
  let walked: { at: string; name: string } | null = null
  try {
    if (listingId && reviewDay) {
      const covered = await coveredReviewIds(db, [{ id: reviewId, listing_id: listingId, created_at: rv.created_at }])
      const hit = covered.get(reviewId)
      if (hit) walked = { at: ymdET(new Date(hit.finishedAt)), name: hit.name }
    }
  } catch { /* unknown: the row offers the walk as before */ }

  // Open work on the unit right now.
  const openTasks: { id: string; name: string; date: string; dept: string }[] = []
  let queued: { taskId: string; date: string } | null = null
  try {
    if (listingId) {
      const from = ymdET(new Date(Date.now() - 30 * 86400000))
      const { data, error } = await db.from('breezeway_tasks_sync')
        .select('id,name,status,scheduled_date,finished_at,type_department')
        .eq('reference_property_id', listingId).is('finished_at', null).gte('scheduled_date', from)
        .order('scheduled_date', { ascending: true }).limit(80)
      if (!error) {
        for (const t of ((data || []) as any[])) {
          const name = String(t.name || '').trim()
          if (!name || CLOSED.test(String(t.status || '')) || isDepartureCleanName(name)) continue
          const row = { id: String(t.id), name: name.slice(0, 120), date: String(t.scheduled_date || '').slice(0, 10), dept: String(t.type_department || '').trim() }
          if (!queued && /quality inspection|inspect|unit check/i.test(name) && !/housekeep/i.test(row.dept)) queued = { taskId: row.id, date: row.date }
          if (openTasks.length < 8) openTasks.push(row)
        }
      }
    }
  } catch { /* no mirror */ }

  // Glitches on the same stay, and the stay's dates.
  const glitches: { id: string; status: string; category: string; at: string }[] = []
  let stay: { checkIn: string; checkOut: string } | null = null
  if (reservationId) {
    try {
      const { data, error } = await db.from('glitches').select('id,status,category,created_at').eq('reservation_id', reservationId).order('created_at', { ascending: false }).limit(10)
      if (!error) for (const g of ((data || []) as any[])) glitches.push({ id: String(g.id), status: String(g.status || ''), category: String(g.category || ''), at: String(g.created_at || '').slice(0, 10) })
    } catch { /* no glitch board */ }
    try {
      const { data: res } = await db.from('guesty_reservations').select('id,check_in,check_out').eq('id', reservationId).maybeSingle()
      if (res) stay = { checkIn: String((res as any).check_in || '').slice(0, 10), checkOut: String((res as any).check_out || '').slice(0, 10) }
    } catch { /* dates unknown */ }
  }

  // Where the unit's public score on this channel stands — live-listing reviews only.
  let score: any = null
  try {
    if (listingId && channel) {
      const cols = 'id,rating,channel,created_at,ext:raw->>externalListingId,ext2:raw->>external_listing_id,rl:raw->rawReview->>listing_id,rl2:raw->rawReview->>listingId,rl3:raw->rawReview->>external_listing_id'
      let q: any = await db.from('guesty_reviews').select(cols).eq('listing_id', listingId).eq('channel', channel).eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(800)
      if (q.error) q = await db.from('guesty_reviews').select('id,rating,channel,created_at').eq('listing_id', listingId).eq('channel', channel).eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(800)
      if (!q.error) {
        let n = 0, sum = 0, old = 0
        const newest: number[] = []
        for (const r of ((q.data || []) as any[])) {
          const stars = ratingToStars(r.rating)
          if (stars == null || stars <= 0) continue
          const stub = { externalListingId: r.ext, external_listing_id: r.ext2, rawReview: { listing_id: r.rl, listingId: r.rl2, external_listing_id: r.rl3 } }
          if (ints && !isCurrentChannelReview(stub, { integrations: ints }, channel)) { old++; continue }
          n++; sum += stars
          if (newest.length < 5) newest.push(stars)
        }
        if (n > 0) {
          const avg = sum / n
          const st = standingOf(avg, n, channel)
          const last5 = newest.length >= 3 ? newest.reduce((a, b) => a + b, 0) / newest.length : null
          const risk = st ? riskOf(st, last5) : null
          score = {
            channel, n, onOldListing: old,
            display: inChannelScale(avg, channel), scale: isBookingChannel(channel) ? 10 : 5,
            holds: st && st.holds ? st.holds.label : null,
            holdsNote: st && st.holds ? st.holds.note : null,
            next: st && st.next ? st.next.label : null,
            fivesToNext: st ? st.fivesToNext : null,
            lowsToDrop: st ? st.lowsToDrop : null,
            risk: risk ? risk.reason : null,
          }
        }
      }
    }
  } catch { /* score unknown: the playbook still shows the rest */ }

  return NextResponse.json({
    ok: true, reviewId, listingId, signOff, stay,
    ops: { walked, queued, openTasks, glitches, replied: !!rv.has_reply },
    score,
  })
}
