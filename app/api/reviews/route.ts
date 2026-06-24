// Live reviews feed — reuses the SHARED cached Guesty token (maintained by the sync)
// so it never hits Guesty's rate-limited OAuth endpoint.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const sb = supabaseAdmin()
    const { data: tok } = await sb
      .from('guesty_tokens')
      .select('access_token, expires_at')
      .eq('id', 'singleton')
      .maybeSingle()

    const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())
    if (!valid) {
      return NextResponse.json({ reviews: [], warming: true, error: 'Guesty token is refreshing — reload in a moment.' })
    }

    // Guesty /reviews is already sorted desc by last update; it does NOT accept a `sort` param.
    const r = await fetch(`${BASE}/reviews?limit=100`, {
      headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      const warming = r.status === 429 || r.status === 401
      return NextResponse.json({
        reviews: [],
        warming,
        error: warming ? 'Guesty is busy — reload in a moment.' : `Guesty reviews ${r.status}: ${body.slice(0, 160)}`
      })
    }

    const d: any = await r.json()
    const arr: any[] = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : (d?.data?.reviews || d?.results || d?.reviews || []))

    const reviews = (Array.isArray(arr) ? arr : []).map((v: any) => {
      // Guesty wraps the channel's native review in `rawReview`; ratings/text live there.
      const rr = v.rawReview || v.raw || {}
      const rating =
        v.rating ?? v.overallRating ??
        rr.overall_rating ?? rr.overallRating ?? rr.rating ?? rr.score ?? rr.average_score ??
        v.publicReview?.rating ?? null
      const content =
        rr.public_review ?? rr.publicReview ?? rr.comments ?? rr.review ?? rr.text ??
        rr.positive ?? rr.review_text ?? rr.content ??
        v.publicReview?.text ?? v.content ?? v.text ?? v.comments ?? ''
      const channel = String(v.channelId ?? v.channel ?? rr.channel ?? v.platform ?? v.source ?? '').toLowerCase()
      const reply =
        rr.host_response ?? rr.response ?? rr.owner_response ?? rr.reply ?? rr.private_feedback ??
        v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? null
      const listingId = v.listingId ?? v.listing?._id ?? rr.listing_id ?? null
      const guest =
        v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ??
        rr.reviewer_name ?? rr.reviewer?.name ?? null
      return {
        id: v._id ?? v.id ?? v.externalReviewId ?? Math.random().toString(36).slice(2),
        rating: typeof rating === 'number' ? rating : (rating != null && rating !== '' ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 400),
        channel, listingId, guest,
        created_at: v.createdAt ?? rr.created_at ?? v.updatedAt ?? v.date ?? null,
        hasReply: !!(reply && String(reply).trim())
      }
    }).filter((x: any) => x.id && (x.content || x.rating != null))

    const ids = Array.from(new Set(reviews.map(x => x.listingId).filter(Boolean)))
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title').in('id', ids as string[])
      ;(ls || []).forEach((l: any) => { names[l.id] = l.nickname || l.title || l.id })
    }
    reviews.forEach((x: any) => { (x as any).listing_name = names[x.listingId] || x.listingId || 'Unknown listing' })

    return NextResponse.json({ reviews })
  } catch (e: any) {
    return NextResponse.json({ reviews: [], error: e?.message || String(e) })
  }
}
