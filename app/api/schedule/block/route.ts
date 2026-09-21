// Block a turnover clean: move it to the NEXT day (soft-block). Records the move in schedule_blocks
// so the schedule board reflects it, and best-effort updates the Breezeway departure task (moves its
// scheduled_date + prepends a [MOVED -> date] note; the task is NOT deleted). action:'unblock' reverses it.
// The work lives in lib/schedule-block.ts so Eve's calendar_block executor does exactly the same thing.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { applyScheduleBlock } from '@/lib/schedule-block'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'schedule' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('schedule', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '').trim()
  const date = String(body?.date || '').slice(0, 10)
  const action = body?.action === 'unblock' ? 'unblock' : 'block'
  if (!listingId || !date) return NextResponse.json({ error: 'missing listingId/date' }, { status: 400 })

  const r = await applyScheduleBlock({ listingId, date, action, by: String(user.email || '') })
  if (!r.ok) return NextResponse.json({ error: r.error || 'Save failed' }, { status: 500 })
  return NextResponse.json({ ok: true, action: r.action, listingId: r.listingId, origDate: r.origDate, blockedUntil: r.blockedUntil, breezeway: r.breezeway })
}
