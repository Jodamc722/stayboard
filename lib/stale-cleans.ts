// CLOSING THE TURNS NOBODY CLOSED.
//
// Jon, 2026-08-27: "any old departure cleans that have not been closed 7 days post departure,
// please close."
//
// ── WHY THIS IS BOOKKEEPING, NOT A SHORTCUT ─────────────────────────────────────────────────────
// Crews finish a turn and forget to close the task. A week later that unit has been cleaned, re-let
// and cleaned again — so an open departure clean from eight days ago is not outstanding work, it is
// a stale record. And stale records are not harmless here: every one inflates the late count on the
// board, which makes the 4pm deadline numbers mean less, which is how a coordinator stops believing
// the one figure the whole screen is built around.
//
// So this closes the record. It does not claim the work was done — the work demonstrably was, or
// the unit could not have been re-let.
//
// ── THE THREE THINGS IT REFUSES TO DO ───────────────────────────────────────────────────────────
// 1. TOUCH A UNIT THAT IS OCCUPIED RIGHT NOW. If somebody is in there today, an open clean on that
//    unit may be genuinely live — an extended stay, a re-clean, a complaint. Skipped, and counted.
// 2. CLOSE ANYTHING VENDOR-CLEANED. Vendor buildings never close their tasks in Breezeway at all
//    (the whole reason the board excludes them from the deadline), so EVERY vendor clean is
//    permanently "stale" by this rule. Auto-closing them would silently rewrite the history of a
//    third of the portfolio and teach us nothing.
// 3. RUN WITHOUT A CEILING. `maxPerRun` exists so that a bad sync, a date bug, or somebody widening
//    the window by accident can never mass-close the portfolio in one pass.
//
// Everything it closes is reported by name. An automation that changes records silently is one
// nobody can audit after the fact, and this one changes records.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { completeBreezewayTask, breezewayConfigured } from './breezeway'
import { getOpsPresets } from './app-settings'
import { untrackedRegex } from './ops-presets'
import { isLiveStay } from './stay-status'
import { getTaskAutomation } from './auto-inspections'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dOf = (v: any) => str(v).slice(0, 10)
const DONE = /\b(complete|finish|close|approv)/i
const GONE = /delete|cancel/i
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type StaleCleanRun = {
  ok: boolean
  enabled: boolean
  cutoff: string
  found: number
  closed: { id: string; unit: string; date: string }[]
  skipped: { occupied: number; vendor: number; overCap: number }
  failed: { id: string; error: string }[]
  error?: string
}

/**
 * Close departure cleans still open more than `afterDays` past their scheduled date.
 *
 * `dryRun` returns exactly what it would close and touches nothing — the preview the settings panel
 * shows before anybody turns this on, because "what would this do to my board" is a fair question
 * to ask of an automation that closes records.
 */
export async function closeStaleCleans(opts: { dryRun?: boolean } = {}): Promise<StaleCleanRun> {
  const cfg = await getTaskAutomation()
  const sc = cfg.staleCleans
  const today = ymd(new Date())
  const cutoff = ymd(new Date(Date.parse(today + 'T12:00:00Z') - sc.afterDays * 86400000))
  const base: StaleCleanRun = {
    ok: true, enabled: sc.enabled, cutoff, found: 0, closed: [],
    skipped: { occupied: 0, vendor: 0, overCap: 0 }, failed: [],
  }
  if (!sc.enabled && !opts.dryRun) return base

  try {
    const db = supabaseAdmin()
    const presets = await getOpsPresets()
    const UNTRACKED = untrackedRegex(presets.vendorBuildings)

    // Bounded window: `afterDays` back to 180 days. Beyond that is archaeology, and closing a
    // six-month-old record changes nothing anybody is looking at.
    const from = ymd(new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000))
    // ORDER DESC — most recent stale clean first. This used to order ASC with .limit(2000);
    // PostgREST silently caps every response at 1000 rows, so it only ever saw the OLDEST 1000
    // stale cleans (~6 months back) and could NEVER reach the 8-day-old ones this job exists to
    // close. Recent-first means the cleans a person would actually recognise are the ones it acts
    // on, and the maxPerRun cap trims the ancient tail rather than the useful head. (2026-08-29)
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,finished_at')
      .gte('scheduled_date', from).lt('scheduled_date', cutoff)
      .ilike('name', '%clean%')
      .order('scheduled_date', { ascending: false })
      .limit(1000)
    if (error) return { ...base, ok: false, error: error.message }

    const open = ((data || []) as any[]).filter(t => {
      const st = str(t.status).toLowerCase()
      if (GONE.test(st) || DONE.test(st) || t.finished_at) return false
      // DEPARTURE cleans only. "Deep clean" and "strip" are different jobs with no 4pm clock and no
      // re-let implying they happened, so the reasoning above does not apply to them.
      return /departure clean|turnover clean/i.test(str(t.name))
    })
    base.found = open.length
    if (!open.length) return base

    // Unit names + who is in them right now.
    const ids = Array.from(new Set(open.map(t => String(t.reference_property_id))))
    const [lRes, occRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building').in('id', ids).limit(1000),
      db.from('guesty_reservations').select('listing_id,check_in,check_out,status')
        .lte('check_in', today).gt('check_out', today).limit(4000),
    ])
    const nameOf: Record<string, string> = {}
    const buildingOf: Record<string, string> = {}
    for (const l of ((lRes.data || []) as any[])) {
      nameOf[String(l.id)] = str(l.nickname || l.title) || 'Unit'
      buildingOf[String(l.id)] = str(l.building)
    }
    const occupied = new Set<string>()
    for (const r of ((occRes.data || []) as any[])) if (isLiveStay(r.status)) occupied.add(String(r.listing_id))

    const queue: { id: string; unit: string; date: string }[] = []
    for (const t of open) {
      const lid = String(t.reference_property_id)
      const unit = nameOf[lid] || 'Unknown unit'
      if (UNTRACKED.test(unit) || UNTRACKED.test(buildingOf[lid] || '')) { base.skipped.vendor++; continue }
      if (sc.skipOccupied && occupied.has(lid)) { base.skipped.occupied++; continue }
      queue.push({ id: String(t.id), unit, date: dOf(t.scheduled_date) })
    }
    if (queue.length > sc.maxPerRun) {
      base.skipped.overCap = queue.length - sc.maxPerRun
      queue.length = sc.maxPerRun
    }

    if (opts.dryRun) return { ...base, closed: queue }
    if (!breezewayConfigured()) return { ...base, ok: false, error: 'Breezeway is not configured.' }

    for (const q of queue) {
      try {
        const r = await completeBreezewayTask(q.id)
        if (!r.ok) throw new Error('Breezeway ' + r.status)
        try {
          await db.from('breezeway_tasks_sync')
            .update({ status: 'completed', finished_at: new Date().toISOString(), synced_at: new Date().toISOString() })
            .eq('id', q.id)
        } catch { /* the next sync catches up */ }
        base.closed.push(q)
      } catch (e: any) {
        base.failed.push({ id: q.id, error: String(e?.message || e).slice(0, 140) })
      }
    }
    base.ok = base.failed.length === 0
    return base
  } catch (e: any) {
    return { ...base, ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}
