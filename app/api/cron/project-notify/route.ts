// PROJECT NOTIFICATIONS — the two scheduled passes.
//
//   GET /api/cron/project-notify              every 15 min: the immediate emails (assigned, mentioned,
//                                             comment, added), one message per person
//   GET /api/cron/project-notify?digest=1     7:05am ET: due-tomorrow / overdue reminders are generated,
//                                             then the morning digest goes out
//   GET ?dry=1                                signed-in only: counts, nothing sent or stamped
//
// Auth is the house pattern: CRON_SECRET bearer when set, else Vercel's x-vercel-cron header; a
// signed-in person may also run it by hand. Anonymous gets nothing — this sends email.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { tooSoon } from '@/lib/cron-auth'
import { withReceipt } from '@/lib/automation-runs'
import { generateReminders, sendImmediate, sendDigest } from '@/lib/project-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try { const { data: { user } } = await createClient().auth.getUser(); return !!user } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron')
  const sp = new URL(req.url).searchParams
  const digest = sp.get('digest') === '1'
  const dry = sp.get('dry') === '1'
  const me = await signedIn()
  if (dry ? !me : (!isCron && !me)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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
