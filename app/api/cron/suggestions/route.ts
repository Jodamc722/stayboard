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
import { createClient } from '@/lib/supabase-server'
import { recordRun } from '@/lib/automation-runs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sweepUnit, deptOf } from '@/lib/pending-work'
import { tooSoon } from '@/lib/cron-auth'
import { buildSuggestions, createFromSuggestion, logAccepted, getCadenceCfg } from '@/lib/suggestions'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  // ── WHO MAY RUN THE CREATING PATH ─────────────────────────────────────────────────────────────
  // Audit, 2026-08-27: this used to accept `auth === ''` when CRON_SECRET is unset — and
  // lib/cron-auth's own header records that CRON_SECRET has never been set on this project. That
  // made a plain anonymous GET from anywhere on the internet enough to run the path that CREATES
  // work in Breezeway and assigns it to named staff.
  //
  // The lenient fallback exists so Vercel's scheduler can run jobs without a secret, and Vercel
  // stamps `x-vercel-cron` on every one of its calls. That header is the whole of the leniency it
  // needs; a bare unauthenticated request is not the scheduler and gets nothing.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron')
  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const me = await signedIn()

  // PREVIEW NAMES UNITS AND PEOPLE. The lenient no-CRON_SECRET cron heuristic exists so Vercel's
  // scheduler can RUN the job, never so an anonymous caller can read who is working where today.
  if (preview) {
    if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else if (!isCron && !me) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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

    if (!cfg.enabled) return NextResponse.json({ ...safe, created: 0, note: 'Suggestions are switched off in settings.' })
    if (preview) return NextResponse.json({ ...safe, suggestions: run.suggestions })

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
        .eq('scheduled_date', date).limit(2000)
      const { data: ls } = await db.from('guesty_listings').select('id,nickname,title').limit(2000)
      const nameOf: Record<string, string> = {}
      for (const l of (ls || []) as any[]) nameOf[String(l.id)] = String(l.nickname || l.title || 'Unit')

      // One visit per unit, and only where somebody is actually going: an unassigned open task is
      // not a visit, it is a hope, and dragging three more jobs onto it helps nobody.
      const visits: Record<string, string | null> = {}
      for (const t of (todays || []) as any[]) {
        if (/delete|cancel/i.test(String(t.status || ''))) continue
        if (/\b(complete|finish|close|approv)/i.test(String(t.status || '')) || t.finished_at) continue
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

    // Receipt, so the automations screen can prove this ran and say what it did.
    await recordRun({
      name: 'suggestions', ok: failed.length === 0, itemCount: created.length,
      detail: {
        suggested: run.suggestions.length, autoCreated: created.length, failed: failed.length,
        consolidated, consolidatedUnits: consolidatedUnits.slice(0, 20), verdict: run.day.verdict,
      },
      error: failed[0] || null,
    })

    const out = {
      ...safe, created: created.length, failed: failed.length, errors: failed.slice(0, 3),
      consolidated, consolidatedUnits: consolidatedUnits.length,
    }
    return NextResponse.json(me ? { ...out, suggestions: run.suggestions } : out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, date, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
