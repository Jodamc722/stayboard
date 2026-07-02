// Guest-sentiment queue for the Messages dashboard. Returns one row per scanned
// conversation (joined with listing name + rolled-up building + thread preview), plus
// summary counts for the warning banner. Read-only; logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = supabaseAdmin()
  const status = new URL(req.url).searchParams.get('status') || 'open'

  let q = sb.from('guesty_conversation_sentiment')
    .select('conversation_id, guest_name, channel, reservation_id, listing_id, score, band, dissatisfied, triggers, top_issue, reason, guest_excerpt, last_message_at, last_guest_at, awaiting_reply, scanned_at, status, closed_at')
    .order('last_message_at', { ascending: false })
    .limit(500)
  if (status !== 'all') q = q.eq('status', status)

  const { data: rows, error } = await q
  if (error) {
    const msg = /relation .* does not exist/i.test(error.message)
      ? 'Sentiment table not found — run guest_sentiment_migration.sql in Supabase.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 200 })
  }
  const list = rows ?? []

  const cids = list.map((r: any) => r.conversation_id)
  // Conversations carry the listing link (sentiment rows often lack it) - resolve unit names through them.
  const { data: convos } = cids.length ? await sb.from('guesty_conversations').select('id, last_message_preview, unread_count, listing_id').in('id', cids as string[]) : { data: [] as any[] }
  const convLid: Record<string, string> = {}
  ;(convos ?? []).forEach((c: any) => { if (c.listing_id) convLid[c.id] = String(c.listing_id) })
  const lids = Array.from(new Set(list.map((r: any) => r.listing_id || convLid[r.conversation_id]).filter(Boolean)))
  const { data: listings } = lids.length ? await sb.from('guesty_listings').select('id, nickname, title, building').in('id', lids as string[]) : { data: [] as any[] }
  const nameOf: Record<string, { name: string; building: string }> = {}
  ;(listings ?? []).forEach((l: any) => { nameOf[l.id] = { name: l.nickname || l.title || l.id, building: rollupBuilding(l.building) } })
  const conv: Record<string, { preview: string; unread: number }> = {}
  ;(convos ?? []).forEach((c: any) => { conv[c.id] = { preview: c.last_message_preview || '', unread: Number(c.unread_count) || 0 } })

  const out = list.map((r: any) => ({
    id: r.conversation_id,
    guest: r.guest_name || 'Guest',
    channel: r.channel || '',
    listingName: (() => { const lid = r.listing_id || convLid[r.conversation_id]; return lid ? (nameOf[lid]?.name || null) : null })(),
    building: (() => { const lid = r.listing_id || convLid[r.conversation_id]; return lid ? (nameOf[lid]?.building || null) : null })(),
    score: r.score,
    band: r.band,
    dissatisfied: !!r.dissatisfied,
    triggers: Array.isArray(r.triggers) ? r.triggers : [],
    topIssue: r.top_issue,
    reason: r.reason,
    excerpt: r.guest_excerpt,
    lastMessageAt: r.last_message_at,
    lastGuestAt: r.last_guest_at,
    awaitingReply: !!r.awaiting_reply,
    status: r.status || 'open',
    preview: conv[r.conversation_id]?.preview || '',
    unread: conv[r.conversation_id]?.unread || 0,
  }))

  const open = out.filter(r => r.status === 'open')
  const summary = {
    total: out.length,
    open: open.length,
    dissatisfied: open.filter(r => r.dissatisfied).length,
    negative: open.filter(r => r.band === 'negative').length,
    awaitingNegative: open.filter(r => r.band === 'negative' && r.awaitingReply).length,
    unansweredNegative: open.filter(r => r.triggers.includes('unanswered_negative')).length,
  }
  return NextResponse.json({ summary, rows: out })
}
