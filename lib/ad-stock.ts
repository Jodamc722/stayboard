// STOCK PHOTO SEARCH for Ad Studio — the search behind app/api/ads/stock, in a lib so the script writer can fill an
// event ad's first two acts with stock stand-ins too (2026-11-12). Licences as before:
//   - Pexels   (PEXELS_API_KEY)      — Pexels licence: free for commercial use, no attribution required
//   - Unsplash (UNSPLASH_ACCESS_KEY) — Unsplash licence: free for commercial use, no attribution required
//   - Openverse, no key              — public-domain only (CC0 / PDM), so nothing needs crediting
// Keys are read from the environment, never from the request.
import 'server-only'

export type StockHit = { url: string; view: string; thumb: string; width: number; height: number; caption: string; source: 'pexels' | 'unsplash' | 'openverse'; license: string; credit: string; link: string }

/** Throws on a network failure (the route turns that into a 502). */
export async function searchStock(qIn: string, shape: string): Promise<{ hits: StockHit[]; sources: string[]; keys: { pexels: boolean; unsplash: boolean } }> {
  const q = String(qIn || '').trim().slice(0, 100)
  const pexels = process.env.PEXELS_API_KEY, unsplash = process.env.UNSPLASH_ACCESS_KEY
  const keys = { pexels: !!pexels, unsplash: !!unsplash }
  if (!q) return { hits: [], sources: [], keys }
  const hits: StockHit[] = []
  const sources: string[] = []
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
  return { hits: hits.filter(h => h.url && h.view).slice(0, 60), sources, keys }
}
