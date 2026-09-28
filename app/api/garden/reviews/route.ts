// GARDEN HOTEL REVIEWS — list, import, draft, approve, mark sent.
//   GET  ?status=all|unanswered|negative&days=90   → { reviews, stats }
//   POST { op: 'import', reviews: ReviewIn[] } | { op: 'import_csv', csv } | { op: 'add', ...ReviewIn }
//        { op: 'draft', id } | { op: 'reply', id, reply, sent?: boolean } | { op: 'skip', id }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { importReviews, parseReviewCsv, draftReviewReply, reviewStats } from '@/lib/garden/reviews'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const days = Math.min(365, Math.max(7, Number(sp.get('days')) || 90))
  const status = sp.get('status') || 'all'
  const db = supabaseAdmin()
  let q = db.from('garden_reviews').select('*').gte('received_at', new Date(Date.now() - days * 86400000).toISOString()).order('received_at', { ascending: false }).limit(300)
  if (status === 'unanswered') q = q.in('reply_status', ['none', 'drafted'])
  if (status === 'negative') q = q.eq('sentiment', 'negative')
  try {
    const [{ data, error }, stats] = await Promise.all([q, reviewStats(days)])
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, reviews: data || [], stats })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || null
  const db = supabaseAdmin()
  const op = String(b?.op || '')
  if (op === 'import') return NextResponse.json({ ok: true, ...(await importReviews(Array.isArray(b?.reviews) ? b.reviews : [], by)) })
  if (op === 'import_csv') return NextResponse.json({ ok: true, ...(await importReviews(parseReviewCsv(String(b?.csv || '')), by)) })
  if (op === 'add') return NextResponse.json({ ok: true, ...(await importReviews([{ source: b?.source || 'manual', guestName: b?.guestName, rating: Number(b?.rating), maxRating: Number(b?.maxRating) || 5, title: b?.title, body: b?.body, receivedAt: b?.receivedAt, reservationId: b?.reservationId }], by)) })
  const id = String(b?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (op === 'draft') { const r = await draftReviewReply(id, by || 'panel'); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
  if (op === 'reply') {
    const reply = String(b?.reply || '').trim()
    if (!reply) return NextResponse.json({ error: 'reply required' }, { status: 400 })
    const sent = b?.sent === true
    const { error } = await db.from('garden_reviews').update(sent ? { reply, reply_status: 'sent', replied_at: new Date().toISOString(), replied_by: by } : { reply_draft: reply, reply_status: 'approved' }).eq('id', id)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }
  if (op === 'skip') { await db.from('garden_reviews').update({ reply_status: 'skipped' }).eq('id', id); return NextResponse.json({ ok: true }) }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
