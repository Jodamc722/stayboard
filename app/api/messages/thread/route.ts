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
    if (id) { const { loadGuestyThread } = await import('@/lib/message-thread'); const t = await loadGuestyThread(id, g.access); return t ? NextResponse.json({ ok: true, thread: t }) : NextResponse.json({ ok: false, error: 'That conversation is not cached here.' }, { status: 404 }) }
    if (phone) { const { loadPhoneThreadData } = await import('@/lib/message-thread'); const t = await loadPhoneThreadData(phone, g.access); return NextResponse.json({ ok: true, thread: t }) }
    return NextResponse.json({ ok: false, error: 'pass ?id= or ?phone=' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
