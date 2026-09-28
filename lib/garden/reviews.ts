// GARDEN HOTEL REVIEWS — every source in one table, Adam drafts the reply in the hotel's voice, a
// person approves and posts it. Jon, 2026-09-28: "review management".
//
// Sources arrive three ways today: an import (JSON or CSV pasted/uploaded on the Reviews page — the
// OTA extranets export these), a manual entry, or a provider sync once one is connected (Google
// Business Profile and Booking.com have APIs; Cloudbeds does not carry reviews). Every row is
// keyed source:externalId so a re-import never duplicates. A new row emits review_received, which
// the triggers turn into a draft and, for a low score, a Slack post.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { getVoice, getHotel, voiceBlock } from './settings'
import { emitGardenEvent } from './triggers'

export type ReviewIn = { source: string; externalId?: string | null; guestName?: string | null; rating: number; maxRating?: number; title?: string | null; body?: string | null; language?: string | null; receivedAt?: string | null; reservationId?: string | null; raw?: any }
const s = (v: any) => (v == null ? '' : String(v))

function sentimentOf(rating: number, max: number): 'positive' | 'mixed' | 'negative' {
  const pct = max ? rating / max : 0
  return pct >= 0.8 ? 'positive' : pct >= 0.6 ? 'mixed' : 'negative'
}
const THEMES: [string, RegExp][] = [
  ['cleanliness', /clean|dirty|dust|stain|smell|hair/i], ['noise', /noise|noisy|loud|quiet/i], ['staff', /staff|front desk|reception|friendly|rude|helpful/i],
  ['garden', /garden|pool|courtyard|grounds/i], ['breakfast', /breakfast|coffee|food/i], ['parking', /parking|park/i], ['a/c', /a\/?c|air con|ac was|temperature|hot in/i],
  ['bed', /bed|mattress|pillow|sleep/i], ['bathroom', /bathroom|shower|water pressure|hot water/i], ['wifi', /wifi|wi-fi|internet/i], ['location', /location|beach|walk|close to/i], ['value', /price|value|expensive|worth/i],
]
export function themesOf(text: string): string[] { return THEMES.filter(([, re]) => re.test(text)).map(([k]) => k) }

/** Upsert reviews; returns how many were new. New ones emit review_received. */
export async function importReviews(list: ReviewIn[], by: string | null): Promise<{ added: number; updated: number; errors: string[] }> {
  const db = supabaseAdmin()
  const out = { added: 0, updated: 0, errors: [] as string[] }
  for (const r of list) {
    const source = s(r.source).toLowerCase().trim() || 'manual'
    const ext = s(r.externalId).trim() || `${s(r.guestName).toLowerCase().replace(/\s+/g, '-') || 'anon'}-${s(r.receivedAt || '').slice(0, 10) || 'undated'}-${Math.round(Number(r.rating) * 10)}`
    const id = `${source}:${ext}`
    const rating = Number(r.rating), max = Number(r.maxRating) || 5
    if (!Number.isFinite(rating)) { out.errors.push(`${id}: no rating`); continue }
    const text = `${s(r.title)} ${s(r.body)}`
    const row = { id, source, external_id: ext, reservation_id: r.reservationId || null, guest_name: s(r.guestName) || null, rating, max_rating: max, title: s(r.title) || null, body: s(r.body) || null, language: r.language || null, received_at: r.receivedAt && !isNaN(Date.parse(r.receivedAt)) ? new Date(r.receivedAt).toISOString() : new Date().toISOString(), sentiment: sentimentOf(rating, max), themes: themesOf(text), raw: r.raw || null, synced_at: new Date().toISOString() }
    const { data: had } = await db.from('garden_reviews').select('id').eq('id', id).maybeSingle()
    const { error } = await db.from('garden_reviews').upsert(row, { onConflict: 'id' })
    if (error) { out.errors.push(`${id}: ${error.message}`); continue }
    if (had) out.updated++; else { out.added++; await emitGardenEvent('review_received', id, { rating, max, guest_name: row.guest_name, body: row.body }) }
  }
  return out
}

/** Parse a pasted CSV (headers: source, guest, rating, title, body, date[, id]). */
export function parseReviewCsv(text: string): ReviewIn[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map(x => x.trim()) }
  const head = split(lines[0]).map(h => h.toLowerCase())
  const idx = (names: string[]) => head.findIndex(h => names.includes(h))
  const iSrc = idx(['source', 'channel', 'platform']), iGuest = idx(['guest', 'name', 'reviewer']), iRating = idx(['rating', 'score', 'stars']), iTitle = idx(['title', 'headline']), iBody = idx(['body', 'review', 'text', 'comment']), iDate = idx(['date', 'received', 'created']), iId = idx(['id', 'review_id', 'external_id']), iMax = idx(['max', 'max_rating', 'out_of'])
  return lines.slice(1).map(split).filter(c => c.length > 1).map(c => ({ source: iSrc >= 0 ? c[iSrc] : 'manual', guestName: iGuest >= 0 ? c[iGuest] : null, rating: Number(iRating >= 0 ? c[iRating] : NaN), maxRating: iMax >= 0 ? Number(c[iMax]) || 5 : 5, title: iTitle >= 0 ? c[iTitle] : null, body: iBody >= 0 ? c[iBody] : null, receivedAt: iDate >= 0 ? c[iDate] : null, externalId: iId >= 0 ? c[iId] : null }))
}

/** Adam drafts the reply in the hotel's voice. Saved as reply_draft, status 'drafted'. */
export async function draftReviewReply(reviewId: string, by: string): Promise<{ ok: boolean; draft?: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'AI not configured' }
  const db = supabaseAdmin()
  const { data: r } = await db.from('garden_reviews').select('*').eq('id', reviewId).maybeSingle()
  if (!r) return { ok: false, error: 'review not found' }
  const [v, h] = await Promise.all([getVoice(), getHotel()])
  const rr = v.reviewReply
  const system = [`You write public review replies for ${h.name}, ${h.city}. ${voiceBlock(v)}`,
    `RULES: ${rr.thankFirst ? 'thank the guest first, specifically, for what they liked.' : ''} ${rr.nameTheFix ? 'If something went wrong, say what has been done or will be done about it — concretely.' : ''} At most ${rr.maxSentences} sentences. Never mention: ${rr.neverMention.join('; ')}. No headers, no bullet points, no emoji. Reply in the language of the review.`].join('\n\n')
  const user = `Source: ${r.source}\nRating: ${r.rating} of ${r.max_rating}\nGuest: ${r.guest_name || 'a guest'}\nTitle: ${r.title || ''}\nReview: ${r.body || '(no text)'}\n\nWrite the reply.`
  const { model, fallback } = await modelPairFor('adam')
  const res = await anthropicMessages(key, { model, max_tokens: 500, system, messages: [{ role: 'user', content: user }] }, fallback, 'adam')
  if (!res.ok) return { ok: false, error: `Anthropic ${res.status}` }
  const draft = textOf(res.data).trim()
  if (!draft) return { ok: false, error: 'empty draft' }
  await db.from('garden_reviews').update({ reply_draft: draft, reply_status: r.reply_status === 'sent' ? 'sent' : 'drafted' }).eq('id', reviewId)
  return { ok: true, draft }
}

export async function reviewStats(days = 90) {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data } = await db.from('garden_reviews').select('rating,max_rating,source,sentiment,themes,reply_status,received_at').gte('received_at', since).limit(2000)
  const rows = (data || []) as any[]
  const n = rows.length
  const avg = n ? Math.round((rows.reduce((a, r) => a + (Number(r.rating) / (Number(r.max_rating) || 5)) * 5, 0) / n) * 100) / 100 : null
  const bySource: Record<string, { n: number; avg: number }> = {}
  for (const r of rows) { const b = bySource[r.source] = bySource[r.source] || { n: 0, avg: 0 }; b.n++; b.avg += (Number(r.rating) / (Number(r.max_rating) || 5)) * 5 }
  for (const k of Object.keys(bySource)) bySource[k].avg = Math.round((bySource[k].avg / bySource[k].n) * 100) / 100
  const themes: Record<string, { n: number; neg: number }> = {}
  for (const r of rows) for (const t of (r.themes || [])) { const x = themes[t] = themes[t] || { n: 0, neg: 0 }; x.n++; if (r.sentiment === 'negative') x.neg++ }
  return { days, n, avg, fiveStarShare: n ? Math.round((rows.filter(r => Number(r.rating) / (Number(r.max_rating) || 5) >= 1).length / n) * 100) : null, negative: rows.filter(r => r.sentiment === 'negative').length, unanswered: rows.filter(r => r.reply_status === 'none' || r.reply_status === 'drafted').length, bySource, themes }
}
