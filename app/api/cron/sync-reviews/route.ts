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

    return NextResponse.json({
      ok: true,
      ms: Date.now() - startedAt,
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
