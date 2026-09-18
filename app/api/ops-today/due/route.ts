// THE PM CALENDAR — what is due and when, by building (lib/pm-calendar).
//   GET /api/ops-today/due?market=Miami&days=30
// Read-only: this proposes nothing and creates nothing. Adding is the Add-task route, as ever.
import { NextRequest, NextResponse } from 'next/server'
import { buildDueCalendar } from '@/lib/pm-calendar'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const days = Number(req.nextUrl.searchParams.get('days') || 30)
  const q = String(req.nextUrl.searchParams.get('date') || '')
  const today = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ymd(new Date())
  try {
    return NextResponse.json(await buildDueCalendar(today, { market, horizonDays: Number.isFinite(days) ? days : 30 }))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
