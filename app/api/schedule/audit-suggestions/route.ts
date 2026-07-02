// Suggested audits from GUEST REVIEWS, fitted to the day being viewed: a unit with a recent low
// review is suggested when it has a CHECKOUT that day (post-checkout audit window) or is VACANT
// (no guest in house). Suggest-only - a task is created via /api/sentiment/create-qc on an
// explicit Add click, never automatically (Jon's rule). Skips units with an open review-audit.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LIVE = /confirm|checked/i
const DEAD_LISTING = /inactive|disabled|archived|deleted/i

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const date = String(new URL(req.url).searchParams.get('date') || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Pass ?date=YYYY-MM-DD' }, { status: 400 })
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const [{ data: reviews }, { data: outs }, { data: staying }, { data: qcs }, { data: listings }] = await Promise.all([
    db.from('guesty_reviews').select('listing_id,rating,content,guest_name,created_at').lte('rating', 3).gte('created_at', since).order('created_at', { ascending: false }).limit(400),
    db.from('guesty_reservations').select('listing_id,status').eq('check_out', date).limit(2000),
    db.from('guesty_reservations').select('listing_id,status').lte('check_in', date).gt('check_out', date).limit(5000),
    db.from('qc_tasks').select('listing_id,status,issue_type'),
    db.from('guesty_listings').select('id,nickname,title,status'),
  ])
  const nameOf: Record<string, string> = {}
  for (const l of (listings || []) as any[]) if (!DEAD_LISTING.test(String(l.status || ''))) nameOf[String(l.id)] = String(l.nickname || l.title || 'Unit')
  const outSet = new Set((outs || []).filter((r: any) => LIVE.test(String(r.status || ''))).map((r: any) => String(r.listing_id)))
  const occupied = new Set((staying || []).filter((r: any) => LIVE.test(String(r.status || ''))).map((r: any) => String(r.listing_id)))
  const hasOpenAudit = new Set((qcs || []).filter((q: any) => q.status === 'open' && q.issue_type === 'review-audit').map((q: any) => String(q.listing_id)))
  const seen = new Set<string>()
  const suggestions: any[] = []
  for (const r of (reviews || []) as any[]) {
    const id = String(r.listing_id || '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    const unit = nameOf[id]
    if (!unit || /waves|botanica/i.test(unit)) continue // dead, excluded, or vendor-cleaned
    if (hasOpenAudit.has(id)) continue
    const fit = outSet.has(id) ? 'checkout' : (!occupied.has(id) ? 'vacant' : null)
    if (!fit) continue // guest in house that day - can't audit
    suggestions.push({ listingId: id, unit, rating: r.rating ?? null, guest: r.guest_name || null, reviewedAt: String(r.created_at || '').slice(0, 10), excerpt: String(r.content || '').slice(0, 180), fit })
    if (suggestions.length >= 15) break
  }
  suggestions.sort((a, b) => (a.rating ?? 9) - (b.rating ?? 9))
  return NextResponse.json({ ok: true, date, suggestions })
}
