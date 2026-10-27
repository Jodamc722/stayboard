// PASTE A PRODUCT LINK, GET THE PRODUCT (Jon, 2026-10-27: "multiple suppliers it can search").
// The team searches on the supplier's own site, picks the product, and pastes its link here. This
// reads what the page itself publishes — the Open Graph title and image, and a price from JSON-LD
// or the product meta tags — and names the supplier from the address.
//
// It works where the site serves its page to a server: Article/HostGPO, City Home, the Shopify
// stores, Lowe's, Samsung. Amazon, Walmart, Target and Wayfair often answer a server with a bot
// check; then the supplier and link still fill in and the name, price and photo are typed by hand.
// It never invents a value: anything it could not read comes back empty.
import 'server-only'

export type Lookup = { ok: boolean; url: string; supplier: string | null; name: string | null; price: number | null; image: string | null; blocked?: boolean; error?: string }

const HOSTS: [RegExp, string][] = [
  [/(^|\.)amazon\.com$|(^|\.)amzn\.(to|com)$|a\.co$/i, 'amz'],
  [/(^|\.)walmart\.com$/i, 'walmart'],
  [/(^|\.)target\.com$/i, 'target'],
  [/(^|\.)hostgpo\.com$|(^|\.)article\.com$/i, 'host'],
  [/(^|\.)wayfair\.com$/i, 'wf'],
  [/(^|\.)cityhome\.com$|(^|\.)cityfurniture\.com$/i, 'ch'],
  [/(^|\.)lowes\.com$/i, 'lowes'],
  [/(^|\.)samsung\.com$/i, 'samsung'],
  [/(^|\.)staples\.com$/i, 'staples'],
  [/(^|\.)helixsleep\.com$/i, 'helix'],
  [/(^|\.)nearlynatural\.com$/i, 'nn'],
  [/(^|\.)rugsusa\.com$/i, 'rugsusa'],
  [/(^|\.)beekman1802\.com$/i, 'beekman'],
  [/(^|\.)apothekeco\.com$/i, 'apotheke'],
  [/(^|\.)publicgoods\.com$/i, 'pg'],
  [/(^|\.)diversifiedhospitality\.com$/i, 'dh'],
]

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim()
function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]; if (!tag) return null
  const v = tag.match(/content=["']([^"']*)["']/i)?.[1]
  return v ? decode(v) : null
}
function ldPrice(html: string): number | null {
  for (const m of Array.from(html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const walk = (x: any): number | null => {
        if (!x || typeof x !== 'object') return null
        if (Array.isArray(x)) { for (const y of x) { const r = walk(y); if (r != null) return r } return null }
        const offers = x.offers || (x['@type'] === 'Offer' ? x : null)
        if (offers) { const o = Array.isArray(offers) ? offers[0] : offers; const p = parseFloat(String(o?.price ?? o?.lowPrice ?? '')); if (Number.isFinite(p) && p > 0) return p }
        for (const k of Object.keys(x)) { if (typeof x[k] === 'object') { const r = walk(x[k]); if (r != null) return r } }
        return null
      }
      const r = walk(JSON.parse(m[1])); if (r != null) return Math.round(r * 100) / 100
    } catch { /* next block */ }
  }
  return null
}

export function supplierFor(url: string): string | null {
  try { const h = new URL(url).hostname; for (const [re, k] of HOSTS) if (re.test(h)) return k } catch { /* not a URL */ }
  return null
}

export async function lookupProduct(raw: string): Promise<Lookup> {
  const url = String(raw || '').trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, url, supplier: null, name: null, price: null, image: null, error: 'Paste a full product link (https://…).' }
  const supplier = supplierFor(url)
  let html = ''
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } })
    const ct = r.headers.get('content-type') || ''
    if (r.ok && ct.includes('html')) html = (await r.text()).slice(0, 1_500_000)
  } catch { /* blocked or slow — fall through with what the address tells us */ }
  const title = html ? (meta(html, 'og:title') || decode(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '')) : ''
  const blocked = !html || /robot check|captcha|access denied|are you a human|pardon our interruption/i.test(title + html.slice(0, 4000))
  if (blocked) return { ok: true, url, supplier, name: null, price: null, image: null, blocked: true }
  const priceMeta = meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price')
  const price = priceMeta && Number.isFinite(parseFloat(priceMeta)) ? Math.round(parseFloat(priceMeta) * 100) / 100 : ldPrice(html)
  let image = meta(html, 'og:image:secure_url') || meta(html, 'og:image')
  if (image && image.startsWith('//')) image = 'https:' + image
  if (image && /logo|favicon|sprite/i.test(image)) image = null
  const name = title.replace(/\s*[|\-–—]\s*(Amazon\.com|Walmart\.com|Target|Wayfair|City Home|Article|HostGPO|Lowe['’]s).*$/i, '').slice(0, 200) || null
  return { ok: true, url, supplier, name, price, image: image && /^https?:\/\//.test(image) ? image : null }
}
