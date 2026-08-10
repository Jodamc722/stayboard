// LABOR REPORT — the one endpoint behind both the morning email and the live dashboard.
//
// ?date=YYYY-MM-DD          a single day
// ?from=&to=                any window
// ?period=day|week|month    relative to ?anchor= (default today, ET)
// Nothing passed            yesterday, which is what the morning email wants.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildLaborReport, ymdET, shiftDay } from '@/lib/labor-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

/** Resolve whatever the caller passed into one concrete window. */
export function resolveWindow(sp: URLSearchParams): { from: string; to: string } {
  const today = ymdET(new Date())
  const anchor = isYmd(sp.get('anchor')) ? String(sp.get('anchor')) : today
  const from = String(sp.get('from') || ''), to = String(sp.get('to') || '')
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to }
  const date = String(sp.get('date') || '')
  if (isYmd(date)) return { from: date, to: date }
  const period = String(sp.get('period') || '').toLowerCase()
  if (period === 'week') {
    // Weeks run Monday–Sunday here; the anchor's own week, clipped so a live week never
    // reports days that have not happened yet.
    const d = new Date(anchor + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7
    const start = shiftDay(anchor, -dow)
    const end = shiftDay(start, 6)
    return { from: start, to: end > today ? today : end }
  }
  if (period === 'month') {
    const start = anchor.slice(0, 8) + '01'
    const d = new Date(anchor + 'T12:00:00')
    const last = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).getUTCDate()
    const end = anchor.slice(0, 8) + String(last).padStart(2, '0')
    return { from: start, to: end > today ? today : end }
  }
  if (period === 'day') return { from: anchor, to: anchor }
  const y = shiftDay(today, -1)
  return { from: y, to: y }
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('labor', 'view')
  if (!gate.ok) return gate.res
  try {
    const { from, to } = resolveWindow(req.nextUrl.searchParams)
    const report = await buildLaborReport(from, to)
    return NextResponse.json({ ok: true, ...report })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
