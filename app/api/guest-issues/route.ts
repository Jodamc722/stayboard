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
const etToday = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms))
/** Check-out day per reservation id. `null` = the lookup failed (the caller decides what unsure means). */
async function checkouts(ids: string[]): Promise<Record<string, string> | null> {
  const co: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin().from('guesty_reservations').select('id,check_out').in('id', ids.slice(i, i + 200))
    if (error) return null
    for (const r of (data || []) as any[]) if (r.check_out) co[String(r.id)] = String(r.check_out).slice(0, 10)
  }
  return co
}
async function staleKeys(rows: any[]): Promise<Set<string>> {
  const out = new Set<string>()
  const open = rows.filter(r => !r.glitch_id && r.verdict !== 'dismissed' && r.severity !== 'security' && r.reservation_id)
  const ids = Array.from(new Set(open.map(r => String(r.reservation_id))))
  if (!ids.length) return out
  const co = await checkouts(ids)
  if (!co) return new Set<string>()   // unsure which are stale = none are
  const cutoff = etToday(Date.now() - STALE_AFTER_DAYS * 86400_000)
  for (const r of open) { const d = co[String(r.reservation_id)]; if (d && d < cutoff) out.add(String(r.source_key)) }
  return out
}

// FRESH = WORTH A PERSON'S MINUTE THIS MORNING (Jon, 2026-11-20 audit: the board shouted "Eve caught
// 244 possible issues"). That 244 was every unfiled detection of the newest 300 rows in 14 days —
// two thirds of them "watch" rows the watch itself judged a routine ask or nothing concrete, and
// over a third of the rest from guests who had already left. The board's line and the sheet's "To look at"
// now count one thing: a named issue (or a safety matter), heard in the last three days, not filed,
// not dismissed, from a stay that has not ended. Nothing is deleted — everything else is still
// under "All" in the sheet. A stay we cannot date counts as still running.
const FRESH_HOURS = 72
async function freshKeys(rows: any[]): Promise<Set<string>> {
  const since = Date.now() - FRESH_HOURS * 3600_000
  const cand = rows.filter(r => !r.glitch_id && r.verdict !== 'dismissed' && (r.severity === 'issue' || r.severity === 'security')
    && Date.parse(String(r.detected_at || '')) >= since)
  const ids = Array.from(new Set(cand.filter(r => r.reservation_id && r.severity !== 'security').map(r => String(r.reservation_id))))
  const co = ids.length ? (await checkouts(ids)) || {} : {}
  const today = etToday()
  const out = new Set<string>()
  for (const r of cand) {
    const d = r.severity === 'security' ? '' : co[String(r.reservation_id || '')]
    if (!d || d >= today) out.add(String(r.source_key))
  }
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
    // ?summary=1 — the glitch board's one line. A count, a safety count and two names — never the
    // rows. It reads only what can be fresh (see FRESH above): named issues and safety matters of
    // the last three days that nobody filed, so the 300-row ceiling no longer cuts the count short
    // (it did: 244 shown when 357 were open). If the narrow read fails, the whole rows are read
    // as before and the same test is applied here.
    if (sp.get('summary') === '1') {
      const since = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString()
      let list: any[] = []
      const slim = await supabaseAdmin().from('guest_issue_detections')
        .select('source_key,detected_at,reservation_id,unit,guest_name,severity,category,headline,verdict,glitch_id')
        .gte('detected_at', since).in('severity', ['issue', 'security']).is('glitch_id', null)
        .order('detected_at', { ascending: false }).limit(300)
      if (slim.error) list = await recentDetections(Math.ceil(FRESH_HOURS / 24))
      else list = (slim.data || []) as any[]
      const keys = await freshKeys(list)
      const open = list.filter(r => keys.has(String(r.source_key)))
      return NextResponse.json({
        ok: true, days, hours: FRESH_HOURS,
        open: open.length,
        security: open.filter(r => r.severity === 'security').length,
        top: open.slice(0, 2).map(r => ({ unit: r.unit || null, guest_name: r.guest_name || null, category: r.category || null, headline: r.headline || null })),
      })
    }
    const rows = await recentDetections(days)
    // Best-effort: a failed lookup just means nothing is offered for bulk dismissal.
    // The stale flags and the fresh flags are independent reads — together, not one after the other.
    const [st, fr] = await Promise.all([
      staleKeys(rows).catch(() => new Set<string>()),   // no stale flags this load
      freshKeys(rows).catch(() => null),                 // no fresh flags = the sheet falls back to every open row
    ])
    for (const r of rows) { r.stale = st.has(String(r.source_key)); if (fr) r.fresh = fr.has(String(r.source_key)) }
    return NextResponse.json({ ok: true, days, freshHours: FRESH_HOURS, rows, settings: await cfg(), canEdit: g.access.levels['glitches'] === 'edit' || g.access.levels['glitches'] === 'full' || g.access.role === 'admin' })
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
