// A REPLY DRAFT WAITING ON EVERY NEW REVIEW (Jon, 2026-11-18: "each review as they come in should be
// drafted already"). After each review sync, the reviews that still need a reply and have no draft
// get one, written by the same endpoint the Draft button calls (so the voice, the rules and the
// style checks are the same). The draft is stored in review_drafts and shown on the Reviews page.
//
// NOTHING IS POSTED. A draft is text waiting for a person; Approve & post is still a person's click.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const str = (v: any) => (v == null ? '' : String(v))

export async function autoDraftReviews(opts: { origin: string; max?: number; budgetMs?: number }): Promise<{ ok: boolean; drafted: number; waiting: number; stoppedBy?: string }> {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, drafted: 0, waiting: 0, stoppedBy: 'no scheduler secret' }
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: rows, error } = await db.from('guesty_reviews')
    .select('id,listing_id,rating,content,channel,guest_name,created_at,has_reply,dismissed,removed_at')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(300)
  if (error) return { ok: false, drafted: 0, waiting: 0, stoppedBy: error.message }
  const need = ((rows || []) as any[]).filter(r => !r.has_reply && !r.dismissed && !r.removed_at && (str(r.content).trim() || r.rating != null))
  if (!need.length) return { ok: true, drafted: 0, waiting: 0 }
  const have = new Set<string>()
  {
    const { data, error: e2 } = await db.from('review_drafts').select('review_id').in('review_id', need.map(r => str(r.id)))
    if (e2) return { ok: false, drafted: 0, waiting: need.length, stoppedBy: e2.message }   // the table is not there yet
    for (const d of (data || []) as any[]) have.add(str(d.review_id))
  }
  const todo = need.filter(r => !have.has(str(r.id)))
  const names = new Map<string, string>()
  try {
    const ids = Array.from(new Set(todo.map(r => str(r.listing_id)).filter(Boolean)))
    if (ids.length) { const { data } = await db.from('guesty_listings').select('id,nickname,title').in('id', ids); for (const l of (data || []) as any[]) names.set(str(l.id), str(l.nickname || l.title)) }
  } catch { /* the draft still works without the unit name */ }
  const max = opts.max ?? 12, started = Date.now(), budget = opts.budgetMs ?? 150_000
  let drafted = 0, stoppedBy: string | undefined
  const openers: string[] = []
  for (const r of todo.slice(0, max)) {
    if (Date.now() - started > budget) { stoppedBy = 'time'; break }
    try {
      const res = await fetch(opts.origin + '/api/reviews/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
        body: JSON.stringify({ reviewId: str(r.id), content: str(r.content), rating: r.rating, listing_name: names.get(str(r.listing_id)) || '', listingId: str(r.listing_id), guest: str(r.guest_name), channel: str(r.channel), avoid: openers.slice(-10) }),
      })
      const j: any = await res.json().catch(() => ({}))
      const text = str(j?.draft).trim()
      // A budget stop or an outage will fail the next one too: stop, the next sync picks them up.
      if (!res.ok || !text) { stoppedBy = str(j?.error || 'draft failed ' + res.status).slice(0, 140); break }
      await db.from('review_drafts').upsert({ review_id: str(r.id), draft: text, source: 'auto', created_at: new Date().toISOString() }, { onConflict: 'review_id' })
      openers.push(text.split(/(?<=[.!?])\s/)[0] || '')
      drafted++
    } catch (e: any) { stoppedBy = str(e?.message || e).slice(0, 140); break }
  }
  return { ok: true, drafted, waiting: todo.length - drafted, ...(stoppedBy ? { stoppedBy } : {}) }
}
