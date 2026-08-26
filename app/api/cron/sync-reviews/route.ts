// REVIEWS GET THEIR OWN JOB.
//
// They used to run 5th of 6 inside /api/sync/guesty, a function with maxDuration = 60, behind
// custom fields, listings, reservations and conversations. Paging the whole review feed can take
// longer than whatever those four leave behind — and when the function is killed mid-loop,
// `recordSync('reviews')` never runs, so the status row shows stale-but-error-free. The job looks
// like it has not run rather than like it failed, which is the hardest kind of problem to notice.
//
// Here it has the whole budget to itself, and it reports honestly: a failure returns ok:false with
// the message, instead of the 200 {ok:true} the combined sync returns even when the reviews step
// threw (app/api/sync/guesty/route.ts, where errors are collected into an array and spread into a
// success response).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { syncReviewsDetailed } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : (!!req.headers.get('x-vercel-cron') || auth === '')
  if (!isCron && !(await signedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  try {
    const st = await syncReviewsDetailed()

    // What actually landed, per channel — the number that matters when somebody says "we got
    // reviews and they are not in the app". A total across all channels is exactly the figure that
    // stayed healthy through the August outage, because one busy channel covers for a silent one.
    let byChannel: Record<string, { n: number; newest: string | null }> = {}
    try {
      const db = supabaseAdmin()
      const since = new Date(Date.now() - 90 * 86400000).toISOString()
      const { data } = await db.from('guesty_reviews').select('channel,created_at').gte('created_at', since).limit(5000)
      for (const r of ((data || []) as any[])) {
        const ch = String(r.channel || 'Other')
        const at = String(r.created_at || '')
        if (!byChannel[ch]) byChannel[ch] = { n: 0, newest: null }
        byChannel[ch].n++
        if (at && (!byChannel[ch].newest || at > byChannel[ch].newest!)) byChannel[ch].newest = at
      }
    } catch { /* the count is a nicety; the sync above is the job */ }

    // ── EXPECTED vs ACTUAL ────────────────────────────────────────────────────────────────────
    // Counting reviews cannot tell "the channel sent nothing" apart from "we failed to store it".
    // Checkouts can. Every stay that ends is a chance for a review, so a review RATE that held for
    // months and then went to zero WHILE CHECKOUTS CONTINUED is a broken pipe, not a quiet week.
    //
    // Deliberately no guest names or confirmation codes here — this response is reachable on the
    // cron path. The named list a human can spot-check on Airbnb lives behind the admin gate at
    // /api/settings/reviews-audit.
    let expectedVsActual: any[] = []
    try {
      const db = supabaseAdmin()
      const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
      const todayY = new Date().toISOString().slice(0, 10)
      const [rv, rs] = await Promise.all([
        db.from('guesty_reviews').select('channel,created_at').gte('created_at', since).limit(6000),
        db.from('guesty_reservations').select('check_out,status,source').gte('check_out', since).lte('check_out', todayY).limit(6000),
      ])
      const chOfSource = (v: any) => {
        const c = String(v || '').toLowerCase()
        if (/airbnb/.test(c)) return 'Airbnb'
        if (/booking/.test(c)) return 'Booking.com'
        if (/vrbo|homeaway/.test(c)) return 'Vrbo'
        return c ? 'Direct/Other' : 'Unknown'
      }
      const stays = ((rs.data || []) as any[]).filter(r => !/cancel|denied|declined|expired|inquir/i.test(String(r.status || '')))
      const revs = ((rv.data || []) as any[]).filter(r => r.created_at)
      const agg: Record<string, { checkouts: number; reviews: number; lastReview: string | null }> = {}
      const bump = (ch: string) => (agg[ch] = agg[ch] || { checkouts: 0, reviews: 0, lastReview: null })
      for (const x of stays) bump(chOfSource(x.source)).checkouts++
      for (const r of revs) {
        const a = bump(String(r.channel || 'Other'))
        a.reviews++
        const at = String(r.created_at)
        if (!a.lastReview || at > a.lastReview) a.lastReview = at
      }
      expectedVsActual = Object.keys(agg).sort().map(ch => {
        const a = agg[ch]
        const rate = a.checkouts > 0 ? a.reviews / a.checkouts : null
        const lastDay = a.lastReview ? a.lastReview.slice(0, 10) : null
        const coSince = lastDay ? stays.filter(x => chOfSource(x.source) === ch && String(x.check_out) > lastDay).length : 0
        const expect = rate != null ? Math.round(coSince * rate) : null
        return {
          channel: ch, checkouts120d: a.checkouts, reviews120d: a.reviews,
          reviewRatePct: rate != null ? Math.round(rate * 100) : null,
          lastReview: lastDay,
          checkoutsSinceLastReview: coSince,
          reviewsExpectedSince: expect,
          verdict: rate == null ? 'no history'
            : coSince === 0 ? 'nothing due yet'
              : (expect ?? 0) >= 3 ? 'BROKEN — ' + coSince + ' checkouts since, ~' + expect + ' reviews expected, 0 arrived'
                : 'arriving',
        }
      })
    } catch { /* the sweep above is the job; this is the diagnosis riding along */ }

    return NextResponse.json({
      ok: true,
      ms: Date.now() - startedAt,
      expectedVsActual,
      ...st,
      // false here means we ran out of time before the feed ran out of reviews — the one condition
      // under which new reviews could still be sitting on a page nobody has read.
      completeSweep: st.exhausted,
      byChannel,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, ms: Date.now() - startedAt, error: String(e?.message || e).slice(0, 400) }, { status: 500 })
  }
}
