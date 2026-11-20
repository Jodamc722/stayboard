// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// The motif kit: the seasonal dressing a composition may place (never a layout). Jon, 2026-11-13: "I did not mind the
// Christmas designs, the lights … I like the Stay logos with different designs — keep them and make them great". So
// the string of bulbs, the bulbs round the Book button and the dressed mark live here, drawn as vectors at any size,
// joined by leaves, ornaments, a tree, sparkle, a firework burst and a deco fan of rays.
//
// Every motif is a pure function of (layer, time): no randomness, no clock, so frame N is always the same picture.
// Client-safe; types only from ./composition.
import type { MotifLayer, Box } from './composition'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const outCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
/** A steady pseudo-random number in 0..1 for (n, k): the same on every frame and every machine. */
export const hash = (n: number, k: number) => { const v = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v) }
const darker = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})` }
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }

export const BULBS: Record<string, string[]> = {
  multi: ['#F6C453', '#E4473F', '#F6C453', '#2FA866', '#F6C453', '#3F8FE0'],
  warm: ['#FFD27A', '#FFC65C', '#FFE0A0'],
  white: ['#FFFFFF', '#FFF6E0'],
}

// ── leaves (drawn in a 100 x 100 box) ───────────────────────────────────────────────────────────────────────────
const LEAF: Record<string, string> = {
  maple: 'M50 0 L59 20 L73 12 L70 36 L92 28 L82 50 L100 58 L78 67 L84 86 L60 78 L53 78 L52 100 L48 100 L47 78 L40 78 L16 86 L22 67 L0 58 L18 50 L8 28 L30 36 L27 12 L41 20 Z',
  oval: 'M50 2 C 76 18, 90 50, 52 90 L 52 100 L 48 100 L 48 90 C 10 50, 24 18, 50 2 Z',
}
const VEINS: Record<string, string> = {
  maple: 'M50 78 L50 8 M50 60 L84 34 M50 60 L16 34 M50 70 L90 58 M50 70 L10 58',
  oval: 'M50 90 L50 10 M50 70 L70 52 M50 70 L30 52 M50 52 L66 36 M50 52 L34 36 M50 34 L60 24 M50 34 L40 24',
}
export function drawLeaf(ctx: Ctx, variant: string, color: string, x: number, y: number, w: number, h: number, rot: number) {
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot * Math.PI / 180); ctx.scale(w / 100, h / 100); ctx.translate(-50, -50)
  if (variant === 'palm') {
    // a palm frond: a curved rib with leaflets fanning off both sides
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(50, 100); ctx.quadraticCurveTo(46, 50, 58, 4); ctx.stroke()
    for (let k = 0; k < 11; k++) {
      const f = k / 10, px = 50 - 4 * Math.sin(f * Math.PI) + 8 * f * f, py = 96 - f * 90, len = 34 * Math.sin(Math.PI * (0.12 + 0.88 * (1 - f * 0.75))), ang = 0.75 - f * 0.35
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(px, py)
        ctx.quadraticCurveTo(px + side * len * 0.55, py - len * 0.1 - 4, px + side * len * Math.cos(ang), py + len * Math.sin(ang) * 0.6)
        ctx.quadraticCurveTo(px + side * len * 0.4, py + 5, px, py + 3); ctx.fill()
      }
    }
    ctx.restore(); return
  }
  ctx.fillStyle = color; ctx.fill(new Path2D(LEAF[variant] || LEAF.oval))
  ctx.strokeStyle = darker(color, 0.72); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.stroke(new Path2D(VEINS[variant] || VEINS.oval))
  ctx.restore()
}

// ── bulbs ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** One bulb with its glow. `on` 0..1. */
function bulb(ctx: Ctx, x: number, y: number, r: number, color: string, on: number) {
  if (on > 0.05) {
    const R = r * 5.2
    ctx.save(); ctx.globalCompositeOperation = 'screen'
    const g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, rgba(color, 0.5 * on)); g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2); ctx.restore()
  }
  ctx.save(); ctx.globalAlpha *= 0.35 + 0.65 * on; ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.74, r, 0, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha *= 0.75 * on; ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.32, r * 0.2, r * 0.3, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
/** How lit bulb k of n is at scene time `local`: off until its turn (light-up), then a slow glow, never a flash. */
function lit(l: MotifLayer, local: number, t: number, k: number, n: number): number {
  const a = l.in
  const start = a ? a.at + (a.preset === 'light-up' ? (k / Math.max(1, n)) * a.dur : 0) : 0
  const up = clamp((local - start) / 0.28)
  return up * (0.74 + 0.26 * Math.sin(t * 2.1 + k * 1.9))
}
/** A string of bulbs swagged across the box: x..x+w at y, sagging by h. */
function stringLights(ctx: Ctx, l: MotifLayer, wire: string, local: number, t: number, u: number) {
  const { x, y, w, h } = l.box
  const swags = Math.max(1, Math.min(8, l.count ? Math.round(l.count / 4) : Math.round(w / (330 * u)))), per = 4, n = swags * per
  const yAt = (f: number) => y + h * Math.sin(((f * swags) % 1) * Math.PI)
  ctx.save(); ctx.strokeStyle = wire; ctx.lineWidth = 2.6 * u; ctx.lineJoin = 'round'; ctx.beginPath()
  for (let k = 0; k <= 180; k++) { const f = Math.min(0.9999, k / 180); if (k) ctx.lineTo(x + f * w, yAt(f)); else ctx.moveTo(x, yAt(0)) }
  ctx.stroke()
  const cols = BULBS[l.variant || 'multi'] || BULBS.multi
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n, bx = x + f * w, by = yAt(f)
    ctx.fillStyle = wire; ctx.fillRect(bx - 3.4 * u, by - 1 * u, 6.8 * u, 9 * u)
    bulb(ctx, bx, by + 17 * u, 10.5 * u, cols[k % cols.length], lit(l, local, t, k, n))
  }
  ctx.restore()
}
/** Bulbs all the way round a box (a pill for a button): the Book button dressed for Christmas. */
function bulbsAround(ctx: Ctx, l: MotifLayer, target: Box, pill: boolean, local: number, t: number, u: number) {
  const pad = 16 * u, { x, y, w, h } = target
  const r = pill ? h / 2 + pad : 26 * u, X = x - (pill ? 0 : pad), Y = y - pad, Wd = w + (pill ? 0 : 2 * pad), Hd = h + 2 * pad
  const straightH = Math.max(0, pill ? w - h : Wd - 2 * r), straightV = pill ? 0 : Math.max(0, Hd - 2 * r)
  const per = 2 * straightH + 2 * straightV + 2 * Math.PI * r
  const n = Math.max(10, Math.round(per / (58 * u))), cols = BULBS[l.variant || 'multi'] || BULBS.multi
  const cxL = pill ? x + h / 2 : X + r, cxR = pill ? x + w - h / 2 : X + Wd - r, cyT = pill ? y + h / 2 : Y + r, cyB = pill ? y + h / 2 : Y + Hd - r
  for (let k = 0; k < n; k++) {
    let d = (k / n) * per, px = 0, py = 0
    const q = (Math.PI * r) / 2
    if (d < straightH) { px = cxL + d; py = cyT - r }
    else if ((d -= straightH) < q) { const an = -Math.PI / 2 + d / r; px = cxR + Math.cos(an) * r; py = cyT + Math.sin(an) * r }
    else if ((d -= q) < straightV) { px = cxR + r; py = cyT + d }
    else if ((d -= straightV) < q) { const an = d / r; px = cxR + Math.cos(an) * r; py = cyB + Math.sin(an) * r }
    else if ((d -= q) < straightH) { px = cxR - d; py = cyB + r }
    else if ((d -= straightH) < q) { const an = Math.PI / 2 + d / r; px = cxL + Math.cos(an) * r; py = cyB + Math.sin(an) * r }
    else if ((d -= q) < straightV) { px = cxL - r; py = cyB - d }
    else { d -= straightV; const an = Math.PI + d / r; px = cxL + Math.cos(an) * r; py = cyT + Math.sin(an) * r }
    bulb(ctx, px, py, 6 * u, cols[k % cols.length], lit(l, local, t, k, n))
  }
}

function star(ctx: Ctx, cx: number, cy: number, r: number, points: number, color: string, rot = 0) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath()
  if (points === 4) { ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r) }
  else for (let k = 0; k < 10; k++) { const an = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r; if (k) ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr) }
  ctx.closePath(); ctx.fill(); ctx.restore()
}

/** How far in a motif is, 0..1 (1 when it has no entrance). */
const inQ = (l: MotifLayer, local: number) => (l.in ? clamp((local - l.in.at) / Math.max(0.01, l.in.dur)) : 1)

export type MotifEnv = { color: (c: string | undefined, d: string) => string; targetBox: (id: string) => { box: Box; pill: boolean } | null; W: number; t: number }

export function drawMotif(ctx: Ctx, l: MotifLayer, local: number, env: MotifEnv) {
  const u = env.W / 1080, { x, y, w, h } = l.box, raw = inQ(l, local), a = l.in
  if (l.motif === 'string-lights') { stringLights(ctx, l, env.color(l.color, '#1B1B1B'), local, env.t, u); return }
  if (l.motif === 'bulbs-around') { const tg = l.target ? env.targetBox(l.target) : null; bulbsAround(ctx, l, tg ? tg.box : l.box, tg ? tg.pill : false, local, env.t, u); return }
  if (l.motif === 'snow') {
    const n = l.count || 40
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.globalAlpha *= raw
    for (let k = 0; k < n; k++) {
      const z = hash(k, 1), r = (1.6 + 4.6 * z * z) * u
      const fy = ((hash(k, 2) + env.t * (0.018 + 0.03 * z)) % 1 + 1) % 1, fx = ((hash(k, 3) + 0.02 * Math.sin(env.t * 0.6 + k)) % 1 + 1) % 1
      ctx.fillStyle = rgba(env.color(l.color, '#FFFFFF'), 0.25 + 0.5 * hash(k, 4)); ctx.beginPath(); ctx.arc(x + fx * w, y + fy * h, r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore(); return
  }
  if (l.motif === 'sparkle') {
    const n = l.count || 12, col = env.color(l.color, '#FFFFFF')
    ctx.save(); ctx.globalAlpha *= raw
    for (let k = 0; k < n; k++) {
      const tw = Math.pow(0.5 + 0.5 * Math.sin(env.t * (1.3 + 1.6 * hash(k, 5)) + k * 2.3), 2), r = (6 + 16 * hash(k, 1)) * u * (0.45 + 0.55 * tw)
      const px = x + hash(k, 6) * w, py = y + hash(k, 7) * h
      ctx.save(); ctx.globalAlpha *= 0.35 + 0.65 * tw
      if (l.variant === 'dot') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, r * 0.4, 0, Math.PI * 2); ctx.fill() } else star(ctx, px, py, r, 4, col)
      ctx.restore()
    }
    ctx.restore(); return
  }
  if (l.motif === 'firework') {
    // one burst: it opens once from its entrance time, hangs, and is gone
    const at = a ? a.at : 0, life = a ? Math.max(0.8, a.dur) : 1.4, q = (local - at) / life
    if (q <= 0 || q >= 1) return
    const grow = 1 - Math.pow(1 - q, 3), fade = clamp(1.15 - q * 1.15), col = env.color(l.color, '#FFFFFF'), R = w / 2, n = l.count || 28
    ctx.save(); ctx.globalCompositeOperation = 'screen'
    for (let k = 0; k < n; k++) {
      const an = (k / n) * Math.PI * 2 + hash(k, 2) * 0.2, rr = R * grow * (0.72 + 0.28 * hash(k, 3))
      const px = x + w / 2 + Math.cos(an) * rr, py = y + h / 2 + Math.sin(an) * rr + R * 0.25 * q * q
      ctx.globalAlpha = fade * (0.55 + 0.45 * hash(k, 9)); ctx.fillStyle = k % 3 === 0 ? '#FFFFFF' : col
      ctx.beginPath(); ctx.arc(px, py, (2.4 + 2.6 * (1 - q)) * u, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha *= 0.4; ctx.beginPath(); ctx.arc(x + w / 2 + Math.cos(an) * rr * 0.84, y + h / 2 + Math.sin(an) * rr * 0.84 + R * 0.2 * q * q, 1.8 * u, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore(); return
  }
  if (l.motif === 'rays') {
    // a deco fan: wedges from the bottom centre of the box (fan) or its centre (full), opening once
    const full = l.variant === 'full', cx = x + w / 2, cy = full ? y + h / 2 : y + h, R = full ? Math.hypot(w, h) / 2 : Math.hypot(w / 2, h)
    const n = l.count || 14, span = full ? Math.PI * 2 : Math.PI, a0 = full ? 0 : Math.PI, open = outCubic(raw), col = env.color(l.color, '#FFFFFF')
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = col
    for (let k = 0; k < n; k += 2) {
      const mid = a0 + ((k + 0.5) / n) * span, half = (span / n) * 0.5 * open
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, mid - half, mid + half); ctx.closePath(); ctx.fill()
    }
    ctx.restore(); return
  }
  if (raw <= 0) return
  const q = outCubic(raw), settle = a && a.preset === 'settle'
  const dy = settle && l.motif !== 'ornament' ? (a!.fromY ?? -240) * (1 - q) : 0, sway = settle ? Math.sin(raw * Math.PI * 2.2) * 26 * u * (1 - q) : 0
  const rot = (l.rotate || 0) + (settle ? (a!.spin || 0) * (1 - q) : 0)
  ctx.save(); ctx.globalAlpha *= clamp(raw * 4)
  if (l.motif === 'leaf') drawLeaf(ctx, l.variant || 'oval', env.color(l.color, '#C4541C'), x + sway, y + dy, w, h, rot)
  else if (l.motif === 'star') star(ctx, x + w / 2 + sway, y + h / 2 + dy, w / 2, l.variant === 'five' ? 5 : 4, env.color(l.color, '#FFFFFF'), (rot * Math.PI) / 180)
  else if (l.motif === 'ornament') {
    // a bauble on a thread: the top of its box is where it hangs from, the ball sits at the bottom. It swings in once.
    const col = env.color(l.color, '#C8102E'), cx = x + w / 2, R = w / 2, top = Math.max(y, y + h - w * 1.16)
    const swing = settle ? Math.sin(raw * Math.PI * 3) * 0.16 * (1 - q) : 0
    ctx.translate(cx, y); ctx.rotate(swing); ctx.translate(-cx, -y)
    ctx.strokeStyle = rgba('#D9B66A', 0.9); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, top); ctx.stroke()
    ctx.fillStyle = '#D9B66A'; ctx.fillRect(cx - R * 0.2, top - R * 0.04, R * 0.4, R * 0.24)
    ctx.fillStyle = col; ctx.beginPath()
    if (l.variant === 'drop') { ctx.moveTo(cx, top + R * 0.16); ctx.bezierCurveTo(cx + R * 1.25, top + R * 0.9, cx + R * 0.95, top + R * 2.2, cx, top + R * 2.3); ctx.bezierCurveTo(cx - R * 0.95, top + R * 2.2, cx - R * 1.25, top + R * 0.9, cx, top + R * 0.16) }
    else ctx.arc(cx, top + R * 1.16, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(cx - R * 0.36, top + R * 0.86, R * 0.2, R * 0.34, -0.5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(cx, top + R * 1.16, R * 0.72, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke()
  } else if (l.motif === 'tree') {
    // a flat evergreen in three tiers with a star, a few bulbs glowing on it
    const col = env.color(l.color, '#1E6B43'), cx = x + w / 2, by = y + h + dy
    ctx.fillStyle = '#5A3A22'; ctx.fillRect(cx - w * 0.06, by - h * 0.12, w * 0.12, h * 0.12)
    const tiers = [[0.5, 0.12, 0.5], [0.4, 0.34, 0.36], [0.29, 0.56, 0.3]]   // half-width, base (from bottom), height — as shares of the box
    tiers.forEach(([hw, base, ht], k) => { ctx.fillStyle = k % 2 ? darker(col, 1.12) : col; ctx.beginPath(); ctx.moveTo(cx - w * hw, by - h * base); ctx.lineTo(cx + w * hw, by - h * base); ctx.lineTo(cx, by - h * (base + ht)); ctx.closePath(); ctx.fill() })
    star(ctx, cx, by - h * 0.88, w * 0.11, 5, '#F6C453')
    const cols = BULBS.multi
    for (let k = 0; k < 9; k++) {
      const f = hash(k, 3), yy = by - h * (0.16 + 0.6 * f), half = w * (0.42 - 0.34 * ((f * 0.6 + 0.16 - 0.12) / 0.74))
      bulb(ctx, cx + (hash(k, 5) * 2 - 1) * Math.max(6, half * 0.8), yy, 6 * u, cols[k % cols.length], 0.74 + 0.26 * Math.sin(env.t * 2 + k * 1.7))
    }
  }
  ctx.restore()
}

/** The Stay mark dressed for the season: a short string of bulbs across its shoulders, leaves, sparkle or a star. */
export function drawLogoDress(ctx: Ctx, dress: string, x: number, y: number, w: number, h: number, t: number, color: (c: string | undefined, d: string) => string, W: number) {
  const u = W / 1080
  if (dress === 'leaves') {
    drawLeaf(ctx, 'maple', color('pumpkin', '#C4541C'), x + w * 0.84, y - h * 0.34, w * 0.26, w * 0.26, 24)
    drawLeaf(ctx, 'oval', color('ochre', '#D9A441'), x + w * 0.7, y - h * 0.22, w * 0.16, w * 0.16, -38)
  } else if (dress === 'lights') {
    const n = 7, sag = h * 0.2, y0 = y - h * 0.22
    ctx.save(); ctx.strokeStyle = 'rgba(20,20,20,0.9)'; ctx.lineWidth = Math.max(1.5, 2.2 * u); ctx.beginPath()
    for (let k = 0; k <= 40; k++) { const f = k / 40, px = x - w * 0.04 + f * w * 1.08, py = y0 + sag * Math.sin(f * Math.PI); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py) }
    ctx.stroke(); ctx.restore()
    for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; bulb(ctx, x - w * 0.04 + f * w * 1.08, y0 + sag * Math.sin(f * Math.PI) + w * 0.03, Math.max(4, w * 0.022), BULBS.multi[k % BULBS.multi.length], 0.74 + 0.26 * Math.sin(t * 2.1 + k * 1.9)) }
  } else if (dress === 'sparkle') {
    const pts: [number, number, number][] = [[0.93, -0.12, 0.085], [1.02, 0.22, 0.045], [0.03, -0.08, 0.05]]
    pts.forEach(([fx, fy, fr], k) => { const tw = 0.6 + 0.4 * Math.sin(t * 2 + k * 2.1); ctx.save(); ctx.globalAlpha *= 0.5 + 0.5 * tw; star(ctx, x + w * fx, y + h * fy, w * fr * (0.7 + 0.3 * tw), 4, color('accent', '#F3D9A0')); ctx.restore() })
  } else if (dress === 'star') {
    star(ctx, x + w * 0.95, y - h * 0.08, w * 0.07, 5, color('accent', '#F6C453'), 0.2)
  }
}
