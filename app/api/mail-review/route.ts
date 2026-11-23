// EMAIL REVIEW (lib/mail-review). Admins only: it reads jon@'s mailbox and sends from it.
//   GET            → the address, the switch, whether the mailbox can be read, what came in lately
//   GET ?peek=1    → what one pass would do, changing nothing
//   POST { op: on | off | scan }
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { reviewState, reviewReady, setReviewOn, scanReviewMail, REVIEW_ADDRESS, REVIEW_MAILBOX } from '@/lib/mail-review'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const g = await requireAdmin()
  if (!g.ok) return g.res
  if (req.nextUrl.searchParams.get('peek')) return NextResponse.json(await scanReviewMail({ peek: true }))
  const [s, rd] = await Promise.all([reviewState(), reviewReady()])
  return NextResponse.json({ ok: true, address: REVIEW_ADDRESS, mailbox: REVIEW_MAILBOX, ready: rd.ready, notReady: rd.why || null, on: s.on, lastRun: s.lastRun, lastError: s.lastError, recent: s.handled.slice(0, 8) })
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin()
  if (!g.ok) return g.res
  const who = String((g as any).access?.email || '') || 'mail-review'
  try {
    const b: any = await req.json().catch(() => ({}))
    if (b.op === 'scan') return NextResponse.json(await scanReviewMail({ force: true, by: who, budgetMs: 150_000 }))
    if (b.op === 'on' || b.op === 'off') { const s = await setReviewOn(b.op === 'on', who); return NextResponse.json({ ok: true, on: s.on }) }
    return NextResponse.json({ ok: false, error: 'Unknown op.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
