// WHICH UNITS THE SALATO FRONT DESK COVERS — read + save (Jon, 2026-09-08).
//
// GET  → every Guesty listing with a flag saying why it is in or out, plus the current config.
// POST → { mode, ids, exclude } saved to app_settings.salato_units.
//
// The set drives the front desk board, the share link, the verification gate, the daily email and
// the Salato vendor board — all of them read lib/salato-units, so this one save moves all five.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { salatoListings, setSalatoUnitsCfg, sanitizeUnitsCfg } from '@/lib/salato-units'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const g = await requireLevel('salato', 'view')
  if (!g.ok) return g.res
  try {
    const { cfg, all, ids } = await salatoListings(supabaseAdmin())
    return NextResponse.json({ ok: true, cfg, listings: all, count: ids.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('salato', 'edit')
  if (!g.ok) return g.res
  try {
    const body = await req.json().catch(() => ({} as any))
    const cfg = sanitizeUnitsCfg(body)
    const r = await setSalatoUnitsCfg(cfg, g.access.email || null)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'Could not save' }, { status: 500 })
    const { all, ids } = await salatoListings(supabaseAdmin())
    return NextResponse.json({ ok: true, cfg, listings: all, count: ids.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
