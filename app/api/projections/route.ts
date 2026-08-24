// OWNER PROJECTIONS — GET builds the whole board (lib/projections); POST saves the shared
// assumptions (overrides per unit-month, management fee %, per-building fee, market uplifts).
// Everything lives in one app_settings row so there is no migration and every editor sees the
// same numbers.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { buildProjections, SETTINGS_KEY, type ProjSettings } from '@/lib/projections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireLevel('projections', 'view')
  if (!gate.ok) return gate.res
  try {
    return NextResponse.json(await buildProjections())
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

const numOr = (v: any): number | undefined => {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('projections', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const cur = await getSetting<ProjSettings>(SETTINGS_KEY, {}).catch(() => ({} as ProjSettings))
  const next: ProjSettings = {
    mgmtPct: cur?.mgmtPct, buildingPct: { ...(cur?.buildingPct || {}) },
    uplift: { ...(cur?.uplift || {}) }, overrides: { ...(cur?.overrides || {}) },
  }
  if (body?.mgmtPct !== undefined) {
    const n = numOr(body.mgmtPct)
    if (n == null || n < 0 || n >= 60) return NextResponse.json({ ok: false, error: 'management fee must be 0–59%' }, { status: 400 })
    next.mgmtPct = Math.round(n * 10) / 10
  }
  if (body?.buildingPct && typeof body.buildingPct === 'object') {
    for (const k of Object.keys(body.buildingPct).slice(0, 100)) {
      const n = numOr(body.buildingPct[k])
      if (n == null) delete next.buildingPct![String(k).slice(0, 80)]
      else if (n >= 0 && n < 60) next.buildingPct![String(k).slice(0, 80)] = Math.round(n * 10) / 10
    }
  }
  if (body?.uplift && typeof body.uplift === 'object') {
    for (const mk of Object.keys(body.uplift).slice(0, 10)) {
      const u = body.uplift[mk] || {}
      const adrPct = numOr(u.adrPct), occPts = numOr(u.occPts)
      next.uplift![String(mk).slice(0, 20)] = {
        ...(next.uplift![mk] || {}),
        ...(adrPct != null && adrPct > -50 && adrPct < 100 ? { adrPct: Math.round(adrPct * 10) / 10 } : {}),
        ...(occPts != null && occPts > -50 && occPts < 50 ? { occPts: Math.round(occPts * 10) / 10 } : {}),
      }
    }
  }
  // Overrides arrive as a sparse patch: { [unitId]: { [month]: { occ?, adr?, los? } | null } }.
  // null clears the whole unit-month back to the suggestion; a null field clears that field.
  if (body?.overrides && typeof body.overrides === 'object') {
    for (const uid of Object.keys(body.overrides).slice(0, 500)) {
      const months = body.overrides[uid]
      if (months == null) { delete next.overrides![uid]; continue }
      if (typeof months !== 'object') continue
      next.overrides![uid] = { ...(next.overrides![uid] || {}) }
      for (const m of Object.keys(months).slice(0, 24)) {
        if (!/^\d{4}-\d{2}$/.test(m)) continue
        const v = months[m]
        if (v == null) { delete next.overrides![uid][m]; continue }
        const cell: { occ?: number; adr?: number; los?: number } = { ...(next.overrides![uid][m] || {}) }
        for (const f of ['occ', 'adr', 'los'] as const) {
          if (v[f] === null) delete cell[f]
          else if (v[f] !== undefined) {
            const n = numOr(v[f])
            if (n != null && n >= 0 && n < (f === 'occ' ? 101 : f === 'los' ? 60 : 100000)) cell[f] = Math.round(n * 100) / 100
          }
        }
        if (Object.keys(cell).length) next.overrides![uid][m] = cell
        else delete next.overrides![uid][m]
      }
      if (!Object.keys(next.overrides![uid]).length) delete next.overrides![uid]
    }
  }
  next.updatedAt = new Date().toISOString()
  next.updatedBy = gate.access.email || null as any
  const r = await setSetting(SETTINGS_KEY, next, gate.access.email || 'projections')
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
