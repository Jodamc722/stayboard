// COLLAGE DETECTION (Jon, 2026-11-03: "don't like collage photos being used"). Captions don't always say
// "collage", so we look at the picture itself: a collage has straight, full-width (or full-height) gutters
// — a thin white or black band with photo content on both sides. Server only (sharp).
import sharp from 'sharp'

const seen = new Map<string, boolean>()

/** Look for straight white/black gutters that split the frame — the signature of a grid or side-by-side. */
export function looksLikeCollage(g: Uint8Array, w: number, h: number): boolean {
  const scan = (n: number, m: number, at: (i: number, j: number) => number, seams: boolean) => {
    // n lines of length m; a gutter line is near-uniform and near white or near black
    const stat = (i: number) => { let s = 0, s2 = 0; for (let j = 0; j < m; j++) { const v = at(i, j); s += v; s2 += v * v } const mean = s / m; return { mean, sd: Math.sqrt(Math.max(0, s2 / m - mean * mean)) } }
    const st = Array.from({ length: n }, (_, i) => stat(i))
    const gutter = st.map(x => x.sd < 5 && (x.mean > 232 || x.mean < 22))
    for (let i = Math.floor(n * 0.15); i < Math.ceil(n * 0.85); i++) {
      if (!gutter[i] || gutter[i - 1]) continue
      let e = i; while (e + 1 < n && gutter[e + 1]) e++
      const len = e - i + 1
      if (len <= Math.max(2, n * 0.04) && e < n * 0.85) {
        const before = st[Math.max(0, i - 3)], after = st[Math.min(n - 1, e + 3)]
        if (before.sd > 18 && after.sd > 18) return true
      }
      i = e
    }
    // photos butted together with no gutter: a straight seam where almost every pixel jumps
    // (only at the halfway line, where side-by-side and stacked pairs split — a shelf or a horizon elsewhere is a real photo)
    for (let i = Math.floor(n * 0.46); seams && i <= Math.ceil(n * 0.54); i++) {
      let big = 0
      for (let j = 0; j < m; j++) if (Math.abs(at(i + 1, j) - at(i - 2, j)) > 28) big++
      if (big > m * 0.8) return true
    }
    return false
  }
  // rows (horizontal gutters) never use the seam test — a horizon at the halfway line is a real photo
  return scan(h, w, (y, x) => g[y * w + x], false) || scan(w, h, (x, y) => g[y * w + x], true)
}

export async function isCollagePhoto(url: string): Promise<boolean> {
  if (!url || url.startsWith('video:') || url.startsWith('/')) return false
  const hit = seen.get(url)
  if (hit !== undefined) return hit
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000)
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm)
    if (!r.ok) { seen.set(url, false); return false }
    const buf = Buffer.from(await r.arrayBuffer())
    const { data, info } = await sharp(buf).resize(360, 360, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true })
    const v = looksLikeCollage(new Uint8Array(data), info.width, info.height)
    seen.set(url, v)
    return v
  } catch { return false }
}

/** Drop collages from a list (checks in parallel, keeps order). */
export async function withoutCollages(urls: string[]): Promise<string[]> {
  const flags = await Promise.all(urls.map(u => isCollagePhoto(u)))
  return urls.filter((_, i) => !flags[i])
}
