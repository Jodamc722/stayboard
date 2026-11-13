// Owner onboarding reminders (lib/owner-onboard-remind): once each weekday morning, Eastern time.
// Scheduled at two UTC hours (EDT and EST); the Eastern-hour check inside lets exactly one of them send.
//   GET             (scheduler: sends what is due, only at 10am ET on a weekday)
//   GET ?preview=1  (an admin: what would be sent today and what is coming up, nothing sent)
//   GET ?force=1    (an admin: send what is due now, whatever the hour)
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runReminders } from '@/lib/owner-onboard-remind-run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const preview = sp.get('preview') === '1', force = sp.get('force') === '1' && !gate.viaSecret
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const rightTime = et.getDay() >= 1 && et.getDay() <= 5 && et.getHours() === 10
  if (!preview && !force && !rightTime) return NextResponse.json({ ok: true, skipped: 'Reminders go out at 10am Eastern on weekdays.' })
  try {
    return NextResponse.json({ ok: true, ...(await runReminders({ origin: process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, preview })) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
