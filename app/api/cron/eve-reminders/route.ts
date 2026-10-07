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
  // HANDOFF ALERTS ride the same 5-minute tick (Jon, 2026-10-07): fire what is due, nag who hasn't
  // confirmed, close what is done — and every half hour the guest-move watch looks for conflicts.
  let handoffs: any = null, moves: any = null
  try {
    const { runHandoffs } = await import('@/lib/handoff-store')
    const { getSetting } = await import('@/lib/app-settings')
    const mw = await getSetting<{ on?: boolean }>('move_watch', { on: false })
    if (mw.on && new Date().getUTCMinutes() % 30 < 5) {
      const { runMoveWatch } = await import('@/lib/move-watch')
      const m = await runMoveWatch()
      moves = { found: m.found, raised: m.raised, errors: m.errors }
      await recordRun({ name: 'move-watch', ok: !m.errors.length, itemCount: m.raised, ms: 0, error: m.errors.slice(0, 2).join(' · ') || null, detail: { found: m.found, raised: m.raised, checked: m.checked } })
    }
    handoffs = await runHandoffs()
    if (handoffs.fired || handoffs.nagged || handoffs.closed || handoffs.notes.length) await recordRun({ name: 'handoff-alerts', ok: !handoffs.notes.length, itemCount: handoffs.fired, ms: 0, error: handoffs.notes.slice(0, 2).join(' · ') || null, detail: handoffs })
  } catch (e: any) { handoffs = { error: String(e?.message || e).slice(0, 200) } }
  return NextResponse.json({ ok: true, ...r, handoffs, moves })
}
