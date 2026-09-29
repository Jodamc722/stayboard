// PROJECT NOTIFICATIONS — the two scheduled passes.
//
//   GET /api/cron/project-notify              every 15 min: the immediate emails (assigned, mentioned,
//                                             comment, added), one message per person
//   GET /api/cron/project-notify?digest=1     7:05am ET: due-tomorrow / overdue reminders are generated,
//                                             then the morning digest goes out
//   GET ?dry=1                                signed-in only: counts, nothing sent or stamped
//
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron); a dry run is
// counts only and open to any active team member. Anonymous gets nothing — this sends email.
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { requireCron, tooSoon } from '@/lib/cron-auth'
import { withReceipt } from '@/lib/automation-runs'
import { generateReminders, sendImmediate, sendDigest } from '@/lib/project-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const digest = sp.get('digest') === '1'
  const dry = sp.get('dry') === '1'
  if (dry) {
    const g = await requireUser()
    if (!g.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else {
    const gate = await requireCron(req)
    if (!gate.ok) return gate.res
  }

  try {
    if (digest) {
      // Once a morning. Reminders are idempotent per day anyway; this stops a double digest.
      if (!dry) { const skip = await tooSoon('project-digest', 20 * 60); if (skip) return NextResponse.json({ ok: true, ...skip }) }
      const out = await withReceipt('project-digest', async () => {
        const reminders = dry ? { dueSoon: -1, overdue: -1 } : await generateReminders()
        const sent = await sendDigest({ dryRun: dry })
        return { reminders, ...sent }
      }, o => ({ itemCount: o.sent, detail: o }))
      return NextResponse.json({ ok: true, digest: true, dry, ...out })
    }
    if (!dry) { const skip = await tooSoon('project-notify', 5); if (skip) return NextResponse.json({ ok: true, ...skip }) }
    const out = await withReceipt('project-notify', () => sendImmediate({ dryRun: dry }), o => ({ itemCount: o.sent, detail: o }))
    return NextResponse.json({ ok: true, dry, ...out })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
