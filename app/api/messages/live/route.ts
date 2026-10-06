// THE LIVE INBOX (Jon, 2026-10-06: "more live and more real raw data"). The open /messages page
// polls this every 30 seconds while it is visible: pull from Guesty (lib/inbox-live — at most once per
// 20s across every viewer), then hand back the same inbox the page renders (lib/inbox-data).
//   GET /api/messages/live            pull if due, then the inbox
//   GET /api/messages/live?pull=0     the inbox from our copy only
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { loadInbox } from '@/lib/inbox-data'
import { pullInboxLive } from '@/lib/inbox-live'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view')
  if (!g.ok) return g.res
  const pull = req.nextUrl.searchParams.get('pull') === '0' ? null : await pullInboxLive({ budgetMs: 15_000 }).catch((e: any) => ({ pulledAt: null, fresh: false, changed: [], threads: 0, error: String(e?.message || e) }))
  try {
    const data = await loadInbox()
    return NextResponse.json({ ok: true, pull, ...data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300), pull }, { status: 500 })
  }
}
