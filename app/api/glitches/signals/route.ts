// WHAT WE KNOW ABOUT THIS UNIT AND THIS GUEST, at the moment somebody decides how to respond.
//
// Jon, 2026-09-15: "whether there was a bad review recently in that unit, there should be
// indicators and flags that help us determine how we respond to that particular unit, the average
// review score, etc."
//
// The point is not to automate the decision. It is that the person holding the phone should not
// have to go and look any of this up: a unit that already took a 2-star hit last month is a unit
// where another bad review costs far more than the refund, and that fact should be on the same
// screen as the refund box rather than three tabs away.
//
// READ-ONLY, and deliberately cheap: four small scoped queries, no AI, no writes.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type UnitFlag = {
  key: string
  tone: 'bad' | 'warn' | 'good'
  label: string
  detail: string
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('glitches', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const id = str(req.nextUrl.searchParams.get('id')).trim()
  if (!id) return NextResponse.json({ ok: false, error: 'A glitch id is required.' }, { status: 400 })

  try {
    const { data: g } = await db.from('glitches')
      .select('id, listing_id, unit, guest_email, guest_name, created_at')
      .eq('id', id).maybeSingle()
    if (!g) return NextResponse.json({ ok: false, error: 'No such glitch.' }, { status: 404 })

    const listingId = str((g as any).listing_id)
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString()
    const since180 = ymd(new Date(Date.now() - 180 * 86400000))

    // 1. This unit's reviews, and 2. the portfolio average to judge them against. A rating means
    //    nothing on its own — 4.3 is poor in a portfolio averaging 4.8 and fine in one averaging 4.1.
    const [unitRevs, allRevs, priorGlitches, guestStays] = await Promise.all([
      listingId
        ? db.from('guesty_reviews').select('rating, content, created_at, channel')
            .eq('listing_id', listingId).eq('excluded_from_score', false)
            .order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as any[] }),
      pageRows<any>((a, b) => db.from('guesty_reviews').select('rating')
        .eq('excluded_from_score', false).not('rating', 'is', null).order('id').range(a, b), 12),
      listingId
        ? db.from('glitches').select('id, created_at, category, overview')
            .eq('listing_id', listingId).gte('incident_date', since180)
            .order('created_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as any[] }),
      str((g as any).guest_email)
        ? db.from('guesty_reservations').select('id, check_in, money_total')
            .ilike('guest_email', str((g as any).guest_email))
            .in('status', ['confirmed', 'checked_in', 'checked_out', 'completed']).limit(50)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const rated = (unitRevs.data || []).map((r: any) => Number(r.rating)).filter((n: number) => Number.isFinite(n) && n > 0)
    const unitAvg = rated.length ? Math.round((rated.reduce((a: number, b: number) => a + b, 0) / rated.length) * 100) / 100 : null

    const portfolio = (allRevs.rows || []).map((r: any) => Number(r.rating)).filter((n: number) => Number.isFinite(n) && n > 0)
    const portfolioAvg = portfolio.length ? Math.round((portfolio.reduce((a: number, b: number) => a + b, 0) / portfolio.length) * 100) / 100 : null

    const recentBad = (unitRevs.data || []).filter((r: any) =>
      Number(r.rating) > 0 && Number(r.rating) <= 3 && str(r.created_at) >= since90)
    const lastReview = (unitRevs.data || [])[0] || null

    // A glitch filed at the same moment as this one is this one — don't count it against the unit.
    const priors = (priorGlitches.data || []).filter((x: any) => str(x.id) !== id)
    const stays = (guestStays.data || []).length
    const guestValue = (guestStays.data || []).reduce((a: number, r: any) => a + (Number(r.money_total) || 0), 0)

    const flags: UnitFlag[] = []
    if (recentBad.length) {
      flags.push({
        key: 'recent-bad-review', tone: 'bad',
        label: recentBad.length === 1 ? 'A bad review here in the last 90 days' : recentBad.length + ' bad reviews here in 90 days',
        detail: 'Lowest was ' + Math.min(...recentBad.map((r: any) => Number(r.rating))) + '★ on ' + str(recentBad[0].created_at).slice(0, 10)
          + '. Another one costs more than this refund does.',
      })
    }
    if (unitAvg != null && portfolioAvg != null && unitAvg < portfolioAvg) {
      flags.push({
        key: 'below-portfolio', tone: 'warn',
        label: 'Rated below the portfolio',
        detail: unitAvg + '★ here against ' + portfolioAvg + '★ across the portfolio, over ' + rated.length + ' review' + (rated.length === 1 ? '' : 's') + '.',
      })
    }
    if (priors.length >= 2) {
      flags.push({
        key: 'repeat-glitches', tone: 'bad',
        label: priors.length + ' other issues on this unit in 6 months',
        detail: 'Most recent: ' + str(priors[0].category || 'issue') + '. A refund does not fix a unit that keeps breaking.',
      })
    } else if (priors.length === 1) {
      flags.push({
        key: 'repeat-glitches', tone: 'warn',
        label: 'One other issue on this unit in 6 months',
        detail: str(priors[0].category || 'issue') + ' on ' + str(priors[0].created_at).slice(0, 10) + '.',
      })
    }
    if (stays >= 2) {
      flags.push({
        key: 'repeat-guest', tone: 'good',
        label: 'Repeat guest — ' + stays + ' stays',
        detail: '$' + Math.round(guestValue).toLocaleString() + ' of business. Worth more than one refund.',
      })
    }

    return NextResponse.json({
      ok: true,
      unit: str((g as any).unit),
      hasListing: !!listingId,
      unitAvg, portfolioAvg, reviewCount: rated.length,
      recentBad: recentBad.length,
      lastReview: lastReview ? {
        rating: Number(lastReview.rating) || null,
        at: str(lastReview.created_at).slice(0, 10),
        channel: str(lastReview.channel) || null,
        excerpt: str(lastReview.content).slice(0, 200),
      } : null,
      priorGlitches: priors.length,
      guestStays: stays,
      flags,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
