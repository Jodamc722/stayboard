// CALLS SCOREBOARD — who called, what got done, what closed incomplete. From guest_calls only.
//
// Everything here is a durable fact: a completed row was written when a person pressed a button,
// an incomplete row was written by the nightly close-out. Nothing is recomputed from reservations,
// so the numbers do not shift when a booking moves or a review lands. That is the difference
// between a scoreboard and a dashboard.
//
//   GET ?days=30  -> { window, totals, mandatory, welcome, byTier, byDay[], byCaller[], recentIncomplete[] }
//
// Completion rate = completed / (completed + incomplete). Rows still open (claimed, no-answer, or
// simply not yet due) are excluded from the rate — they are not a verdict yet — but they are
// reported as `open` so the desk can say how much is still in play.
//
// ONE FORMULA (2026-09-28 audit, P0-5): the row reader, the classification and the rate all come
// from lib/call-desk (callLogRows / tallyCall / callRate) — the same code Home and the Command Center
// strip use through welcomeRate, so `welcome.rate` here is the number they print. Under five verdicts
// a rate is withheld (null) rather than quoted off one or two calls.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { ymdET } from '@/lib/team-schedule'
import { pctOrCount } from '@/lib/money'
import { addDays, callDay, callLogRows, tallyCall, emptyTally, callRate, type CallTally } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'

// `late` = completed AFTER the day it was due (called_at's Eastern date is past scheduled_for). It
// counts as done, but it is reported, because a desk that is always catching guests in the unit is
// not calling ahead of anyone.
type Agg = CallTally

export async function GET(req: NextRequest) {
  const gate = await requireLevel('welcome-calls', 'view')
  if (!gate.ok) return gate.res
  const days = Math.max(1, Math.min(90, Number(new URL(req.url).searchParams.get('days')) || 30))
  const today = ymdET(new Date())
  const from = addDays(today, -(days - 1))
  const sb = supabaseAdmin()

  // scheduled_for is the day the call was DUE — the day it belongs to on the board. Rows from
  // before migration 074 have none; they fall back to called_at's Eastern date.
  //
  // The window is on scheduled_for, NOT called_at: a mandatory call is made whenever the booking
  // lands, often a week or two before arrival, and a called_at window would drop exactly those —
  // while their missed counterparts (closed at arrival+2) always stayed in. That understated the
  // mandatory rate, worst on the 7-day view.
  const { rows: inWindow, truncated } = await callLogRows(sb, from, today)

  const totals = emptyTally()
  const mandatory = emptyTally()
  const welcome = emptyTally()
  const byTier: Record<string, Agg> = {}
  // Per day, split the way the desk is judged: MANDATORY must be 100%, OTHER should be completed.
  const byDayMap: Record<string, Agg & { day: string; mandatory: Agg; other: Agg }> = {}
  const byCallerMap: Record<string, Agg & { name: string; email: string; reached: number; lastAt: string }> = {}
  for (let i = 0; i < days; i++) { const d = addDays(from, i); byDayMap[d] = { ...emptyTally(), day: d, mandatory: emptyTally(), other: emptyTally() } }

  for (const r of inWindow) {
    const tier = String(r.tier || (r.kind === 'post_checkout' ? 'post_checkout' : 'standard'))
    tallyCall(totals, r)
    if (r.kind === 'welcome') tallyCall(welcome, r)
    // Mandatory = lux, big, recovery. Post-checkout is its own kind of call, not a mandatory welcome.
    if (tier !== 'standard' && tier !== 'post_checkout') tallyCall(mandatory, r)
    if (!byTier[tier]) byTier[tier] = emptyTally()
    tallyCall(byTier[tier], r)
    const d = callDay(r); if (byDayMap[d]) { tallyCall(byDayMap[d], r); tallyCall(tier !== 'standard' && tier !== 'post_checkout' ? byDayMap[d].mandatory : byDayMap[d].other, r) }
    // Callers: only rows a person acted on. Incompletes have no caller — they are the desk's miss.
    const email = String(r.caller_email || '').toLowerCase()
    const name = String(r.called_by || '').trim()
    if (email || name) {
      const key = email || name.toLowerCase()
      if (!byCallerMap[key]) byCallerMap[key] = { ...emptyTally(), name: name || email.split('@')[0], email, reached: 0, lastAt: '' }
      const c = byCallerMap[key]
      tallyCall(c, r)
      if (r.outcome === 'reached' || r.outcome === 'happy' || r.outcome === 'issue') c.reached++
      if (String(r.called_at) > c.lastAt) c.lastAt = String(r.called_at)
    }
  }

  const byCaller = Object.values(byCallerMap)
    .map(c => ({ ...c, rate: callRate(c), reachRate: pctOrCount(c.reached, c.completed, 5, 0).pct }))
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
  const byDay = Object.values(byDayMap).map(d => ({ ...d, rate: callRate(d), mandatory: { ...d.mandatory, rate: callRate(d.mandatory) }, other: { ...d.other, rate: callRate(d.other) } }))
  const recentIncomplete = inWindow
    .filter((r: any) => r.outcome === 'incomplete')
    .sort((a: any, b: any) => String(b.scheduled_for || '').localeCompare(String(a.scheduled_for || '')))
    .slice(0, 25)
    .map((r: any) => ({ id: r.reservation_id, kind: r.kind, tier: r.tier, guest: r.guest_name, day: callDay(r), attempts: Number(r.attempts) || 0, note: r.note }))

  return NextResponse.json({
    window: { from, to: today, days },
    totals: { ...totals, rate: callRate(totals) },
    mandatory: { ...mandatory, rate: callRate(mandatory) },
    // Welcome calls alone — the rate Home and the Command Center strip show for the same days.
    welcome: { ...welcome, rate: callRate(welcome) },
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, { ...v, rate: callRate(v) }])),
    byDay, byCaller, recentIncomplete,
    truncated,
  })
}
