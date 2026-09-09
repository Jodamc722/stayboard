// CALLS SCOREBOARD — who called, what got done, what closed incomplete. From guest_calls only.
//
// Everything here is a durable fact: a completed row was written when a person pressed a button,
// an incomplete row was written by the nightly close-out. Nothing is recomputed from reservations,
// so the numbers do not shift when a booking moves or a review lands. That is the difference
// between a scoreboard and a dashboard.
//
//   GET ?days=30  -> { window, totals, byTier, byDay[], byCaller[], recentIncomplete[] }
//
// Completion rate = completed / (completed + incomplete). Rows still open (claimed, no-answer, or
// simply not yet due) are excluded from the rate — they are not a verdict yet — but they are
// reported as `open` so the desk can say how much is still in play.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { pageRows } from '@/lib/db-page'
import { ymdET } from '@/lib/team-schedule'
import { addDays, isCompleted } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'

// `late` = completed AFTER the guest arrived (called_at's Eastern date is past scheduled_for). It
// counts as done — Jon's 24-hour window — but it is reported, because a desk that is always
// catching guests in the unit is not calling ahead of anyone.
type Agg = { completed: number; late: number; incomplete: number; open: number; attempts: number; noAnswer: number }
const agg = (): Agg => ({ completed: 0, late: 0, incomplete: 0, open: 0, attempts: 0, noAnswer: 0 })
const rate = (a: Agg) => (a.completed + a.incomplete) ? Math.round((a.completed / (a.completed + a.incomplete)) * 100) : null

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
  //
  // guest_calls has a composite key and no `id`, so the stable order for paging is the key itself.
  const { rows, truncated } = await pageRows<any>((a, b) => sb.from('guest_calls')
    .select('reservation_id,kind,outcome,tier,attempts,called_by,caller_email,called_at,scheduled_for,guest_name,note,closed_at')
    .or(`scheduled_for.gte.${from},and(scheduled_for.is.null,called_at.gte.${from}T00:00:00Z)`)
    .order('reservation_id').order('kind').range(a, b), 6)

  const dayOf = (r: any) => String(r.scheduled_for || '').slice(0, 10) || ymdET(new Date(r.called_at))
  const inWindow = rows.filter((r: any) => { const d = dayOf(r); return d >= from && d <= today })

  const totals = agg()
  const mandatory = agg()
  const byTier: Record<string, Agg> = {}
  // Per day, split the way the desk is judged: MANDATORY must be 100%, OTHER should be completed.
  const byDayMap: Record<string, Agg & { day: string; mandatory: Agg; other: Agg }> = {}
  const byCallerMap: Record<string, Agg & { name: string; email: string; reached: number; lastAt: string }> = {}
  const bump = (a: Agg, r: any) => {
    const o = String(r.outcome || '')
    if (isCompleted(o)) {
      a.completed++
      if (r.kind === 'welcome' && r.scheduled_for && r.called_at && ymdET(new Date(r.called_at)) > String(r.scheduled_for).slice(0, 10)) a.late++
    }
    else if (o === 'incomplete') a.incomplete++
    else a.open++
    a.attempts += Number(r.attempts) || 0
    if (o === 'no_answer') a.noAnswer++
  }
  for (let i = 0; i < days; i++) { const d = addDays(from, i); byDayMap[d] = { ...agg(), day: d, mandatory: agg(), other: agg() } }

  for (const r of inWindow) {
    const tier = String(r.tier || (r.kind === 'post_checkout' ? 'post_checkout' : 'standard'))
    bump(totals, r)
    // Mandatory = lux, big, recovery. Post-checkout is its own kind of call, not a mandatory welcome.
    if (tier !== 'standard' && tier !== 'post_checkout') bump(mandatory, r)
    if (!byTier[tier]) byTier[tier] = agg()
    bump(byTier[tier], r)
    const d = dayOf(r); if (byDayMap[d]) { bump(byDayMap[d], r); bump(tier !== 'standard' && tier !== 'post_checkout' ? byDayMap[d].mandatory : byDayMap[d].other, r) }
    // Callers: only rows a person acted on. Incompletes have no caller — they are the desk's miss.
    const email = String(r.caller_email || '').toLowerCase()
    const name = String(r.called_by || '').trim()
    if (email || name) {
      const key = email || name.toLowerCase()
      if (!byCallerMap[key]) byCallerMap[key] = { ...agg(), name: name || email.split('@')[0], email, reached: 0, lastAt: '' }
      const c = byCallerMap[key]
      bump(c, r)
      if (r.outcome === 'reached' || r.outcome === 'happy' || r.outcome === 'issue') c.reached++
      if (String(r.called_at) > c.lastAt) c.lastAt = String(r.called_at)
    }
  }

  const byCaller = Object.values(byCallerMap)
    .map(c => ({ ...c, rate: rate(c), reachRate: c.completed ? Math.round((c.reached / c.completed) * 100) : null }))
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
  const byDay = Object.values(byDayMap).map(d => ({ ...d, rate: rate(d), mandatory: { ...d.mandatory, rate: rate(d.mandatory) }, other: { ...d.other, rate: rate(d.other) } }))
  const recentIncomplete = inWindow
    .filter((r: any) => r.outcome === 'incomplete')
    .sort((a: any, b: any) => String(b.scheduled_for || '').localeCompare(String(a.scheduled_for || '')))
    .slice(0, 25)
    .map((r: any) => ({ id: r.reservation_id, kind: r.kind, tier: r.tier, guest: r.guest_name, day: dayOf(r), attempts: Number(r.attempts) || 0, note: r.note }))

  return NextResponse.json({
    window: { from, to: today, days },
    totals: { ...totals, rate: rate(totals) },
    mandatory: { ...mandatory, rate: rate(mandatory) },
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, { ...v, rate: rate(v) }])),
    byDay, byCaller, recentIncomplete,
    truncated,
  })
}
