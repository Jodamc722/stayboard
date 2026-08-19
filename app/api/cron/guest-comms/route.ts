// Guest communications sync — its own route, its own budget, its own schedule.
//
// WHY THIS EXISTS AS A SEPARATE CRON. Guest messages used to be the last step of /api/sync/guesty,
// which runs on a 60-second function. By the time listings, reservations, conversations and reviews
// had run there was no budget left, so the message step was killed mid-loop on every single pass.
// It failed silently — killed, not thrown — so nothing was stamped and no error was recorded. The
// feed had been 2.5 days stale before anyone looked, while Eve was answering guest questions off it.
//
// A customer-service brain is worth exactly as much as the freshness of the messages under it, so
// this gets a 300s budget and a 15-minute cadence of its own, and it reports partial runs honestly.
import { NextRequest, NextResponse } from 'next/server'
import { syncConversations, syncRecentMessages } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === `Bearer ${secret}`
  if (!viaCron) {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
  }

  const sp = new URL(req.url).searchParams
  const max = Math.min(Math.max(Number(sp.get('max')) || 200, 1), 600)
  const started = Date.now()
  const out: any = { ranBy: viaCron ? 'cron' : 'admin' }

  // Conversations first — the message pass reads from this table, so a stale inbox list means we
  // would not even know which threads had moved.
  try {
    out.conversations = await syncConversations()
  } catch (e: any) {
    out.conversationsError = String(e?.message || e).slice(0, 250)
  }

  // Leave headroom under the 300s ceiling so a slow batch returns a real answer instead of a kill.
  try {
    out.messages = await syncRecentMessages(max, { budgetMs: 210_000 })
  } catch (e: any) {
    out.messagesError = String(e?.message || e).slice(0, 250)
  }

  // Report the resulting freshness so this route is self-diagnosing — the whole failure mode last
  // time was that nobody could see the feed rotting.
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('guesty_sync_status').select('entity,last_sync_at,last_error,items_synced')
      .in('entity', ['messages', 'conversations'])
    out.feeds = (data || []).map((f: any) => ({
      entity: f.entity,
      ageMinutes: f.last_sync_at ? Math.round((Date.now() - new Date(f.last_sync_at).getTime()) / 60000) : null,
      lastError: f.last_error, items: f.items_synced,
    }))
  } catch { /* diagnostics only */ }

  out.ms = Date.now() - started
  return NextResponse.json({ ok: true, ...out })
}
