// ONBOARDING COST ESTIMATE API (Jon, 2026-11-20) — everything the estimator page needs, in one read.
// The arithmetic and the shapes live in lib/onboard-estimate.ts; this route only reads and writes.
//
//   GET                       view  → { ok, level, standard, settings }
//   PUT { settings }          full  → saves the rates and any prices typed on the page
//
// standard  the saved linen standard (app_settings `linen_standard`): par levels AND the price per piece,
//           so the Linens page and this estimate can never disagree.
// settings  the clean prices, the square-foot rule, tax, the linen allowance, and price overrides for the
//           inventory lines (the list itself and its default prices are code: lib/need-list.ts,
//           lib/need-buy.ts and the price book in lib/onboard-estimate.ts).
// Gated by Sales: this is a sales tool, and /sales/onboarding-cost sits under that key.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, type Gate } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting, setSetting } from '@/lib/app-settings'
import { LINEN_STANDARD_KEY, normLinenStandard } from '@/lib/linens'
import { ESTIMATE_SETTINGS_KEY, normEstSettings } from '@/lib/onboard-estimate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })

async function gate(need: 'view' | 'edit' | 'full'): Promise<Gate> {
  const g = await requireLevel('sales', need)
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}

export async function GET() {
  const g = await gate('view')
  if (!g.ok) return g.res
  try {
    const [savedStd, savedSettings] = await Promise.all([getSetting<any>(LINEN_STANDARD_KEY, null), getSetting<any>(ESTIMATE_SETTINGS_KEY, null)])
    return NextResponse.json({ ok: true, level: g.access.levels['sales'] || 'view', standard: normLinenStandard(savedStd), settings: normEstSettings(savedSettings) })
  } catch (e: any) {
    return fail(String(e?.message || e).slice(0, 200), 500)
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.settings || typeof body.settings !== 'object') return fail('Send { settings }.', 400)
  const g = await gate('full')
  if (!g.ok) return g.res
  try {
    const who = g.access.email || ''
    const settings = { ...normEstSettings(body.settings), updatedAt: new Date().toISOString(), updatedBy: who }
    const saved = await setSetting(ESTIMATE_SETTINGS_KEY, settings, who)
    if (!saved.ok) return fail('Could not save the rates — try again.', 502)
    return NextResponse.json({ ok: true, settings })
  } catch (e: any) {
    return fail(String(e?.message || e).slice(0, 200), 500)
  }
}
