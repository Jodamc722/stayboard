// REVIEW AUDIT — did reviews stop arriving, and is it us or the channel?
//
// Jon, 2026-08-26: "can we find a way to audit to see if any came in and why they are not coming in."
//
// Counting the reviews we HAVE can never answer that, because "the channel sent nothing" and "we
// failed to store what it sent" produce an identical empty result. This route answers it from three
// directions that CAN tell them apart:
//
//   1. EXPECTED vs ACTUAL. Every stay that checks out is a chance for a review. Comparing checkouts
//      per week against reviews per week gives a review RATE, and a rate that was steady for months
//      and then went to zero — while checkouts continued — is a broken pipe, not a quiet week. This
//      is the evidence that turns "it feels dead" into a number.
//   2. NAMED STAYS TO SPOT-CHECK. The specific recent Airbnb checkouts with no review on file. Open
//      any of them on Airbnb's own dashboard: if the guest DID review and it is not here, the gap is
//      between Airbnb and Guesty and nothing in this app can close it. That is a two-minute test
//      that settles the argument with a fact instead of an inference.
//   3. WHAT GUESTY IS ACTUALLY RETURNING. The raw shape of the newest records straight off the API,
//      plus every distinct channel string seen. If Airbnb reviews began arriving under a channel
//      name our normaliser does not recognise, they would be landing in the database filed as
//      something else — arriving and invisible, which is exactly what "we got some and they are not
//      showing" would look like from the outside.
//
// Read-only. Writes nothing, changes nothing.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guestyConfigured, listRecentReviews } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const ymd = (d: Date) => d.toISOString().slice(0, 10)
/** Monday-anchored week key, so checkouts and reviews land in the same buckets. */
function weekOf(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return ymd(d)
}
/** Which OTA a reservation came through, from Guesty's free-text source. */
function channelOfSource(s: string): string {
  const c = s.toLowerCase()
  if (/airbnb/.test(c)) return 'Airbnb'
  if (/booking/.test(c)) return 'Booking.com'
  if (/vrbo|homeaway/.test(c)) return 'Vrbo'
  if (/expedia/.test(c)) return 'Expedia'
  if (!c) return 'Unknown'
  return 'Direct/Other'
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const days = Math.max(30, Math.min(180, parseInt(str(req.nextUrl.searchParams.get('days')) || '120', 10) || 120))
  const since = ymd(new Date(Date.now() - days * 86400000))
  const today = ymd(new Date())
  const db = supabaseAdmin()

  const [revRes, resRes, lstRes] = await Promise.all([
    db.from('guesty_reviews').select('id,listing_id,channel,channel_raw,created_at,guest_name,rating')
      .gte('created_at', since).limit(6000),
    db.from('guesty_reservations').select('listing_id,check_out,status,source,guest_name,confirmation_code')
      .gte('check_out', since).lte('check_out', today).limit(6000),
    db.from('guesty_listings').select('id,nickname,title').limit(2000),
  ])

  const unitOf: Record<string, string> = {}
  for (const l of ((lstRes.data || []) as any[])) unitOf[str(l.id)] = l.nickname || l.title || str(l.id)

  const reviews = ((revRes.data || []) as any[]).filter(r => r.created_at)
  const stays = ((resRes.data || []) as any[])
    .filter(r => !/cancel|denied|declined|expired|inquir/i.test(str(r.status)))

  // ── 1. EXPECTED vs ACTUAL, per channel per week ────────────────────────────────────────────
  const weeks: Record<string, Record<string, { checkouts: number; reviews: number }>> = {}
  const touch = (w: string, ch: string) => {
    if (!weeks[w]) weeks[w] = {}
    if (!weeks[w][ch]) weeks[w][ch] = { checkouts: 0, reviews: 0 }
    return weeks[w][ch]
  }
  for (const s of stays) touch(weekOf(str(s.check_out)), channelOfSource(str(s.source))).checkouts++
  for (const r of reviews) touch(weekOf(str(r.created_at)), str(r.channel || 'Other')).reviews++

  const weekKeys = Object.keys(weeks).sort()
  const channels = Array.from(new Set(
    stays.map(s => channelOfSource(str(s.source))).concat(reviews.map(r => str(r.channel || 'Other')))
  )).sort()

  // Per channel: the rate before it went quiet vs what has happened since.
  const perChannel = channels.map(ch => {
    const rows = weekKeys.map(w => ({ week: w, ...(weeks[w][ch] || { checkouts: 0, reviews: 0 }) }))
    const withRev = rows.filter(r => r.reviews > 0)
    const lastRevWeek = withRev.length ? withRev[withRev.length - 1].week : null
    const before = lastRevWeek ? rows.filter(r => r.week <= lastRevWeek) : rows
    const after = lastRevWeek ? rows.filter(r => r.week > lastRevWeek) : []
    const sum = (a: typeof rows, k: 'checkouts' | 'reviews') => a.reduce((n, r) => n + r[k], 0)
    const coBefore = sum(before, 'checkouts'), rvBefore = sum(before, 'reviews')
    const coAfter = sum(after, 'checkouts'), rvAfter = sum(after, 'reviews')
    const rate = coBefore > 0 ? rvBefore / coBefore : null
    return {
      channel: ch,
      weeklyRows: rows,
      historicReviewRatePct: rate != null ? Math.round(rate * 100) : null,
      lastReviewWeek: lastRevWeek,
      sinceThen: { checkouts: coAfter, reviews: rvAfter, expectedReviews: rate != null ? Math.round(coAfter * rate) : null },
      // The headline: checkouts kept happening, reviews did not, and here is how many we should
      // have seen. A quiet channel with no checkouts behind it is not evidence of anything.
      verdict: rate == null ? 'no history to compare'
        : coAfter === 0 ? 'no checkouts since the last review — nothing to expect yet'
          : rvAfter === 0 && Math.round(coAfter * rate) >= 3
            ? 'BROKEN: ' + coAfter + ' checkouts since, ~' + Math.round(coAfter * rate) + ' reviews expected, 0 arrived'
            : 'arriving',
    }
  })

  // ── 2. NAMED STAYS TO SPOT-CHECK ───────────────────────────────────────────────────────────
  // Airbnb checkouts after our newest Airbnb review, with no review on file for that unit+guest.
  const newestByCh: Record<string, string> = {}
  for (const r of reviews) {
    const ch = str(r.channel || 'Other'); const at = str(r.created_at)
    if (at && (!newestByCh[ch] || at > newestByCh[ch])) newestByCh[ch] = at
  }
  const seenGuest = new Set(reviews.map(r => str(r.listing_id) + '|' + str(r.guest_name).trim().toLowerCase()))
  const spotCheck = stays
    .filter(s => channelOfSource(str(s.source)) === 'Airbnb')
    .filter(s => !newestByCh['Airbnb'] || str(s.check_out) > str(newestByCh['Airbnb']).slice(0, 10))
    .filter(s => !seenGuest.has(str(s.listing_id) + '|' + str(s.guest_name).trim().toLowerCase()))
    .sort((a, b) => str(b.check_out).localeCompare(str(a.check_out)))
    .slice(0, 40)
    .map(s => ({
      guest: str(s.guest_name) || '(no name)',
      unit: unitOf[str(s.listing_id)] || str(s.listing_id),
      checkedOut: str(s.check_out),
      confirmation: str(s.confirmation_code) || null,
    }))

  // ── 3. WHAT GUESTY IS ACTUALLY RETURNING ───────────────────────────────────────────────────
  let live: any = { configured: false }
  try {
    if (guestyConfigured()) {
      const recent = await listRecentReviews(200)
      const byCh: Record<string, { n: number; newest: string | null }> = {}
      for (const r of recent) {
        const ch = r.channel || 'Other'
        if (!byCh[ch]) byCh[ch] = { n: 0, newest: null }
        byCh[ch].n++
        if (r.createdAt && (!byCh[ch].newest || r.createdAt > byCh[ch].newest!)) byCh[ch].newest = r.createdAt
      }
      const ours = new Set(reviews.map(r => str(r.id)))
      live = {
        configured: true,
        scanned: recent.length,
        byChannel: byCh,
        // Anything Guesty is serving that never reached our table. If this is not empty, the fault
        // is ours and these ids are the proof.
        inGuestyNotInOurs: recent.filter(r => r.id && !ours.has(r.id)).slice(0, 20)
          .map(r => ({ id: r.id, channel: r.channel, createdAt: r.createdAt, rating: r.rating })),
      }
    }
  } catch (e: any) { live = { configured: true, error: String(e?.message || e).slice(0, 200) } }

  // Every distinct raw channel string we have stored — a new spelling here would mean reviews are
  // arriving and being filed under a name nobody is looking at.
  const rawChannels: Record<string, number> = {}
  for (const r of reviews) {
    const k = str(r.channel_raw) || '(empty)'
    rawChannels[k] = (rawChannels[k] || 0) + 1
  }

  return NextResponse.json({
    ok: true, windowDays: days, since, today,
    newestReviewByChannel: newestByCh,
    perChannel,
    spotCheckAirbnbNoReview: spotCheck,
    liveFromGuesty: live,
    rawChannelStrings: rawChannels,
  })
}
