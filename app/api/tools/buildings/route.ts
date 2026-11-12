// Building search for the projections calculator: name or address in, up to eight buildings out (the
// Projections library and the buildings we manage), each with the street address to fill the form.
import { NextRequest, NextResponse } from 'next/server'
import { buildingSuggestions } from '@/lib/projection-places'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = String(req.nextUrl.searchParams.get('q') || '').slice(0, 80)
  const hits = await buildingSuggestions(q)
  // Public: name, street address, area and whether we hold projections for it. Nothing else.
  return NextResponse.json({ ok: true, buildings: hits.map(h => ({ key: h.key, name: h.name, address: h.address, area: h.area, libId: h.libId || null, lat: h.lat ?? null, lng: h.lng ?? null, projections: !!(h.plans && h.plans > 0) })) }, { headers: { 'Cache-Control': 'no-store' } })
}
