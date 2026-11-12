// STOCK PHOTOS for Ad Studio (Jon, 2026-11-04: "search images online to fit the look, as long as they are stock
// images"). GET ?q=<words>&shape=portrait|landscape|square → licensed photos we may use in marketing:
//   - Pexels   (PEXELS_API_KEY)      — Pexels licence: free for commercial use, no attribution required
//   - Unsplash (UNSPLASH_ACCESS_KEY) — Unsplash licence: free for commercial use, no attribution required
//   - Openverse, no key              — public-domain only (CC0 / PDM), so nothing needs crediting
// Keys are read from the environment, never from the request. Every hit carries its source and licence so a
// photo's provenance is visible in the editor. The search itself lives in lib/ad-stock (2026-11-12) so the event-ad
// writer can use it too.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { searchStock } from '@/lib/ad-stock'
export type { StockHit } from '@/lib/ad-stock'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const q = String(req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100)
  const shape = String(req.nextUrl.searchParams.get('shape') || '')
  if (!q) return NextResponse.json({ ok: true, hits: [], source: 'none' })
  try {
    const r = await searchStock(q, shape)
    return NextResponse.json({ ok: true, hits: r.hits, sources: r.sources, keys: r.keys })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 })
  }
}
