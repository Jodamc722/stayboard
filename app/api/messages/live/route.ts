// THE LIVE INBOX (Jon, 2026-10-06: "more live and more real raw data"). The open /inbox page
// polls this every 30 seconds while it is visible: pull from Guesty (lib/inbox-live — at most once per
// 20s across every viewer), then hand back the same inbox the page renders (lib/inbox-data).
//   GET /api/messages/live            pull if due, then the inbox
//   GET /api/messages/live?pull=0     the inbox from our copy only
//   GET /api/messages/live?v=<v>      …and if the list is the one the page already holds (same `v`),
//                                     only the header and the clock come back (2026-11-10: every poll
//                                     used to resend ~116 KB and redraw the list to say "nothing new")
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
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
    // ?count=1 — the floating inbox's badge: how many threads wait on us and how many are unread, nothing else.
    if (req.nextUrl.searchParams.get('count') === '1') {
      const { effectiveState, markTime } = await import('@/lib/inbox-queue')
      let reply = 0, unread = 0
      for (const it of data.items as any[]) {
        const key = it.kind === 'phone' ? 'p:' + it.t.number : 'g:' + it.c.id
        const e = effectiveState((data.state as any)[key], it.kind === 'phone' ? markTime(it.at) : markTime(it.at, (data.waiting as any)[it.c.id]?.lastGuest), Date.now())
        if (e.archived) continue
        if ((it.kind === 'phone' ? it.t.awaiting : !!(data.waiting as any)[it.c.id]) && !e.done && !e.snoozed) reply++
        if (it.kind === 'phone' ? it.t.unread : (it.c.unread_count || 0) > 0) unread++
      }
      return NextResponse.json({ ok: true, reply, unread })
    }
    // A fingerprint of everything the list draws. The clock and the header pills are left out: they
    // move on their own and always travel.
    const v = createHash('sha1').update(JSON.stringify([data.items, data.unitById, data.waiting, data.lastResponderById, data.state])).digest('hex').slice(0, 16)
    if (req.nextUrl.searchParams.get('v') === v) return NextResponse.json({ ok: true, unchanged: true, v, pull, now: data.now, header: data.header })
    return NextResponse.json({ ok: true, v, pull, ...data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300), pull }, { status: 500 })
  }
}
