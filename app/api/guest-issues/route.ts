// GUEST ISSUES — what Lighthouse heard, and what it did about it (Jon, 2026-10-07).
//
//   GET                       → the Detected list (last 14 days) + the watch's settings
//   GET ?preview=1&hours=72   → a dry run: what the watch WOULD file right now, nothing written
//   POST {}                   → run the watch now
//   POST { sourceKey, decision:'file'|'dismiss' }  → a person overriding one row
//   POST { on: true|false }   → turn the watch on or off
//
// Read needs view on Glitches; running or deciding needs edit — the same gate the board uses.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { getSetting, setSetting } from '@/lib/app-settings'
import { runGuestIssueWatch, recentDetections, decideDetection } from '@/lib/guest-issue'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SETTING = 'guest_issue_watch'
type Cfg = { on: boolean }
const cfg = async (): Promise<Cfg> => { const s = await getSetting<any>(SETTING, null); return { on: s && typeof s === 'object' ? s.on !== false : true } }

export async function GET(req: NextRequest) {
  const g = await requireLevel('glitches', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  if (sp.get('preview') === '1') {
    const hours = Math.max(1, Math.min(336, Number(sp.get('hours')) || 72))
    const r = await runGuestIssueWatch({ hours, dryRun: true })
    return NextResponse.json({ preview: true, ...r, settings: await cfg() })
  }
  try {
    const days = Math.max(1, Math.min(90, Number(sp.get('days')) || 14))
    const rows = await recentDetections(days)
    return NextResponse.json({ ok: true, days, rows, settings: await cfg(), canEdit: g.access.levels['glitches'] === 'edit' || g.access.levels['glitches'] === 'full' || g.access.role === 'admin' })
  } catch (e: any) {
    const msg = String(e?.message || e)
    return NextResponse.json({ ok: false, needsMigration: /relation|does not exist|schema cache/i.test(msg), error: msg.slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // The half-hour cron runs it; a person can press it from the board.
  const allowed = cronAllowed(req)
  const viaCron = allowed.viaSecret
  let by = 'cron'
  if (!viaCron) {
    const person = await requireLevel('glitches', 'edit')
    if (!person.ok) {
      if (!allowed.ok) return person.res
      const skip = await tooSoon('guest-issue-watch', 25)
      if (skip) return NextResponse.json({ ok: true, ...skip })
    } else by = String(person.access.email || 'team')
  }
  const b = await req.json().catch(() => ({} as any))

  if (typeof b?.on === 'boolean') {
    await setSetting(SETTING, { on: b.on }, by)
    return NextResponse.json({ ok: true, settings: { on: b.on } })
  }
  if (b?.sourceKey && (b.decision === 'file' || b.decision === 'dismiss')) {
    const r = await decideDetection(String(b.sourceKey), b.decision, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }

  const settings = await cfg()
  if (!settings.on && viaCron) return NextResponse.json({ ok: true, off: true, note: 'The guest-issue watch is switched off.' })
  const hours = Math.max(1, Math.min(336, Number(b?.hours) || (viaCron ? 6 : 48)))
  const r = await runGuestIssueWatch({ hours, by })
  if (r.filed || r.alerted || !r.ok) await recordRun({ name: 'guest-issue-watch', ok: r.ok, itemCount: r.filed, detail: { found: r.found, filed: r.filed, alerted: r.alerted, skipped: r.skipped, error: r.error } })
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}
