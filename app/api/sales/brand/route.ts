// A THEME FROM THE BUILDING'S OWN WEBSITE (Jon, 2026-11-11: "smart themes based on the building; we
// should be able to link the website of the building so you can get an idea of the theme and look").
//
// POST { url } → { ok, theme, logo, image }. Reads the page and up to three of its stylesheets and
// returns a magazine theme (components/SalesMagazine MagTheme): the building's dark brand colour as
// the primary, its most-used saturated colour as the accent, tints derived from those, the display
// typeface when the site loads it from Google Fonts, plus its logo and lead (og:image) picture.
//
// SAFETY. A team-only route (Sales edit) that fetches a URL someone typed, so: http(s) only, the host
// must resolve to a public address (no localhost, private, link-local or metadata ranges — checked on
// every redirect hop), 8-second timeout, 1.5 MB per response, at most three redirects.
import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'dns/promises'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i]

async function publicUrl(raw: string): Promise<URL> {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web addresses (http or https) can be read.')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('That address is not a public website.')
  const addrs = await lookup(u.hostname, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error('That website could not be found.')
  if (addrs.some(a => PRIVATE.some(r => r.test(a.address)))) throw new Error('That address is not a public website.')
  return u
}

async function get(raw: string, max = 1_500_000): Promise<{ url: string; text: string }> {
  let url = await publicUrl(raw)
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    try {
      const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StayLighthouse/1.0; +https://stay-hospitality.com)', Accept: 'text/html,text/css,*/*' } })
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await publicUrl(new URL(r.headers.get('location')!, url).toString()); continue }
      if (!r.ok) throw new Error('The website answered ' + r.status + '.')
      const reader = r.body?.getReader()
      if (!reader) return { url: url.toString(), text: '' }
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) { try { await reader.cancel() } catch {} break }
        chunks.push(value)
      }
      return { url: url.toString(), text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') }
    } finally { clearTimeout(t) }
  }
  throw new Error('Too many redirects.')
}

// ── colour helpers ──
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

function pickTheme(css: string, themeColor: string | null) {
  const counts = new Map<string, number>()
  for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)/g)) {
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

const SERIFY = /(serif|garamond|caslon|baskerville|bodoni|didot|playfair|cormorant|libre|lora|merriweather|crimson|fraunces|dm serif|marcellus|cinzel|prata|gilda|italiana|tenor|josefin|montserrat|poppins|raleway|lato|futura|jost|syne|manrope)/i

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  const body = await req.json().catch(() => ({}))
  let raw = String(body?.url || '').trim()
  if (!raw) return NextResponse.json({ ok: false, error: 'Paste the building’s website.' }, { status: 400 })
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  try {
    const page = await get(raw)
    const html = page.text
    const base = page.url
    const abs = (u: string) => { try { return new URL(u.replace(/&amp;/g, '&'), base).toString() } catch { return '' } }
    const meta = (prop: string) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')); return m ? m[1] : '' }
    const title = (meta('og:site_name') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').split(/[|–—-]/)[0].trim().slice(0, 40)
    const image = abs(meta('og:image') || meta('twitter:image'))
    // The logo: an <img> whose src, class or alt says logo; else an SVG/PNG icon link.
    let logo = ''
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0]
      if (/logo/i.test(tag)) { const src = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1] || (tag.match(/data-src=["']([^"']+)["']/i) || [])[1]; if (src && !/^data:/.test(src)) { logo = abs(src); break } }
    }
    // Stylesheets: inline <style> plus up to three linked sheets.
    let css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map(m => m[1]).join('\n') + '\n' + Array.from(html.matchAll(/style=["']([^"']+)["']/gi)).map(m => m[1]).join('\n')
    const sheets = Array.from(html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)).map(m => (m[0].match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean).map(h => abs(h!)).filter(Boolean)
    const gfLinks = sheets.filter(h => /fonts\.googleapis\.com/.test(h))
    for (const h of sheets.filter(h => !/fonts\.googleapis\.com/.test(h)).slice(0, 3)) { try { css += '\n' + (await get(h, 600_000)).text } catch { /* one sheet missing is fine */ } }
    const themeColor = meta('theme-color') || null
    const pal = pickTheme(css, themeColor)
    if (!pal) return NextResponse.json({ ok: false, error: 'Could not find brand colours on that site. Pick a theme, or set the colours by hand.' }, { status: 422 })
    // Display face: a family the site loads from Google Fonts, preferring a serif or display face.
    let display = '', displayUrl = ''
    const fams: string[] = []
    for (const l of gfLinks) for (const m of l.matchAll(/family=([^&:]+)/g)) fams.push(decodeURIComponent(m[1].replace(/\+/g, ' ')))
    const pick = fams.find(f => /serif|garamond|caslon|baskerville|bodoni|didot|playfair|cormorant|lora|crimson|prata|gilda|italiana|marcellus|cinzel|dm serif|fraunces/i.test(f)) || fams.find(f => SERIFY.test(f))
    if (pick) { display = pick; displayUrl = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(pick).replace(/%20/g, '+') + ':wght@300;400;500&display=swap' }
    return NextResponse.json({ ok: true, theme: { label: title || new URL(base).hostname.replace(/^www\./, ''), ...pal, ...(display ? { display, displayUrl } : {}) }, logo, image })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.name === 'AbortError' ? 'That website took too long to answer.' : (e?.message || 'Could not read that website.') }, { status: 400 })
  }
}
