// REVIEW & RECOMMENDED — the board's third tab.
//
// Jon, 2026-08-31: "does this live in Today in Ops, create a review / recommended tab."
//
// The brief answers this once at 7am and then it is a fixed picture in somebody's inbox. A
// coordinator re-asks it all day — after a guest extends, after a job gets closed, after a
// technician calls in. So the same engine that builds the email's Review card is served live here.
//
// Signed in, and scoped by market like everything else on the board. Read-only: it recommends, and
// the acting is done through the routes that already exist for assigning and scheduling, so there
// is exactly one code path that touches a task.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { buildReviewQueue } from '@/lib/review-queue'
import { auditDuplicates, closeStrayInspections } from '@/lib/task-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())

  try {
    const db = supabaseAdmin()
    const { data: lRes } = await db.from('guesty_listings')
      .select('id,nickname,title,building,address_city,status').limit(2000)

    const nameOf: Record<string, string> = {}
    const ids: string[] = []
    for (const l of ((lRes || []) as any[])) {
      const name = String(l.nickname || l.title || 'Unit')
      const m = marketOf(l.building, l.address_city, name)
      if (market !== 'all' && m !== market) continue
      const id = String(l.id)
      nameOf[id] = name
      ids.push(id)
    }

    // The proposals run as a DRY RUN here, always. This endpoint is what a coordinator opens to
    // look; nothing they merely look at should change a record.
    const [queue, dupes, strays] = await Promise.all([
      buildReviewQueue(ids, today, { nameOf, horizon: 21, limit: 200 }),
      auditDuplicates({ listingIds: ids, days: 30, today }),
      closeStrayInspections({ dryRun: true }),
    ])

    return NextResponse.json({ ok: true, today, market, queue, dupes, strays })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
