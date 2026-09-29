// ON THE BOOKS vs THE SAME TIME LAST YEAR (lib/forecast/pacing) — the next 30 / 60 / 90 days.
//
//   GET ?windows=30,60,90   → { ok, windows[], basis, notes }
//
// Nights for anyone who can see the revenue pages; the dollar side only for people cleared for
// money (canSeeMoney) — everyone else gets the same payload with every revenue figure null.
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel, canSeeMoney } from '@/lib/access'
import { buildPacing, type Pacing } from '@/lib/forecast/pacing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['revenue', 'home', 'command'], 'view')
  if (!gate.ok) return gate.res
  const windows = String(req.nextUrl.searchParams.get('windows') || '').split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
  try {
    const p: Pacing = await buildPacing({ windows })
    if (canSeeMoney(gate.access)) return NextResponse.json(p)
    const hide = (s: any) => ({ ...s, revenue: null })
    return NextResponse.json({
      ...p,
      windows: p.windows.map(w => ({
        ...w, now: hide(w.now), lastYear: hide(w.lastYear), revenuePct: null,
        sameUnits: w.sameUnits ? { ...w.sameUnits, now: hide(w.sameUnits.now), lastYear: hide(w.sameUnits.lastYear), revenuePct: null } : null,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Pacing could not be built: ' + String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
