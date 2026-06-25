// Live reviews feed - reuses the SHARED cached Guesty token (maintained by the sync)
// so it never hits Guesty's rate-limited OAuth endpoint. Pulls the FULL review
// backlog via skip-pagination (not just the newest page).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

function pickArray(d: any): any[] {
  const dd = d?.data ?? d
  if (Array.isArray(dd)) return dd
  if (Array.isArray(dd?.reviews)) return dd.reviews
  if (Array.isArray(dd?.results)) return dd.results
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.reviews)) return d.reviews
  return []
}

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
      return NextResponse.json({ reviews: [], warming: true, error: 'Guesty token is refreshing - reload in a moment.' })
    }
    const token = tok!.access_token

    // Pull the full backlog: paginate by skip until a short page (Guesty /reviews has no `sort` param).
    let raw: any[] = []
    for (let page = 0; page < 12; page++) {
      const r = await fetch(`${BASE}/reviews?limit=100&skip=${page * 100}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store'
      })
      if (!r.ok) {
        if (page === 0) {
          const body = await r.text().catch(() => '')
          const warming = r.status === 429 || r.status === 401
          return NextResponse.json({
            reviews: [],
            warming,
            error: warming ? 'Guesty is busy - reload in a moment.' : `Guesty reviews ${r.status}: ${body.slice(0, 160)}`
          })
        }
        break
      }
      const batch = pickArray(await r.json())
      if (!batch.length) break
      raw = raw.concat(batch)
      if (batch.length < 100) break
    }

    const reviews = raw.map((v: any) => {
      const rr = v.rawReview || v.raw || {}
      const rating =
        v.rating ?? v.overallRating ??
        rr.overall_rating ?? rr.overallRating ?? rr.rating ?? rr.score ?? rr.average_score ??
        v.publicReview?.rating ?? null
      const content =
        rr.public_review ?? rr.publicReview ?? rr.comments ?? rr.review ?? rr.text ??
        rr.positive ?? rr.review_text ?? rr.content ??
        v.publicReview?.text ?? v.content ?? v.text ?? v.comments ?? ''
      const rawChannel = String(v.channelId ?? v.channel ?? rr.channel ?? v.platform ?? v.source ?? '').toLowerCase()
      // Map Guesty's raw channel codes (e.g. "airbnb2") to clean OTA labels.
      const channel =
        /airbnb/.test(rawChannel) ? 'Airbnb'
        : /booking/.test(rawChannel) ? 'Booking.com'
        : /vrbo|homeaway/.test(rawChannel) ? 'Vrbo'
        : /expedia/.test(rawChannel) ? 'Expedia'
        : /direct|manual|website|owner/.test(rawChannel) ? 'Direct'
        : (rawChannel ? rawChannel.charAt(0).toUpperCase() + rawChannel.slice(1) : 'Other')
      const reply =
        rr.host_response ?? rr.response ?? rr.owner_response ?? rr.reply ?? rr.private_feedback ??
        v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? null
      // Guesty stores posted replies in a reviewReplies[] array (status PENDING/COMPLETED) — treat any as replied.
      const replies = v.reviewReplies ?? rr.reviewReplies ?? rr.review_replies ?? rr.replies ?? null
      const repliedViaArr = Array.isArray(replies) && replies.some((x: any) =>
        !x?.status || ['COMPLETED', 'PENDING', 'PUBLISHED', 'SENT', 'DONE'].includes(String(x.status).toUpperCase()))
      const listingId = v.listingId ?? v.listing?._id ?? rr.listing_id ?? null
      const guest =
        v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ??
        rr.reviewer_name ?? rr.reviewer?.name ?? null
      // The actual host reply text (from a flat field or the reviewReplies[] array), for the "Replied" view.
      const replyText =
        (typeof reply === 'string' && reply.trim()) ? reply
        : (Array.isArray(replies)
            ? (replies.map((x: any) => x?.reply ?? x?.text ?? x?.reviewReply ?? x?.body ?? '').find((s: any) => s && String(s).trim()) || '')
            : '')
      return {
        id: v._id ?? v.id ?? v.externalReviewId ?? Math.random().toString(36).slice(2),
        rating: typeof rating === 'number' ? rating : (rating != null && rating !== '' ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 400),
        channel, listingId, guest,
        created_at: v.createdAt ?? rr.created_at ?? v.updatedAt ?? v.date ?? null,
        hasReply: repliedViaArr || !!(reply && String(reply).trim()),
        reply: String(replyText || '').slice(0, 500)
      }
    }).filter((x: any) => x.id && (x.content || x.rating != null))

    const ids = Array.from(new Set(reviews.map(x => x.listingId).filter(Boolean)))
    const names: Record<string, string> = {}
    const bmap: Record<string, string> = {}
    const inactive: Record<string, boolean> = {}
    const SKIP_BUILDINGS = ['waves'] // deactivated buildings — no replies needed
    if (ids.length) {
      const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title,building,status').in('id', ids as string[])
      ;(ls || []).forEach((l: any) => { names[l.id] = l.nickname || l.title || l.id; bmap[l.id] = (l.building || '').trim(); inactive[l.id] = ['inactive','disabled','archived','deleted'].includes(String(l.status || '').toLowerCase()) })
    }
    reviews.forEach((x: any) => { (x as any).listing_name = names[x.listingId] || x.listingId || 'Unknown listing' })

    const visible = reviews.filter((x: any) => !inactive[x.listingId] && !SKIP_BUILDINGS.includes((bmap[x.listingId] || '').toLowerCase()))
    return NextResponse.json({ reviews: visible, count: visible.length })
  } catch (e: any) {
    return NextResponse.json({ reviews: [], error: e?.message || String(e) })
  }
}
