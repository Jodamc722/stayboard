// Reviews feed — reads the persisted guesty_reviews table FIRST (fast, no Guesty call).
// The 15-min sync (lib/guesty.ts → syncReviews) keeps that table fresh. If the table is
// empty or errors (e.g. before the SQL migration has been run), we FALL BACK to the live
// Guesty pull so nothing breaks. Response shape is preserved exactly for ReviewsPanel.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Listings whose status marks them as dead — filtered out of the feed.
const DEAD_STATUSES = new Set(['inactive', 'disabled', 'archived', 'deleted'])

function pickArray(d: any): any[] {
  const dd = d?.data ?? d
  if (Array.isArray(dd)) return dd
  if (Array.isArray(dd?.reviews)) return dd.reviews
  if (Array.isArray(dd?.results)) return dd.results
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.reviews)) return d.reviews
  return []
}

function cleanChannel(raw: string): string {
  const c = String(raw || '').toLowerCase()
  if (/airbnb/.test(c)) return 'Airbnb'
  if (/booking/.test(c)) return 'Booking.com'
  if (/vrbo|homeaway/.test(c)) return 'Vrbo'
  if (/expedia/.test(c)) return 'Expedia'
  if (/direct|manual|owner/.test(c)) return 'Direct'
  const t = String(raw || '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other'
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = supabaseAdmin()

  // ── 1. Try the persisted table first ────────────────────────────
  try {
    const { data: rows, error } = await sb
      .from('guesty_reviews')
      .select('id, listing_id, rating, content, channel, guest_name, created_at, has_reply, reply, excluded_from_score, exclude_reason')
      .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)

    if (!error && rows && rows.length) {
      // Join guesty_listings for status/building filtering + listing_name.
      const ids = Array.from(new Set(rows.map((r: any) => r.listing_id).filter(Boolean)))
      const meta: Record<string, { name: string; status: string; building: string | null }> = {}
      if (ids.length) {
        const { data: ls } = await sb
          .from('guesty_listings')
          .select('id, nickname, title, status, building')
          .in('id', ids as string[])
        ;(ls || []).forEach((l: any) => {
          meta[l.id] = {
            name: l.nickname || l.title || l.id,
            status: String(l.status || '').toLowerCase(),
            building: l.building || null
          }
        })
      }

      const shape = (r: any, m: any) => ({
        id: r.id,
        rating: r.rating != null ? Number(r.rating) : null,
        content: String(r.content || '').slice(0, 400),
        channel: r.channel || '',
        listingId: r.listing_id,
        guest: r.guest_name,
        created_at: r.created_at,
        hasReply: !!r.has_reply,
        reply: r.reply || null,
        listing_name: m?.name || r.listing_id || 'Unknown listing',
      })

      // Active (mapped, synced) reviews are draftable + count toward scores. Unmapped reviews
      // (listing not synced, inactive, or flagged not-mapped-on-channel) are shown separately,
      // can't be replied to, and never count toward the average / health score.
      const reviews: any[] = []
      const unmapped: any[] = []
      for (const r of rows as any[]) {
        const m = r.listing_id ? meta[r.listing_id] : null
        if (m && m.building && String(m.building).toLowerCase() === 'waves') continue  // Waves excluded entirely
        let reason: string | null = null
        if (!m) reason = 'Listing not synced'
        else if (DEAD_STATUSES.has(m.status)) reason = 'Listing inactive'
        else if (r.excluded_from_score) reason = r.exclude_reason || 'Not mapped on channel'
        if (reason) unmapped.push({ ...shape(r, m), reason })
        else reviews.push(shape(r, m))
      }

      return NextResponse.json({ reviews, unmapped })
    }
  } catch {
    // fall through to live pull
  }

  // ── 2. Fallback: live Guesty pull (table empty / not yet created) ─
  try {
    const { data: tok } = await sb
      .from('guesty_tokens')
      .select('access_token, expires_at')
      .eq('id', 'singleton')
      .maybeSingle()

    const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())
    if (!valid) {
      return NextResponse.json({ reviews: [], warming: true, error: 'Guesty token is refreshing — reload in a moment.' })
    }

    // Paginate the full backlog (skip-pagination) so all channels are pulled, not just the newest page.
    let raw: any[] = []
    for (let page = 0; page < 12; page++) {
      const r = await fetch(`${BASE}/reviews?limit=100&skip=${page * 100}`, {
        headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json' },
        cache: 'no-store'
      })
      if (!r.ok) {
        if (page === 0) {
          const body = await r.text().catch(() => '')
          const warming = r.status === 429 || r.status === 401
          return NextResponse.json({
            reviews: [],
            warming,
            error: warming ? 'Guesty is busy — reload in a moment.' : `Guesty reviews ${r.status}: ${body.slice(0, 160)}`
          })
        }
        break
      }
      const d: any = await r.json()
      const batch: any[] = pickArray(d)
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
      const channel = cleanChannel(String(v.channelId ?? v.channel ?? rr.channel ?? v.platform ?? v.source ?? v.integration ?? v.module ?? ''))
      const replyFlat =
        rr.host_response ?? rr.response ?? rr.owner_response ?? rr.reply ?? rr.private_feedback ??
        v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? null
      const replies = v.reviewReplies ?? rr.reviewReplies ?? rr.review_replies ?? rr.replies ?? null
      const repliedArr = Array.isArray(replies) && replies.some((x: any) => !x?.status || ['COMPLETED','PENDING','PUBLISHED','SENT','DONE'].includes(String(x.status).toUpperCase()))
      const replyText = (typeof replyFlat === 'string' && replyFlat.trim()) ? replyFlat
        : (Array.isArray(replies) ? (replies.map((x: any) => x?.reply ?? x?.text ?? x?.reviewReply ?? x?.body ?? '').find((s: any) => s && String(s).trim()) || '') : '')
      const listingId = v.listingId ?? v.listing?._id ?? rr.listing_id ?? null
      const guest = v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ?? rr.reviewer_name ?? rr.reviewer?.name ?? null
      return {
        id: v._id ?? v.id ?? v.externalReviewId ?? Math.random().toString(36).slice(2),
        rating: typeof rating === 'number' ? rating : (rating != null && rating !== '' ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 400),
        channel, listingId, guest,
        created_at: v.createdAt ?? rr.created_at ?? v.updatedAt ?? v.date ?? null,
        hasReply: repliedArr || !!(replyFlat && String(replyFlat).trim()),
        reply: String(replyText || '').slice(0, 500) || null
      }
    }).filter((x: any) => x.id && (x.content || x.rating != null))

    // Join listings for name + status/building so we can drop dead listings + Waves.
    const ids = Array.from(new Set(reviews.map(x => x.listingId).filter(Boolean)))
    const meta: Record<string, { name: string; status: string; building: string | null }> = {}
    if (ids.length) {
      const { data: ls } = await sb.from('guesty_listings').select('id, nickname, title, status, building').in('id', ids as string[])
      ;(ls || []).forEach((l: any) => {
        meta[l.id] = { name: l.nickname || l.title || l.id, status: String(l.status || '').toLowerCase(), building: l.building || null }
      })
    }
    const visible = reviews.filter((x: any) => {
      const m = x.listingId ? meta[x.listingId] : null
      if (m) {
        if (DEAD_STATUSES.has(m.status)) return false
        if (m.building && String(m.building).toLowerCase() === 'waves') return false
      }
      return true
    })
    visible.forEach((x: any) => { (x as any).listing_name = (x.listingId && meta[x.listingId]?.name) || x.listingId || 'Unknown listing' })

    return NextResponse.json({ reviews: visible })
  } catch (e: any) {
    return NextResponse.json({ reviews: [], error: e?.message || String(e) })
  }
}
