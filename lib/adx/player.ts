// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// The deterministic player. One pure entry point — renderFrame(ctx, doc, t, assets) — draws frame N from the document
// and a time; the live preview, the audit's stills and every exported frame call it, so what Jon sees is what is
// encoded. No clocks, no randomness. It only ever calls fillRect / fillText / drawImage / Path2D on a canvas: nothing
// in a composition is turned into HTML, CSS or script.
//
// The layout pass (layoutText, textRect, restTime) needs no canvas — it takes a `Measure` — so the audit and the
// plain-node tests run the same code the browser does.
import type { Composition, Scene, Layer, TextLayer, PhotoLayer, ShapeLayer, VectorLayer, LogoLayer, ButtonLayer, MotifLayer, TypeStyle, Box, Ease } from './composition'
import { resolveColor, LOGO } from './composition'
import { drawMotif, drawLogoDress } from './motifs'

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type Img = CanvasImageSource & { width: number; height: number }
export type Assets = {
  /** The picture for a photo layer (already cropped for it, or the whole photograph), or null while it loads. */
  photo: (l: PhotoLayer) => Img | null
  logo: (variant: 'black' | 'white') => Img | null
}
/** Width in pixels of `text` set in `style` at `size`, tracking included. */
export type Measure = (style: TypeStyle, size: number, text: string) => number

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
// feature tests (older Safari has no canvas letter-spacing, round rectangles or filters)
const hasLS = (ctx: Ctx) => 'letterSpacing' in (ctx as object)
const hasRR = (ctx: Ctx) => 'roundRect' in (ctx as object)
const hasFilter = (ctx: Ctx) => 'filter' in (ctx as object)
const EASE: Record<Ease, (x: number) => number> = {
  linear: x => clamp(x),
  outCubic: x => 1 - Math.pow(1 - clamp(x), 3),
  outExpo: x => { x = clamp(x); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x) },
  inOutCubic: x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 },
  outBack: x => { x = clamp(x); const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) },
}
const ease = (name: Ease | undefined, d: Ease, x: number) => (EASE[name || d] || EASE[d])(x)
const inQ = (l: Layer, local: number) => (l.in ? clamp((local - l.in.at) / Math.max(0.01, l.in.dur)) : 1)

// ── type ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const fontCss = (s: TypeStyle, size: number) => `${s.style === 'italic' ? 'italic ' : ''}${s.weight} ${size}px '${s.family}', ${s.family === 'Fraunces' ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}`
const styleOf = (doc: Composition, name: string | undefined): TypeStyle => doc.tokens.type[name || 'display'] || doc.tokens.type.display
const shown = (s: TypeStyle, t: string) => (s.upper ? t.toUpperCase() : t)

/** The browser's measure: the canvas itself, in the face that will be drawn. */
export function canvasMeasure(ctx: Ctx): Measure {
  return (style, size, text) => {
    ctx.font = fontCss(style, size)
    const tr = style.tracking * size
    if (hasLS(ctx)) { (ctx as any).letterSpacing = tr + 'px'; const w = ctx.measureText(text).width; (ctx as any).letterSpacing = '0px'; return w }
    return ctx.measureText(text).width + tr * text.length
  }
}
/** A measure with no canvas (server and tests): average glyph widths per face. Close enough to catch a line that
 *  cannot fit; the browser's own measure decides before anything is exported. */
export const approxMeasure: Measure = (style, size, text) => {
  const base = style.family === 'Fraunces' ? (style.style === 'italic' ? 0.46 : 0.5) : style.family === 'Bricolage Grotesque' ? 0.53 : 0.54
  const wk = 1 + (style.weight - 500) / 2500
  let w = 0
  for (const ch of text) w += /[ilI.,:;'!|·]/.test(ch) ? 0.28 : ch === ' ' ? 0.27 : /[mwMW@]/.test(ch) ? 0.86 : /[A-Z0-9–—]/.test(ch) ? 0.64 : 0.5
  return w * size * (base / 0.5) * wk + style.tracking * size * text.length
}

type Word = { t: string; style: TypeStyle; color: string; sp: boolean; w: number }
export type TextLayout = {
  lines: Word[][]; size: number; lh: number; widths: number[]
  /** Everything fits the box at a size the design allows. */
  fits: boolean
  /** The words wrapped onto more lines than the design asked for. */
  tooManyLines: boolean
  /** Where the words actually sit, for the audit and for clicking on them. */
  rect: { x0: number; y0: number; x1: number; y1: number }
}
/** Runs → words → lines. The biggest size between fit.min and fit.max at which the lines fit the box; never smaller
 *  than fit.min (the audit fails the piece instead of shrinking type until it is unreadable). */
export function layoutText(doc: Composition, l: TextLayer, measure: Measure, extraTracking = 0): TextLayout {
  const base = styleOf(doc, l.style), lh = base.lineHeight
  const max = l.fit ? l.fit.max : l.size || 28, min = l.fit ? l.fit.min : l.size || 28
  const wantLines = l.fit ? l.fit.lines : Math.max(1, Math.floor((l.box.h + 0.5) / (min * lh)))
  const paras: { t: string; style: TypeStyle; color: string; sp: boolean }[][] = [[]]
  let sp = false                                   // a space carries across runs: "somewhere " + "warm."
  for (const r of l.runs) {
    if ('br' in r) { paras.push([]); sp = false; continue }
    const st = r.style ? styleOf(doc, r.style) : base, color = resolveColor(doc, r.color || l.color, '#FFFFFF')
    const parts = r.t.split(/(\s+)/)
    for (const p of parts) { if (!p) continue; if (/^\s+$/.test(p)) { sp = true; continue } paras[paras.length - 1].push({ t: shown(st, p), style: extraTracking ? { ...st, tracking: st.tracking + extraTracking } : st, color, sp }); sp = false }
  }
  const build = (size: number) => {
    const lines: Word[][] = [], widths: number[] = []
    for (const para of paras) {
      if (!para.length) continue
      let cur: Word[] = [], cw = 0
      for (const p of para) {
        const w = measure(p.style, size, p.t), space = cur.length && p.sp ? measure(p.style, size, ' ') : 0
        if (cur.length && cw + space + w > l.box.w + 0.5) { lines.push(cur); widths.push(cw); cur = []; cw = 0 }
        const lead = cur.length && p.sp ? space : 0
        cur.push({ ...p, sp: cur.length > 0 && p.sp, w }); cw += lead + w
      }
      if (cur.length) { lines.push(cur); widths.push(cw) }
    }
    return { lines, widths }
  }
  let size = max, b = build(size), ok = false
  for (; size >= min; size -= 1) {
    b = build(size)
    if (b.lines.length <= wantLines && b.lines.length * size * lh <= l.box.h + 0.5 && Math.max(0, ...b.widths) <= l.box.w + 0.5) { ok = true; break }
  }
  if (!ok) { size = min; b = build(size) }
  const widest = Math.max(0, ...b.widths), x0 = l.align === 'center' ? l.box.x + (l.box.w - widest) / 2 : l.align === 'right' ? l.box.x + l.box.w - widest : l.box.x
  return { lines: b.lines, size, lh, widths: b.widths, fits: ok, tooManyLines: b.lines.length > wantLines, rect: { x0, y0: l.box.y, x1: x0 + widest, y1: l.box.y + b.lines.length * size * lh } }
}

function setFont(ctx: Ctx, s: TypeStyle, size: number): boolean {
  ctx.font = fontCss(s, size)
  if (hasLS(ctx)) { (ctx as any).letterSpacing = s.tracking * size + 'px'; return false }
  return Math.abs(s.tracking) >= 0.02          // no native tracking: wide-tracked labels are spaced by hand
}
function fillWord(ctx: Ctx, s: TypeStyle, size: number, t: string, x: number, y: number) {
  if (!setFont(ctx, s, size)) { ctx.fillText(t, x, y); return }
  let cx = x
  for (const ch of t) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + s.tracking * size }
}

function drawText(ctx: Ctx, doc: Composition, l: TextLayer, local: number) {
  const a = l.in, preset = a ? a.preset : 'none'
  const trackIn = preset === 'track-in' ? (1 - EASE.outCubic(inQ(l, local))) * 0.28 : 0
  const L = layoutText(doc, l, canvasMeasure(ctx), trackIn)
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  L.lines.forEach((line, k) => {
    const q = preset === 'rise-lines' ? ease(a!.ease, doc.tokens.motion.ease, (local - a!.at - k * (a!.stagger ?? 0.1)) / Math.max(0.01, a!.dur)) : EASE.outCubic(inQ(l, local))
    if (q <= 0) return
    const lw = L.widths[k], lx = l.align === 'center' ? l.box.x + (l.box.w - lw) / 2 : l.align === 'right' ? l.box.x + l.box.w - lw : l.box.x
    const top = l.box.y + k * L.size * L.lh, baseY = top + L.size * 0.84
    ctx.save()
    let dy = 0
    if (preset === 'rise-lines') { ctx.beginPath(); ctx.rect(lx - L.size * 0.3, top - L.size * 0.16, lw + L.size * 0.6, L.size * L.lh + L.size * 0.24); ctx.clip(); dy = (1 - q) * L.size * 1.15 }
    else if (preset === 'fade-up') { ctx.globalAlpha *= q; dy = (1 - q) * 22 }
    else if (preset !== 'none') ctx.globalAlpha *= q
    let cx = lx
    for (const w of line) {
      if (w.sp) cx += canvasMeasure(ctx)(w.style, L.size, ' ')
      ctx.fillStyle = w.color; fillWord(ctx, w.style, L.size, w.t, cx, baseY + dy); cx += w.w
    }
    ctx.restore()
  })
  if (hasLS(ctx)) (ctx as any).letterSpacing = '0px'
  ctx.restore()
}

// ── photographs: cover-crop round a focal point, a slow camera, an optional mask and wipe. Never tinted by default.
/** The scale at which a photograph covers its box (1 = one photo pixel per canvas pixel). */
export function coverScale(l: PhotoLayer, pw: number, ph: number) { return Math.max(l.box.w / pw, l.box.h / ph) }
/** The largest scale a layer ever draws its photograph at: the cover crop times the camera's furthest push. */
export function maxUpscale(l: PhotoLayer, pw: number, ph: number) { const c = l.camera; return coverScale(l, pw, ph) * Math.max(c?.from.scale || 1, c?.to.scale || 1) }
/** The scale a picture is really drawn at: an added image (source 'upload') is fitted whole inside its box. */
export function drawnScale(l: PhotoLayer, a: { w: number; h: number; source?: string }) { return a.source === 'upload' ? Math.min(l.box.w / a.w, l.box.h / a.h) : maxUpscale(l, a.w, a.h) }
const FILTER: Record<string, string> = { warm: 'sepia(0.18) saturate(1.08)', cool: 'saturate(0.92) hue-rotate(-6deg)', mono: 'grayscale(1) contrast(1.05)' }

function maskPath(ctx: Ctx, l: { box: Box; mask?: PhotoLayer['mask'] }) {
  const { x, y, w, h } = l.box, m = l.mask
  ctx.beginPath()
  if (m && m.shape === 'arch') { const r = Math.min(w / 2, h); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath() }
  else if (m && m.shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (m && m.shape === 'round' && hasRR(ctx)) (ctx as any).roundRect(x, y, w, h, m.radius ?? 28)
  else ctx.rect(x, y, w, h)
}
function drawPhoto(ctx: Ctx, doc: Composition, l: PhotoLayer, local: number, dur: number, A: Assets) {
  const asset = doc.assets.photos[l.photo]; if (!asset) return
  const { x, y, w, h } = l.box, a = l.in
  const q = a && (a.preset === 'wipe' || a.preset === 'fade' || a.preset === 'fade-up') ? ease(a.ease, 'inOutCubic', inQ(l, local)) : 1
  if (q <= 0) return
  ctx.save()
  if (a && a.preset !== 'wipe') ctx.globalAlpha *= q
  maskPath(ctx, l); ctx.clip()
  if (a && a.preset === 'wipe' && q < 1) { ctx.beginPath(); const f = a.from || 'bottom'; if (f === 'left') ctx.rect(x, y, w * q, h); else if (f === 'right') ctx.rect(x + w * (1 - q), y, w * q, h); else if (f === 'top') ctx.rect(x, y, w, h * q); else if (f === 'center') ctx.rect(x + w * (1 - q) / 2, y, w * q, h); else ctx.rect(x, y + h * (1 - q), w, h * q); ctx.clip() }
  const img = A.photo(l)
  if (!img || !img.width) { ctx.fillStyle = 'rgba(128,128,128,0.35)'; ctx.fillRect(x, y, w, h); ctx.restore(); return }
  const cam = l.camera, cq = cam ? ease(cam.ease, 'linear', local / Math.max(0.001, dur)) : 0
  const lerp = (k: 'scale' | 'x' | 'y', d: number) => { const f = cam?.from[k] ?? d, t = cam?.to[k] ?? d; return f + (t - f) * cq }
  // the image handed over may be the whole photograph or one already cropped to this box: cover it either way
  // an added image or PNG is shown whole, centred in its box (its transparency kept); a photograph covers its window
  const added = asset.source === 'upload'
  const s = added ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height) * lerp('scale', 1), dw = img.width * s, dh = img.height * s
  const whole = Math.abs(img.width / img.height - asset.w / asset.h) < 0.02
  const foc = whole ? (l.focal || asset.focal || { x: 0.5, y: 0.5 }) : { x: 0.5, y: 0.5 }
  const dx = added ? x + (w - dw) / 2 : clamp(x + w / 2 - foc.x * dw + lerp('x', 0) * w, x + w - dw, x), dy = added ? y + (h - dh) / 2 : clamp(y + h / 2 - foc.y * dh + lerp('y', 0) * h, y + h - dh, y)
  // an added image or 3D object keeps gently moving once it has arrived (deterministic: it depends only on the time)
  if (added && l.idle) {
    const cx = x + w / 2, cy = y + h / 2, ph = local * Math.PI * 2
    if (l.idle === 'float') ctx.translate(0, Math.sin(ph / 3.2) * h * 0.03)
    else if (l.idle === 'sway') { ctx.translate(cx, cy); ctx.rotate(Math.sin(ph / 3.6) * 0.07); ctx.translate(-cx, -cy) }
    else if (l.idle === 'spin') { ctx.translate(cx, cy); ctx.rotate(local * 0.35); ctx.translate(-cx, -cy) }
    else if (l.idle === 'pulse') { const k = 1 + Math.sin(ph / 2.2) * 0.035; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy) }
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
  if (l.treatment !== 'none' && hasFilter(ctx)) (ctx as any).filter = FILTER[l.treatment] || 'none'
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
}

const tintCache = new WeakMap<object, Map<string, Img>>()
function tinted(img: Img, color: string): Img {
  let m = tintCache.get(img as object); if (!m) { m = new Map(); tintCache.set(img as object, m) }
  const hit = m.get(color); if (hit) return hit
  const c = makeCanvas(img.width, img.height); if (!c) return img
  const g = c.getContext('2d') as Ctx; g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, img.width, img.height)
  m.set(color, c as unknown as Img); return c as unknown as Img
}
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
  return null
}
export const logoHeight = (l: LogoLayer) => (l.box.w * LOGO.h) / LOGO.w
function drawLogo(ctx: Ctx, doc: Composition, l: LogoLayer, local: number, t: number, A: Assets) {
  const img = A.logo(l.variant); const q = EASE.outCubic(inQ(l, local)); if (q <= 0) return
  const { x, y, w } = l.box, h = logoHeight(l), dy = l.in && l.in.preset === 'fade-up' ? (1 - q) * 22 : 0
  ctx.save(); ctx.globalAlpha *= q
  if (img && img.width) ctx.drawImage(l.tint ? tinted(img, resolveColor(doc, l.tint, '#FFFFFF')) : img, x, y + dy, w, h)
  if (l.dress) drawLogoDress(ctx, l.dress, x, y + dy, w, h, t, (c, d) => resolveColor(doc, c, d), doc.canvas.w)
  ctx.restore()
}
function drawShape(ctx: Ctx, doc: Composition, l: ShapeLayer, local: number) {
  const a = l.in, q = a ? ease(a.ease, 'inOutCubic', inQ(l, local)) : 1; if (q <= 0) return
  const { x, y, w, h } = l.box, col = resolveColor(doc, l.color)
  ctx.save()
  if (a && (a.preset === 'fade' || a.preset === 'fade-up' || a.preset === 'pop')) ctx.globalAlpha *= q
  if (a && (a.preset === 'draw' || a.preset === 'wipe') && q < 1) { ctx.beginPath(); const f = a.from || 'left'; if (f === 'center') ctx.rect(x + w * (1 - q) / 2, y - 40, w * q, h + 80); else if (f === 'right') ctx.rect(x + w * (1 - q), y - 40, w * q, h + 80); else if (f === 'top') ctx.rect(x - 40, y, w + 80, h * q); else if (f === 'bottom') ctx.rect(x - 40, y + h * (1 - q), w + 80, h * q); else ctx.rect(x, y - 40, w * q, h + 80); ctx.clip() }
  ctx.beginPath()
  if (l.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (l.shape === 'line') { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h) }
  else if (l.radius && hasRR(ctx)) (ctx as any).roundRect(x, y, w, h, l.radius)
  else ctx.rect(x, y, w, h)
  if (l.stroke || l.shape === 'line') { ctx.strokeStyle = col; ctx.lineWidth = l.stroke || 2; ctx.stroke() } else { ctx.fillStyle = col; ctx.fill() }
  ctx.restore()
}
function drawVector(ctx: Ctx, doc: Composition, l: VectorLayer, local: number) {
  const a = l.in, q = a ? ease(a.ease, 'outCubic', inQ(l, local)) : 1; if (q <= 0) return
  const { x, y, w, h } = l.box
  ctx.save(); ctx.globalAlpha *= a && a.preset !== 'wipe' && a.preset !== 'draw' ? q : 1
  if (a && (a.preset === 'wipe' || a.preset === 'draw') && q < 1) { ctx.beginPath(); if (a.from === 'bottom') ctx.rect(x, y + h * (1 - q), w, h * q); else if (a.from === 'top') ctx.rect(x, y, w, h * q); else ctx.rect(x, y, w * q, h); ctx.clip() }
  const dy = a && a.preset === 'fade-up' ? (1 - q) * 22 : 0
  ctx.translate(x, y + dy); ctx.scale(w / l.viewBox[0], h / l.viewBox[1])
  for (const p of l.paths) {
    let path: Path2D; try { path = new Path2D(p.d) } catch { continue }
    if (p.fill) { ctx.fillStyle = resolveColor(doc, p.fill); ctx.fill(path) }
    if (p.stroke) { ctx.strokeStyle = resolveColor(doc, p.stroke); ctx.lineWidth = p.strokeWidth || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path) }
  }
  ctx.restore()
}
function drawButton(ctx: Ctx, doc: Composition, l: ButtonLayer, local: number) {
  const raw = inQ(l, local); if (raw <= 0) return
  const q = EASE.outBack(raw), { x, y, w, h } = l.box, s = l.in ? 0.92 + 0.08 * q : 1, st = styleOf(doc, l.style)
  ctx.save(); ctx.globalAlpha *= clamp(raw * 3); ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + h / 2))
  ctx.fillStyle = resolveColor(doc, l.fill); ctx.beginPath()
  if (hasRR(ctx)) (ctx as any).roundRect(x, y, w, h, l.radius ?? h / 2); else ctx.rect(x, y, w, h)
  ctx.fill()
  const size = buttonSize(doc, l, canvasMeasure(ctx))
  ctx.fillStyle = resolveColor(doc, l.color, '#FFFFFF'); ctx.textBaseline = 'middle'
  const tw = canvasMeasure(ctx)(st, size, shown(st, l.label))
  fillWord(ctx, st, size, shown(st, l.label), x + (w - tw) / 2, y + h / 2 + size * 0.04)
  if (hasLS(ctx)) (ctx as any).letterSpacing = '0px'
  ctx.restore()
}
/** The label's size: as set, shrunk only as far as needed to sit inside the button with air on both sides. */
export function buttonSize(doc: Composition, l: ButtonLayer, measure: Measure): number {
  const st = styleOf(doc, l.style)
  let size = l.size
  for (; size > 18; size--) if (measure(st, size, shown(st, l.label)) <= l.box.w - Math.max(48, l.box.h * 0.8)) break
  return size
}

function drawLayer(ctx: Ctx, doc: Composition, scene: Scene, l: Layer, local: number, t: number, A: Assets) {
  const W = doc.canvas.w, H = doc.canvas.h
  ctx.save()
  if (l.opacity != null) ctx.globalAlpha *= l.opacity
  if (l.rotate && l.type !== 'motif' && l.type !== 'fill' && 'box' in l) { const b = l.box as Box, cx = b.x + b.w / 2, cy = b.y + ((b as Box).h || 0) / 2; ctx.translate(cx, cy); ctx.rotate((l.rotate * Math.PI) / 180); ctx.translate(-cx, -cy) }
  if (l.type === 'fill') { ctx.fillStyle = resolveColor(doc, l.color); ctx.fillRect(0, 0, W, H) }
  else if (l.type === 'photo') drawPhoto(ctx, doc, l, local, scene.dur, A)
  else if (l.type === 'text') drawText(ctx, doc, l, local)
  else if (l.type === 'shape') drawShape(ctx, doc, l, local)
  else if (l.type === 'vector') drawVector(ctx, doc, l, local)
  else if (l.type === 'logo') drawLogo(ctx, doc, l, local, t, A)
  else if (l.type === 'button') drawButton(ctx, doc, l, local)
  else if (l.type === 'motif') drawMotif(ctx, l as MotifLayer, local, {
    W, t, color: (c, d) => resolveColor(doc, c, d),
    targetBox: id => { const tg = scene.layers.find(x => x.id === id); if (!tg || !('box' in tg)) return null; const b = tg.box as Box; return { box: tg.type === 'logo' ? { x: b.x, y: b.y, w: b.w, h: logoHeight(tg) } : b, pill: tg.type === 'button' } },
  })
  ctx.restore()
}
function drawScene(ctx: Ctx, doc: Composition, scene: Scene, local: number, t: number, A: Assets, hide?: Set<string>) {
  for (const l of scene.layers) if (!hide || !hide.has(l.id)) drawLayer(ctx, doc, scene, l, local, t, A)
}

/** Which scene is on screen at time t. */
export function sceneAt(doc: Composition, t: number): number {
  const S = doc.scenes
  for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].start) return i
  return 0
}
/** The moment a scene has fully arrived (every entrance done), for stills and for the audit. */
export function restTime(scene: Scene): number {
  let end = 0
  for (const l of scene.layers) if (l.in) end = Math.max(end, l.in.at + l.in.dur + (l.in.preset === 'rise-lines' ? (l.in.stagger ?? 0.1) * 3 : 0))
  return scene.start + Math.min(scene.dur - 0.05, Math.max(end + 0.15, scene.dur * 0.72))
}
/** The base ground of a scene (its first fill), as a hex colour. */
export function groundOf(doc: Composition, scene: Scene): string {
  const f = scene.layers.find(l => l.type === 'fill')
  return resolveColor(doc, f && f.type === 'fill' ? f.color : undefined, '#000000')
}

const buffers: { a: OffscreenCanvas | HTMLCanvasElement | null; b: OffscreenCanvas | HTMLCanvasElement | null } = { a: null, b: null }
function buf(which: 'a' | 'b', W: number, H: number) {
  let c = buffers[which]
  if (!c || c.width !== W || c.height !== H) { c = makeCanvas(W, H); buffers[which] = c }
  return c
}

/** THE FRAME at time t. `hide` leaves layers out (the audit samples what is behind a line of words that way). */
export function renderFrame(ctx: Ctx, doc: Composition, t: number, A: Assets, opts: { hide?: Set<string>; credit?: boolean } = {}) {
  const W = doc.canvas.w, H = doc.canvas.h, S = doc.scenes
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H)
  if (!S.length) { ctx.restore(); return }
  t = clamp(t, 0, Math.max(0, doc.canvas.duration - 1e-4))
  const i = sceneAt(doc, t), sc = S[i], local = t - sc.start, tr = sc.transitionIn
  const trDur = tr.dur || 0
  const A_ = i > 0 && trDur > 0 && local < trDur ? buf('a', W, H) : null, B_ = A_ ? buf('b', W, H) : null
  if (A_ && B_) {
    const prev = S[i - 1], ga = A_.getContext('2d') as Ctx, gb = B_.getContext('2d') as Ctx
    ga.setTransform(1, 0, 0, 1, 0, 0); gb.setTransform(1, 0, 0, 1, 0, 0)
    drawScene(ga, doc, prev, prev.dur + local, t, A, opts.hide); drawScene(gb, doc, sc, local, t, A, opts.hide)
    const q = ease(tr.ease, 'inOutCubic', local / trDur)
    const dx = tr.dir === 'left' ? -W : tr.dir === 'right' ? W : 0, dy = tr.dir === 'up' ? -H : tr.dir === 'down' ? H : 0
    if (tr.type === 'push') { ctx.drawImage(A_, dx * q, dy * q); ctx.drawImage(B_, -dx * (1 - q), -dy * (1 - q)) }
    else if (tr.type === 'slide') { ctx.drawImage(A_, 0, 0); ctx.fillStyle = `rgba(0,0,0,${0.25 * q})`; ctx.fillRect(0, 0, W, H); ctx.drawImage(B_, -dx * (1 - q), -dy * (1 - q)) }
    else if (tr.type === 'wipe') { ctx.drawImage(A_, 0, 0); ctx.save(); ctx.beginPath(); if (tr.dir === 'left') ctx.rect(W * (1 - q), 0, W * q, H); else if (tr.dir === 'right') ctx.rect(0, 0, W * q, H); else if (tr.dir === 'down') ctx.rect(0, 0, W, H * q); else ctx.rect(0, H * (1 - q), W, H * q); ctx.clip(); ctx.drawImage(B_, 0, 0); ctx.restore() }
    else if (tr.type === 'dip') { const g = groundOf(doc, sc); if (q < 0.5) { ctx.drawImage(A_, 0, 0); ctx.globalAlpha = q * 2; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H) } else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = (q - 0.5) * 2; ctx.drawImage(B_, 0, 0) } }
    else { ctx.drawImage(A_, 0, 0); ctx.globalAlpha = q; ctx.drawImage(B_, 0, 0) }
    ctx.globalAlpha = 1
  } else drawScene(ctx, doc, sc, local, t, A, opts.hide)
  // the music's licence line (CC BY tracks need their credit in the piece): small, at the foot of the last scene
  const credit = doc.assets.audio.music.credit
  if (opts.credit !== false && credit && i === S.length - 1 && !opts.hide) {
    // on its own small dark plate, so it reads whatever the design put at the foot of the frame
    const size = Math.round(20 * (W / 1080)), st: TypeStyle = { family: 'Instrument Sans', weight: 500, style: 'normal', lineHeight: 1.2, tracking: 0.01 }
    ctx.save(); ctx.globalAlpha = clamp((local - 0.6) / 0.5); ctx.textBaseline = 'alphabetic'
    const w = canvasMeasure(ctx)(st, size, credit), y = H - Math.round(40 * (H / 1920)), padX = size * 0.8
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath()
    if (hasRR(ctx)) (ctx as any).roundRect((W - w) / 2 - padX, y - size * 1.15, w + padX * 2, size * 1.7, size * 0.85); else ctx.rect((W - w) / 2 - padX, y - size * 1.15, w + padX * 2, size * 1.7)
    ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.92)'
    fillWord(ctx, st, size, credit, (W - w) / 2, y)
    if (hasLS(ctx)) (ctx as any).letterSpacing = '0px'
    ctx.restore()
  }
  ctx.restore()
}

/** The text or button under a point of the canvas at time t (topmost first) — for editing the words in place. */
export function hitText(doc: Composition, t: number, px: number, py: number, measure: Measure): { scene: number; layer: TextLayer | ButtonLayer; rect: { x0: number; y0: number; x1: number; y1: number } } | null {
  const i = sceneAt(doc, t), sc = doc.scenes[i]; if (!sc) return null
  for (let k = sc.layers.length - 1; k >= 0; k--) {
    const l = sc.layers[k]
    if (l.type === 'text') { const r = layoutText(doc, l, measure).rect, pad = 14; if (px >= r.x0 - pad && px <= r.x1 + pad && py >= r.y0 - pad && py <= r.y1 + pad) return { scene: i, layer: l, rect: r } }
    if (l.type === 'button') { const b = l.box; if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return { scene: i, layer: l, rect: { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } } }
  }
  return null
}
