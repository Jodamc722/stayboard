// Reminders for one onboarding, the team's side:
//   POST { action: 'pause' | 'resume' }      → stop or restart the automatic reminders for this owner
//   POST { action: 'send', owner }           → send that owner's next reminder now, without waiting for its day
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, itemsFor } from '@/lib/owner-onboard-server'
import { remindState } from '@/lib/owner-onboard-remind'
import { sendReminder } from '@/lib/owner-onboard-remind-run'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  let note = '', error = ''
  if (b.action === 'pause' || b.action === 'resume') { r.remind = { ...(r.remind || { log: [] }), log: r.remind?.log || [], paused: b.action === 'pause' }; note = b.action === 'pause' ? 'Reminders are paused for this owner.' : 'Reminders are on again.' }
  else if (b.action === 'send') {
    const p = remindState(r).plans.find(x => x.owner === String(b.owner || 'p'))
    if (!p) return NextResponse.json({ ok: false, error: 'There is nothing to remind this owner about right now.' }, { status: 400 })
    const s = await sendReminder(r, p, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin)
    if (s.ok) note = 'Reminder sent to ' + p.email + '.'; else error = s.error || 'Not sent.'
  } else return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: !error, error: error || undefined, note, record: teamView(r), items: await itemsFor(r) }, { status: error ? 502 : 200 })
}
