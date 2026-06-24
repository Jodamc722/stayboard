// Live reviews feed — reuses the SHARED cached Guesty token (maintained by the 15-min sync)
// so it never hits Guesty's rate-limited OAuth endpoint. No new table / no migration.
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

    // Guesty Open API /reviews returns results already sorted descending by last update.
    // It does NOT accept a `sort` param (sending one returns 400). Valid params: limit, skip, channelId, listingId, etc.
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
    // Response shape: { isRawResponse, data, skip, limit }. Reviews live under data (array or .results/.reviews).
    const dd: any = d?.data ?? d
    const arr: any[] =
      (Array.isArray(dd) ? dd : null) ||
      dd?.reviews || dd?.results || dd?.data ||
      d?.results || d?.reviews || []

    const reviews = (Array.isArray(arr) ? arr : []).map((v: any) => {
      const rating = v.rating ?? v.overallRating ?? v.score ?? v.publicReview?.rating ?? v.privateReview?.rating ?? null
      const content = v.publicReview?.text ?? v.publicReview ?? v.content ?? v.text ?? v.comments ?? v.review ?? v.privateFeedback ?? ''
      const channel = String(v.channelId ?? v.channel ?? v.platform ?? v.source ?? v.integration ?? v.module ?? '').toLowerCase()
      const reply = v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? v.publicReview?.response ?? v.replies?.[0]?.text ?? null
      const listingId = v.listingId ?? v.listing?._id ?? v.listing?.id ?? null
      const guest = v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ?? v.from?.fullName ?? v.reservation?.guest?.fullName ?? null
      return {
        id: v._id ?? v.id ?? Math.random().toString(36).slice(2),
        rating: typeof rating === 'number' ? rating : (rating != null ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 400),
        channel, listingId, guest,
        created_at: v.createdAt ?? v.updatedAt ?? v.date ?? v.submittedAt ?? null,
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

    if (!reviews.length) {
      return NextResponse.json({
        reviews: [],
        _shape: {
          topKeys: Object.keys(d || {}),
          dataType: Array.isArray(d?.data) ? 'array' : typeof d?.data,
          dataLen: Array.isArray(d?.data) ? d.data.length : undefined,
          dataKeys: d?.data && !Array.isArray(d.data) ? Object.keys(d.data) : undefined,
          sample: JSON.stringify(d).slice(0, 800)
        }
      })
    }

    return NextResponse.json({ reviews })
  } catch (e: any) {
    return NextResponse.json({ reviews: [], error: e?.message || String(e) })
  }
}
