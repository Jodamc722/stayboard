// SUGGEST THE WEEK (Jon, 2026-09-28: "we should have this also for weekly planner").
//
//   POST { from, to }  → one plan per day (up to 14), built the way the shadow scheduler builds
//                        tomorrow: the day's departure cleans, who is rostered / already working,
//                        the suggester's rules, and the last 30 days of habits as a tie-breaker.
//
// Read-only. The planner's Approve pushes a day through /api/schedule/assign, the same route the
// Suggest-a-schedule popup uses, so nothing new can write to Breezeway.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { projectDay } from '@/lib/eve/scheduler-shadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function POST(req: NextRequest) {
  const gate = await requireLevel('schedule', 'view')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.from)) ? String(b.from) : ymd(new Date())
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.to)) ? String(b.to) : from
  const days: string[] = []
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z') && days.length < 14; t += 86400000) days.push(new Date(t).toISOString().slice(0, 10))
  const plans: any[] = []
  for (const d of days) {
    try { const p = await projectDay(d); plans.push(p ? p : { date: d, cleans: 0, empty: true }) }
    catch (e: any) { plans.push({ date: d, error: String(e?.message || e).slice(0, 120) }) }
  }
  return NextResponse.json({ ok: true, from, to, plans })
}
