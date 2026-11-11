// THE BUILDING PROJECTIONS LIBRARY (lib/sales-library) — the Sales tab's database of buildings.
//   GET              → every building, summarized
//   GET ?id=<id>     → one building with its comps and floor plans
//   POST {id?, name, area, website, note, cma} → add or update (edit)
//   DELETE ?id=<id>  → remove (edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readLibrary, getBuilding, saveBuilding, deleteBuilding, summarize } from '@/lib/sales-library'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('sales', 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('id') || '').trim()
  if (id) {
    const e = await getBuilding(id)
    return e ? NextResponse.json({ ok: true, building: e }) : NextResponse.json({ ok: false, error: 'Not in the library.' }, { status: 404 })
  }
  const list = await readLibrary()
  return NextResponse.json({ ok: true, buildings: list.map(summarize).sort((a, b) => a.name.localeCompare(b.name)) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || !body.cma) return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 })
  const r = await saveBuilding(body, g.access.email || null)
  return r.ok ? NextResponse.json({ ok: true, building: r.entry }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('id') || '').trim()
  const r = await deleteBuilding(id, g.access.email || null)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
}
