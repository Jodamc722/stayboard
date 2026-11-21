// Owner emails: every conversation BCC'd to Lighthouse, matched to owners (lib/owner-mail).
//   GET                 the threads (read live from Gmail, kept three minutes); ?fresh=1 skips the wait
//   GET ?thread=<id>    the text of each message in one of those threads
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { ownerThreads, ownerThreadBodies } from '@/lib/owner-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('owner-audit', 'view'); if (!g.ok) return g.res
  const q = req.nextUrl.searchParams
  try {
    const t = q.get('thread')
    if (t) {
      const bodies = await ownerThreadBodies(t)
      return bodies ? NextResponse.json({ ok: true, bodies }) : NextResponse.json({ ok: false, error: 'That conversation is not on the Lighthouse list.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ...(await ownerThreads(q.get('fresh') === '1')) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
