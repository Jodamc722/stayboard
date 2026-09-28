// GARDEN HOTEL OWNER REPORTS — one per month, built from the hotel's own tables, with a narrative
// Adam writes in the hotel's voice, saved as a draft a person finalises and shares.
//
// Jon, 2026-09-28: "owner reports". The VR owner report is a deck built from Guesty statements;
// the hotel's is simpler and truer to what we hold: occupancy and room-nights, arrivals by source,
// booked revenue and ADR as Cloudbeds totals them, cleans and inspections done, calls reached,
// verifications, reviews and their average, and what went wrong (negative reviews, missed calls).
// Money here is BOOKED revenue from Cloudbeds — the statement basis lives in the hotel's books.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { anthropicMessages, textOf } from '../anthropic-call'
import { modelPairFor } from '../ai-models'
import { gardenReport } from './desk'
import { reviewStats } from './reviews'
import { getHotel, getVoice, voiceBlock } from './settings'

const monthRange = (period: string) => { const [y, m] = period.split('-').map(Number); const from = `${period}-01`; const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return { from, to } }
const prevPeriod = (period: string) => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7) }

export async function buildOwnerReport(period: string): Promise<any> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('period must be YYYY-MM')
  const db = supabaseAdmin()
  const { from, to } = monthRange(period)
  const prev = monthRange(prevPeriod(period))
  const [cur, last, reviews, { data: negReviews }, { data: missed }, { data: queue }] = await Promise.all([
    gardenReport(from, to), gardenReport(prev.from, prev.to), reviewStats(35),
    db.from('garden_reviews').select('source,guest_name,rating,max_rating,title,body,received_at,reply_status').gte('received_at', from + 'T00:00:00Z').lte('received_at', to + 'T23:59:59Z').eq('sentiment', 'negative').order('received_at', { ascending: false }).limit(10),
    db.from('garden_phone_calls').select('id').eq('direction', 'inbound').eq('result', 'missed').gte('started_at', from + 'T00:00:00Z').lte('started_at', to + 'T23:59:59Z'),
    db.from('garden_call_queue').select('kind,status').gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z'),
  ])
  const Q = (queue || []) as any[]
  const welcome = { due: Q.filter(q => q.kind === 'welcome').length, done: Q.filter(q => q.kind === 'welcome' && q.status === 'done').length, expired: Q.filter(q => q.kind === 'welcome' && q.status === 'expired').length }
  const delta = (a: number | null, b: number | null) => (a != null && b != null ? Math.round((a - b) * 10) / 10 : null)
  return {
    period, from, to, hotel: (await getHotel()).name,
    occupancy: { value: cur.occupancy, prev: last.occupancy, delta: delta(cur.occupancy, last.occupancy), roomNights: cur.roomNights, rooms: cur.rooms },
    arrivals: { value: cur.arrivals, prev: last.arrivals, bySource: cur.bySource },
    revenue: { booked: cur.revenueBooked, prev: last.revenueBooked, adr: cur.adr, prevAdr: last.adr, basis: 'booked in Cloudbeds' },
    operations: { cleans: cur.cleans, calls: cur.calls, verifications: cur.verifications, welcomeCalls: welcome, missedCalls: (missed || []).length },
    reviews: { count: reviews.n, avg: reviews.avg, fiveStarShare: reviews.fiveStarShare, negative: reviews.negative, bySource: reviews.bySource, themes: reviews.themes, lowlights: (negReviews || []) },
    builtAt: new Date().toISOString(),
  }
}

export async function narrateOwnerReport(data: any): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const [v] = await Promise.all([getVoice()])
  const system = `You write the owner's monthly letter for ${data.hotel}. ${voiceBlock(v)}\n\nRULES: four short paragraphs at most — the month in one line, what went well, what went wrong and what was done, what next month holds. Use only the numbers given. Say "not tracked yet" where a figure is null. No headers, no bullets.`
  const { model, fallback } = await modelPairFor('adam')
  const r = await anthropicMessages(key, { model, max_tokens: 700, system, messages: [{ role: 'user', content: JSON.stringify({ ...data, reviews: { ...data.reviews, lowlights: (data.reviews?.lowlights || []).slice(0, 4) } }) }] }, fallback, 'adam')
  return r.ok ? textOf(r.data).trim() || null : null
}

const code = () => Array.from({ length: 12 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('')

export async function saveOwnerReport(period: string, by: string, opts: { narrate?: boolean } = {}) {
  const db = supabaseAdmin()
  const data = await buildOwnerReport(period)
  const narrative = opts.narrate ? await narrateOwnerReport(data) : null
  const { data: had } = await db.from('garden_owner_reports').select('id,share_code,narrative,status').eq('period', period).maybeSingle()
  const row: any = { period, title: `${data.hotel} — ${new Date(period + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`, data, updated_at: new Date().toISOString() }
  if (narrative || !had?.narrative) row.narrative = narrative || had?.narrative || null
  if (!had) { row.share_code = code(); row.created_by = by; row.status = 'draft' }
  const { data: saved, error } = await db.from('garden_owner_reports').upsert(row, { onConflict: 'period' }).select('*').single()
  if (error) throw new Error(error.message)
  return saved
}
