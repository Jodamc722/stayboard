// POST A HOST REPLY TO A GUESTY REVIEW — the one place that does it (2026-09-28 audit, D17/D18).
//
// Guesty: PUT /reviews/{id}/reply { reviewReply }, with the shared cached token. It lived inside
// app/api/reviews/reply, so Eve's review-reply drafts in the Command Center's Decide band could only
// be copied and pasted into /reviews. Both now call this; a person presses the button every time.
//
// WHAT IT DOES, IN ORDER
//   1. A review on a listing we no longer run cannot be answered (Guesty refuses it, or never
//      answers). Our mirror is checked first and such a review is CLOSED — dismissed and out of the
//      score — instead of posting anything (Jon, 2026-09-22).
//   2. Guesty gets 20 seconds. Never a spinner that spins forever.
//   3. A channel that no longer knows the listing → closed, same as (1). A channel that refuses a
//      second reply (Booking.com: "already exists") → the review IS answered; marked replied.
//   4. The reply is saved on our copy (and mirrored into raw.hostResponse, which the unit page reads)
//      so it shows at once and review counts stay right.
//
// SAVES ARE CHECKED, NOT HOPED FOR (D18). supabase-js returns { error } — it does not throw — so the
// old try { update } catch { fallback } never ran its fallback and never said a save failed. Each
// write now checks `error`; a failed save after a successful post is returned as `saveError` (the
// reply is live on the channel; the next review sync corrects our copy).
import 'server-only'
import { revalidateTag } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

/** `status` + `body` are exactly what /api/reviews/reply answers; `ok` / `error` are for other callers. */
export type ReviewReplyOutcome = { ok: boolean; status: number; body: Record<string, any>; error?: string }

export async function postReviewReply(reviewId: string, reviewReply: string): Promise<ReviewReplyOutcome> {
  const id = String(reviewId || '').trim()
  const text = String(reviewReply || '').trim()
  if (!id || !text) return fail(400, 'reviewId and reviewReply are required')
  const sb = supabaseAdmin()

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())
  if (!valid) return fail(503, 'Guesty token is refreshing - try again in a moment.')

  // 1. LISTING NO LONGER ACTIVE — close the review rather than send anything.
  try {
    const { data: rv } = await sb.from('guesty_reviews').select('listing_id').eq('id', id).maybeSingle()
    const lid = rv?.listing_id
    if (lid) {
      const { data: l, error: lErr } = await sb.from('guesty_listings').select('status, listed:raw->>isListed, active:raw->>active').eq('id', lid).maybeSingle()
      if (!lErr) {
        if (!l) return await closeReview(sb, id, 'listing no longer active')
        const st = String((l as any).status || '').toLowerCase()
        if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0 || String((l as any).active) === 'false' || String((l as any).listed) === 'false') {
          return await closeReview(sb, id, 'listing no longer active')
        }
      }
    }
  } catch { /* the check is a shortcut; Guesty's own answer below still decides */ }

  // 2. Never spin: Guesty gets 20 seconds to answer.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  let r: Response
  try {
    r = await fetch(`${BASE}/reviews/${encodeURIComponent(id)}/reply`, {
      signal: ctl.signal,
      method: 'PUT',
      headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewReply: text }),
    })
  } catch (e: any) {
    clearTimeout(timer)
    const timedOut = e?.name === 'AbortError'
    return fail(504, timedOut ? 'Guesty did not answer in 20 seconds, so nothing was posted. Try again in a minute.' : 'Could not reach Guesty: ' + String(e?.message || e).slice(0, 120))
  }
  clearTimeout(timer)
  const resBody = await r.text().catch(() => '')

  // 3. The channel's answer.
  if (!r.ok) {
    const gone = (r.status === 404 && /externalPropertyId|REVIEWS_LISTING_NOT_FOUND|listing/i.test(resBody)) || /listing[^"]{0,40}(inactive|not active|unlisted|not found|disabled|deleted)/i.test(resBody)
    if (gone) return await closeReview(sb, id, 'listing no longer active')
    // Booking.com (and some channels) reject a second reply: the review is already answered and the
    // channel doesn't allow edits. Treat that as success — mark it replied so it stops nagging.
    const alreadyReplied = /already exists|does not allow update|ERR_REVIEWS_LIBRARY/i.test(resBody)
    if (alreadyReplied) {
      const saveError = await saveReply(sb, id, text)
      try { revalidateTag('reviews') } catch { /* outside a request there is no cache to bust */ }
      return { ok: true, status: 200, body: { ok: true, alreadyReplied: true, reply: text, note: "This review was already answered on its channel (Booking.com doesn't allow edits), so it's now marked as replied.", ...(saveError ? { saveError } : {}) } }
    }
    return fail(502, `Guesty ${r.status}: ${resBody.slice(0, 200)}`)
  }

  // 4. Posted. Save it on our copy so it shows immediately.
  const saveError = await saveReply(sb, id, text)
  try { revalidateTag('reviews') } catch { /* outside a request there is no cache to bust */ }
  return { ok: true, status: 200, body: { ok: true, reply: text, ...(saveError ? { saveError } : {}) } }
}

function fail(status: number, error: string): ReviewReplyOutcome {
  return { ok: false, status, body: { error }, error }
}

/** Store the reply on our row, mirrored into raw.hostResponse. Returns the error text, or null. */
async function saveReply(sb: any, reviewId: string, text: string): Promise<string | null> {
  const { data: row, error: readErr } = await sb.from('guesty_reviews').select('raw').eq('id', reviewId).maybeSingle()
  let error: any = readErr || null
  if (!readErr) {
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    ;({ error } = await sb.from('guesty_reviews').update({ reply: text, has_reply: true, raw: { ...raw, hostResponse: text } }).eq('id', reviewId))
  }
  // The raw mirror could not be read or written: the two columns the counts use still get saved.
  if (error) ({ error } = await sb.from('guesty_reviews').update({ reply: text, has_reply: true }).eq('id', reviewId))
  if (error) {
    console.error('[review-reply] reply posted but not saved locally', reviewId, error.message)
    return 'Posted, but our copy did not save (' + String(error.message).slice(0, 120) + ') — the next review sync will catch up.'
  }
  return null
}

/** Dismiss a review we can no longer answer and take it out of the score. Nothing is posted. */
async function closeReview(sb: any, reviewId: string, why: string): Promise<ReviewReplyOutcome> {
  const patch: any = { dismissed: true, dismissed_by: 'auto: ' + why, dismissed_at: new Date().toISOString(), excluded_from_score: true, exclude_reason: why }
  let { error } = await sb.from('guesty_reviews').update(patch).eq('id', reviewId)
  // The dismissal columns may not exist on an older schema; the score exclusion alone still closes it.
  if (error) ({ error } = await sb.from('guesty_reviews').update({ excluded_from_score: true, exclude_reason: why }).eq('id', reviewId))
  if (error) console.error('[review-reply] could not close review', reviewId, error.message)
  try { revalidateTag('reviews') } catch { /* see above */ }
  const message = 'Listing is no longer active — this review was closed. Nothing was posted.' + (error ? ' (Closing it here failed: ' + String(error.message).slice(0, 100) + '.)' : '')
  return { ok: false, status: 200, body: { ok: false, closed: true, reason: why, message }, error: message }
}
