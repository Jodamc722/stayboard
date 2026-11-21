// AD STUDIO — ONE PIECE, EVERY SHAPE (Jon, 2026-11-21: "From posts, to videos to shorts").
//
// A piece is designed for one frame: a vertical short, a story, a 4:5 feed post or a square. reflow() lays the same
// piece out for another of those frames, so one design becomes the Reel, the feed post and the square ad without
// being designed three times. No model is called.
//
// HOW. What matters in a design sits inside the safe area (the part the platform's own buttons leave clear), so the
// safe area of the old frame is mapped onto the safe area of the new one, and the bands outside it (where a
// photograph or a block of colour runs off the top or the foot) onto the new bands. The map only ever moves things
// up or down in the same order, so nothing that was clear of something else lands on it. Then:
//   · type is resized with the frame, never under the smallest size the studio allows, and its box is given the room
//     its lines need
//   · a circle stays a circle, a leaf keeps its shape, the logo keeps its proportions
//   · a photograph's window is re-cut for the new frame and never shows the photograph above its real pixels
//   · words, the logo and the button are kept inside the new safe area and clear of one another
// The result goes through the same validator and the same measured check as any other piece (the tests reflow every
// house design into every shape and require the check to pass). Pure and isomorphic.
import { CHANNELS, MIN_HEADLINE_PX, MIN_LABEL_PX, DEAD_BAND_MAX, type ChannelKey, type Composition, type Layer, type Scene, type Box, type PhotoLayer, type TextLayer } from './composition'
import { approxMeasure, layoutText, type Measure } from './player'
import { deadBand } from './audit'
import { fitPhoto } from './edit'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const OBJECT_MOTIFS = ['leaf', 'ornament', 'star', 'tree', 'firework']
export const SHAPE_LABEL: Record<ChannelKey, string> = { vertical: 'Vertical 9:16', story: 'Story 9:16', feed: 'Feed 4:5', square: 'Square 1:1' }

/** The same piece laid out for another frame. Returns the piece itself when it is already that shape.
 *  `measure` sizes the words (the browser passes the canvas's own; the default is the studio's approximation). */
export function reflow(doc: Composition, channel: ChannelKey, measure: Measure = approxMeasure): Composition {
  const to = CHANNELS[channel]
  if (!to) return doc
  const W = doc.canvas.w, H = doc.canvas.h, sf = doc.canvas.safe, ts = to.safe
  if (to.w === W && to.h === H && ts.top === sf.top && ts.bottom === sf.bottom && ts.left === sf.left && ts.right === sf.right) return doc
  const inH = Math.max(1, H - sf.top - sf.bottom), outH = to.h - ts.top - ts.bottom, ky = outH / inH
  // across: every shape is the same width today, so things keep their place (a different width scales them). Words,
  // the logo and the button are then brought inside the new safe area if they would leave it (inX, below); they are
  // not squeezed when they already fit, so a line that fitted still fits.
  const kx = to.w / W
  const mx = (x: number) => x * kx
  const inX = (b: Box): Box => {
    const lo = ts.left, hi = to.w - ts.right
    if (b.x >= lo - 0.5 && b.x + b.w <= hi + 0.5) return b
    const w = Math.min(b.w, hi - lo)
    return { ...b, w, x: Math.round(Math.max(lo, Math.min(hi - w, b.x))) }
  }
  // down: top band → top band, safe area → safe area, foot → foot
  const my = (y: number) => (y <= sf.top ? y * (ts.top / Math.max(1, sf.top)) : y >= H - sf.bottom ? to.h - ts.bottom + (y - (H - sf.bottom)) * (ts.bottom / Math.max(1, sf.bottom)) : ts.top + (y - sf.top) * ky)
  const kType = clamp(ky, 0.72, 1.12), kObj = clamp(ky, 0.6, 1.15)
  const safeTop = ts.top, safeBot = to.h - ts.bottom
  const mapBox = (b: Box): Box => { const x0 = mx(b.x), x1 = mx(b.x + b.w), y0 = my(b.y), y1 = my(b.y + b.h); return { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) } }
  /** Keeps its proportions: scaled about its own middle, which goes where the map sends it. */
  const mapWhole = (b: Box, k: number): Box => { const w = Math.max(1, Math.round(b.w * k)), h = Math.max(1, Math.round(b.h * k)), cx = mx(b.x + b.w / 2), cy = my(b.y + b.h / 2); return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h } }
  const lh = (style: string) => { const t = (doc.tokens.type as Record<string, { lineHeight?: number }>)[style]; return (t && t.lineHeight) || 1.1 }

  const scenes: Scene[] = doc.scenes.map(s => {
    let layers: Layer[] = s.layers.map((l): Layer => {
      if (l.type === 'fill') return l
      if (l.type === 'photo') {
        const a = doc.assets.photos[l.photo]
        const round = l.mask && l.mask.shape === 'circle'
        // an added image or object (drawn whole) keeps its shape; a photograph's window is re-cut
        const whole = !!a && a.source === 'upload' && a.kind !== 'video' && !l.cover
        const next = { ...l, box: round || whole ? mapWhole(l.box, kObj) : mapBox(l.box) } as PhotoLayer
        return a ? fitPhoto(next, a) : next
      }
      if (l.type === 'shape') {
        if (l.shape === 'ellipse' && Math.abs(l.box.w - l.box.h) <= Math.max(l.box.w, l.box.h) * 0.03) return { ...l, box: mapWhole(l.box, kObj) }
        // a hairline stays a hairline
        if (l.box.h <= 12) { const b = mapBox(l.box); return { ...l, box: { ...b, h: l.box.h } } }
        if (l.box.w <= 12) { const b = mapBox(l.box); return { ...l, box: { ...b, w: l.box.w } } }
        // a block squeezed into a short foot is still a block (never a hairline)
        const b = mapBox(l.box)
        return { ...l, box: { ...b, h: Math.max(b.h, 14), w: Math.max(b.w, 14) } }
      }
      if (l.type === 'vector') return { ...l, box: mapWhole(l.box, kObj) }
      if (l.type === 'motif') return { ...l, box: OBJECT_MOTIFS.indexOf(l.motif) >= 0 ? mapWhole(l.box, kObj) : mapBox(l.box) }
      if (l.type === 'logo') {
        // the small mark in a corner keeps its size; the large mark of an end card is sized with the frame
        const k = l.box.w > 220 ? clamp(ky, 0.78, 1.1) : 1, w = Math.round(l.box.w * k), cx = mx(l.box.x + l.box.w / 2)
        const nb = inX({ x: Math.round(l.box.w > 220 ? cx - w / 2 : mx(l.box.x)), y: Math.round(my(l.box.y)), w, h: 1 })
        return { ...l, box: { x: nb.x, y: nb.y, w: nb.w } }
      }
      if (l.type === 'button') {
        const b = inX(mapBox(l.box)), h = Math.max(84, Math.round(l.box.h * clamp(ky, 0.8, 1)))
        return { ...l, box: { ...b, h } }
      }
      // words
      const t = l as TextLayer, b = inX(mapBox(t.box)), line = lh(t.style)
      if (t.fit) {
        // from the size the headline is really set at (its width may have held it under its largest), so it keeps
        // the same weight in the frame and the same distance from what is beside it
        const drawn = Math.min(t.fit.max, layoutText(doc, t, measure).size || t.fit.max)
        const max = Math.max(MIN_HEADLINE_PX, Math.round(drawn * kType)), min = Math.min(max, Math.max(MIN_HEADLINE_PX, Math.round(t.fit.min * kType)))
        return { ...t, fit: { ...t.fit, max, min }, box: { ...b, h: Math.max(b.h, Math.ceil(t.fit.lines * max * line * 1.03)) } }
      }
      const lines = Math.max(1, Math.round(t.box.h / Math.max(1, (t.size || 28) * line)))
      // a label grows with a taller frame only as far as its line still fits its (possibly narrower) box
      let size = Math.max(MIN_LABEL_PX, Math.round((t.size || 28) * kType))
      const at = (n: number): TextLayer => ({ ...t, size: n, box: { ...b, h: Math.max(b.h, Math.ceil(lines * n * line * 1.04)) } })
      while (size > MIN_LABEL_PX && !layoutText(doc, at(size), measure).fits) size--
      return at(size)
    })

    // words, the logo and the button: inside the safe area, and clear of one another (they were; sizes that could
    // not shrink with the frame may now touch)
    type Item = { i: number; x0: number; x1: number; y0: number; y1: number }
    const hOf = (l: Layer): number => (l.type === 'logo' ? Math.round(l.box.w / 2.09) : (l as { box: Box }).box.h)
    const items: Item[] = []
    // (a short rule under a label belongs to the column of words: it moves with them, never through them)
    const isTick = (l: Layer) => l.type === 'shape' && !l.stroke && l.box.h <= 12 && l.box.w <= 400
    layers.forEach((l, i) => { if (l.type === 'text' || l.type === 'logo' || l.type === 'button' || isTick(l)) items.push({ i, x0: (l as { box: Box }).box.x, x1: (l as { box: Box }).box.x + (l as { box: Box }).box.w, y0: (l as { box: Box }).box.y, y1: (l as { box: Box }).box.y + hOf(l) }) })
    items.sort((a, b) => a.y0 - b.y0)
    const GAP = 6
    for (let n = 1; n < items.length; n++) {
      const cur = items[n]
      let need = 0
      for (let m = 0; m < n; m++) { const p = items[m]; if (Math.min(p.x1, cur.x1) - Math.max(p.x0, cur.x0) > 4 && p.y1 + GAP > cur.y0 && p.y0 < cur.y1) need = Math.max(need, p.y1 + GAP - cur.y0) }
      if (need > 0) { cur.y0 += need; cur.y1 += need }
    }
    // the column as a whole back inside the safe area
    if (items.length) {
      const top = Math.min(...items.map(x => x.y0)), bot = Math.max(...items.map(x => x.y1))
      let shift = 0
      if (bot > safeBot) shift = Math.max(safeTop - top, safeBot - bot)          // up, but never above the top
      else if (top < safeTop) shift = Math.min(safeTop - top, safeBot - bot)
      for (const it of items) { it.y0 += shift; it.y1 += shift }
    }
    layers = layers.map((l, i) => { const it = items.find(x => x.i === i); return it && l.type !== 'fill' && Math.round(it.y0) !== l.box.y ? ({ ...l, box: { ...l.box, y: Math.round(it.y0) } } as Layer) : l })

    // A CIRCLE, A LEAF OR A DRAWN SHAPE THAT WAS CLEAR OF THE WORDS STAYS CLEAR OF THEM. Kept whole, it can be larger
    // against a shorter frame than it was; it is made smaller toward the edge it hangs from until it is clear again.
    const isWhole = (l: Layer) => (l.type === 'shape' && l.shape === 'ellipse') || l.type === 'vector' || (l.type === 'motif' && OBJECT_MOTIFS.indexOf(l.motif) >= 0)
    const words = (L: Layer[]) => L.filter(l => l.type === 'text' || l.type === 'logo' || l.type === 'button').map(l => { const b = (l as { box: Box }).box; return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + hOf(l) } })
    const hits = (b: Box, R: { x0: number; y0: number; x1: number; y1: number }[]) => R.some(r => Math.min(r.x1, b.x + b.w) - Math.max(r.x0, b.x) > 6 && Math.min(r.y1, b.y + b.h) - Math.max(r.y0, b.y) > 6)
    const was = words(s.layers), now = words(layers)
    layers = layers.map((l, i) => {
      const src = s.layers[i]
      if (!isWhole(l) || !src || hits((src as { box: Box }).box, was)) return l
      let b = (l as { box: Box }).box
      for (let n = 0; n < 6 && hits(b, now); n++) {
        const w = Math.max(8, Math.round(b.w * 0.85)), h = Math.max(8, Math.round(b.h * 0.85))
        b = { x: b.x + b.w / 2 < to.w / 2 ? b.x : b.x + b.w - w, y: b.y + b.h / 2 < to.h / 2 ? b.y : b.y + b.h - h, w, h }
      }
      return b === (l as { box: Box }).box ? l : ({ ...l, box: b } as Layer)
    })
    return { ...s, layers }
  })

  let out: Composition = { ...doc, brief: { ...doc.brief, channel }, canvas: { ...doc.canvas, w: to.w, h: to.h, safe: { ...ts } }, scenes }
  // NO EMPTY BAND. A shorter frame can leave a gap between the words and the colour or photograph at the foot (or the
  // top) that is now too large a share of it. Whatever bounds the gap is carried into it: a block or a photograph
  // grows toward the words, never the other way.
  const limit = DEAD_BAND_MAX * to.h
  out = { ...out, scenes: out.scenes.map(s => {
    let sc = s
    for (let pass = 0; pass < 2; pass++) {
      const [d0, d1] = deadBand({ ...out, scenes: [sc] }, sc, measure), size = d1 - d0
      if (size <= limit - 2) break
      const grow = Math.ceil(size - limit * 0.9)
      const stretch = (l: Layer): Layer => {
        if (l.type !== 'shape' && l.type !== 'photo') return l
        if (l.type === 'shape' && (l.stroke || l.box.h <= 12)) return l                       // a frame or a hairline is not a block
        const b = l.box
        let nb: Box | null = null
        if (d1 < to.h - 1 && Math.abs(b.y - d1) <= 2) nb = { ...b, y: b.y - grow, h: b.h + grow }             // below the gap: up into it
        else if (d1 >= to.h - 1 && Math.abs(b.y + b.h - d0) <= 2) nb = { ...b, h: b.h + grow }                 // the gap is the foot: down into it
        if (!nb) return l
        if (l.type === 'photo') { const a = doc.assets.photos[l.photo]; return a ? fitPhoto({ ...l, box: nb }, a) : { ...l, box: nb } }
        return { ...l, box: nb }
      }
      const next = { ...sc, layers: sc.layers.map(stretch) }
      if (next.layers.every((l, i) => l === sc.layers[i])) break
      sc = next
    }
    return sc
  }) }
  return out

}

/** A copy of the piece in another shape, ready to save as a piece of its own (the server gives it its id). */
export function variantOf(doc: Composition, channel: ChannelKey, measure: Measure = approxMeasure): Composition {
  const d = reflow(doc, channel, measure)
  const base = doc.title.replace(/ · (Vertical 9:16|Story 9:16|Feed 4:5|Square 1:1)$/, '')
  return { ...d, id: 'piece', title: (base + ' · ' + SHAPE_LABEL[channel]).slice(0, 120), meta: { ...d.meta, origin: d.meta.origin === 'house' ? 'house' : 'edited' } }
}
