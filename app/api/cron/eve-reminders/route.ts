// EVE'S REMINDERS, EVERY FIVE MINUTES (Jon, 2026-10-01: "remind me at 11 am" → Eve reminds you in the
// Slack channel). Posts every reminder that has come due back where it was asked (lib/eve/reminders).
// A person's GET shows what is coming up; only the cron (or the secret) fires.
import { NextRequest, NextResponse } from 'next/server'
import { cronAllowed } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { requireAdmin } from '@/lib/access'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: NextRequest) {
  const scheduled = cronAllowed(req).viaSecret
  if (!scheduled) {
    const g = await requireAdmin('admin')
    if (!g.ok) return g.res
    const { listReminders } = await import('@/lib/eve/reminders')
    const upcoming = await listReminders({ limit: 50 })
    return NextResponse.json({ ok: true, upcoming })
  }
  const t0 = Date.now()
  const { fireDueReminders } = await import('@/lib/eve/reminders')
  const r = await fireDueReminders()
  if (r.due > 0 || r.notes.length) await recordRun({ name: 'eve-reminders', ok: r.failed === 0, itemCount: r.fired, ms: Date.now() - t0, error: r.failed ? r.notes.slice(0, 3).join(' · ') : null, detail: { due: r.due, fired: r.fired, failed: r.failed } })
  return NextResponse.json({ ok: true, ...r })
}
