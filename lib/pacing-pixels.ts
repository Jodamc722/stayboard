// MEASURE THE PRICELABS CHARTS, DON'T EYEBALL THEM (Jon, 2026-10-06: "the pacing report data is not
// accurate"). The same 17WEST PDF run three times through the vision reader gave market occupancy of
// 63%, 50% and 43% — a model estimating a line's height against an axis is not good enough for an
// owner. The PriceLabs "Pacing vs Market" PDF embeds each chart as a crisp 1800x800 RGB image with
// fixed colours, so the lines can be MEASURED:
//
//   - "Your …" series: solid dark grey  rgb(51,51,51)
//   - "Market …" series: solid red      rgb(230,62,61) — the dash-dot "last year" line is the same red
//     but has gaps, so the solid one is the red path present in every column (traced, not guessed)
//   - light gridlines give the y positions of the printed tick values; short dark tick marks under
//     the x axis give the x positions of the printed dates
//
// The vision model is still used — but only for what it reads reliably: the PRINTED tick labels
// (y values top→bottom, x dates left→right) and which chart is which. Every number on the slide comes
// from pixels. Measured on the 17WEST Oct 1–6 pull: occupancy 75.0% vs 60.8%, ADR $218 vs $206,
// RevPAR $164.5 vs $126.0 — and 75.0% × $218 lands on the PDF's own RevPAR line within a dollar.
//
// No dependencies: the PDF's image XObjects are FlateDecode RGB, which node:zlib inflates.
import { inflateSync } from 'node:zlib'

export type ChartImage = { w: number; h: number; rgb: Uint8Array }
export type ChartLabels = { metric: 'occupancy' | 'adr' | 'revpar' | 'other'; yTicks: number[]; xDates: string[] }
export type MeasuredPoint = { date: string; ours: number; market: number }

/** Every DeviceRGB 8-bit image in the PDF, in object order (page order for react-pdf output). */
export function pdfRgbImages(buf: Buffer): ChartImage[] {
  const s = buf.toString('latin1')
  const out: { obj: number; img: ChartImage }[] = []
  const re = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const dict = m[2]
    if (!/\/Subtype\s*\/Image/.test(dict) || !/\/ColorSpace\s*\/DeviceRGB/.test(dict) || !/\/FlateDecode/.test(dict)) continue
    if (!/\/BitsPerComponent\s+8/.test(dict)) continue
    const w = Number((dict.match(/\/Width\s+(\d+)/) || [])[1]), h = Number((dict.match(/\/Height\s+(\d+)/) || [])[1])
    const len = Number((dict.match(/\/Length\s+(\d+)/) || [])[1])
    if (!(w > 200 && h > 100 && len > 0)) continue
    const start = m.index + m[0].length
    let raw: Buffer
    try { raw = inflateSync(buf.subarray(start, start + len)) } catch { continue }
    const pred = Number((dict.match(/\/Predictor\s+(\d+)/) || [])[1]) || 1
    const rgb = pred >= 10 ? unPng(raw, w, h, 3) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    if (rgb.length < w * h * 3) continue
    out.push({ obj: Number(m[1]), img: { w, h, rgb } })
  }
  return out.sort((a, b) => a.obj - b.obj).map(x => x.img)
}

/** PNG-predictor rows (Predictor ≥ 10) → raw pixels. */
function unPng(raw: Buffer, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp, out = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = y && i >= bpp ? out[dst - stride + i - bpp] : 0
      let v = x
      if (f === 1) v = x + a
      else if (f === 2) v = x + b
      else if (f === 3) v = x + ((a + b) >> 1)
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) }
      out[dst + i] = v & 255
    }
  }
  return out
}

const fit = (xs: number[], ys: number[]) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  const k = den ? num / den : 0
  return (x: number) => my + k * (x - mx)
}
const groups = (idx: number[], gap = 2) => {
  const g: number[][] = []
  for (const i of idx) { if (g.length && i - g[g.length - 1][g[g.length - 1].length - 1] <= gap) g[g.length - 1].push(i); else g.push([i]) }
  return g
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const dayNum = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000)

/**
 * Read one chart: our line and the solid market line at every day from `from` to `to` (inclusive).
 * Returns null when anything needed to calibrate is missing — a missing reading, never a guessed one.
 */
export function measureChart(img: ChartImage, labels: ChartLabels, from: string, to: string): MeasuredPoint[] | null {
  const { w: W, h: H, rgb } = img
  const px = (x: number, y: number) => { const i = (y * W + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]] }
  const isBlack = (x: number, y: number) => { const [r, g, b] = px(x, y); return Math.abs(r - 51) < 9 && Math.abs(g - 51) < 9 && Math.abs(b - 51) < 9 }
  const isRed = (x: number, y: number) => { const [r, g, b] = px(x, y); return Math.abs(r - 230) < 14 && Math.abs(g - 62) < 22 && Math.abs(b - 61) < 22 }
  const isLight = (x: number, y: number) => { const [r, g, b] = px(x, y); return r > 200 && r < 245 && Math.abs(r - g) < 4 && Math.abs(g - b) < 4 }
  const isDark = (x: number, y: number) => { const [r, g, b] = px(x, y); return r + g + b < 450 }

  // x axis: the first long dark row; gridlines: long light rows above it.
  let axisY = -1
  for (let y = Math.floor(H * 0.3); y < H && axisY < 0; y++) { let n = 0; for (let x = 0; x < W; x++) if (isDark(x, y)) n++; if (n > W * 0.5) axisY = y }
  if (axisY < 0) return null
  const lightRows: number[] = []
  for (let y = 0; y < axisY - 2; y++) { let n = 0; for (let x = 0; x < W; x++) if (isLight(x, y)) n++; if (n > W * 0.5) lightRows.push(y) }
  const grid = groups(lightRows).map(g => mean(g))
  const yt = (labels.yTicks || []).filter(v => isFinite(v))
  // Pair printed ticks (top→bottom) with gridlines (top→bottom); the 0 tick sits on the axis.
  const gy: number[] = [], gv: number[] = []
  for (let i = 0; i < yt.length; i++) {
    if (i < grid.length) { gy.push(grid[i]); gv.push(yt[i]) }
    else if (yt[i] === 0) { gy.push(axisY); gv.push(0) }
  }
  if (gy.length < 2) return null
  const valueAt = fit(gy, gv)

  // x ticks: short dark marks just under the axis; keep the evenly spaced run that matches the dates.
  const tickCols: number[] = []
  for (let x = 0; x < W; x++) { let n = 0; for (let y = axisY + 2; y < Math.min(H, axisY + 10); y++) if (isDark(x, y)) n++; if (n >= 4) tickCols.push(x) }
  const ticks = groups(tickCols).map(g => mean(g))
  const dates = (labels.xDates || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (dates.length < 2 || ticks.length < dates.length) return null
  let run: number[] | null = null
  for (let i = ticks.length - dates.length; i >= 0 && !run; i--) {
    const c = ticks.slice(i, i + dates.length), sp = c.slice(1).map((v, k) => v - c[k])
    if (sp.every(v => Math.abs(v - sp[0]) <= 4)) run = c
  }
  if (!run) return null
  const xAt = fit(dates.map(dayNum), run)

  const top = Math.max(0, Math.floor(Math.min(...grid, axisY) - 4)), bot = axisY - 1
  const runsAt = (x: number, test: (x: number, y: number) => boolean) => {
    const ys: number[] = []
    for (let y = top; y <= bot; y++) if (test(x, y)) ys.push(y)
    return groups(ys).filter(g => g.length >= 2).map(g => mean(g))
  }
  const d0 = dayNum(from), d1 = dayNum(to)
  const c0 = Math.round(xAt(d0)), c1 = Math.round(xAt(d1))
  if (!(c0 >= 0 && c1 < W && c1 > c0)) return null

  // Solid market line: of the red paths at the window's first column, the one present in every column.
  let best: { hits: number; path: Map<number, number> } | null = null
  for (const y0 of runsAt(c0, isRed)) {
    let y = y0, hits = 0
    const path = new Map<number, number>()
    for (let x = c0; x <= c1; x++) {
      const near = runsAt(x, isRed).filter(q => Math.abs(q - y) <= 4)
      if (near.length) { y = near.sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0]; hits++; path.set(x, y) }
    }
    if (!best || hits > best.hits) best = { hits, path }
  }
  if (!best || best.hits < (c1 - c0 + 1) * 0.95) return null   // not a solid line all the way: don't trust it

  const out: MeasuredPoint[] = []
  for (let d = d0; d <= d1; d++) {
    const x = Math.round(xAt(d))
    const b = runsAt(x, isBlack)
    let ry = best.path.get(x)
    for (let k = 1; ry == null && k <= 3; k++) ry = best.path.get(x - k) ?? best.path.get(x + k)
    if (b.length !== 1 || ry == null) continue   // ambiguous column: skip the day rather than guess
    const iso = new Date(d * 86400000).toISOString().slice(0, 10)
    out.push({ date: iso, ours: Math.round(valueAt(b[0]) * 10) / 10, market: Math.round(valueAt(ry) * 10) / 10 })
  }
  return out.length >= 2 ? out : null
}

/** Measure every labelled chart; occupancy / adr / revpar series ready for seriesRows/crossCheckAdr. */
export function measurePacingPdf(buf: Buffer, charts: ChartLabels[], from: string, to: string): { occupancy?: MeasuredPoint[]; adr?: MeasuredPoint[]; revpar?: MeasuredPoint[] } | null {
  const imgs = pdfRgbImages(buf)
  if (!imgs.length || !Array.isArray(charts) || !charts.length) return null
  const out: { occupancy?: MeasuredPoint[]; adr?: MeasuredPoint[]; revpar?: MeasuredPoint[] } = {}
  for (let i = 0; i < Math.min(imgs.length, charts.length); i++) {
    const lab = charts[i]
    if (!lab || (lab.metric !== 'occupancy' && lab.metric !== 'adr' && lab.metric !== 'revpar') || out[lab.metric]) continue
    try { const pts = measureChart(imgs[i], lab, from, to); if (pts) out[lab.metric] = pts } catch { /* one chart failing never sinks the others */ }
  }
  return out.occupancy || out.adr ? out : null
}
