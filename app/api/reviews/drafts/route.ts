// The reply drafts written as reviews arrive (lib/review-autodraft), for the Reviews page.
//   GET                 { drafts: { <reviewId>: text } } — only for reviews still waiting on a reply
//   POST { run: true }  write the missing ones now (edit access); the review sync does this on its own
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { autoDraftReviews } from '@/lib/review-autodraft'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const gate = await requireLevel('reviews', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data, error } = await db.from('review_drafts').select('review_id,draft,created_at').gte('created_at', since).limit(1000)
  if (error) return NextResponse.json({ ok: true, drafts: {}, note: 'drafts are not set up yet' })
  const ids = ((data || []) as any[]).map(d => String(d.review_id))
  const open = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rv } = await db.from('guesty_reviews').select('id,has_reply,dismissed').in('id', ids.slice(i, i + 200))
    for (const r of (rv || []) as any[]) if (!r.has_reply && !r.dismissed) open.add(String(r.id))
  }
  const drafts: Record<string, string> = {}
  for (const d of (data || []) as any[]) if (open.has(String(d.review_id))) drafts[String(d.review_id)] = String(d.draft)
  return NextResponse.json({ ok: true, drafts })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reviews', 'edit')
  if (!gate.ok) return gate.res
  const r = await autoDraftReviews({ origin: req.nextUrl.origin, max: 15 })
  return NextResponse.json(r)
}
