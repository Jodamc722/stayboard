// A BUILDING'S OWN LOOK, READ OFF ITS WEBSITE (Jon, 2026-11-11: "smart themes based on the building"; 2026-11-18:
// "styles should pull font style, photos from their website for design and colour themes for sales decks").
//
// One read of the home page and up to three of its stylesheets gives:
//   - COLOURS: the dark brand colour, the most-used saturated one as the accent, and tints from those.
//   - TYPE: the headline face and the text face the site sets, as faces a deck can load (lib/brand-fonts): the
//     site's own when it is a Google Font, the closest free match when it is licensed.
//   - PICTURES: its logo, its lead picture, and the large photographs on the page.
// Used by /api/sales/brand (the new-deck form and the Style drawer). Server-only: it fetches a URL someone typed,
// through lib/safe-fetch (public hosts only, timeouts, size caps, redirects re-checked).
import 'server-only'
import { safeGet as get } from './safe-fetch'
import { fontsFromCss, googleHref, type BrandFont } from './brand-fonts'

type RGB = [number, number, number]
const hex = (c: RGB) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
function parseColor(s: string): RGB | null {
  s = s.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3})$/)
  if (m) return m[1].split('').map(x => parseInt(x + x, 16)) as RGB
  m = s.match(/^#([0-9a-f]{6})$/)
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)) as RGB
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (m) return [+m[1], +m[2], +m[3]]
  return null
}
function hsl([r, g, b]: RGB) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return { h: 0, s: 0, l }
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const W: RGB = [255, 255, 255], K: RGB = [0, 0, 0]

export function pickTheme(css: string, themeColor: string | null) {
  const counts = new Map<string, number>()
  for (const m of Array.from(css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)/g))) {
    const c = parseColor(m[0]); if (!c) continue
    const k = hex(c); counts.set(k, (counts.get(k) || 0) + 1)
  }
  if (themeColor) { const c = parseColor(themeColor); if (c) counts.set(hex(c), (counts.get(hex(c)) || 0) + 25) }
  const list = Array.from(counts.entries()).map(([k, n]) => ({ k, n, c: parseColor(k)!, ...hsl(parseColor(k)!) })).sort((a, b) => b.n - a.n)
  const dark = list.find(x => x.l >= 0.06 && x.l <= 0.36 && x.s >= 0.12) || list.find(x => x.l >= 0.06 && x.l <= 0.3)
  const accent = list.find(x => x.s >= 0.25 && x.l >= 0.32 && x.l <= 0.72 && (!dark || Math.abs(x.h - dark.h) > 18 || Math.abs(x.l - dark.l) > 0.2))
  if (!dark && !accent) return null
  const navy: RGB = dark ? dark.c : mix(accent!.c, K, 0.55)
  const sand: RGB = accent ? accent.c : mix(navy, W, 0.45)
  const ink = mix(navy, K, 0.35)
  return {
    navy: hex(navy), sand: hex(sand), ink: hex(ink),
    body: hex(mix(ink, [120, 120, 120], 0.35)), muted: hex(mix(ink, W, 0.5)),
    sandSoft: hex(mix(sand, W, 0.86)), warm: hex(mix(sand, W, 0.95)), rule: hex(mix([226, 222, 214], sand, 0.08)),
    glow: hex(mix(sand, W, 0.5)), desk: hex(mix(mix(sand, W, 0.9), [214, 212, 208], 0.5)),
  }
}

/** The photographs on a page worth using: the lead picture, then large <img>, srcset and CSS background pictures.
 *  Logos, icons, sprites, maps, tracking pixels and data: URIs are left out. Up to `max`, in page order. */
export function pagePhotos(html: string, css: string, abs: (u: string) => string, lead: string, max = 10): string[] {
  const out: string[] = []
  const bad = /logo|icon|sprite|favicon|avatar|badge|pixel|spacer|loader|placeholder|blank\.|map|flag|arrow|social|facebook|instagram|linkedin|twitter|youtube|\.svg(\?|$)|\.gif(\?|$)|^data:/i
  const add = (u: string) => { const a = u ? abs(u.trim()) : ''; if (a && !bad.test(a) && /\.(jpe?g|png|webp|avif)(\?|#|$)|\/image|\/media|\/upload|\/wp-content|cdn/i.test(a) && out.indexOf(a) < 0) out.push(a) }
  if (lead) add(lead)
  for (const m of Array.from(html.matchAll(/<(?:img|source)\b[^>]*>/gi))) {
    const tag = m[0]
    if (/logo|icon/i.test(tag)) continue
    const w = Number((tag.match(/\swidth=["']?(\d+)/i) || [])[1] || 0)
    if (w && w < 500) continue
    // the widest candidate in a srcset, else the plain source
    const set = (tag.match(/\s(?:data-)?srcset=["']([^"']+)["']/i) || [])[1]
    if (set) { const best = set.split(',').map(x => x.trim().split(/\s+/)).map(([u, d]) => ({ u, n: parseFloat(d || '0') || 0 })).sort((a, b) => b.n - a.n)[0]; if (best?.u) { add(best.u); continue } }
    add((tag.match(/\s(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i) || [])[1] || '')
  }
  for (const m of Array.from((html + '\n' + css).matchAll(/background(?:-image)?\s*:[^;}]*url\(\s*["']?([^"')]+)["']?\s*\)/gi))) add(m[1])
  return out.slice(0, max)
}

export type BrandRead = {
  theme: Record<string, any>; logo: string; image: string
  /** Photographs found on the page, the lead picture first. */
  images: string[]
  /** What the site sets its headlines and text in, and the face the deck uses for each. */
  fonts: { display: BrandFont | null; text: BrandFont | null }
  source: string
}
export async function readBrand(rawUrl: string): Promise<BrandRead> {
  let raw = String(rawUrl || '').trim()
  if (!raw) throw new Error('Paste the building’s website.')
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  const page = await get(raw)
  const html = page.text
  const base = page.url
  const abs = (u: string) => { try { return new URL(u.replace(/&amp;/g, '&'), base).toString() } catch { return '' } }
  const meta = (prop: string) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')); return m ? m[1] : '' }
  const title = (meta('og:site_name') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').split(/[|–—-]/)[0].trim().slice(0, 40)
  const image = abs(meta('og:image') || meta('twitter:image'))
  // The logo: an <img> whose src, class or alt says logo.
  let logo = ''
  for (const m of Array.from(html.matchAll(/<img[^>]+>/gi))) {
    const tag = m[0]
    if (/logo/i.test(tag)) { const src = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1] || (tag.match(/data-src=["']([^"']+)["']/i) || [])[1]; if (src && !/^data:/.test(src)) { logo = abs(src); break } }
  }
  // Stylesheets: inline <style> plus up to three linked sheets.
  let css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map(m => m[1]).join('\n') + '\n' + Array.from(html.matchAll(/style=["']([^"']+)["']/gi)).map(m => m[1]).join('\n')
  const sheets = Array.from(html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)).map(m => (m[0].match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean).map(h => abs(h!)).filter(Boolean)
  const gfLinks = sheets.filter(h => /fonts\.googleapis\.com/.test(h))
  for (const h of sheets.filter(h => !/fonts\.googleapis\.com/.test(h)).slice(0, 3)) { try { css += '\n' + (await get(h, 600_000)).text } catch { /* one sheet missing is fine */ } }
  const pal = pickTheme(css, meta('theme-color') || null)
  if (!pal) throw Object.assign(new Error('Could not find brand colours on that site. Pick a theme, or set the colours by hand.'), { status: 422 })
  const fams: string[] = []
  for (const l of gfLinks) for (const m of Array.from(l.matchAll(/family=([^&:]+)/g))) fams.push(decodeURIComponent(m[1].replace(/\+/g, ' ')))
  const fonts = fontsFromCss(css, fams)
  const theme: Record<string, any> = { label: title || new URL(base).hostname.replace(/^www\./, ''), ...pal,
    ...(fonts.display ? { display: fonts.display.use, displayUrl: googleHref(fonts.display.use) } : {}),
    ...(fonts.text ? { sans: fonts.text.use } : {}) }
  return { theme, logo, image, images: pagePhotos(html, css, abs, image), fonts, source: base }
}
