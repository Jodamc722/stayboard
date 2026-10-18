// Owner arriving today — the morning post and the 3:45pm reminder (lib/owner-arrival-check).
// Scheduled twice in UTC per slot (EDT and EST); the ET window inside the run lets exactly one fire.
//   GET                                    (scheduler — slot from the ET hour)
//   GET ?slot=morning|afternoon            (force a slot)
//   GET ?slot=…&preview=1                  (an admin: what it would say, nothing sent)
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runOwnerArrivalCheck } from '@/lib/owner-arrival-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  // No slot given (the scheduler): before noon ET is the morning post, after it the 3:45 reminder.
  const etHour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
  const slot = sp.get('slot') === 'afternoon' ? 'afternoon' : sp.get('slot') === 'morning' ? 'morning' : (etHour < 12 ? 'morning' : 'afternoon')
  try {
    return NextResponse.json({ ok: true, ...(await runOwnerArrivalCheck(slot, { preview: sp.get('preview') === '1' })) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
