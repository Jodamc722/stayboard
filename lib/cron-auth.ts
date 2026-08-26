// WHY FIVE SCHEDULED JOBS HAD NEVER RUN.
//
// This app grew two different ways of authorising a cron:
//
//   THE OPEN PATTERN (reservations, breezeway-tasks, slack, watchdog, ~20 others):
//     if (CRON_SECRET is set) require the bearer token — otherwise run.
//     With no secret configured these run fine, which is why the booking feed is always current.
//
//   THE GATED PATTERN (guest-comms, sentiment/scan, eve-audit, eve-metrics, eve/learn):
//     viaCron = CRON_SECRET is set AND the bearer matches — otherwise require a logged-in session.
//     With no secret configured, Vercel's scheduler sends no bearer, fails the session check, and
//     gets a 401. Every time. Silently.
//
// CRON_SECRET has never been set on this project, so those five have never once run on schedule.
// Nothing alerted, because a 401 is a perfectly healthy-looking response: the guest conversations
// feed sat hours stale, sentiment went unscanned, and Eve's nightly learning, her daily baselines
// and her own standing audit were simply dark — while every dashboard reported green.
//
// THE FIX, AND WHY IT IS NOT JUST "MAKE THEM OPEN".
// Two of these five spend real money on every run (sentiment/scan and eve/learn both call
// Anthropic). An open URL that costs money each time it is fetched is a bill waiting to happen —
// so opening them the way the other twenty are opened would trade a silent outage for a silent
// invoice.
//
// So: run when nobody can prove who they are, but never more often than the schedule intends.
// `tooSoon()` reads the run ledger the automations work added today and refuses a repeat inside the
// job's own interval. The worst an anonymous caller can do is trigger the run that was about to
// happen anyway. Setting CRON_SECRET still tightens it back to a bearer check — this makes the
// secret an improvement rather than a prerequisite, which is the property it should have had from
// the start.
import 'server-only'
import type { NextRequest } from 'next/server'
import { supabaseAdmin } from './supabase-admin'

/**
 * Is this request allowed to run a scheduled job?
 * When CRON_SECRET is set, only the matching bearer passes (Vercel sends it on every cron call).
 * When it is not set, everything passes — and the caller must additionally respect tooSoon().
 */
export function cronAllowed(req: NextRequest): { ok: boolean; viaSecret: boolean } {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: true, viaSecret: false }
  const auth = req.headers.get('authorization') || ''
  return { ok: auth === 'Bearer ' + secret, viaSecret: auth === 'Bearer ' + secret }
}

/**
 * Has this job already run inside its own interval? Uses `automation_runs` as the ledger.
 * Returns the skip payload to hand straight back, or null to proceed.
 *
 * Deliberately fails OPEN (returns null) if the ledger cannot be read: a throttle that cannot see
 * the history must not become the reason a job never runs — that is the exact failure this whole
 * file exists to undo.
 */
export async function tooSoon(name: string, minMinutes: number): Promise<{ skipped: string; lastRunAt: string } | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('automation_runs')
      .select('ran_at')
      .eq('name', name)
      .order('ran_at', { ascending: false })
      .limit(1)
    const last = ((data as any[]) || [])[0]?.ran_at
    if (!last) return null
    const mins = (Date.now() - new Date(last).getTime()) / 60000
    if (mins < minMinutes) {
      return { skipped: `ran ${Math.round(mins)} min ago; this job runs at most every ${minMinutes} min`, lastRunAt: last }
    }
    return null
  } catch {
    return null
  }
}
