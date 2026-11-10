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
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SETTING = 'guest_issue_watch'
type Cfg = { on: boolean }
const cfg = async (): Promise<Cfg> => { const s = await getSetting<any>(SETTING, null); return { on: s && typeof s === 'object' ? s.on !== false : true } }

// STALE = the stay ended more than a week ago and nobody filed it (2026-11-09). The guest has left,
// the review window has all but closed, and there is nothing left for ops to fix for that guest —
// these are what the "Dismiss stale" button clears in one go. Safety / security is never stale.
// Only a detection tied to a reservation with a known checkout can be stale.
const STALE_AFTER_DAYS = 7
async function staleKeys(rows: any[]): Promise<Set<string>> {
  const out = new Set<string>()
  const open = rows.filter(r => !r.glitch_id && r.verdict !== 'dismissed' && r.severity !== 'security' && r.reservation_id)
  const ids = Array.from(new Set(open.map(r => String(r.reservation_id))))
  if (!ids.length) return out
  const co: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin().from('guesty_reservations').select('id,check_out').in('id', ids.slice(i, i + 200))
    if (error) return new Set<string>()   // unsure which are stale = none are
    for (const r of (data || []) as any[]) if (r.check_out) co[String(r.id)] = String(r.check_out).slice(0, 10)
  }
  const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - STALE_AFTER_DAYS * 86400_000))
  for (const r of open) { const d = co[String(r.reservation_id)]; if (d && d < cutoff) out.add(String(r.source_key)) }
  return out
}

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
    // ?summary=1 — the glitch board's one-line banner ("Eve caught N possible issues"). It needs a
    // count, a safety count and two names, and was being sent up to 300 whole detection rows
    // (transcript excerpts and all) on every open of the board to get them. Same window, same
    // order, same 300-row ceiling and the same "still open" test as the list — only the columns
    // differ. If the narrow read fails (a column this database does not have), the whole rows
    // are read exactly as before and summarised here.
    if (sp.get('summary') === '1') {
      const since = new Date(Date.now() - days * 86400_000).toISOString()
      let list: any[] = []
      const slim = await supabaseAdmin().from('guest_issue_detections')
        .select('source_key,unit,guest_name,severity,category,headline,verdict,glitch_id')
        .gte('detected_at', since).order('detected_at', { ascending: false }).limit(300)
      if (slim.error) list = await recentDetections(days)
      else list = (slim.data || []) as any[]
      const open = list.filter(r => !r.glitch_id && r.verdict !== 'dismissed' && r.severity !== 'none')
      return NextResponse.json({
        ok: true, days,
        open: open.length,
        security: open.filter(r => r.severity === 'security').length,
        top: open.slice(0, 2).map(r => ({ unit: r.unit || null, guest_name: r.guest_name || null, category: r.category || null, headline: r.headline || null })),
      })
    }
    const rows = await recentDetections(days)
    // Best-effort: a failed lookup just means nothing is offered for bulk dismissal.
    try { const st = await staleKeys(rows); for (const r of rows) r.stale = st.has(String(r.source_key)) } catch { /* no stale flags this load */ }
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
  // { dismissStale: true } — a person clearing every stale detection at once. Recomputed here, never
  // taken from the page; a person only (the cron cannot call this), and nothing is sent anywhere.
  if (b?.dismissStale === true) {
    const person = await requireLevel('glitches', 'edit')
    if (!person.ok) return person.res
    try {
      const rows = await recentDetections(14)
      const keys = Array.from(await staleKeys(rows))
      if (!keys.length) return NextResponse.json({ ok: true, dismissed: 0 })
      const { error } = await supabaseAdmin().from('guest_issue_detections')
        .update({ verdict: 'dismissed', note: 'stale (stay ended over ' + STALE_AFTER_DAYS + ' days ago) — dismissed by ' + String(person.access.email || 'team') })
        .in('source_key', keys).is('glitch_id', null)
      if (error) return NextResponse.json({ ok: false, error: error.message.slice(0, 200) }, { status: 500 })
      return NextResponse.json({ ok: true, dismissed: keys.length })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
    }
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
