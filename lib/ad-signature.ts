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
import { MOMENTS } from './marketing-calendar'

const INK = '#F7F2E9', MUT = 'rgba(247,242,233,0.72)', GOLD = '#D4B47C', NIGHT = '#0E0F11', NIGHT2 = '#16181B'
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const outExpo = (x: number) => { x = clamp(x); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x) }
const inOut = (x: number) => { x = clamp(x); return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2 }
const outCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3)

type Ctx = CanvasRenderingContext2D
type Env = { W: number; H: number; u: number; port: boolean; tall: boolean; M: number; top: number; bot: number; ui: number; cap: number; serif: string; sans: string; A: AdAssets; p: AdProject; t: number
  accent: string; night: string; night2: string; ink: string; mut: string; onAccent: string }

// ── the scene's content decides its layout ───────────────────────────────────────────────────────
export type SigLayout = 'hero' | 'list' | 'numbers' | 'cards' | 'gallery' | 'quote' | 'end'
const SIG_KEYS: SigLayout[] = ['hero', 'list', 'numbers', 'cards', 'gallery', 'quote', 'end']
const NUMERIC = /^\s*[$€£]?\d[\d,.]*\s*(%|\+|x|k|m|★)?\s*\|/i
export function layoutOf(sc: AdScene): SigLayout {
  if (sc.sig && SIG_KEYS.indexOf(sc.sig) >= 0) return sc.sig   // the writer's or the editor's choice
  const k = sc.kind
  if (k === 'cta' || k === 'contact') return 'end'
  if (k === 'quote') return 'quote'
  const items = (sc.items || []).filter(x => x && x.trim())
  if (k === 'stats' || k === 'curve' || (items.length && items.every(x => NUMERIC.test(x)))) return items.length ? 'numbers' : 'hero'
  if (k === 'cards' && items.length >= 2 && sc.photos.filter(Boolean).length >= 2) return 'cards'
  if (items.length && !(k === 'poster' || k === 'event')) return 'list'
  if ((k === 'wall' || k === 'grid' || k === 'tilegrid' || k === 'polaroid' || k === 'tiles') || sc.photos.filter(Boolean).length >= 2) return 'gallery'
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
    // (a single long word — a web address — cannot wrap, so the widest line has to fit too)
    for (let k = 0; k < 12; k++) { ctx.font = font(s); const ls = wrap(ctx, text, maxW); if (ls.length <= forced && Math.max(0, ...ls.map(l => ctx.measureText(l.map(x => x.t).join(' ')).width)) <= maxW) return s; s *= 0.95 }
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
    for (const w of ln) { ctx.fillStyle = w.gold ? e.accent : (o.color || INK); ctx.fillText(w.t, cx, base + dy); cx += ctx.measureText(w.t).width + sp }
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
const rr = (ctx: Ctx, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h) }
/** One line, shrunk until it fits the width. */
function fitOne(ctx: Ctx, text: string, maxW: number, max: number, font: (s: number) => string): number {
  let s = max
  for (let k = 0; k < 40; k++) { ctx.font = font(s); if (ctx.measureText(text).width <= maxW) return s; s *= 0.94 }
  return s
}
/** Body copy that fades up, wrapped; returns its height. */
function para(ctx: Ctx, e: Env, text: string, x: number, y: number, maxW: number, size: number, local: number, delay: number, o: { align?: 'left' | 'center'; color?: string; maxLines?: number; weight?: number; measureOnly?: boolean } = {}): number {
  ctx.font = `${o.weight || 400} ${size}px ${e.sans}`
  const all = wrap(ctx, strip(text), maxW), lines = all.slice(0, o.maxLines || 3)
  const h = lines.length * size * 1.36
  if (o.measureOnly) return h
  const a = outCubic((local - delay) / 0.7); if (a <= 0) return h
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = o.color || e.mut; ctx.textBaseline = 'alphabetic'
  lines.forEach((ln, k) => { let str = ln.map(w => w.t).join(' '); if (k === lines.length - 1 && all.length > lines.length) str = str.replace(/[\s,.;:]+$/, '') + '…'; const w = ctx.measureText(str).width; ctx.fillText(str, o.align === 'center' ? x + (maxW - w) / 2 : x, y + size + k * size * 1.36 + (1 - a) * 12 * e.u) })
  ctx.restore()
  return h
}
/** The small line above a headline: a short accent rule, then the tracked label. Returns its height. */
function eyebrowRow(ctx: Ctx, e: Env, text: string, x: number, y: number, local: number, delay: number, center = false, maxW = 0): number {
  const t = strip(text).trim(); if (!t) return 0
  const size = (e.port ? 26 : 24) * e.u, rl = 54 * e.u, gap = 20 * e.u
  ctx.font = `600 ${size}px ${e.sans}`; try { (ctx as any).letterSpacing = 0.24 * size + 'px' } catch { /* */ }
  const tw = ctx.measureText(t.toUpperCase()).width; try { (ctx as any).letterSpacing = '0px' } catch { /* */ }
  const x0 = center ? x + (maxW - (rl + gap + tw)) / 2 : x
  rule(ctx, x0, y + size * 0.62, rl, local, delay, e.accent, 2.5 * e.u)
  label(ctx, e, t, x0 + rl + gap, y + size, size, local, delay + 0.12, { color: e.accent, weight: 600 })
  return size + 34 * e.u
}
/** A photo cropped to a circle with an accent ring (faces sit high in the frame, so the crop favours the top). */
function portrait(ctx: Ctx, e: Env, img: CanvasImageSource | null, cx: number, cy: number, r: number, local: number, delay: number) {
  const a = outExpo((local - delay) / 0.9); if (a <= 0) return
  ctx.save(); ctx.globalAlpha *= clamp(a * 1.4)
  const R = r * (0.9 + 0.1 * a)
  ctx.beginPath(); ctx.arc(cx, cy, R + 10 * e.u, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.save(); ctx.clip()
  ctx.fillStyle = e.night2; ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  const iw = (img as any)?.naturalWidth || 0, ih = (img as any)?.naturalHeight || 0
  if (img && iw && ih) { const sc = Math.max((R * 2) / iw, (R * 2) / ih); ctx.drawImage(img, cx - (iw * sc) / 2, cy - R - (ih * sc - R * 2) * 0.18, iw * sc, ih * sc) }
  ctx.restore()
  ctx.lineWidth = 4 * e.u; ctx.strokeStyle = e.accent; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

// ── the layouts ──────────────────────────────────────────────────────────────────────────────────
type Get = (u: string) => HTMLImageElement | HTMLVideoElement | null
const serifF = (e: Env) => (s: number) => `600 ${s}px ${e.serif}`

function backdrop(ctx: Ctx, e: Env, img: CanvasImageSource | null, local: number, dur: number, i: number, alpha: number) {
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, e.W, e.H)
  if (img) { ctx.save(); ctx.globalAlpha *= alpha; photo(ctx, img, 0, 0, e.W, e.H, local, dur, i); ctx.restore(); shade(ctx, 0, 0, e.H, e.W, 0.3, 0.78) } else glow(ctx, e, local)
}

function hero(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  if (img) {
    photo(ctx, img, 0, 0, W, H, local, dur, i)
    shade(ctx, 0, 0, H * 0.28, W, 0.5, 0)
    shade(ctx, 0, H * (port ? 0.34 : 0.22), H, W, 0, 0.94)
  } else { ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H); glow(ctx, e, local) }
  const head = sc.head || strip(sc.vo)
  const center = !img
  const maxW = center ? W - 2 * M : port ? W - 2 * M : W * 0.62
  const size = fit(ctx, head, maxW, (e.tall ? 172 : port ? 150 : 150) * u, port ? 4 : 3, serifF(e))
  const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true })
  const sub = sc.sub && bare(sc.sub) !== bare(sc.eyebrow || '') ? sc.sub : ''
  const subSize = (port ? 38 : 34) * u
  const subH = sub ? para(ctx, e, sub, 0, 0, maxW * 0.92, subSize, 0, 0, { measureOnly: true, maxLines: 2 }) + 30 * u : 0
  const tag = sameWords(sc.eyebrow || '', head) ? '' : (sc.eyebrow || '')
  const ebH = tag ? (port ? 26 : 24) * u + 34 * u : 0
  const blockH = ebH + hh + subH
  const y0 = center ? (H - blockH) / 2 : H - e.bot - blockH
  const x0 = center ? M : M
  // a second, local shadow under the words themselves: a bright pool or a white wall never eats the headline
  if (img) shade(ctx, 0, y0 - 300 * u, y0 + blockH * 0.5, W, 0, 0.5)
  if (img) { ctx.fillStyle = 'rgba(8,8,9,0.5)'; ctx.fillRect(0, y0 + blockH * 0.5, W, H - (y0 + blockH * 0.5)) }
  if (tag) eyebrowRow(ctx, e, tag, x0, y0, local, 0.05, center, maxW)
  setLines(ctx, e, head, x0, y0 + ebH, maxW, size, { font: e.serif, weight: 600, local, delay: 0.14, align: center ? 'center' : 'left' })
  if (sub) para(ctx, e, sub, x0, y0 + ebH + hh + 30 * u, center ? maxW : maxW * 0.92, subSize, local, 0.8, { align: center ? 'center' : 'left', maxLines: 2 })
}

function glow(ctx: Ctx, e: Env, local: number) {
  const g = ctx.createRadialGradient(e.W * (0.3 + 0.05 * Math.sin(local * 0.4)), e.H * 0.25, 0, e.W * 0.3, e.H * 0.25, Math.max(e.W, e.H) * 0.9)
  g.addColorStop(0, rgba(e.accent, 0.22)); g.addColorStop(0.5, rgba(e.accent, 0.05)); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, e.W, e.H)
}

function list(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  const img = get(sc.photos[0] || '')
  const items = (sc.items || []).filter(x => x && x.trim()).slice(0, 4)
  const n = Math.max(1, items.length)
  const head = sc.head.trim()
  const tag = sameWords(sc.eyebrow || '', head) ? '' : (sc.eyebrow || '')
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H); glow(ctx, e, local)
  // the type column: where it sits, and how much it needs
  const tx = M, tw = port ? W - 2 * M : W * 0.5 - M - 60 * u
  const hS = head ? fit(ctx, head, tw, (port ? 96 : 92) * u, 2, serifF(e)) : 0
  const hH = head ? setLines(ctx, e, head, 0, 0, tw, hS, { font: e.serif, weight: 600, local, measureOnly: true }) + 44 * u : 0
  const ebH = tag ? 60 * u : 0
  const tb = H - e.bot
  let ty = e.top
  if (img) {
    if (port) {
      // the photo takes what the words do not need — never less than a fifth of the frame, never more than 46%
      const want = ebH + hH + n * 150 * u + 40 * u
      const ph = clamp(tb - want - 60 * u, H * 0.2, H * 0.46)
      const reveal = outExpo(local / 1.1)
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, ph * reveal); ctx.clip(); photo(ctx, img, 0, 0, W, ph, local, dur, i); shade(ctx, 0, 0, ph * 0.4, W, 0.45, 0); shade(ctx, 0, ph * 0.7, ph, W, 0, 0.5); ctx.restore()
      rule(ctx, 0, ph - 1.5 * u, W, local, 0.3, e.accent, 3 * u, 1.0)
      ty = ph + 64 * u
    } else {
      const px = W * 0.5, reveal = outExpo(local / 1.1)
      ctx.save(); ctx.beginPath(); ctx.rect(px + (W - px) * (1 - reveal), 0, (W - px) * reveal, H); ctx.clip(); photo(ctx, img, px, 0, W - px, H, local, dur, i); ctx.restore()
      ty = e.top + 60 * u
    }
  } else ty = e.top + 60 * u
  // the block sits centred in the room it has (a short list should not hang off the top)
  const room = tb - ty
  const rowH = clamp((room - ebH - hH) / n, 96 * u, (port ? 200 : 170) * u)
  let y = ty + Math.max(0, (room - (ebH + hH + rowH * n)) / 2)
  if (tag) y += eyebrowRow(ctx, e, tag, tx, y, local, 0.15) + 0
  if (head) { setLines(ctx, e, head, tx, y, tw, hS, { font: e.serif, weight: 600, local, delay: 0.22 }); y += hH }
  const tS = clamp(rowH * 0.29, 34 * u, (port ? 50 : 46) * u), dS = tS * 0.72
  const numW = 84 * u
  items.forEach((row, k) => {
    const [t1, t2] = split(row)
    const d = 0.5 + k * 0.2, ry = y + k * rowH
    rule(ctx, tx, ry, tw, local, d - 0.1, 'rgba(247,242,233,0.2)', 1.5 * u, 0.9)
    const mid = ry + rowH / 2
    const blockH = tS * 1.1 + (t2 ? dS * 1.5 : 0)
    label(ctx, e, pad2(k + 1), tx, mid - blockH / 2 + tS * 0.86, 24 * u, local, d, { color: e.accent, weight: 700, track: 0.1 })
    ctx.font = `600 ${tS}px ${e.sans}`
    const t1s = fitOne(ctx, strip(t1), tw - numW, tS, s2 => `600 ${s2}px ${e.sans}`)
    setLines(ctx, e, strip(t1), tx + numW, mid - blockH / 2 - tS * 0.05, tw - numW + 4, t1s, { font: e.sans, weight: 600, local, delay: d, lh: 1.1 })
    if (t2) para(ctx, e, t2, tx + numW, mid - blockH / 2 + tS * 1.1, tw - numW, dS, local, d + 0.22, { maxLines: 1 })
  })
  rule(ctx, tx, y + n * rowH, tw, local, 0.5 + n * 0.2, 'rgba(247,242,233,0.2)', 1.5 * u, 0.9)
}

function numbers(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  backdrop(ctx, e, get(sc.photos[0] || ''), local, dur, i, 0.3)
  const items = (sc.items || []).filter(x => x && x.trim()).slice(0, 3)
  const n = Math.max(1, items.length)
  const head = sc.head.trim(), tag = sameWords(sc.eyebrow || '', head) ? '' : (sc.eyebrow || '')
  const maxW = W - 2 * M
  const hS = head ? fit(ctx, head, maxW, (port ? 88 : 76) * u, 2, serifF(e)) : 0
  const hH = head ? setLines(ctx, e, head, 0, 0, maxW, hS, { font: e.serif, weight: 600, local, measureOnly: true }) + 50 * u : 0
  const ebH = tag ? 60 * u : 0
  const rows = port ? n : 1
  const room = H - e.bot - e.top - ebH - hH
  const rh = Math.min(room / rows, (port ? 400 : 420) * u)
  let y = e.top + Math.max(0, (room - rh * rows) / 2)
  if (tag) y += eyebrowRow(ctx, e, tag, M, y, local, 0.05)
  if (head) { setLines(ctx, e, head, M, y, maxW, hS, { font: e.serif, weight: 600, local, delay: 0.08 }); y += hH }
  // One size for every figure, sized on the FINAL figures so nothing changes size — or runs off the frame — while
  // it counts. Wide frames give each figure the width it needs rather than equal columns, so a long one
  // ("1,000,000+") does not shrink the rest.
  const nums = items.map(row => split(row)[0])
  const gapX = 90 * u
  let ns = Math.min((port ? 230 : 200) * u, rh * 0.56)
  const widths = (sz: number) => { ctx.font = `600 ${sz}px ${e.serif}`; return nums.map(x => ctx.measureText(x).width) }
  for (let k = 0; k < 40; k++) { const w = widths(ns); if (port ? Math.max(...w) <= maxW : w.reduce((a2, b2) => a2 + b2, 0) + gapX * (n - 1) <= maxW) break; ns *= 0.95 }
  const wN = widths(ns)
  // labels need their room too
  ctx.font = `600 ${(port ? 28 : 24) * u}px ${e.sans}`
  const colW = wN.map((w, k) => Math.max(w, port ? 0 : Math.min(360 * u, ctx.measureText(strip(split(items[k])[1]).toUpperCase()).width * 1.3)))
  const totalW = colW.reduce((a2, b2) => a2 + b2, 0)
  const spare = port ? 0 : Math.max(0, (maxW - totalW) / Math.max(1, n - 1))
  let xx = M
  items.forEach((row, k) => {
    const [num, lab] = split(row)
    const m = num.match(/^([^\d]*)([\d,.]+)(.*)$/)
    const d = 0.3 + k * 0.25
    const q = outExpo((local - d) / 1.6)
    let shown = num
    if (m) { const target = Number(m[2].replace(/,/g, '')); const dec = (m[2].split('.')[1] || '').length; const v = target * q; shown = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US')) + m[3] }
    const cx = port ? M : xx, cy = y + (port ? k * rh : 0)
    const wCol = port ? maxW : colW[k]
    if (!port) xx += colW[k] + Math.min(spare, 260 * u)
    rule(ctx, cx, cy, port ? maxW : wCol, local, d - 0.15, rgba(e.accent, 0.65), 2 * u)
    if (q > 0) { ctx.save(); ctx.globalAlpha *= clamp(q * 3); ctx.font = `600 ${ns}px ${e.serif}`; ctx.fillStyle = e.ink; ctx.textBaseline = 'alphabetic'; ctx.fillText(shown, cx, cy + 34 * u + ns * 0.86); ctx.restore() }
    if (!(head && sameWords(lab, head))) label(ctx, e, strip(lab), cx, cy + 34 * u + ns * 0.86 + 58 * u, (port ? 28 : 24) * u, local, d + 0.4, { color: e.accent })
  })
}

/** PHOTO CARDS — two or three things we do, each with its own picture (the sales films' card rows). */
function cards(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H); glow(ctx, e, local)
  const items = (sc.items || []).filter(x => x && x.trim()).slice(0, 3)
  const ph = sc.photos.filter(Boolean)
  const n = Math.max(1, Math.min(items.length || ph.length, 3))
  const head = sc.head.trim(), tag = sameWords(sc.eyebrow || '', head) ? '' : (sc.eyebrow || '')
  const maxW = W - 2 * M
  const hS = head ? fit(ctx, head, maxW, (port ? 88 : 76) * u, 2, serifF(e)) : 0
  const hH = head ? setLines(ctx, e, head, 0, 0, maxW, hS, { font: e.serif, weight: 600, local, measureOnly: true }) + 46 * u : 0
  const ebH = tag ? 60 * u : 0
  let y = e.top
  if (tag) y += eyebrowRow(ctx, e, tag, M, y, local, 0.05)
  if (head) { setLines(ctx, e, head, M, y, maxW, hS, { font: e.serif, weight: 600, local, delay: 0.08 }); y += hH }
  const gap = 26 * u, room = H - e.bot - y
  const cw = port ? maxW : (maxW - gap * (n - 1)) / n
  const ch = port ? Math.min((room - gap * (n - 1)) / n, 420 * u) : Math.min(room, 620 * u)
  const y0 = y + (port ? Math.max(0, (room - (ch * n + gap * (n - 1))) / 2) : Math.max(0, (room - ch) / 2))
  for (let k = 0; k < n; k++) {
    const [t1, t2] = split(items[k] || '')
    const d = 0.35 + k * 0.22, q = outExpo((local - d) / 1.0)
    if (q <= 0) continue
    const x = port ? M : M + k * (cw + gap), cy = (port ? y0 + k * (ch + gap) : y0) + (1 - q) * 60 * u
    ctx.save(); ctx.globalAlpha *= clamp(q * 1.6)
    rr(ctx, x, cy, cw, ch, 22 * u); ctx.save(); ctx.clip()
    photo(ctx, get(ph[k % Math.max(1, ph.length)] || ''), x, cy, cw, ch, local - d, dur, i + k, 0.8)
    shade(ctx, x, cy + ch * 0.3, cy + ch, cw, 0, 0.9)
    ctx.restore()
    rr(ctx, x, cy, cw, ch, 22 * u); ctx.lineWidth = 1.5 * u; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke()
    const pad = 34 * u, tS = fitOne(ctx, strip(t1), cw - 2 * pad, (port ? 56 : 58) * u, s2 => `600 ${s2}px ${e.serif}`), dS = (port ? 30 : 30) * u
    const dH = t2 ? para(ctx, e, t2, 0, 0, cw - 2 * pad, dS, 0, 0, { measureOnly: true, maxLines: 2 }) + 20 * u : 0
    ctx.font = `600 ${tS}px ${e.serif}`; ctx.fillStyle = e.ink; ctx.textBaseline = 'alphabetic'; ctx.fillText(strip(t1), x + pad, cy + ch - pad - dH)
    if (t2) para(ctx, e, t2, x + pad, cy + ch - pad - dH + 16 * u, cw - 2 * pad, dS, local, d + 0.3, { maxLines: 2 })
    ctx.fillStyle = e.accent; ctx.fillRect(x + pad, cy + ch - pad - dH - tS * 1.15 - 14 * u, 44 * u, 3 * u)
    ctx.restore()
  }
}

function gallery(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  // A MONTAGE: quick full-screen cuts through the scene's photos (one image on screen at a time — never a grid
  // or a collage), each pushing in, the headline set over the last one.
  const { W, H, u, M, port } = e
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H)
  const ph = sc.photos.filter(Boolean).slice(0, 4)
  const n = Math.max(1, ph.length)
  // the early cuts are quick; the last photo holds for the headline
  const hold = n > 1 ? Math.max(0.55, (dur * 0.45) / (n - 1)) : dur
  const k = Math.min(n - 1, Math.floor(Math.max(0, local) / hold)), lk = Math.max(0, local) - k * hold
  photo(ctx, get(ph[k] || ''), 0, 0, W, H, lk, k === n - 1 ? dur - k * hold : hold, i + k, 1.4)
  // a quick flash of white on each cut, the way an editor cuts on the beat
  if (k > 0 && lk < 0.12) { ctx.fillStyle = `rgba(255,250,240,${0.18 * (1 - lk / 0.12)})`; ctx.fillRect(0, 0, W, H) }
  const head = sc.head || strip(sc.vo)
  if (head && k === n - 1) {
    shade(ctx, 0, 0, H * 0.28, W, 0.5, 0)
    shade(ctx, 0, H * 0.3, H, W, 0, 0.94)
    const maxW = port ? W - 2 * M : W * 0.62
    const size = fit(ctx, head, maxW, (e.tall ? 160 : 140) * u, 3, serifF(e))
    const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local: lk, measureOnly: true })
    const sub = sc.sub || ''
    const subS = (port ? 36 : 32) * u
    const subH = sub ? para(ctx, e, sub, 0, 0, maxW, subS, 0, 0, { measureOnly: true, maxLines: 2 }) + 28 * u : 0
    const tag = sameWords(sc.eyebrow || '', head) ? '' : (sc.eyebrow || '')
    const ebH = tag ? 60 * u : 0
    const y0 = H - e.bot - hh - subH - ebH
    shade(ctx, 0, y0 - 300 * u, y0 + (hh + ebH) * 0.5, W, 0, 0.5); ctx.fillStyle = 'rgba(8,8,9,0.5)'; ctx.fillRect(0, y0 + (hh + ebH) * 0.5, W, H)
    if (tag) eyebrowRow(ctx, e, tag, M, y0, lk, 0.05)
    setLines(ctx, e, head, M, y0 + ebH, maxW, size, { font: e.serif, weight: 600, local: lk, delay: 0.1 })
    if (sub) para(ctx, e, sub, M, y0 + ebH + hh + 28 * u, maxW, subS, lk, 0.7, { maxLines: 2 })
  }
}

function quote(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port } = e
  backdrop(ctx, e, get(sc.photos[0] || ''), local, dur, i, 0.26)
  const text = sc.head || strip(sc.vo)
  const maxW = port ? W - 2 * M : W * 0.7
  const x = port ? M : (W - maxW) / 2
  const size = fit(ctx, text, maxW, (port ? 96 : 84) * u, port ? 7 : 4, serifF(e))
  const hh = setLines(ctx, e, text, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true, lh: 1.12 })
  const y0 = (H - hh) / 2 - size * 0.4
  const a = outCubic(local / 0.8)
  ctx.save(); ctx.globalAlpha *= a; ctx.font = `600 ${size * 2.6}px ${e.serif}`; ctx.fillStyle = e.accent; ctx.fillText('“', x - size * 0.1, y0 + size * 0.9); ctx.restore()
  setLines(ctx, e, text, x, y0 + size * 0.7, maxW, size, { font: e.serif, weight: 600, local, delay: 0.2, lh: 1.12, stagger: 0.12 })
  const who = sc.sub || (sc.items || [])[0] || ''
  if (who) { rule(ctx, x, y0 + size * 0.7 + hh + 50 * u, 60 * u, local, 0.9, e.accent); label(ctx, e, strip(who), x + 84 * u, y0 + size * 0.7 + hh + 60 * u, 24 * u, local, 1.0, { color: e.mut }) }
}

function pill(ctx: Ctx, e: Env, text: string, cx: number, y: number, local: number, delay: number, left = false): number {
  const { u } = e
  const a = outCubic((local - delay) / 0.6); const bh = 92 * u
  if (a <= 0) return bh
  ctx.save(); ctx.globalAlpha *= a; const fs = 28 * u
  ctx.font = `700 ${fs}px ${e.sans}`; try { (ctx as any).letterSpacing = fs * 0.16 + 'px' } catch { /* */ }
  const s = strip(text).toUpperCase(), tw = ctx.measureText(s).width, bw = tw + 96 * u, bx = left ? cx : cx - bw / 2, by = y + (1 - a) * 14 * u
  rr(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = e.accent; ctx.fill()
  ctx.fillStyle = e.onAccent; ctx.textBaseline = 'middle'; ctx.fillText(s, bx + 48 * u + fs * 0.08, by + bh / 2 + 1 * u)
  ctx.restore()
  return bh
}

function endCard(ctx: Ctx, e: Env, sc: AdScene, i: number, local: number, dur: number, get: Get) {
  const { W, H, u, M, port, A, p } = e
  const img = get(sc.photos[0] || '')
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H)
  if (img) { ctx.save(); ctx.globalAlpha *= 0.34; photo(ctx, img, 0, 0, W, H, local, dur + 4, i, 0.6); ctx.restore(); shade(ctx, 0, 0, H, W, 0.3, 0.8) } else glow(ctx, e, local)
  const qr = (sc.qr || '').trim()
  const logo = (A.logos && A.logos.white) || A.logo
  const lgAspect = logo ? ((logo as any).naturalHeight || 106) / ((logo as any).naturalWidth || 222) : 0
  const isContact = sc.kind === 'contact' && !!(p.contact && (p.contact.name || p.contact.phone))
  const head = sc.head || (isContact ? 'Book a **call.**' : 'Book your **stay.**')

  // ── THE OWNER CARD: who to call. Photo, name, number — the frame the sales films end on. ──
  if (isContact) {
    const c = p.contact
    const face = c.photo ? (A.img(c.photo) as any) : null
    const side = !port                                   // wide frames: photo left, words right
    const R = (side ? 230 : e.tall ? 170 : 130) * u
    const colW = side ? W * 0.44 : W - 2 * M
    const size = fit(ctx, head, colW, (side ? 124 : e.tall ? 124 : 100) * u, 2, serifF(e))
    const hh = setLines(ctx, e, head, 0, 0, colW, size, { font: e.serif, weight: 600, local, measureOnly: true })
    const phoneS = fitOne(ctx, c.phone || '', colW, (side ? 112 : e.tall ? 104 : 88) * u, s2 => `600 ${s2}px ${e.serif}`)
    const lgW = (side ? 190 : 190) * u, lgH = lgW * lgAspect
    const nameS = (e.tall ? 46 : side ? 46 : 42) * u, roleS = (e.tall ? 28 : side ? 30 : 26) * u, mailS = (e.tall ? 32 : side ? 34 : 30) * u
    const stack = lgH + 50 * u + hh + 44 * u + nameS * 1.2 + (c.role ? roleS * 1.9 : 0) + 34 * u + phoneS * 1.05 + mailS * 1.8
    if (side) {
      const cx = W * 0.27, cy = H / 2
      portrait(ctx, e, face, cx, cy, R, local, 0.1)
      const x = W * 0.46; let y = (H - stack) / 2
      if (logo) { const a = outCubic(local / 0.8); ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(logo as any, x, y, lgW, lgH); ctx.restore() }
      y += lgH + 50 * u
      setLines(ctx, e, head, x, y, colW, size, { font: e.serif, weight: 600, local, delay: 0.25 }); y += hh + 44 * u
      const a1 = outCubic((local - 0.7) / 0.6)
      ctx.save(); ctx.globalAlpha *= a1; ctx.textBaseline = 'alphabetic'
      ctx.font = `600 ${nameS}px ${e.sans}`; ctx.fillStyle = e.ink; ctx.fillText(c.name || '', x, y + nameS); y += nameS * 1.2
      if (c.role) { ctx.font = `400 ${roleS}px ${e.sans}`; ctx.fillStyle = e.mut; ctx.fillText(c.role, x, y + roleS * 1.2); y += roleS * 1.9 }
      ctx.restore(); y += 34 * u
      const a2 = outExpo((local - 0.95) / 0.9)
      ctx.save(); ctx.globalAlpha *= clamp(a2 * 2); ctx.font = `600 ${phoneS}px ${e.serif}`; ctx.fillStyle = e.accent; ctx.textBaseline = 'alphabetic'; ctx.fillText(c.phone || '', x, y + phoneS * 0.86 + (1 - a2) * 16 * u); ctx.restore(); y += phoneS * 1.05
      const a3 = outCubic((local - 1.2) / 0.6)
      ctx.save(); ctx.globalAlpha *= a3; ctx.font = `500 ${mailS}px ${e.sans}`; ctx.fillStyle = e.ink; ctx.fillText(c.email || '', x, y + mailS * 1.3, colW); ctx.restore()
      return
    }
    const total = R * 2 + 56 * u + stack
    let y = Math.max(e.top, (H - e.bot * 0.6 - total) / 2 + e.top * 0.2)
    if (logo) { const a = outCubic(local / 0.8); ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(logo as any, (W - lgW) / 2, y, lgW, lgH); ctx.restore() }
    y += lgH + 50 * u
    portrait(ctx, e, face, W / 2, y + R, R, local, 0.15); y += R * 2 + 56 * u
    setLines(ctx, e, head, M, y, colW, size, { font: e.serif, weight: 600, local, delay: 0.3, align: 'center' }); y += hh + 44 * u
    const a1 = outCubic((local - 0.75) / 0.6)
    ctx.save(); ctx.globalAlpha *= a1; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'
    ctx.font = `600 ${nameS}px ${e.sans}`; ctx.fillStyle = e.ink; ctx.fillText(c.name || '', W / 2, y + nameS); y += nameS * 1.2
    if (c.role) { ctx.font = `400 ${roleS}px ${e.sans}`; ctx.fillStyle = e.mut; ctx.fillText(c.role, W / 2, y + roleS * 1.2); y += roleS * 1.9 }
    ctx.restore(); y += 34 * u
    const a2 = outExpo((local - 1.0) / 0.9)
    ctx.save(); ctx.globalAlpha *= clamp(a2 * 2); ctx.textAlign = 'center'; ctx.font = `600 ${phoneS}px ${e.serif}`; ctx.fillStyle = e.accent; ctx.textBaseline = 'alphabetic'; ctx.fillText(c.phone || '', W / 2, y + phoneS * 0.86 + (1 - a2) * 16 * u); ctx.restore(); y += phoneS * 1.05
    const a3 = outCubic((local - 1.25) / 0.6)
    ctx.save(); ctx.globalAlpha *= a3; ctx.textAlign = 'center'; ctx.font = `500 ${mailS}px ${e.sans}`; ctx.fillStyle = e.ink; ctx.fillText(c.email || '', W / 2, y + mailS * 1.3, colW); ctx.restore()
    return
  }

  // ── THE GUEST CARD: the mark, the line, where to book (and the code when there is one). ──
  const maxW = W - 2 * M
  const size = fit(ctx, head, maxW, (e.tall ? 150 : port ? 124 : 124) * u, 3, serifF(e))
  const hh = setLines(ctx, e, head, 0, 0, maxW, size, { font: e.serif, weight: 600, local, measureOnly: true })
  const qS = qr ? Math.min(W, H) * (port ? 0.3 : 0.26) : 0
  const rawCta = strip((sc.items || [])[0] || '').replace(/^book (at|on)\s+/i, '')
  // the button never repeats the headline word for word: when the address is already the headline, it says what to do
  const cta0 = rawCta || (qr ? '' : 'stay-hospitality.com')
  const cta = cta0 && bare(head).indexOf(bare(cta0)) >= 0 ? 'Book direct' : cta0
  // a line that only repeats the headline or the button says nothing — leave it out
  const sub = sc.sub && !sameWords(sc.sub, head + ' ' + cta) ? sc.sub : ''
  const lgW = (e.tall ? 250 : 210) * u, lgH = lgW * lgAspect
  const subS = (e.tall ? 36 : 32) * u
  const blocks = [lgH + 80 * u, hh, cta ? 60 * u + 92 * u : 0, sub ? 44 * u + subS * 1.4 : 0, qr ? qS + 110 * u : 0]
  const total = blocks.reduce((x, b) => x + b, 0)
  let y = Math.max(e.top, (H - total) / 2)
  if (logo) { const a = outCubic(local / 0.8); ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(logo as any, (W - lgW) / 2, y + (1 - a) * 14 * u, lgW, lgH); ctx.restore() }
  y += blocks[0]
  setLines(ctx, e, head, M, y, maxW, size, { font: e.serif, weight: 600, local, delay: 0.25, align: 'center' })
  y += hh
  if (cta) { pill(ctx, e, cta, W / 2, y + 60 * u, local, 0.9); y += 60 * u + 92 * u }
  if (sub) { label(ctx, e, sub, W / 2, y + 44 * u + subS * 0.5, 24 * u, local, 1.1, { align: 'center', color: e.mut }); y += 44 * u + subS * 1.4 }
  if (qr) {
    const a = outExpo((local - 1.1) / 0.9)
    if (a > 0) {
      const mods = qrModules(qr), n = mods.length, quiet = 4, cell = qS / (n + quiet * 2)
      const tile = cell * (n + quiet * 2), tx = (W - tile) / 2, ty = y + 40 * u
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 20 * u)
      ctx.fillStyle = '#FFFFFF'; rr(ctx, tx, ty, tile, tile, 18 * u); ctx.fill()
      ctx.fillStyle = '#111111'
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mods[r][c]) ctx.fillRect(Math.floor(tx + (c + quiet) * cell), Math.floor(ty + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell))
      ctx.restore()
      label(ctx, e, sc.qrLabel || 'Scan to try it free', W / 2, ty + tile + 52 * u, 22 * u, local, 1.4, { align: 'center', color: e.accent, weight: 700 })
    }
  }
}

// ── words: what is already on screen need not be said twice ──────────────────────────────────────
const bare = (x: string) => String(x || '').replace(/\*\*/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
/** True when (nearly) every word of `a` is already in `b` — an eyebrow that repeats its headline, a caption that reads the screen aloud. */
function sameWords(a: string, b: string, share = 0.99): boolean {
  const aw = bare(a).split(' ').filter(w => w.length > 2); if (!aw.length) return true
  const bw = new Set(bare(b).split(' ').filter(w => w.length > 2))
  return aw.filter(w => bw.has(w)).length / aw.length >= share
}
/** Is the spoken line shown as a caption on this scene? Only where the frame is a photo with room for it, and
 *  only when it adds something the screen does not already say. */
function captionOn(p: AdProject, sc: AdScene): boolean {
  if (!p.captions || !sc.vo.trim()) return false
  const L = layoutOf(sc)
  if (L === 'list' || L === 'numbers' || L === 'end' || L === 'cards') return false
  return !sameWords(sc.vo, [sc.head, sc.sub, sc.eyebrow || '', (sc.items || []).join(' ')].join(' '), 0.6)
}

function drawSig(ctx: Ctx, e0: Env, i: number, local0: number, dur: number) {
  const sc = e0.p.scenes[i]
  // the frame keeps room for a caption only on the scenes that show one
  const e: Env = { ...e0, bot: e0.ui + (captionOn(e0.p, sc) ? e0.cap : 0) }
  // After a wipe the type waits for the frame to land, so nothing is caught half-set mid-transition.
  const local = local0 - (i > 0 ? TR * 0.7 : 0)
  const A = e.A
  const get: Get = (url: string) => (!url ? null : A.media ? (A.media(url, local) as any) : A.img(url))
  const L = layoutOf(sc)
  if (L === 'end') endCard(ctx, e, sc, i, local, dur, get)
  else if (L === 'list') list(ctx, e, sc, i, local, dur, get)
  else if (L === 'numbers') numbers(ctx, e, sc, i, local, dur, get)
  else if (L === 'cards') cards(ctx, e, sc, i, local, dur, get)
  else if (L === 'gallery') gallery(ctx, e, sc, i, local, dur, get)
  else if (L === 'quote') quote(ctx, e, sc, i, local, dur, get)
  else hero(ctx, e, sc, i, local, dur, get)
}

// ── tone: the season or the event colours the accent and the dark — nothing else changes ─────────
/** Signature worn for a calendar moment. Keyed by the moment's old look, so every moment already has one. */
export const SIG_TONES: Record<string, { accent: string; night: string; night2: string }> = {
  holiday: { accent: '#E3C27A', night: '#0B1711', night2: '#13251B' },      // evergreen and warm gold
  xmasred: { accent: '#EBCB7A', night: '#1A0A0C', night2: '#2A1114' },
  winter: { accent: '#E8D9C0', night: '#0E1114', night2: '#171C21' },
  harvest: { accent: '#E39A56', night: '#17100B', night2: '#241810' },      // burnt orange on deep brown
  champagne: { accent: '#F0D8A0', night: '#12100B', night2: '#1D1910' },
  rose: { accent: '#F2B6C2', night: '#170C10', night2: '#241319' },
  miami: { accent: '#FF8FB8', night: '#110B1A', night2: '#1B1229' },
  sand: { accent: '#E6B98C', night: '#14110D', night2: '#201B15' },
  editorial: { accent: '#E9D8B4', night: '#0C1512', night2: '#15231E' },
  usa: { accent: '#FF7A86', night: '#0A1020', night2: '#111A33' },
  spooky: { accent: '#FF9A45', night: '#0D0B10', night2: '#17131C' },
  midnight: { accent: '#D2B077', night: '#070F1F', night2: '#0E1A33' },
  stay: { accent: '#D2B077', night: '#0B1722', night2: '#122434' },         // navy & gold — the sales films
}
const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null }
const rgba = (c: string, a: number) => { const h = hex(c); return h ? `rgba(${h[0]},${h[1]},${h[2]},${a})` : c }
const lum = (c: string) => { const h = hex(c); return h ? (0.299 * h[0] + 0.587 * h[1] + 0.114 * h[2]) / 255 : 0.7 }
function toneOf(p: AdProject): { accent: string; night: string; night2: string } {
  const key = p.tone || (p.moment ? (MOMENTS.find(m => m.key === p.moment)?.look || '') : '')
  const t = SIG_TONES[key] || { accent: GOLD, night: NIGHT, night2: NIGHT2 }
  const st = p.style || ({} as any)
  // a colour picked by hand (Whole ad → Colours) wins over the season's
  return { accent: hex(st.accent || '') ? st.accent! : t.accent, night: hex(st.base || '') && lum(st.base!) < 0.35 ? st.base! : t.night, night2: t.night2 }
}

/** Where the platform's buttons and captions sit, so type never lands under them. */
function frameEnv(ctx: Ctx, p: AdProject, t: number, A: AdAssets): Env {
  const W = ctx.canvas.width, H = ctx.canvas.height, u = Math.min(W, H) / 1080, port = H > W * 1.1, tall = H > W * 1.5
  // Reels / Stories / Shorts / TikTok cover the top and the bottom of a 9:16 frame; the feed shapes are clean edge to edge.
  const top = (tall ? 250 : port ? 190 : 170) * u, ui = (tall ? 330 : port ? 110 : 100) * u, cap = (tall ? 170 : 130) * u
  const tn = toneOf(p)
  return { W, H, u, port, tall, M: (port ? 84 : 110) * u, top, ui, cap, bot: ui, serif: A.elegant || A.serif || 'Georgia, serif', sans: A.body, A, p, t,
    accent: tn.accent, night: tn.night, night2: tn.night2, ink: INK, mut: MUT, onAccent: lum(tn.accent) > 0.55 ? '#111111' : '#FFFFFF' }
}

const TR = 0.62   // the one transition's length
export function drawSignatureFrame(ctx: Ctx, p: AdProject, tl: Timeline, t: number, A: AdAssets) {
  const e = frameEnv(ctx, p, t, A)
  const { W, H, u } = e
  ctx.save()
  ctx.imageSmoothingEnabled = true; try { (ctx as any).imageSmoothingQuality = 'high' } catch { /* */ }
  ctx.textAlign = 'left'
  ctx.fillStyle = e.night; ctx.fillRect(0, 0, W, H)
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
  if (logo && layoutOf(sc) !== 'end') { const lw = (e.tall ? 150 : 132) * u, lh = lw * ((logo as any).naturalHeight || 106) / ((logo as any).naturalWidth || 222); ctx.save(); ctx.globalAlpha *= 0.95; ctx.drawImage(logo as any, e.M, (e.tall ? 150 : e.port ? 70 : 64) * u, lw, lh); ctx.restore() }
  // captions: the spoken line, clean, no box (most people watch muted) — only where it adds to the screen
  if (captionOn(p, sc)) {
    const a = clamp(local / 0.3) * clamp((dur - local) / 0.3)
    if (a > 0) {
      const size = (e.tall ? 38 : e.port ? 34 : 32) * u
      ctx.save(); ctx.globalAlpha = a; ctx.font = `500 ${size}px ${e.sans}`
      const lines = wrap(ctx, captionText(sc.vo), W - 2 * e.M).slice(0, 2)
      const base = H - e.ui - 34 * u
      lines.forEach((ln, k) => {
        const s = ln.map(w => w.t).join(' '), w = ctx.measureText(s).width
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 16 * u; ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.fillText(s, (W - w) / 2, base - (lines.length - 1 - k) * size * 1.32)
      })
      ctx.restore()
    }
  }
  ctx.restore()
}
