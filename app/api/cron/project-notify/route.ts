// PROJECT NOTIFICATIONS — one cron line, three passes chosen by the Eastern hour.
//
//   GET /api/cron/project-notify              every 30 min: the immediate emails (assigned, mentioned,
//                                             comment, added), one message per person — plus, on
//                                             the 6am ET runs, the recurring-projects pass, and on
//                                             the 7am ET runs, the reminders + morning digest
//   GET ?digest=1                             just the morning digest pass (by hand)
//   GET ?recur=1                              just the recurring-projects pass (by hand)
//   GET ?boards=index | ?boards=recap         the shared-board posts to #leadership (by hand);
//                                             scheduled at 7am and 6pm ET on this same line
//   GET ?dry=1                                counts only, nothing sent, stamped or created
//
// ONE LINE, NOT THREE (2026-09-28). The morning digest (/api/cron/project-digest, 11:05 UTC) and
// the recurring-projects pass (/api/cron/project-recur, 10:35 UTC) had cron lines of their own, both
// pinned to UTC — so both drifted an hour earlier every winter. They now ride this line and key on
// the EASTERN hour: recurrences at 6am (before the reminders, so a new 1:1 already exists when its
// owner's digest is built), the digest at 7am. Both keep a 20-hour guard, so each goes once a morning:
// the recur pass was meant to be idempotent, but a series behind by more than one period is caught up
// one instance per run, so the 6:13 and 6:43 runs could each create one (2026-09-29 review, R1-12).
// A by-hand ?recur=1 is not guarded — a person asked for it.
//
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron); a dry run is
// counts only and open to any active team member. Anonymous gets nothing — this sends email.
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { requireCron, tooSoon } from '@/lib/cron-auth'
import { withReceipt } from '@/lib/automation-runs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateReminders, sendImmediate, sendDigest } from '@/lib/project-notify'
import { runRecurrences } from '@/lib/project-templates'
import { todayISO } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const RECUR_HOUR_ET = 6
const DIGEST_HOUR_ET = 7
// THE SHARED-BOARD SUMMARIES (Jon, 2026-10-09: "I don't want notifications every second. It
// could be done daily in the evening. Morning index."). They ride this line rather than taking
// cron lines of their own, and key on the EASTERN hour so neither drifts an hour every winter.
const INDEX_HOUR_ET = 7     // with the morning digest: what is waiting before the day starts
const RECAP_HOUR_ET = 18    // end of the working day: what moved on the shared boards

function hourET(): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()))
  return h === 24 ? 0 : h
}

/** Reminders + the morning digest. Once a morning (20h guard); a dry run is never throttled. */
async function digestPass(dry: boolean): Promise<any> {
  if (!dry) { const skip = await tooSoon('project-digest', 20 * 60); if (skip) return { ok: true, digest: true, ...skip } }
  const out = await withReceipt('project-digest', async () => {
    const reminders = dry ? { dueSoon: -1, overdue: -1 } : await generateReminders()
    const sent = await sendDigest({ dryRun: dry })
    return { reminders, ...sent }
  }, o => ({ itemCount: o.sent, detail: o }))
  return { ok: true, digest: true, dry, ...out }
}

/** The next instance of every recurring project that is due. Dry = list what is due. */
async function recurPass(dry: boolean): Promise<any> {
  const today = todayISO()
  if (dry) {
    const { data } = await supabaseAdmin().from('projects').select('id,title,recurs').not('recurs', 'is', null).eq('archived', false).limit(200)
    const due = ((data || []) as any[]).filter(p => p.recurs?.next_on && p.recurs.next_on <= today).map(p => ({ id: p.id, title: p.title, next_on: p.recurs.next_on }))
    return { ok: true, recur: true, dry: true, today, due }
  }
  const out = await withReceipt('project-recur', () => runRecurrences(today), o => ({ itemCount: o.created.length, detail: o }))
  return { ok: true, recur: true, today, ...out }
}

/** The two shared-board posts to #leadership. Each guarded to once a day; a dry run is not. */
async function boardsPass(which: 'index' | 'recap', dry: boolean): Promise<any> {
  const key = which === 'index' ? 'project-boards-index' : 'project-boards-recap'
  if (!dry) { const skip = await tooSoon(key, 20 * 60); if (skip) return { ok: true, [which]: true, ...skip } }
  const { morningIndex, eveningRecap } = await import('@/lib/project-board-feed')
  const out = await withReceipt(key, () => (which === 'index' ? morningIndex({ dry }) : eveningRecap({ dry })),
    (o: any) => ({ itemCount: which === 'index' ? Object.values(o.counts || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) : (o.lines || 0), detail: o }))
  return { ok: true, [which]: true, dry, ...out }
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const boards = sp.get('boards')      // 'index' | 'recap' — one by hand
  const digest = sp.get('digest') === '1'
  const recur = sp.get('recur') === '1'
  const dry = sp.get('dry') === '1'
  if (dry) {
    const g = await requireUser()
    if (!g.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else {
    const gate = await requireCron(req)
    if (!gate.ok) return gate.res
  }

  try {
    // A single pass by hand.
    if (boards === 'index' || boards === 'recap') return NextResponse.json(await boardsPass(boards, dry))
    if (digest) return NextResponse.json(await digestPass(dry))
    if (recur) return NextResponse.json(await recurPass(dry))

    // The scheduled run: the morning pass for this Eastern hour (each in its own try, so a failed
    // morning pass never stops the immediate emails), then the immediate emails.
    const out: any = { ok: true, dry }
    if (!dry) {
      const h = hourET()
      if (h === RECUR_HOUR_ET) {
        try {
          const skip = await tooSoon('project-recur', 1200)
          out.recur = skip ? { ok: true, recur: true, ...skip } : await recurPass(false)
        } catch (e: any) { out.recur = { ok: false, error: String(e?.message || e).slice(0, 300) } }
      }
      if (h === DIGEST_HOUR_ET) {
        try { out.digest = await digestPass(false) } catch (e: any) { out.digest = { ok: false, error: String(e?.message || e).slice(0, 300) } }
      }
      // Each in its own try: a Slack outage must not stop the emails below.
      if (h === INDEX_HOUR_ET) {
        try { out.index = await boardsPass('index', false) } catch (e: any) { out.index = { ok: false, error: String(e?.message || e).slice(0, 300) } }
      }
      if (h === RECAP_HOUR_ET) {
        try { out.recap = await boardsPass('recap', false) } catch (e: any) { out.recap = { ok: false, error: String(e?.message || e).slice(0, 300) } }
      }
      const skip = await tooSoon('project-notify', 5)
      if (skip) return NextResponse.json({ ...out, ...skip })
    }
    const imm = await withReceipt('project-notify', () => sendImmediate({ dryRun: dry }), o => ({ itemCount: o.sent, detail: o }))
    return NextResponse.json({ ...out, ...imm })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
