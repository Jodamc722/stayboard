// COMMAND CENTER — the day's CALLS as needed vs completed (Jon, 2026-09-30: "Welcome calls needed
// versus completed · Review recovery calls needed versus completed").
//
// One read of the Calls desk engine (lib/call-desk loadCallsDesk — the same numbers /welcome-calls
// prints), reduced to two tallies and their rows:
//   welcome   — every pre-arrival call inside its 72-hour window (due, not closed): how many are
//               done, how many are still owed, and how many of those land today.
//   recovery  — every call that exists because the UNIT is in review recovery: the pre-arrival
//               call into a recovery unit, and the post-checkout call for a guest leaving one.
// Rows carry what the Today page needs to list and log them — never the guest's phone; that stays
// on the Calls desk where the caller is.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { ymdET } from '@/lib/team-schedule'
import { loadCallsDesk, type WelcomeRow, type PostRow } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

export type DayCallRow = {
  id: string
  /** welcome = pre-arrival · pre = pre-arrival into a recovery unit · post = post-checkout from a recovery unit */
  kind: 'welcome' | 'pre' | 'post'
  guest: string; unit: string; building: string; listingId: string
  /** The day the call belongs to: check-in for pre-arrival, check-out for post-checkout. */
  date: string; today: boolean
  tier: string; mandatory: boolean
  done: boolean; outcome: string; attempts: number; calledBy: string; calledAt: string
  claimedBy: string
  value: number; nights: number
  recovery: { rating: number; channel: string; openDays: number; at: string } | null
  reasons: string[]
}
export type DayCalls = {
  ok: true; today: string
  welcome: { needed: number; done: number; todayNeeded: number; todayDone: number; rows: DayCallRow[] }
  recovery: { needed: number; done: number; pre: number; post: number; rows: DayCallRow[] }
  recoveryFailed: boolean
}

const rec = (r: WelcomeRow | PostRow) => r.recovery ? { rating: r.recovery.rating, channel: r.recovery.channel, openDays: r.recovery.openDays, at: r.recovery.at } : null

export async function GET() {
  const gate = await requireLevel('welcome-calls', 'view')
  if (!gate.ok) return gate.res
  const today = ymdET(new Date())
  try {
    const d = await loadCallsDesk(supabaseAdmin(), today)
    const w = d.rows.filter(r => r.due && !r.closed)
    const welcomeRows: DayCallRow[] = w.map(r => ({
      id: r.id, kind: r.recovery ? 'pre' : 'welcome', guest: r.guest, unit: r.listing, building: r.building, listingId: r.listingId,
      date: r.check_in, today: r.check_in === today, tier: r.tier, mandatory: r.mandatory,
      done: r.done, outcome: r.outcome, attempts: r.attempts, calledBy: r.calledBy, calledAt: r.calledAt, claimedBy: r.claimedBy,
      value: r.value, nights: r.status?.nights || 0, recovery: rec(r), reasons: [],
    }))
    const post = d.outRows.filter(r => !r.closed)
    const postRows: DayCallRow[] = post.map(r => ({
      id: r.id, kind: 'post', guest: r.guest, unit: r.listing, building: r.building, listingId: r.listingId,
      date: r.check_out, today: r.check_out === today, tier: 'recovery', mandatory: true,
      done: r.done, outcome: r.outcome, attempts: r.attempts, calledBy: r.calledBy, calledAt: r.calledAt, claimedBy: r.claimedBy,
      value: r.value, nights: r.nights, recovery: rec(r), reasons: r.reasons,
    }))
    const preRec = welcomeRows.filter(r => r.kind === 'pre')
    const recoveryRows = preRec.concat(postRows)
    const sortRows = (a: DayCallRow, b: DayCallRow) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date) || Number(b.mandatory) - Number(a.mandatory) || b.value - a.value
    const out: DayCalls = {
      ok: true, today,
      welcome: {
        needed: welcomeRows.length, done: welcomeRows.filter(r => r.done).length,
        todayNeeded: welcomeRows.filter(r => r.today).length, todayDone: welcomeRows.filter(r => r.today && r.done).length,
        rows: welcomeRows.sort(sortRows),
      },
      recovery: {
        needed: recoveryRows.length, done: recoveryRows.filter(r => r.done).length,
        pre: preRec.length, post: postRows.length,
        rows: recoveryRows.sort(sortRows),
      },
      recoveryFailed: d.recoveryFailed,
    }
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
