// Post a host reply to a Guesty review. PUT /reviews/{id}/reply { reviewReply }.
// Uses the shared cached Guesty token. Requires a logged-in user (the human approves each post).
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reviews' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('reviews', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { reviewId, reviewReply } = await req.json().catch(() => ({} as any))
  if (!reviewId || !reviewReply || !String(reviewReply).trim()) {
    return NextResponse.json({ error: 'reviewId and reviewReply are required' }, { status: 400 })
  }

  const sb = supabaseAdmin()
  const { data: tok } = await sb
    .from('guesty_tokens')
    .select('access_token, expires_at')
    .eq('id', 'singleton')
    .maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())
  if (!valid) return NextResponse.json({ error: 'Guesty token is refreshing - try again in a moment.' }, { status: 503 })

  // LISTING NO LONGER ACTIVE (Jon, 2026-09-22: "it should say listing is no longer active and force
  // close the review, should not just spin when post"). A review on a unit we no longer run cannot be
  // answered — Guesty either refuses it or never answers. So check our own mirror first, and close the
  // review (dismissed + out of the score) instead of sending anything.
  const closeReview = async (why: string) => {
    const patch: any = { dismissed: true, dismissed_by: 'auto: ' + why, dismissed_at: new Date().toISOString(), excluded_from_score: true, exclude_reason: why }
    try { await sb.from('guesty_reviews').update(patch).eq('id', reviewId) }
    catch { try { await sb.from('guesty_reviews').update({ excluded_from_score: true, exclude_reason: why }).eq('id', reviewId) } catch { /* best effort */ } }
    try { revalidateTag('reviews') } catch {}
    return NextResponse.json({ ok: false, closed: true, reason: why, message: 'Listing is no longer active — this review was closed. Nothing was posted.' }, { status: 200 })
  }
  try {
    const { data: rv } = await sb.from('guesty_reviews').select('listing_id').eq('id', reviewId).maybeSingle()
    const lid = rv?.listing_id
    if (lid) {
      const { data: l } = await sb.from('guesty_listings').select('status, listed:raw->>isListed, active:raw->>active').eq('id', lid).maybeSingle()
      if (!l) return await closeReview('listing no longer active')
      const st = String((l as any).status || '').toLowerCase()
      if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0 || String((l as any).active) === 'false' || String((l as any).listed) === 'false') {
        return await closeReview('listing no longer active')
      }
    }
  } catch { /* the check is a shortcut; Guesty's own answer below still decides */ }

  // Never spin: Guesty gets 20 seconds to answer.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  let r: Response
  try {
    r = await fetch(`${BASE}/reviews/${encodeURIComponent(reviewId)}/reply`, {
    signal: ctl.signal,
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tok!.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reviewReply: String(reviewReply) })
  })
  } catch (e: any) {
    clearTimeout(timer)
    const timedOut = e?.name === 'AbortError'
    return NextResponse.json({ error: timedOut ? 'Guesty did not answer in 20 seconds, so nothing was posted. Try again in a minute.' : 'Could not reach Guesty: ' + String(e?.message || e).slice(0, 120) }, { status: 504 })
  }
  clearTimeout(timer)
  const body = await r.text().catch(() => '')
  if (!r.ok) {
    // The channel no longer knows this listing (unlisted, disconnected, retired): close it, same as
    // the mirror check above — the review can never be answered from here.
    const gone = (r.status === 404 && /externalPropertyId|REVIEWS_LISTING_NOT_FOUND|listing/i.test(body)) || /listing[^"]{0,40}(inactive|not active|unlisted|not found|disabled|deleted)/i.test(body)
    if (gone) return await closeReview('listing no longer active')
    // Booking.com (and some channels) reject a second reply: the review is already answered and
    // the channel doesn't allow edits. Treat that as success - mark it replied so it stops nagging.
    const alreadyReplied = /already exists|does not allow update|ERR_REVIEWS_LIBRARY/i.test(body)
    if (alreadyReplied) {
      try {
        const { data: row } = await sb.from('guesty_reviews').select('raw').eq('id', reviewId).maybeSingle()
        const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
        await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true, raw: { ...raw, hostResponse: String(reviewReply) } }).eq('id', reviewId)
      } catch { try { await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true }).eq('id', reviewId) } catch { /* best effort */ } }
      return NextResponse.json({ ok: true, alreadyReplied: true, reply: String(reviewReply), note: "This review was already answered on its channel (Booking.com doesn't allow edits), so it's now marked as replied." }, { status: 200 })
    }
    return NextResponse.json({ error: `Guesty ${r.status}: ${body.slice(0, 200)}` }, { status: 502 })
  }

  // Persist locally so it shows immediately and review counts stay accurate. Also mirror the
  // reply into raw.hostResponse, because the listing page derives "replied" from raw (not the
  // reply column) - this makes the unit page reflect the reply right after posting and on reload.
  try {
    const { data: row } = await sb.from('guesty_reviews').select('raw').eq('id', reviewId).maybeSingle()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    const newRaw = { ...raw, hostResponse: String(reviewReply) }
    await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true, raw: newRaw }).eq('id', reviewId)
  } catch {
    await sb.from('guesty_reviews').update({ reply: String(reviewReply), has_reply: true }).eq('id', reviewId)
  }

  try { revalidateTag('reviews') } catch {}
  return NextResponse.json({ ok: true, reply: String(reviewReply) })
}
