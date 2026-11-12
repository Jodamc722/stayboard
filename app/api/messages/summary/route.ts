// THE THREAD SUMMARY FOR THE BOOKING PANE (lib/thread-summary).
//   GET ?c=<conversation id>             the cached summary, written now if the thread changed since
//   GET ?c=<conversation id>&refresh=1   write it again
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { threadSummary } from '@/lib/thread-summary'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view')
  if (!g.ok) return g.res
  const c = String(req.nextUrl.searchParams.get('c') || '').trim()
  if (!c) return NextResponse.json({ ok: false, error: 'c (conversation id) required' }, { status: 400 })
  const r = await threadSummary(c, { refresh: req.nextUrl.searchParams.get('refresh') === '1' })
  return NextResponse.json(r, { status: r.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } })
}
