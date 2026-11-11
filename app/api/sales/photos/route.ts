// PHOTO SEARCH FOR THE SALES MAGAZINE (Jon, 2026-11-11: "the photos should allow us to also search in
// our library for whatever"). The Photo Library's own smart search (lib/photo-search: "elser pool",
// "17 west view", "brickell kitchen") behind the Sales permission, so whoever builds a deck can use
// it without Photo Library access. Results are our own listing photos, sized for picking.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { searchPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('sales', 'view')
  if (!g.ok) return g.res
  const q = String(req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  if (!q) return NextResponse.json({ ok: true, hits: [], total: 0 })
  try {
    const r = await searchPhotos(q, 60)
    return NextResponse.json({ ok: true, total: r.total, hits: r.hits.map(h => ({ url: h.url, thumb: h.thumb, view: h.view, caption: h.caption, unit: h.unit, building: h.building, width: h.width, height: h.height })) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
