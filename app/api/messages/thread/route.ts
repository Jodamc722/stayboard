// A THREAD AS JSON, FOR THE UNIFIED INBOX'S PANE (lib/message-thread).
//   GET ?id=<guesty conversation id>   |   GET ?phone=<digits>
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view')
  if (!g.ok) return g.res
  const id = req.nextUrl.searchParams.get('id') || ''
  const phone = (req.nextUrl.searchParams.get('phone') || '').replace(/\D/g, '')
  try {
    // ?live=1 pulls the thread's posts from Guesty first (at most once per 10s per thread), so the
    // open conversation is Guesty's words, not our last half-hourly copy (Jon, 2026-10-06).
    let live: { pulled: boolean; error?: string } | null = null
    if (id && req.nextUrl.searchParams.get('live') === '1') { const { pullThreadLive } = await import('@/lib/inbox-live'); live = await pullThreadLive(id) }
    if (id) { const { loadGuestyThread } = await import('@/lib/message-thread'); const t = await loadGuestyThread(id, g.access); return t ? NextResponse.json({ ok: true, thread: t, live, at: new Date().toISOString() }) : NextResponse.json({ ok: false, error: 'That conversation is not cached here.' }, { status: 404 }) }
    if (phone) { const { loadPhoneThreadData } = await import('@/lib/message-thread'); const t = await loadPhoneThreadData(phone, g.access); return NextResponse.json({ ok: true, thread: t }) }
    return NextResponse.json({ ok: false, error: 'pass ?id= or ?phone=' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
