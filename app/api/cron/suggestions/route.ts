// THE MORNING SUGGESTION RUN.
//
//   GET               → build today's short list; create the ones whose cadence is set to 'auto'.
//   GET ?preview=1    → build it and create nothing (signed-in humans only).
//
// Jon, 2026-08-26: "this should live in user setting where you can have automations (suggestion
// sent)". A cadence has three settings — Off, Suggest it, Create it automatically — and this is
// what the third one means. It obeys every cap the suggested list obeys, including the day read,
// because the cap is the whole promise: "we can't have 200 tasks just auto populate."
//
// So on a heavy turn day this route creates NOTHING and says so. That is the feature working.
import { NextRequest, NextResponse } from 'next/server'
import { recordRun } from '@/lib/automation-runs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sweepUnit, deptOf } from '@/lib/pending-work'
import { closeStaleCleans } from '@/lib/stale-cleans'
import { closeStrayInspections } from '@/lib/task-audit'
import { requireCron, tooSoon } from '@/lib/cron-auth'
import { buildSuggestions, createFromSuggestion, logAccepted, getCadenceCfg } from '@/lib/suggestions'
import { isTaskDone } from '@/lib/task-categories'
import { updateBreezewayTask, cancelBreezewayTask, breezewayConfigured } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function GET(req: NextRequest) {
  // ── WHO MAY RUN THE CREATING PATH ─────────────────────────────────────────────────────────────
  // This path CREATES work in Breezeway and assigns it to named staff. The scheduler's bearer, or
  // a signed-in admin (lib/cron-auth requireCron) — nothing anonymous, no spoofable header.
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const me = !!gate.access

  // PREVIEW NAMES UNITS AND PEOPLE — a person's view, never the scheduler's.
  if (preview && !me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const date = ymd(new Date())

  // ── ONCE A DAY, WHOEVER CALLS ─────────────────────────────────────────────────────────────────
  // Every other cron in this app that spends something real leans on tooSoon(); this one wrote its
  // receipt to `automation_runs` and then never read it back, so nothing stopped it running twenty
  // times in an hour. It is a MORNING run: 20 hours is "not again today", while still allowing
  // tomorrow's 7:48 to fire. A preview never creates anything, so it is not throttled.
  if (!preview) {
    const skip = await tooSoon('suggestions', 20 * 60)
    if (skip) return NextResponse.json({ ok: true, date, created: 0, ...skip })
  }

  try {
    const cfg = await getCadenceCfg()
    const run = await buildSuggestions(date)

    // COUNTS ONLY on the anonymous path — no unit names, no staff names.
    const safe = {
      ok: true, date, enabled: cfg.enabled,
      day: run.day, considered: run.considered, dropped: run.dropped, mix: run.mix,
      amenityStats: run.amenityStats, climateVocab: run.climateVocab, inert: run.inert,
      stalled: run.stalled.length, doubleListed: run.doubleListed,
      historyComplete: run.historyComplete, suggested: run.suggestions.length,
    }

    if (preview) return NextResponse.json({ ...safe, suggestions: run.suggestions, overdue: run.overdue })

    // ── NOT DONE → CARRIED, NEVER RE-CREATED (Jon, 2026-11-02: "we should never have two tasks
    // incomplete. If incomplete move to next day. Never create a new one, only if new.") ─────────
    // Every open preventative task (A/C cleaning, filters, deep cleans…) dated before today moves to
    // today. One per unit per cadence: if the same job is open twice, the newest is carried and the
    // older copies are cancelled (cancel, not complete — nobody did them). If today's or a later copy
    // already exists, the late ones are the duplicates. Runs even with suggestions switched off,
    // because these tasks exist either way.
    let carried = 0, dupesCancelled = 0
    try {
      if (breezewayConfigured()) {
        const groups: Record<string, typeof run.overdue> = {}
        for (const o of run.overdue) (groups[o.key] = groups[o.key] || []).push(o)
        let budget = 120
        for (const list of Object.values(groups)) {
          if (budget <= 0) break
          list.sort((a, b) => (a.since < b.since ? 1 : a.since > b.since ? -1 : Number(b.id) - Number(a.id)))
          const keep = list[0].hasCurrent ? null : list[0]
          for (const o of list) {
            if (budget-- <= 0) break
            if (o === keep) {
              const r = await updateBreezewayTask(o.id, { name: o.name, scheduled_date: date }).catch(() => null)
              if (r?.ok) { carried++; try { await supabaseAdmin().from('breezeway_tasks_sync').update({ scheduled_date: date }).eq('id', o.id) } catch { /* sync */ } }
            } else {
              const c = await cancelBreezewayTask(o.id).catch(() => null)
              if (c?.ok) { dupesCancelled++; try { await supabaseAdmin().from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', o.id) } catch { /* sync */ } }
            }
          }
        }
      }
    } catch { /* carrying must never fail the run */ }
    ;(safe as any).carried = carried; (safe as any).duplicatesCancelled = dupesCancelled

    if (!cfg.enabled) return NextResponse.json({ ...safe, created: 0, note: 'Suggestions are switched off in settings.' })

    const autoKeys = new Set(cfg.cadences.filter(c => c.mode === 'auto').map(c => c.key))
    const toMake = run.suggestions.filter(s => autoKeys.has(s.cadenceKey))

    const created: string[] = []
    const failed: string[] = []
    for (const s of toMake) {
      const made = await createFromSuggestion(s, 'lighthouse-cron')
      if (made.ok) { created.push(made.taskId || ''); await logAccepted(s, 'lighthouse-cron', made.taskId || null) }
      else failed.push(String(made.error || '').slice(0, 120))
    }

    // ── CONSOLIDATE EVERY TRIP SOMEBODY IS ALREADY MAKING ─────────────────────────────────────
    // Jon, 2026-08-27: "if maintenance is going into a unit, automatically push all of the pending
    // maintenance tasks in that unit to that date that they're going in the unit."
    //
    // The Add button already does this for work created from a suggestion, but most visits are not
    // created here — a coordinator schedules them, or a guest reports something. So each morning
    // every unit with a maintenance visit ON THE BOARD TODAY pulls its own pending maintenance onto
    // that visit. The tech is going through that door anyway; the second trip is the waste.
    //
    // Scoped to today only, and to the same trade. Its own try/catch: consolidating is a bonus, and
    // failing at it must never mark the run as failed.
    let consolidated = 0
    const consolidatedUnits: string[] = []
    try {
      const db = supabaseAdmin()
      const { data: todays } = await db.from('breezeway_tasks_sync')
        .select('reference_property_id,name,status,type_department,assignees,finished_at')
        .eq('scheduled_date', date).limit(1000) // deliberate cap: one day of Breezeway tasks (~90–300) — the cap never bites, so the consolidation acts on exactly what it did before
      const { data: ls } = await db.from('guesty_listings').select('id,nickname,title').limit(1000) // deliberate cap: one row per Guesty listing (~290, inactive included)
      const nameOf: Record<string, string> = {}
      for (const l of (ls || []) as any[]) nameOf[String(l.id)] = String(l.nickname || l.title || 'Unit')

      // One visit per unit, and only where somebody is actually going: an unassigned open task is
      // not a visit, it is a hope, and dragging three more jobs onto it helps nobody.
      const visits: Record<string, string | null> = {}
      for (const t of (todays || []) as any[]) {
        if (/delete|cancel/i.test(String(t.status || ''))) continue
        if (isTaskDone(t.status, t.finished_at)) continue
        if (deptOf(t.type_department) !== 'maintenance') continue
        const who = Array.isArray(t.assignees)
          ? (t.assignees.map((p: any) => String(p && typeof p === 'object' ? (p.name ?? '') : p).trim()).filter(Boolean)[0] || null)
          : null
        if (!who) continue
        const lid = String(t.reference_property_id)
        if (!(lid in visits)) visits[lid] = who
      }
      for (const lid of Object.keys(visits).slice(0, 60)) {
        const r = await sweepUnit({
          listingId: lid, unitName: nameOf[lid] || 'the unit', date,
          dept: 'maintenance', assignee: visits[lid], by: 'lighthouse-cron',
        })
        if (r.moved.length) { consolidated += r.moved.length; consolidatedUnits.push(nameOf[lid] || lid) }
      }
    } catch { /* the suggestions still stand */ }

    // ── STALE DEPARTURE CLEANS ────────────────────────────────────────────────────────────────
    // Jon, 2026-08-27: "any old departure cleans that have not been closed 7 days post departure,
    // please close." Off until switched on in settings; see lib/stale-cleans for what it refuses to
    // touch. Its own try — closing bookkeeping must never be able to fail the suggestion run.
    let stale: any = null
    try { stale = await closeStaleCleans() } catch (e: any) { stale = { ok: false, error: String(e?.message || e).slice(0, 140) } }

    // ── STRAY INSPECTIONS ─────────────────────────────────────────────────────────────────────
    // Jon, 2026-08-31: "the only inspections that get moved up are the automated inspections
    // created by Lighthouse." The other half of that rule: everything else stops sitting open.
    // Closed, never deleted — see lib/task-audit for why. Its own try, same as the cleans:
    // bookkeeping must never be able to fail the suggestion run.
    let strays: any = null
    try { strays = await closeStrayInspections() } catch (e: any) { strays = { ok: false, error: String(e?.message || e).slice(0, 140) } }

    // Receipt, so the automations screen can prove this ran and say what it did.
    await recordRun({
      name: 'suggestions', ok: failed.length === 0, itemCount: created.length,
      detail: {
        suggested: run.suggestions.length, autoCreated: created.length, failed: failed.length,
        consolidated, consolidatedUnits: consolidatedUnits.slice(0, 20), verdict: run.day.verdict,
        staleCleansClosed: stale?.closed?.length || 0, staleCleansSkipped: stale?.skipped || null,
        strayInspectionsClosed: strays?.closed?.length || 0, strayInspectionsSkipped: strays?.skipped || null,
        unownedMaintenanceMoved: strays?.pushed?.length || 0,
      },
      error: failed[0] || null,
    })

    const out = {
      ...safe, created: created.length, failed: failed.length, errors: failed.slice(0, 3),
      consolidated, consolidatedUnits: consolidatedUnits.length,
      staleCleans: stale ? { closed: stale.closed?.length || 0, found: stale.found, enabled: stale.enabled, skipped: stale.skipped } : null,
      strayInspections: strays ? { closed: strays.closed?.length || 0, pushed: strays.pushed?.length || 0, found: strays.found, enabled: strays.enabled, skipped: strays.skipped } : null,
    }
    return NextResponse.json(me ? { ...out, suggestions: run.suggestions } : out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, date, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
