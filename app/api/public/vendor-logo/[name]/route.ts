// THE VENDOR LOGOS ON THE ONBOARDING DECK (Jon, 2026-09-24: "work on logos, please").
//
// Each mark is read off the company's own website and served from our origin, so the deck never
// hotlinks a file that can move, block us, or render as an empty tile (the Guesty icon did):
//   Guesty, PriceLabs  their header wordmark, an inline <svg> on the home page, found by its
//                      aria-label ("Guesty Logo", "PriceLabs Logo")
//   Breezeway, Pacer   the SVG file each publishes; Pacer's "light" file is drawn for dark
//                      backgrounds, so its white lettering is recoloured to ink for our slides
//
// The result is cleaned (no scripts, no event handlers, no classes or inline styles on the root),
// given an intrinsic size from its viewBox so an <img> can scale it, and cached at the CDN for a
// month. If a vendor redesigns and the mark cannot be found, this returns 404 and the deck's
// StackMark falls back to its monogram tile — never a broken image.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Src = { page?: string; label?: string; file?: string; color?: string; swap?: [string, string][] }
const SRC: Record<string, Src> = {
  guesty: { page: 'https://www.guesty.com/', label: 'Guesty Logo', color: '#357969' },
  pricelabs: { page: 'https://hello.pricelabs.co/', label: 'PriceLabs Logo' },
  breezeway: { file: 'https://www.breezeway.io/hubfs/breezeway_logo.svg.svg' },
  pacer: { file: 'https://www.pacerrev.com/logos/pacer-main-light.svg', swap: [['fill: #fff;', 'fill: #1d2433;']] },
}

function clean(svg: string, src: Src): string | null {
  let s = svg.replace(/<\?xml[^>]*>/g, '').trim()
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
  s = s.replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
  // the root tag: drop page-specific class/style, make sure it is a standalone document
  s = s.replace(/^<svg([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs.replace(/\s(class|style)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    if (!/\sxmlns=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"'
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(a)
    a = a.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    if (vb) a += ` width="${vb[1]}" height="${vb[2]}"`
    return '<svg' + a + '>'
  })
  if (src.color) s = s.replace(/currentColor/g, src.color)
  for (const [a, b] of src.swap || []) s = s.split(a).join(b)
  return s
}

async function get(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
      next: { revalidate: 60 * 60 * 24 * 7 },
    })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const src = SRC[String(params.name || '').toLowerCase()]
  if (!src) return new NextResponse('not found', { status: 404 })
  let raw: string | null = null
  if (src.file) raw = await get(src.file)
  else if (src.page && src.label) {
    const html = await get(src.page)
    if (html) {
      const at = html.indexOf('aria-label="' + src.label + '"')
      const start = at >= 0 ? html.lastIndexOf('<svg', at) : -1
      const end = at >= 0 ? html.indexOf('</svg>', at) : -1
      if (start >= 0 && end > start) raw = html.slice(start, end + 6)
    }
  }
  const svg = raw ? clean(raw, src) : null
  if (!svg) return new NextResponse('logo unavailable', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } })
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
