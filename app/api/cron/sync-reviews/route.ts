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

    // ── EXPECTED vs ACTUAL, COUNTED PROPERLY ──────────────────────────────────────────────────
    //
    // The first version of this pulled rows and summed them, and PostgREST silently capped the
    // result at 1,000 no matter what `.limit()` asked for. It reported a 193% review rate and a
    // "last review" six weeks older than the truth — numbers that looked like findings and were
    // artefacts of a truncated page. Nothing said the data was short; it just was.
    //
    // So this counts with `head: true`, which returns a COUNT and no rows and therefore has no
    // ceiling to hit. Slower by a few queries, honest at any size.
    //
    // The question it exists to answer: is a silent channel a broken pipe or just a quiet week?
    // Reviews alone cannot say. Checkouts can — a channel with stays still ending and no reviews
    // arriving is broken; a channel with no stays has nothing to be silent about.
    let expectedVsActual: any[] = []
    try {
      const db = supabaseAdmin()
      const dayISO = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
      const d120 = dayISO(120)
      const CH: { name: string; srcLike: string }[] = [
        { name: 'Airbnb', srcLike: '%airbnb%' },
        { name: 'Booking.com', srcLike: '%booking%' },
        { name: 'Vrbo', srcLike: '%vrbo%' },
      ]
      const countOf = async (q: any) => { const { count } = await q; return count ?? 0 }

      expectedVsActual = await Promise.all(CH.map(async ch => {
        // Newest review on this channel — one row, so no ceiling in play.
        const { data: nd } = await db.from('guesty_reviews').select('created_at')
          .eq('channel', ch.name).order('created_at', { ascending: false }).limit(1)
        const newest: string | null = nd && nd[0] ? String((nd[0] as any).created_at) : null

        const [reviews120, checkouts120] = await Promise.all([
          countOf(db.from('guesty_reviews').select('*', { count: 'exact', head: true })
            .eq('channel', ch.name).gte('created_at', d120)),
          countOf(db.from('guesty_reservations').select('*', { count: 'exact', head: true })
            .ilike('source', ch.srcLike).gte('check_out', d120).lte('check_out', new Date().toISOString())),
        ])

        // Stays that ended AFTER the last review landed. This is the number that decides it.
        const checkoutsSince = newest
          ? await countOf(db.from('guesty_reservations').select('*', { count: 'exact', head: true })
            .ilike('source', ch.srcLike).gt('check_out', newest).lte('check_out', new Date().toISOString()))
          : 0

        const daysSilent = newest ? Math.floor((Date.now() - new Date(newest).getTime()) / 86400000) : null
        const perDay = reviews120 / 120
        return {
          channel: ch.name,
          reviews120d: reviews120,
          checkouts120d: checkouts120,
          reviewsPerDay: Math.round(perDay * 10) / 10,
          newestReview: newest ? newest.slice(0, 10) : null,
          daysSilent,
          checkoutsSinceLastReview: checkoutsSince,
          verdict:
            !newest ? 'no reviews on record'
              : checkoutsSince === 0 ? 'no stays have ended since the last review — nothing is due'
                : daysSilent != null && perDay > 0 && daysSilent >= 3 && checkoutsSince >= 3
                  ? 'BROKEN — ' + checkoutsSince + ' stays ended since the last review and none produced one, against ' +
                    (Math.round(perDay * 10) / 10) + '/day normally'
                  : 'arriving',
        }
      }))
    } catch (e: any) {
      expectedVsActual = [{ error: String(e?.message || e).slice(0, 200) }]
    }

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
