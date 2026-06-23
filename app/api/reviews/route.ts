// Live reviews feed — pulls from Guesty Open API using the existing cached OAuth token.
// No new table / no migration: fetched on demand and joined to listing names from Supabase.
import { NextResponse } from 'next/server'
import { getToken } from '@/lib/guesty'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const token = await getToken()
    const r = await fetch(`${BASE}/reviews?limit=60&sort=-createdAt`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      return NextResponse.json({ reviews: [], error: `Guesty reviews ${r.status}: ${body.slice(0, 160)}` })
    }
    const d: any = await r.json()
    const arr: any[] = Array.isArray(d) ? d : (d.results || d.data || d.reviews || [])

    const reviews = arr.map((v: any) => {
      const rating = v.rating ?? v.overallRating ?? v.score ?? v.publicReview?.rating ?? null
      const content = v.publicReview?.text ?? v.publicReview ?? v.content ?? v.text ?? v.comments ?? v.review ?? v.privateFeedback ?? ''
      const channel = String(v.channel ?? v.platform ?? v.source ?? v.integration ?? v.module ?? '').toLowerCase()
      const reply = v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? v.publicReview?.response ?? null
      const listingId = v.listingId ?? v.listing?._id ?? v.listing?.id ?? null
      const guest = v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ?? v.from?.fullName ?? null
      return {
        id: v._id ?? v.id ?? Math.random().toString(36).slice(2),
        rating: typeof rating === 'number' ? rating : (rating != null ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 400),
        channel, listingId, guest,
        created_at: v.createdAt ?? v.date ?? v.submittedAt ?? null,
        hasReply: !!(reply && String(reply).trim())
      }
    }).filter((x: any) => x.id && (x.content || x.rating != null))

    const ids = Array.from(new Set(reviews.map(x => x.listingId).filter(Boolean)))
    const names: Record<string, string> = {}
    if (ids.length) {
      const sb = supabaseAdmin()
      const { data: ls } = await sb.from('guesty_listings').select('id,nickname,title').in('id', ids as string[])
      ;(ls || []).forEach((l: any) => { names[l.id] = l.nickname || l.title || l.id })
    }
    reviews.forEach((x: any) => { (x as any).listing_name = names[x.listingId] || x.listingId || 'Unknown listing' })

    return NextResponse.json({ reviews })
  } catch (e: any) {
    return NextResponse.json({ reviews: [], error: e?.message || String(e) })
  }
}
