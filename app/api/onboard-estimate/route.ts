// ONBOARDING COST ESTIMATE API (Jon, 2026-11-20) — everything the estimator page needs, in one read.
// The arithmetic and the shapes live in lib/onboard-estimate.ts; this route only reads and writes.
//
//   GET                       view  → { ok, level, standard, rows, left, settings }
//   PUT { settings }          full  → saves the rates (clean prices, square-foot rule, tax, linen allowance)
//
// standard  the saved linen standard (app_settings `linen_standard`): par levels AND the price per piece,
//           so the Linens page and this estimate can never disagree. No prices are kept in code.
// rows      the Default onboarding catalog's essentials (ffe_catalog_items + ffe_catalog_options) as
//           estimate rows: the real product price at Standard / Mid / Luxury for each line. Consumables
//           (lines with no tiered product) are ours to supply and come back in `left`, unpriced.
// Gated by Sales: this is a sales tool, and /sales/onboarding-cost sits under that key.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, type Gate } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting, setSetting } from '@/lib/app-settings'
import { LINEN_STANDARD_KEY, normLinenStandard } from '@/lib/linens'
import { ESTIMATE_SETTINGS_KEY, ESTIMATE_CATALOG, normEstSettings, catalogRows } from '@/lib/onboard-estimate'

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
    const db = supabaseAdmin()
    const [savedStd, savedSettings, itemRead] = await Promise.all([
      getSetting<any>(LINEN_STANDARD_KEY, null),
      getSetting<any>(ESTIMATE_SETTINGS_KEY, null),
      Promise.resolve(db.from('ffe_catalog_items').select('id,category,name,need,qty,qty_per,sort')
        .eq('catalog', ESTIMATE_CATALOG).eq('section', 'essential').is('archived_at', null).order('sort').limit(500)),
    ])
    if (itemRead.error) return fail('Could not read the onboarding catalog — try again.', 502)
    const items = (itemRead.data || []) as any[]
    let options: any[] = []
    if (items.length) {
      const optRead = await db.from('ffe_catalog_options').select('item_id,tier,price,name,sort')
        .in('item_id', items.map(i => i.id)).is('archived_at', null).order('sort').limit(5000)
      if (optRead.error) return fail('Could not read the catalog prices — try again.', 502)
      options = optRead.data || []
    }
    const settings = normEstSettings(savedSettings)
    const { rows, left } = catalogRows(items, options, settings)
    return NextResponse.json({ ok: true, level: g.access.levels['sales'] || 'view', standard: normLinenStandard(savedStd), rows, left, settings })
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
