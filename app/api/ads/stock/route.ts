// STOCK PHOTOS for Ad Studio (Jon, 2026-11-04: "search images online to fit the look, as long as they are stock
// images"). GET ?q=<words>&shape=portrait|landscape|square → licensed photos we may use in marketing:
//   - Pexels   (PEXELS_API_KEY)      — Pexels licence: free for commercial use, no attribution required
//   - Unsplash (UNSPLASH_ACCESS_KEY) — Unsplash licence: free for commercial use, no attribution required
//   - Openverse, no key              — public-domain only (CC0 / PDM), so nothing needs crediting
// Keys are read from the environment, never from the request. Every hit carries its source and licence so a
// photo's provenance is visible in the editor.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export type StockHit = { url: string; view: string; thumb: string; width: number; height: number; caption: string; source: 'pexels' | 'unsplash' | 'openverse'; license: string; credit: string; link: string }

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const q = String(req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100)
  const shape = String(req.nextUrl.searchParams.get('shape') || '')
  if (!q) return NextResponse.json({ ok: true, hits: [], source: 'none' })
  const pexels = process.env.PEXELS_API_KEY, unsplash = process.env.UNSPLASH_ACCESS_KEY
  const hits: StockHit[] = []
  const sources: string[] = []
  try {
    if (pexels) {
      const o = shape === 'portrait' ? '&orientation=portrait' : shape === 'landscape' ? '&orientation=landscape' : shape === 'square' ? '&orientation=square' : ''
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=30${o}`, { headers: { Authorization: pexels } })
      const d: any = await r.json().catch(() => ({}))
      for (const p of d?.photos || []) hits.push({ url: p.src?.original || p.src?.large2x, view: p.src?.large2x || p.src?.large, thumb: p.src?.medium || p.src?.small, width: p.width, height: p.height, caption: String(p.alt || ''), source: 'pexels', license: 'Pexels licence · free for commercial use', credit: String(p.photographer || ''), link: String(p.url || '') })
      sources.push('pexels')
    }
    if (unsplash) {
      const o = shape === 'portrait' ? '&orientation=portrait' : shape === 'landscape' ? '&orientation=landscape' : shape === 'square' ? '&orientation=squarish' : ''
      const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=30&content_filter=high${o}`, { headers: { Authorization: 'Client-ID ' + unsplash, 'Accept-Version': 'v1' } })
      const d: any = await r.json().catch(() => ({}))
      for (const p of d?.results || []) hits.push({ url: p.urls?.full || p.urls?.regular, view: p.urls?.regular, thumb: p.urls?.small, width: p.width, height: p.height, caption: String(p.alt_description || p.description || ''), source: 'unsplash', license: 'Unsplash licence · free for commercial use', credit: String(p.user?.name || ''), link: String(p.links?.html || '') })
      sources.push('unsplash')
    }
    if (!hits.length) {
      const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&page_size=40&mature=false`, { headers: { 'User-Agent': 'Lighthouse AdStudio' } })
      const d: any = await r.json().catch(() => ({}))
      for (const p of d?.results || []) {
        const w = Number(p.width) || 0, h = Number(p.height) || 0
        if (w && w < 1000) continue
        if (shape === 'portrait' && w && h && h < w) continue
        if (shape === 'landscape' && w && h && h > w) continue
        hits.push({ url: String(p.url || ''), view: String(p.url || ''), thumb: String(p.thumbnail || p.url || ''), width: w, height: h, caption: String(p.title || ''), source: 'openverse', license: (String(p.license || '').toUpperCase() === 'PDM' ? 'Public domain' : 'CC0') + ' · no credit needed', credit: String(p.creator || ''), link: String(p.foreign_landing_url || '') })
      }
      sources.push('openverse')
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 })
  }
  return NextResponse.json({ ok: true, hits: hits.filter(h => h.url && h.view).slice(0, 60), sources, keys: { pexels: !!pexels, unsplash: !!unsplash } })
}
