// WHO ACTUALLY CLOCKED IN (Jon, 2026-11-10: "want to see who actually clocked on here, scheduler
// page"). The team list on /schedule shows the Homebase SCHEDULE; this is the Homebase TIMECARDS for
// the same day — each person's first clock-in, last clock-out, whether they are on the clock now,
// and hours. One Homebase read per day per 90 seconds, shared by every open tab. A failed read is a
// 500, never "nobody clocked in".
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireVrUser } from '@/lib/vr-gate'
import { getTimecardsAudited } from '@/lib/homebase-labor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

export type Punch = { name: string; firstIn: string | null; lastOut: string | null; open: boolean; hours: number; cards: number }

async function build(date: string) {
  const a = await getTimecardsAudited(date, date)
  if (!a.complete) throw new Error('Homebase timecards could not be read — try again in a minute')
  const by: Record<string, Punch> = {}
  for (const c of a.cards) {
    if (c.date && c.date !== date) continue
    const k = c.name.trim().toLowerCase()
    const p = by[k] || (by[k] = { name: c.name.trim(), firstIn: null, lastOut: null, open: false, hours: 0, cards: 0 })
    p.cards++
    if (c.clockIn && (!p.firstIn || c.clockIn < p.firstIn)) p.firstIn = c.clockIn
    if (c.clockOut && (!p.lastOut || c.clockOut > p.lastOut)) p.lastOut = c.clockOut
    if (c.open) p.open = true
    p.hours += Number(c.hours) || 0
  }
  const punches = Object.values(by).map(p => ({ ...p, hours: Math.round(p.hours * 100) / 100, lastOut: p.open ? null : p.lastOut }))
    .sort((x, y) => String(x.firstIn).localeCompare(String(y.firstIn)))
  return { ok: true, date, builtAt: Date.now(), punches }
}
const cached = unstable_cache(async (date: string) => build(date), ['schedule-punches-v1'], { revalidate: 90 })

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const q = String(req.nextUrl.searchParams.get('date') || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ymd(new Date())
  if (date > ymd(new Date())) return NextResponse.json({ ok: true, date, future: true, punches: [] })
  try { return NextResponse.json(await cached(date)) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
