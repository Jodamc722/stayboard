// SIGNATURE — the house's premium ad design (Jon, 2026-11-12: "I would rate the ads 1/10 … our ad generation
// should be world class"). One disciplined system instead of thirty-odd scene kinds, twenty transitions and
// stickers: what makes hospitality advertising feel expensive is restraint, so every ad in this look gets
//   · one type pairing — a high-contrast serif for what we say, a tracked sans for labels and detail
//   · photos treated like film — a slow push, a warm grade, a soft vignette and fine grain
//   · type that is set, not stamped — each line rises out of its own mask, rules draw themselves on
//   · one transition — the next frame wipes up from below while the last one settles back
//   · six layouts the scene's content picks for itself: hero, list, numbers, gallery, quote, end card
// Every scene kind maps onto one of the six, so any ad (written, templated or revamped) can wear it.
// Client-safe; drawn by drawFrame when the project's look is 'signature'.
import type { AdProject, AdAssets, Timeline, AdScene } from './ad-engine'
import { qrModules, sceneAt, captionText } from './ad-engine'

const INK = '#F7F2E9', MUT = 'rgba(247,242,233,0.72)', GOLD = '#D4B47C', NIGHT = '#0E0F11', NIGHT2 = '#16181B'
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const outExpo = (x: number) => { x = clamp(x); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x) }
const inOut = (x: number) => { x = clamp(x); return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2 }
const outCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3)

type Ctx = CanvasRenderingContext2D
type Env = { W: number; H: number; u: number; port: boolean; M: number; top: number; bot: number; serif: string; sans: string; A: AdAssets; p: AdProject; t: number }

// ── the scene's content decides its layout ───────────────────────────────────────────────────────
export type SigLayout = 'hero' | 'list' | 'numbers' | 'gallery' | 'quote' | 'end'
const NUMERIC = /^\s*[$€£]?\d[\d,.]*\s*(%|\+|x|k|m|★)?\s*\|/i
export function layoutOf(sc: AdScene): SigLayout {
  const k = sc.kind
  if (k === 'cta' || k === 'contact') return 'end'
  if (k === 'quote') return 'quote'
  const items = (sc.items || []).filter(x => x && x.trim())
  if (k === 'stats' || k === 'curve' || (items.length && items.every(x => NUMERIC.test(x)))) return items.length ? 'numbers' : 'hero'
  if (items.length && !(k === 'poster' || k === 'event')) return 'list'
  if ((k === 'wall' || k === 'grid' || k === 'tilegrid' || k === 'polaroid' || k === 'tiles') || sc.photos.filter(Boolean).length >= 3) return 'gallery'
  return 'hero'
}

// ── film treatment ───────────────────────────────────────────────────────────────────────────────
let _grain: HTMLCanvasElement | null = null
function grain(ctx: Ctx, e: Env) {
  if (typeof document === 'undefined') return
  if (!_grain) {
    _grain = document.createElement('canvas'); _grain.width = _grain.height = 256
    const g = _grain.getContext('2d')!, d = g.createImageData(256, 256)
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 }
    g.putImageData(d, 0, 0)
  }
  const f = Math.floor(e.t * 24), ox = (f * 73) % 256, oy = (f * 151) % 256
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07
  const s = Math.max(1, Math.round(e.u * 1.6))
  ctx.translate(-ox * s, -oy * s); ctx.scale(s, s)
  const pat = ctx.createPattern(_grain, 'repeat'); if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, e.W / s + 512, e.H / s + 512) }
  ctx.restore()
}
function vignette(ctx: Ctx, e: Env, k = 0.55) {
  const g = ctx.createRadialGradient(e.W / 2, e.H / 2, Math.min(e.W, e.H) * 0.35, e.W / 2, e.H / 2, Math.hypot(e.W, e.H) * 0.62)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${k})`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, e.W, e.H)
}
/** A photo, cover-fitted into a box, on a slow push that alternates direction scene to scene; graded warm. */
function photo(ctx: Ctx, img: CanvasImageSource | null, x: number, y: number, w: number, h: number, local: number, dur: number, seed: number, push = 1) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.fillStyle = NIGHT2; ctx.fillRect(x, y, w, h)
  const iw = (img as any)?.naturalWidth || (img as any)?.videoWidth || (img as any)?.width || 0
  const ih = (img as any)?.naturalHeight || (img as any)?.videoHeight || (img as any)?.height || 0
  if (img && iw && ih) {
    const q = clamp(local / Math.max(1, dur + 0.6))
    const z = 1.04 + 0.085 * q * push
    const s = Math.max(w / iw, h / ih) * z
    const dir = seed % 4
    const px = (dir === 0 ? -1 : dir === 1 ? 1 : 0) * 0.025 * w * q, py = (dir === 2 ? -1 : dir === 3 ? 1 : 0) * 0.02 * h * q
    ctx.drawImage(img, x + (w - iw * s) / 2 + px, y + (h - ih * s) / 2 + py, iw * s, ih * s)
    // the grade: lifted warm shadows, a touch of contrast — reads as one shoot across every listing photo
    ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,196,140,0.22)'; ctx.fillRect(x, y, w, h)
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(244,238,230,1)'; ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}
function shade(ctx: Ctx, x: number, y0: number, y1: number, w: number, a0: number, a1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  g.addColorStop(0, `rgba(8,8,9,${a0})`); g.addColorStop(1, `rgba(8,8,9,${a1})`)
  ctx.fillStyle = g; ctx.fillRect(x, Math.min(y0, y1), w, Math.abs(y1 - y0))
}

// ── type ─────────────────────────────────────────────────────────────────────────────────────────
type Tok = { t: string; gold: boolean }
function tokens(line: string): Tok[] {
  const out: Tok[] = []; let gold = false
  for (const part of line.split('**')) { for (const w of part.split(/\s+/).filter(Boolean)) out.push({ t: w, gold }); gold = !gold }
  return out
}
/** Wrap into lines (respecting forced breaks), measured in the current font. */
function wrap(ctx: Ctx, text: string, maxW: number): Tok[][] {
  const lines: Tok[][] = []
  for (const para of String(text || '').split('\n')) {
    let cur: Tok[] = []
    for (const tk of tokens(para)) {
      const trial = [...cur, tk].map(x => x.t).join(' ')
      if (cur.length && ctx.measureText(trial).width > maxW) { lines.push(cur); cur = [tk] } else cur.push(tk)
    }
    if (cur.length) lines.push(cur)
  }
  return lines
}
/** The biggest size (≤ max) at which the text fits the width in at most maxLines lines. */
function fit(ctx: Ctx, text: string, maxW: number, max: number, maxLines: number, font: (s: number) => string): number {
  // The writer's line breaks are the design: shrink (to a point) before breaking a line they set.
  const forced = String(text || '').split('\n').length
  if (forced > 1) {
    let s = max
    for (let k = 0; k < 12; k++) { ctx.font = font(s); if (wrap(ctx, text, maxW).length <= forced) return s; s *= 0.95 }
  }
  let s = max
  for (let k = 0; k < 40; k++) {
    ctx.font = font(s)
    const ls = wrap(ctx, text, maxW)
    const widest = Math.max(0, ...ls.map(l => ctx.measureText(l.map(x => x.t).join(' ')).width))
    if (ls.length <= maxLines && widest <= maxW) return s
    s *= 0.93
  }
  return s
}
/** Set type: every line rises out of its own mask, staggered. Returns the block's height. */
function setLines(ctx: Ctx, e: Env, text: string, x: number, y: number, maxW: number, size: number, o: { font: string; weight: number; color?: string; local: number; delay?: number; align?: 'left' | 'center'; lh?: number; stagger?: number; measureOnly?: boolean }): number {
  const lh = o.lh ?? 1.02
  ctx.font = `${o.weight} ${size}px ${o.font}`
  const lines = wrap(ctx, text, maxW)
  if (o.measureOnly) return lines.length * size * lh
  ctx.textBaseline = 'alphabetic'
  lines.forEach((ln, k) => {
    const q = outExpo((o.local - (o.delay || 0) - k * (o.stagger ?? 0.09)) / 0.95)
    if (q <= 0) return
    const str = ln.map(w => w.t).join(' ')
    const lw = ctx.measureText(str).width
    const lx = o.align === 'center' ? x + (maxW - lw) / 2 : x
    const top = y + k * size * lh, base = top + size * 0.86
    ctx.save(); ctx.beginPath(); ctx.rect(lx - size * 0.2, top - size * 0.12, lw + size * 0.4, size * lh + size * 0.24); ctx.clip()
    let cx = lx; const dy = (1 - q) * size * 1.1
    const sp = ctx.measureText(' ').width
    for (const w of ln) { ctx.fillStyle = w.gold ? GOLD : (o.color || INK); ctx.fillText(w.t, cx, base + dy); cx += ctx.measureText(w.t).width + sp }
    ctx.restore()
  })
  return lines.length * size * lh
}
/** A small tracked uppercase label that fades up. */
function label(ctx: Ctx, e: Env, text: string, x: number, y: number, size: number, local: number, delay: number, o: { color?: string; align?: 'left' | 'center' | 'right'; weight?: number; track?: number } = {}): number {
  const s = String(text || '').toUpperCase(); if (!s) return 0
  const a = outCubic((local - delay) / 0.6); if (a <= 0) return 0
  ctx.save(); ctx.globalAlpha *= a
  ctx.font = `${o.weight || 600} ${size}px ${e.sans}`; ctx.textBaseline = 'alphabetic'
  const tr = (o.track ?? 0.24) * size
  try { (ctx as any).letterSpacing = tr + 'px' } catch { /* */ }
  const w = ctx.measureText(s).width
  const lx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
  ctx.fillStyle = o.color || INK; ctx.fillText(s, lx, y + (1 - a) * 10 * e.u)
  ctx.restore()
  return w
}
/** A hairline that draws itself on. */
function rule(ctx: Ctx, x: number, y: number, len: number, local: number, delay: number, color = GOLD, wpx = 2, dur = 0.8) {
  const q = inOut((local - delay) / dur); if (q <= 0) return
  ctx.save(); ctx.fillStyle = color; ctx.fillRect(x, y, len * q, wpx); ctx.restore()
}
const strip = (s: string) => String(s || '').replace(/\*\*/g, '')
const split = (row: string): [string, string] => { const i = row.indexOf('|'); return i < 0 ? [row.trim(), ''] : [row.slice(0, i).trim(), row.slice(i + 1).trim()] }
const pad2 = (n: number) => String(n).padStart(2, '0')

// ── the layouts ──────────────────────────────────────────────────────────────────────────────────
type Get = (u: string) => HTMLImageElement | HTMLVideoElement | null

function hero(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  if (img) {
    photo(ctx, img, 0, 0, W, H, local, dur, i)
    shade(ctx, 0, 0, H * 0.3, W, 0.42, 0)
    shade(ctx, 0, H * (port ? 0.36 : 0.3), H, W, 0, 0.92)
  } else { ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H); glow(ctx, e, local) }
  const head = sc.head || strip(sc.vo)
  const center = !img
  const maxW = W - 2 * M - (port ? 0 : W * 0.3)
  const serifF = (s: number) => `600 ${s}px ${e.serif}`
  const size = fit(ctx, head, maxW, (port ? 150 : 132) * u, port ? 4 : 3, serifF)
  const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true })
  const sub = sc.sub && sc.sub !== sc.eyebrow ? sc.sub : ''
  const subSize = (port ? 36 : 30) * u
  ctx.font = `400 ${subSize}px ${e.sans}`
  const subH = sub ? wrap(ctx, sub, maxW * 0.9).length * subSize * 1.35 + 26 * u : 0
  const tag = sc.eyebrow || ''
  const blockH = 70 * u + hh + subH
  const y0 = center ? (H - blockH) / 2 : H - e.bot - blockH
  const x0 = center ? (W - maxW) / 2 : M
  // eyebrow row: index · rule · tag
  const idx = pad2(i + 1)
  const lw = label(ctx, e, idx, center ? W / 2 - (tag ? 120 * u : 0) : x0, y0 + 24 * u, 22 * u, local, 0.05, { color: GOLD, weight: 700, align: center && !tag ? 'center' : 'left' })
  if (tag) { rule(ctx, (center ? W / 2 - 120 * u : x0) + lw + 18 * u, y0 + 16 * u, 56 * u, local, 0.15); label(ctx, e, tag, (center ? W / 2 - 120 * u : x0) + lw + 92 * u, y0 + 24 * u, 22 * u, local, 0.3) }
  setLines(ctx, e, head, x0, y0 + 70 * u, maxW, size, { font: e.serif, weight: 600, local, delay: 0.12, align: center ? 'center' : 'left' })
  if (sub) {
    const a = outCubic((local - 0.75) / 0.7)
    ctx.save(); ctx.globalAlpha *= a; ctx.font = `400 ${subSize}px ${e.sans}`; ctx.fillStyle = MUT
    wrap(ctx, sub, maxW * 0.9).forEach((ln, k) => { const s = ln.map(w => w.t).join(' '); const w = ctx.measureText(s).width; ctx.fillText(s, center ? (W - w) / 2 : x0, y0 + 70 * u + hh + 26 * u + subSize + k * subSize * 1.35 + (1 - a) * 12 * u) })
    ctx.restore()
  }
}

function glow(ctx: Ctx, e: Env, local: number) {
  const g = ctx.createRadialGradient(e.W * (0.3 + 0.05 * Math.sin(local * 0.4)), e.H * 0.25, 0, e.W * 0.3, e.H * 0.25, Math.max(e.W, e.H) * 0.9)
  g.addColorStop(0, 'rgba(212,180,124,0.20)'); g.addColorStop(0.5, 'rgba(212,180,124,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, e.W, e.H)
}

function list(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  const items = (sc.items || []).filter(x => x && x.trim()).slice(0, 4)
  // the photo panel and the type panel; the seam is a gold rule that draws across
  let px = 0, py = 0, pw = W, ph = H, tx = M, ty = 0, tw = W - 2 * M, tb = H - e.bot
  if (img) {
    if (port) { ph = H * (items.length > 3 ? 0.44 : 0.5); ty = ph + 74 * u }
    else { px = W * 0.5; pw = W * 0.5; tw = W * 0.5 - 2 * M; ty = e.top + 30 * u }
    ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
    const reveal = outExpo(local / 1.1)
    ctx.save(); ctx.beginPath()
    if (port) ctx.rect(0, 0, W, ph * reveal); else ctx.rect(px + pw * (1 - reveal), 0, pw * reveal, H)
    ctx.clip(); photo(ctx, img, px, py, pw, ph, local, dur, i); if (port) shade(ctx, 0, 0, ph * 0.35, W, 0.4, 0); ctx.restore()
    if (port) rule(ctx, 0, ph - 1 * u, W, local, 0.3, GOLD, 3 * u, 1.0); else ctx.fillRect(0, 0, 0, 0)
  } else { ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H); glow(ctx, e, local); ty = e.top + 90 * u }
  let y = ty
  const head = sc.head.trim()
  if (head) {
    const size = fit(ctx, head, tw, (port ? 92 : 84) * u, 2, s => `600 ${s}px ${e.serif}`)
    y += setLines(ctx, e, head, tx, y, tw, size, { font: e.serif, weight: 600, local, delay: 0.2 }) + 40 * u
  }
  // the rows share what is left above the bottom margin
  const room = tb - y, n = Math.max(1, items.length)
  const rowH = Math.min((port ? 230 : 180) * u, room / n)
  const tS = Math.min((port ? 50 : 40) * u, rowH * 0.3), dS = tS * 0.74
  items.forEach((row, k) => {
    const [t1, t2] = split(row)
    const d = 0.45 + k * 0.22, ry = y + k * rowH
    rule(ctx, tx, ry, tw, local, d - 0.1, 'rgba(247,242,233,0.18)', 1.5 * u, 0.9)
    label(ctx, e, pad2(k + 1), tx, ry + 22 * u + tS, 22 * u, local, d, { color: GOLD, weight: 700 })
    const cx = tx + 88 * u, cw = tw - 88 * u
    setLines(ctx, e, strip(t1), cx, ry + 22 * u, cw, tS, { font: e.sans, weight: 600, local, delay: d, lh: 1.2 })
    if (t2) {
      const a = outCubic((local - d - 0.25) / 0.6)
      ctx.save(); ctx.globalAlpha *= a; ctx.font = `400 ${dS}px ${e.sans}`; ctx.fillStyle = MUT
      const ln = wrap(ctx, strip(t2), cw)[0]; if (ln) ctx.fillText(ln.map(w => w.t).join(' ') + (wrap(ctx, strip(t2), cw).length > 1 ? '…' : ''), cx, ry + 22 * u + tS * 1.25 + dS * 1.15)
      ctx.restore()
    }
  })
}

function numbers(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
  if (img) { ctx.save(); ctx.globalAlpha *= 0.32; photo(ctx, img, 0, 0, W, H, local, dur, i); ctx.restore(); shade(ctx, 0, 0, H, W, 0.35, 0.8) } else glow(ctx, e, local)
  const items = (sc.items || []).filter(x => x && x.trim()).slice(0, 3)
  let y = e.top + 40 * u
  const head = sc.head.trim()
  if (head) { const size = fit(ctx, head, W - 2 * M, (port ? 84 : 72) * u, 2, s => `600 ${s}px ${e.serif}`); y += setLines(ctx, e, head, M, y, W - 2 * M, size, { font: e.serif, weight: 600, local, delay: 0.05 }) + 30 * u }
  const n = Math.max(1, items.length)
  const cols = port ? 1 : n, rows = port ? n : 1
  const cw = (W - 2 * M) / cols, rh = (H - e.bot - y) / rows
  items.forEach((row, k) => {
    const [num, lab] = split(row)
    const m = num.match(/^([^\d]*)([\d,.]+)(.*)$/)
    const d = 0.25 + k * 0.25
    const q = outExpo((local - d) / 1.6)
    let shown = num
    if (m) { const target = Number(m[2].replace(/,/g, '')); const dec = (m[2].split('.')[1] || '').length; const v = target * q; shown = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US')) + m[3] }
    const cx = M + (port ? 0 : k * cw), cy = y + (port ? k * rh : 0)
    rule(ctx, cx, cy, (port ? W - 2 * M : cw - 40 * u), local, d - 0.15, 'rgba(212,180,124,0.6)', 2 * u)
    const ns = Math.min((port ? 210 : 190) * u, (port ? rh * 0.62 : rh * 0.45))
    if (q > 0) { ctx.save(); ctx.globalAlpha *= clamp(q * 3); ctx.font = `600 ${ns}px ${e.serif}`; ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic'; ctx.fillText(shown, cx, cy + 24 * u + ns * 0.9); ctx.restore() }
    label(ctx, e, strip(lab), cx, cy + 24 * u + ns * 1.08 + 40 * u, 24 * u, local, d + 0.4, { color: MUT })
  })
}

function gallery(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
  const ph = sc.photos.filter(Boolean).slice(0, 3)
  const n = Math.max(1, ph.length), gap = 10 * u
  for (let k = 0; k < n; k++) {
    const r = outExpo((local - k * 0.16) / 1.0)
    if (r <= 0) continue
    const img = get(ph[k])
    if (port) { const bh = (H - gap * (n - 1)) / n, y = k * (bh + gap); ctx.save(); ctx.beginPath(); ctx.rect(0, y, W * r, bh); ctx.clip(); photo(ctx, img, 0, y, W, bh, local, dur, i + k, 0.8); ctx.restore() }
    else { const bw = (W - gap * (n - 1)) / n, x = k * (bw + gap); ctx.save(); ctx.beginPath(); ctx.rect(x, H * (1 - r), bw, H * r); ctx.clip(); photo(ctx, img, x, 0, bw, H, local, dur, i + k, 0.8); ctx.restore() }
  }
  shade(ctx, 0, H * 0.5, H, W, 0, 0.85)
  const head = sc.head || strip(sc.vo)
  if (head) {
    const maxW = W - 2 * M
    const size = fit(ctx, head, maxW, (port ? 120 : 110) * u, 3, s => `600 ${s}px ${e.serif}`)
    const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true })
    const y0 = H - e.bot - hh
    label(ctx, e, sc.eyebrow || pad2(i + 1), M, y0 - 30 * u, 22 * u, local, 0.45, { color: GOLD, weight: 700 })
    setLines(ctx, e, head, M, y0, maxW, size, { font: e.serif, weight: 600, local, delay: 0.5 })
  }
}

function quote(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
  if (img) { ctx.save(); ctx.globalAlpha *= 0.28; photo(ctx, img, 0, 0, W, H, local, dur, i); ctx.restore() } else glow(ctx, e, local)
  const text = sc.head || strip(sc.vo)
  const maxW = W - 2 * M
  const size = fit(ctx, text, maxW, (port ? 92 : 80) * u, port ? 7 : 4, s => `600 ${s}px ${e.serif}`)
  const hh = setLines(ctx, e, text, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true, lh: 1.12 })
  const y0 = (H - hh) / 2
  const a = outCubic(local / 0.8)
  ctx.save(); ctx.globalAlpha *= a; ctx.font = `600 ${size * 2.6}px ${e.serif}`; ctx.fillStyle = GOLD; ctx.fillText('“', M - size * 0.1, y0 + size * 0.9); ctx.restore()
  setLines(ctx, e, text, M, y0 + size * 0.7, maxW, size, { font: e.serif, weight: 600, local, delay: 0.2, lh: 1.12, stagger: 0.12 })
  const who = sc.sub || (sc.items || [])[0] || ''
  if (who) { rule(ctx, M, y0 + size * 0.7 + hh + 50 * u, 60 * u, local, 0.9); label(ctx, e, strip(who), M + 84 * u, y0 + size * 0.7 + hh + 58 * u, 22 * u, local, 1.0, { color: MUT }) }
}

function endCard(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port, A, p } = e
  const img = get(sc.photos[0] || '')
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
  if (img) { ctx.save(); ctx.globalAlpha *= 0.34; photo(ctx, img, 0, 0, W, H, local, dur + 4, i, 0.6); ctx.restore(); shade(ctx, 0, 0, H, W, 0.25, 0.75) } else glow(ctx, e, local)
  const qr = (sc.qr || '').trim()
  const logo = (A.logos && A.logos.white) || A.logo
  // the stack: mark, headline, line, call to action, address — and the code when there is one
  const maxW = W - 2 * M
  const head = sc.head || 'Book your **stay.**'
  const size = fit(ctx, head, maxW, (port ? 132 : 110) * u, 3, s => `600 ${s}px ${e.serif}`)
  const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true })
  const qS = qr ? Math.min(W, H) * (port ? 0.3 : 0.26) : 0
  const sub = sc.sub || ''
  const cta = (sc.items || [])[0] || (sc.kind === 'contact' || qr ? '' : 'stay-hospitality.com')
  const contactLines = sc.kind === 'contact' ? [p.contact?.name, p.contact?.role, p.contact?.phone, p.contact?.email].filter(Boolean) as string[] : []
  const lgW = 190 * u, lgH = logo ? lgW * ((logo as any).naturalHeight || 106) / ((logo as any).naturalWidth || 222) : 0
  const blocks = [lgH + 70 * u, hh, sub ? 96 * u : 0, cta ? 120 * u : 0, contactLines.length * 46 * u + (contactLines.length ? 30 * u : 0), qr ? qS + 90 * u : 0]
  const total = blocks.reduce((a, b) => a + b, 0)
  let y = Math.max(e.top, (H - total) / 2)
  if (logo) { const a = outCubic(local / 0.8); ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(logo as any, (W - lgW) / 2, y + (1 - a) * 14 * u, lgW, lgH); ctx.restore() }
  y += blocks[0]
  setLines(ctx, e, head, M, y, maxW, size, { font: e.serif, weight: 600, local, delay: 0.25, align: 'center' })
  y += hh
  if (sub) { const a = outCubic((local - 0.7) / 0.6); ctx.save(); ctx.globalAlpha *= a; ctx.font = `400 ${34 * u}px ${e.sans}`; ctx.fillStyle = MUT; const w = ctx.measureText(sub).width; ctx.fillText(sub, (W - Math.min(w, maxW)) / 2, y + 66 * u, maxW); ctx.restore(); y += 96 * u }
  if (cta) {
    const a = outCubic((local - 0.95) / 0.6)
    if (a > 0) {
      ctx.save(); ctx.globalAlpha *= a; ctx.font = `600 ${26 * u}px ${e.sans}`; try { (ctx as any).letterSpacing = 26 * 0.2 * u + 'px' } catch { /* */ }
      const s = strip(cta).toUpperCase(), tw = ctx.measureText(s).width, bw = tw + 80 * u, bh = 78 * u, bx = (W - bw) / 2, by = y + 30 * u
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, bh / 2) : ctx.rect(bx, by, bw, bh)
      ctx.fillStyle = GOLD; ctx.fill(); ctx.fillStyle = NIGHT; ctx.textBaseline = 'middle'; ctx.fillText(s, bx + 40 * u, by + bh / 2 + 1 * u)
      ctx.restore()
    }
    y += 120 * u
  }
  contactLines.forEach((ln, k) => { label(ctx, e, ln, W / 2, y + 30 * u + k * 46 * u, (k === 0 ? 28 : 24) * u, local, 0.9 + k * 0.1, { align: 'center', color: k === 0 ? INK : MUT, track: k >= 2 ? 0.04 : 0.2 }) })
  if (contactLines.length) y += contactLines.length * 46 * u + 30 * u
  if (qr) {
    const a = outExpo((local - 1.1) / 0.9)
    if (a > 0) {
      const mods = qrModules(qr), n = mods.length, quiet = 4, cell = qS / (n + quiet * 2)
      const tile = cell * (n + quiet * 2), tx = (W - tile) / 2, ty = y + 40 * u
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 20 * u)
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(tx, ty, tile, tile, 18 * u) : ctx.rect(tx, ty, tile, tile); ctx.fill()
      ctx.fillStyle = '#111111'
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mods[r][c]) ctx.fillRect(Math.floor(tx + (c + quiet) * cell), Math.floor(ty + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell))
      ctx.restore()
      label(ctx, e, sc.qrLabel || 'Scan to try it free', W / 2, ty + tile + 52 * u, 22 * u, local, 1.4, { align: 'center', color: GOLD, weight: 700 })
    }
  }
}

function drawSig(ctx: Ctx, e: Env, i: number, local0: number, dur: number) {
  const sc = e.p.scenes[i]
  // After a wipe the type waits for the frame to land, so nothing is caught half-set mid-transition.
  const local = local0 - (i > 0 ? TR * 0.7 : 0)
  const A = e.A
  const get: Get = (url: string) => (!url ? null : A.media ? (A.media(url, local) as any) : A.img(url))
  const L = layoutOf(sc)
  if (L === 'end') endCard(ctx, e, sc, i, local, dur, get)
  else if (L === 'list') list(ctx, e, sc, i, local, dur, get)
  else if (L === 'numbers') numbers(ctx, e, sc, i, local, dur, get)
  else if (L === 'gallery') gallery(ctx, e, sc, i, local, dur, get)
  else if (L === 'quote') quote(ctx, e, sc, i, local, dur, get)
  else hero(ctx, e, sc, i, local, dur, get)
}

/** Where the platform's buttons and captions sit, so type never lands under them. */
function frameEnv(ctx: Ctx, p: AdProject, t: number, A: AdAssets): Env {
  const W = ctx.canvas.width, H = ctx.canvas.height, u = Math.min(W, H) / 1080, port = H > W * 1.1
  return { W, H, u, port, M: (port ? 84 : 110) * u, top: (port ? 200 : 110) * u, bot: (port ? (p.captions ? 380 : 300) : (p.captions ? 190 : 120)) * u, serif: A.elegant || A.serif || 'Georgia, serif', sans: A.body, A, p, t }
}

const TR = 0.62   // the one transition's length
export function drawSignatureFrame(ctx: Ctx, p: AdProject, tl: Timeline, t: number, A: AdAssets) {
  const e = frameEnv(ctx, p, t, A)
  const { W, H, u } = e
  ctx.save()
  ctx.imageSmoothingEnabled = true; try { (ctx as any).imageSmoothingQuality = 'high' } catch { /* */ }
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H)
  if (!p.scenes.length) { ctx.restore(); return }
  const i = sceneAt(tl, t), local = t - tl.starts[i], dur = tl.durs[i]
  const T = i > 0 ? Math.min(TR, dur * 0.4, tl.durs[i - 1] * 0.4) : 0
  if (i > 0 && local < T) {
    const q = inOut(local / T)
    const toEnd = layoutOf(p.scenes[i]) === 'end'
    // the last frame settles back and darkens…
    ctx.save(); const z = 1 + 0.05 * q; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2)
    drawSig(ctx, e, i - 1, tl.durs[i - 1] + local, tl.durs[i - 1]); ctx.restore()
    ctx.fillStyle = `rgba(0,0,0,${0.55 * q})`; ctx.fillRect(0, 0, W, H)
    // …while the next one wipes up from below, rising a little as it comes (an end card fades in instead)
    ctx.save()
    if (toEnd) { ctx.fillStyle = `rgba(0,0,0,${0.45 * q})`; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = clamp((local / T - 0.35) / 0.65) }
    else { ctx.beginPath(); ctx.rect(0, H * (1 - q), W, H * q); ctx.clip(); ctx.translate(0, (1 - q) * H * 0.18) }
    drawSig(ctx, e, i, local, dur); ctx.restore()
  } else drawSig(ctx, e, i, local, dur)
  vignette(ctx, e, 0.34)
  grain(ctx, e)
  // the mark, small and quiet, top left (never on the end card, which carries its own)
  const sc = p.scenes[i]
  const logo = (A.logos && A.logos.white) || A.logo
  if (logo && layoutOf(sc) !== 'end') { const lw = 118 * u, lh = lw * ((logo as any).naturalHeight || 106) / ((logo as any).naturalWidth || 222); ctx.save(); ctx.globalAlpha *= 0.92; ctx.drawImage(logo as any, e.M, (e.port ? 120 : 60) * u, lw, lh); ctx.restore() }
  // the scene count, editorial style, top right
  if (layoutOf(sc) !== 'end') label(ctx, e, `${pad2(i + 1)} / ${pad2(p.scenes.length)}`, W - e.M, (e.port ? 120 : 60) * u + 30 * u, 20 * u, 1, 0, { align: 'right', color: 'rgba(247,242,233,0.7)', weight: 600, track: 0.18 })
  // captions: the spoken line, clean, no box (most people watch muted)
  const bare = (x: string) => x.replace(/\*\*/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
  const hw = new Set(bare(sc.head).split(' ').filter(w => w.length > 2)), vw = bare(sc.vo).split(' ').filter(w => w.length > 2)
  const echo = vw.length > 0 && vw.filter(w => hw.has(w)).length / vw.length >= 0.5
  if (p.captions && sc.vo.trim() && !echo && !(e.port && layoutOf(sc) === 'end')) {
    const a = clamp(local / 0.3) * clamp((dur - local) / 0.3)
    if (a > 0) {
      const size = (e.port ? 38 : 32) * u
      ctx.save(); ctx.globalAlpha = a; ctx.font = `500 ${size}px ${e.sans}`
      const lines = wrap(ctx, captionText(sc.vo), W * 0.78).slice(0, 2)
      const base = H - (e.port ? 250 : 70) * u
      lines.forEach((ln, k) => {
        const s = ln.map(w => w.t).join(' '), w = ctx.measureText(s).width
        ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 14 * u; ctx.fillStyle = '#FFFFFF'
        ctx.fillText(s, (W - w) / 2, base - (lines.length - 1 - k) * size * 1.32)
      })
      ctx.restore()
    }
  }
  ctx.restore()
}
