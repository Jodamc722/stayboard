// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// THE MEASURED AUDIT. Jon's ad rules, held as checks that are measured rather than guessed: the words are laid out
// with the same code that draws them (so "fits" means fits), contrast is computed from the colours actually behind a
// line (and sampled from the rendered pixels when a photograph is behind it), photographs are checked against their
// real pixel size, and the frame is scanned for large dead areas. A failure blocks export; nothing is ever "fixed" by
// shrinking type under its floor.
//
// Pure: takes a document and a Measure. In the browser the Measure is the canvas and a Sampler reads pixels; on the
// server and in the plain-node tests an approximate Measure runs the same checks.
import type { Composition, Scene, Layer, TextLayer, Box } from './composition'
import { resolveColor, lum, contrast, CHANNEL_NAMES } from './composition'
import { layoutText, logoHeight, maxUpscale, restTime, renderFrame, buttonSize, groundOf, type Measure, type Assets, type Ctx } from './player'

export type Issue = { sev: 'fail' | 'warn'; code: string; scene?: string; layer?: string; msg: string }
export type Rect = { x0: number; y0: number; x1: number; y1: number }
/** Luminance (0..1) of the darkest and lightest tenth of what is drawn behind `rect` in scene `i`, under layer `hideFrom`. */
export type Sampler = (sceneIndex: number, rect: Rect, hideFrom: number) => { lo: number; hi: number } | null
export type AuditResult = { ok: boolean; issues: Issue[]; fails: number; warns: number; measured: { text: number; photos: number; scenes: number } }

/** Codes that depend on exact glyph widths: on the server (approximate measure) they are advice, not grounds to rewrite. */
export const MEASURED_CODES = ['text-fit', 'text-lines', 'safe-area', 'decor-on-words', 'contrast-photo']

const PRICE = /[$€£]\s?\d|\b\d+\s?(usd|dollars|bucks)\b|\b\d{1,3}\s?%\s?off\b|\bper night\b|\/\s?night\b|\bnightly rate|\bdiscount|\bpromo code|\bbest rate|\bfree night/i
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b|\bcall us\b|\btext us\b/i
const textOf = (l: TextLayer) => l.runs.map(r => ('br' in r ? ' ' : r.t)).join('').replace(/\s+/g, ' ').trim()
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
const overlap = (a: Rect, b: Rect) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) })
const rectOf = (b: Box): Rect => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h })

/** What sits directly behind a rectangle, looking down the layer stack from just under layer `k`. */
function backdrop(doc: Composition, scene: Scene, k: number, r: Rect): { kind: 'flat'; color: string } | { kind: 'photo'; layer: string } {
  for (let j = k - 1; j >= 0; j--) {
    const l = scene.layers[j]
    if (l.type === 'fill') return { kind: 'flat', color: resolveColor(doc, l.color) }
    if (l.type === 'photo' && overlap(rectOf(l.box), r) > area(r) * 0.08) return { kind: 'photo', layer: l.id }
    if (l.type === 'button' && overlap(rectOf(l.box), r) > area(r) * 0.85) return { kind: 'flat', color: resolveColor(doc, l.fill) }
    if (l.type === 'shape' && !l.stroke && l.shape !== 'line' && (l.opacity ?? 1) >= 0.9) {
      const b = l.shape === 'ellipse' ? { x: l.box.x + l.box.w * 0.15, y: l.box.y + l.box.h * 0.15, w: l.box.w * 0.7, h: l.box.h * 0.7 } : l.box
      if (overlap(rectOf(b), r) > area(r) * 0.85) return { kind: 'flat', color: resolveColor(doc, l.color) }
    }
  }
  return { kind: 'flat', color: groundOf(doc, scene) }
}

/** Where every designed thing in a scene sits once it has arrived (the base ground is not a designed thing). */
function contentRects(doc: Composition, scene: Scene, measure: Measure): Rect[] {
  const out: Rect[] = [], u = doc.canvas.w / 1080
  for (const l of scene.layers) {
    if (l.type === 'fill') continue
    if (l.type === 'text') out.push(layoutText(doc, l, measure).rect)
    else if (l.type === 'logo') out.push({ x0: l.box.x, y0: l.box.y, x1: l.box.x + l.box.w, y1: l.box.y + logoHeight(l) })
    else if (l.type === 'motif' && l.motif === 'string-lights') out.push({ x0: l.box.x, y0: l.box.y, x1: l.box.x + l.box.w, y1: l.box.y + l.box.h + 30 * u })
    else if (l.type === 'motif' && (l.motif === 'firework' || l.motif === 'bulbs-around')) continue      // passing, or carried by its target
    else out.push(rectOf(l.box))
  }
  return out
}
/** The tallest full-width band with nothing designed in it, as [from, to] in canvas pixels. */
export function deadBand(doc: Composition, scene: Scene, measure: Measure): [number, number] {
  const H = doc.canvas.h
  const iv = contentRects(doc, scene, measure).map(r => [Math.max(0, r.y0), Math.min(H, r.y1)] as [number, number]).filter(v => v[1] > v[0]).sort((a, b) => a[0] - b[0])
  let best: [number, number] = [0, 0], cur = 0
  for (const [a, b] of iv) { if (a - cur > best[1] - best[0]) best = [cur, a]; cur = Math.max(cur, b) }
  if (H - cur > best[1] - best[0]) best = [cur, H]
  return best
}

export function auditComposition(doc: Composition, measure: Measure, opts: { sample?: Sampler } = {}): AuditResult {
  const issues: Issue[] = []
  const R = doc.rules, W = doc.canvas.w, H = doc.canvas.h, sf = doc.canvas.safe, u = W / 1080
  const safe: Rect = { x0: sf.left, y0: sf.top, x1: W - sf.right, y1: H - sf.bottom }
  const fail = (code: string, msg: string, scene?: string, layer?: string) => issues.push({ sev: 'fail', code, msg, scene, layer })
  const warn = (code: string, msg: string, scene?: string, layer?: string) => issues.push({ sev: 'warn', code, msg, scene, layer })
  const inside = (r: Rect) => r.x0 >= safe.x0 - 1 && r.x1 <= safe.x1 + 1 && r.y0 >= safe.y0 - 1 && r.y1 <= safe.y1 + 1
  const S = doc.scenes
  if (!S.length) { fail('empty', 'There is nothing to show yet.'); return { ok: false, issues, fails: 1, warns: 0, measured: { text: 0, photos: 0, scenes: 0 } } }

  let textN = 0, photoN = 0, logos = 0
  const seenKey = new Map<string, string>(), seenSrc = new Map<string, string>()
  const onScreen: string[] = []
  let lastPhotoSource = ''

  S.forEach((s, si) => {
    const textRects: { id: string; idx: number; r: Rect }[] = []
    let photosHere = 0
    s.layers.forEach((l, k) => {
      if (l.in && l.in.at + l.in.dur > s.dur - 0.8 && l.in.preset !== 'light-up' && !(l.type === 'motif' && l.motif === 'firework')) warn('late-entrance', `It is still arriving ${(s.dur - l.in.at - l.in.dur).toFixed(1)} s before the scene ends; let it rest longer.`, s.id, l.id)
      if (l.type === 'text') {
        textN++
        const L = layoutText(doc, l, measure), words = textOf(l)
        onScreen.push(words)
        textRects.push({ id: l.id, idx: k, r: L.rect })
        if (!L.fits) fail('text-fit', `“${words.slice(0, 40)}” does not fit its space at ${L.size}px, the smallest this design allows. Shorten the words.`, s.id, l.id)
        else if (L.tooManyLines) fail('text-lines', `“${words.slice(0, 40)}” runs to more lines than the design allows.`, s.id, l.id)
        if (L.size < R.minLabelPx * u) fail('text-small', `“${words.slice(0, 40)}” is ${L.size}px — under the ${Math.round(R.minLabelPx * u)}px floor for a phone screen.`, s.id, l.id)
        if (R.textInsideSafe && !inside(L.rect)) fail('safe-area', `“${words.slice(0, 40)}” leaves the safe area: the platform's own buttons would cover it.`, s.id, l.id)
        // contrast: every colour used in the line against what is really behind it
        const bd = backdrop(doc, s, k, L.rect)
        const styleBase = doc.tokens.type[l.style] || doc.tokens.type.display
        const colours = new Set<string>([resolveColor(doc, l.color, '#FFFFFF')])
        for (const r of l.runs) if (!('br' in r) && r.color) colours.add(resolveColor(doc, r.color, '#FFFFFF'))
        const large = L.size >= 52 * u && styleBase.weight >= 500
        const need = large ? 3 : 4.5
        const alpha = l.opacity ?? 1
        if (bd.kind === 'flat') {
          const bl = lum(bd.color)
          for (const c of Array.from(colours)) {
            const cl = lum(c) * alpha + bl * (1 - alpha), ratio = contrast(cl, bl)
            if (ratio < need) fail('contrast', `“${words.slice(0, 40)}” in ${c} on ${bd.color} has contrast ${ratio.toFixed(1)}:1; it needs ${need}:1 to be read on a phone.`, s.id, l.id)
          }
        } else {
          const smp = opts.sample ? opts.sample(si, L.rect, k) : null
          if (!smp) warn('contrast-photo', `“${words.slice(0, 40)}” sits on a photograph; its legibility is checked when the piece is drawn.`, s.id, l.id)
          else for (const c of Array.from(colours)) {
            const cl = lum(c), ratio = Math.min(contrast(cl, smp.lo), contrast(cl, smp.hi))
            if (ratio < need) fail('contrast-photo', `“${words.slice(0, 40)}” is hard to read over the photograph (${ratio.toFixed(1)}:1 at its worst; needs ${need}:1). Move the words onto a ground.`, s.id, l.id)
          }
        }
      } else if (l.type === 'button') {
        onScreen.push(l.label)
        if (!inside(rectOf(l.box))) fail('safe-area', `The “${l.label}” button leaves the safe area.`, s.id, l.id)
        const size = buttonSize(doc, l, measure)
        if (size < R.minLabelPx * u) fail('text-small', `The button's words are ${size}px — too small. Make the button wider or the label shorter.`, s.id, l.id)
        const ratio = contrast(lum(resolveColor(doc, l.color, '#FFFFFF')), lum(resolveColor(doc, l.fill)))
        if (ratio < 3) fail('contrast', `The button's words have contrast ${ratio.toFixed(1)}:1 against the button; it needs 3:1.`, s.id, l.id)
      } else if (l.type === 'logo') {
        logos++
        const r: Rect = { x0: l.box.x, y0: l.box.y, x1: l.box.x + l.box.w, y1: l.box.y + logoHeight(l) }
        if (!inside(r)) fail('safe-area', 'The Stay logo leaves the safe area.', s.id, l.id)
        const bd = backdrop(doc, s, k, r), ink = l.variant === 'black' ? '#000000' : resolveColor(doc, l.tint, '#FFFFFF')
        if (bd.kind === 'flat') { const ratio = contrast(lum(ink), lum(bd.color)); if (ratio < 3) fail('logo-contrast', `The ${l.variant} logo is lost on ${bd.color} (${ratio.toFixed(1)}:1). Use the ${l.variant === 'black' ? 'white' : 'black'} mark there.`, s.id, l.id) }
        else { const smp = opts.sample ? opts.sample(si, r, k) : null; if (smp) { const ratio = Math.min(contrast(lum(ink), smp.lo), contrast(lum(ink), smp.hi)); if (ratio < 2.4) fail('logo-contrast', `The logo is hard to see over the photograph (${ratio.toFixed(1)}:1). Move it onto a ground.`, s.id, l.id) } }
      } else if (l.type === 'photo') {
        photoN++; photosHere++
        const a = doc.assets.photos[l.photo]
        if (!a) { fail('photo-missing', 'A scene points at a photograph that is not in the piece.', s.id, l.id); return }
        lastPhotoSource = a.source
        if (seenKey.has(l.photo) || seenSrc.has(a.src)) fail('photo-reuse', `The same photograph is used twice (also in ${seenKey.get(l.photo) || seenSrc.get(a.src)}). Every scene gets its own.`, s.id, l.id)
        else { seenKey.set(l.photo, s.name); seenSrc.set(a.src, s.name) }
        const up = maxUpscale(l, a.w, a.h)
        if (up > R.maxPhotoUpscale + 0.005) fail('photo-soft', `This ${a.w}×${a.h} photograph is drawn at ${Math.round(up * 100)}% of its real size and will look soft. Make its window smaller (or use a larger photograph).`, s.id, l.id)
        if (R.photoArea && a.source === 'ours' && a.area && a.area !== R.photoArea) fail('photo-area', `${a.building || 'This photograph'} is not in the area this piece is about.`, s.id, l.id)
        if (R.photoTreatment === 'none' && l.treatment !== 'none') warn('photo-filter', 'This look shows photographs untreated; a filter is set on this one.', s.id, l.id)
      }
    })
    if (photosHere > 1) fail('collage', `${photosHere} photographs share the screen in “${s.name}”. One photograph at a time — never a grid or a collage.`, s.id)
    // decoration drawn over the words
    s.layers.forEach((l, k) => {
      if (l.type !== 'motif' && l.type !== 'vector') return
      if (l.type === 'motif' && (l.motif === 'bulbs-around' || l.motif === 'firework' || l.motif === 'snow' || l.motif === 'sparkle')) return
      const b: Rect = l.type === 'motif' && l.motif === 'string-lights' ? { x0: l.box.x, y0: l.box.y, x1: l.box.x + l.box.w, y1: l.box.y + l.box.h + 30 * u } : rectOf(l.box)
      for (const t of textRects) if (t.idx < k && overlap(b, { x0: t.r.x0 + 4, y0: t.r.y0 + 4, x1: t.r.x1 - 4, y1: t.r.y1 - 4 }) > 0) fail('decor-on-words', 'Decoration rests on the words; it should frame them.', s.id, l.id)
    })
    // large dead areas
    const [d0, d1] = deadBand(doc, s, measure)
    if ((d1 - d0) / H > R.deadBandMax + 0.001) fail('dead-area', `“${s.name}” leaves ${Math.round(((d1 - d0) / H) * 100)}% of the frame empty in one band (from ${Math.round(d0)} to ${Math.round(d1)} px down). Carry a photograph, a colour block or decoration into it.`, s.id)
  })

  // the piece as a whole
  if (!logos) fail('no-logo', 'The Stay logo is not in the piece.')
  const end = S[S.length - 1]
  if (!end.layers.some(l => l.type === 'logo')) warn('end-logo', 'The last scene has no logo.', end.id)
  if (end.dur < 3) fail('end-short', `The last scene holds ${end.dur.toFixed(1)} s — too short to read and act on. Give it at least 3 s.`, end.id)
  const endWords = end.layers.map(l => (l.type === 'button' ? l.label : l.type === 'text' ? textOf(l) : '')).join(' ')
  if (R.guestAd) { if (!end.layers.some(l => l.type === 'button' && /stay-hospitality\.com/i.test(l.label))) fail('end-cta', `A guest piece ends on a “${R.endsOn}” button.`, end.id) }
  else if (!/651[-. ]?200[-. ]?8283/.test(endWords) || !/nick/i.test(endWords)) fail('end-cta', `An owner piece ends on Nick's contact line (“${R.endsOn}”).`, end.id)
  if (lastPhotoSource && lastPhotoSource !== 'ours') fail('photo-source', 'The last photograph in a piece must be one of our own listings.')
  const kinds = new Set(S.map(s => s.transitionIn.type).filter(t => t !== 'none' && t !== 'cut'))
  if (kinds.size > R.maxTransitionKinds) fail('transitions', `${kinds.size} kinds of transition in one piece (${Array.from(kinds).join(', ')}). Keep to ${R.maxTransitionKinds}.`)
  if (!S[0].layers.some(l => (l.type === 'photo' || l.type === 'shape' || l.type === 'vector') && (!l.in || l.in.at <= 0.01 && l.in.preset === 'fade'))) warn('first-frame', 'The very first frame is a plain ground. Open on the photograph, already on screen.', S[0].id)
  const want = doc.brief.seconds || 15
  if (Math.abs(doc.canvas.duration - want) > want * 0.25) warn('duration', `The piece runs ${doc.canvas.duration.toFixed(1)} s; the brief asked for ${want} s.`)

  // words
  const spoken = doc.script.lines.map(x => x.vo), everything = onScreen.concat(spoken, [doc.social.caption])
  for (const b of R.bannedSpoken) for (const ln of doc.script.lines) if (ln.vo.toLowerCase().indexOf(b.toLowerCase()) >= 0) fail('banned-spoken', `“${b}” is in a spoken line; the voice mispronounces it. Keep it on screen only.`, ln.scene)
  for (const b of R.bannedAnywhere) { const re = new RegExp('(^|[^a-z])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i'); if (everything.some(x => re.test(x))) fail('banned-word', `“${b}” is not how we say it. Use “a local team and 24/7 guest support”.`) }
  if (R.noPrices) for (const x of everything) if (PRICE.test(x)) { fail('price', `A guest piece never shows a price or a discount (“${x.slice(0, 50)}”).`); break }
  if (R.noPhone) for (const x of everything) if (PHONE.test(x)) { fail('phone', `A guest piece never asks people to call or text (“${x.slice(0, 50)}”). The only ask is ${R.endsOn}.`); break }
  if (everything.some(x => /\b40\s?\+/.test(x)) && CHANNEL_NAMES.filter(n => everything.some(x => x.toLowerCase().indexOf(n.toLowerCase()) >= 0)).length < 3) fail('channels-unnamed', 'The piece says “40+” platforms without naming them. Show the channels by name (Airbnb, Vrbo, Booking.com, Expedia, Marriott …).')
  for (const ln of doc.script.lines) {
    const s = S.find(x => x.id === ln.scene); if (!s || !ln.vo) continue
    const words = ln.vo.replace(/stay-hospitality\.com/i, 'stay hospitality dot com').split(/\s+/).filter(Boolean).length
    if (words / s.dur > 3.2) warn('vo-fast', `${words} spoken words in ${s.dur.toFixed(1)} s is too fast to land.`, s.id)
  }
  const hook = S[0].layers.filter((l): l is TextLayer => l.type === 'text' && !!l.fit).map(textOf).join(' ').split(/\s+/).filter(Boolean).length
  if (hook > 7) warn('hook-long', `The opening headline is ${hook} words; people decide in a second and a half. Aim for 2 to 5.`, S[0].id)

  const fails = issues.filter(x => x.sev === 'fail').length
  return { ok: fails === 0, issues, fails, warns: issues.length - fails, measured: { text: textN, photos: photoN, scenes: S.length } }
}

/** The browser's sampler: draw the scene at rest without the layer in question (and whatever is above it), then read
 *  the pixels under the rectangle. Returns null when the canvas cannot be read. */
export function canvasSampler(doc: Composition, A: Assets, ctx: Ctx): Sampler {
  return (si, rect, hideFrom) => {
    try {
      const s = doc.scenes[si]
      const hide = new Set(s.layers.slice(hideFrom).map(l => l.id))
      renderFrame(ctx, doc, restTime(s), A, { hide, credit: false })
      const x = Math.max(0, Math.floor(rect.x0)), y = Math.max(0, Math.floor(rect.y0)), w = Math.min(doc.canvas.w - x, Math.ceil(rect.x1 - rect.x0)), h = Math.min(doc.canvas.h - y, Math.ceil(rect.y1 - rect.y0))
      if (w < 2 || h < 2) return null
      const d = ctx.getImageData(x, y, w, h).data, ls: number[] = []
      const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)))
      for (let yy = 0; yy < h; yy += step) for (let xx = 0; xx < w; xx += step) { const i = (yy * w + xx) * 4; ls.push(0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2])) }
      ls.sort((a, b) => a - b)
      return { lo: ls[Math.floor(ls.length * 0.1)], hi: ls[Math.floor(ls.length * 0.9)] }
    } catch { return null }
  }
}

/** One line per issue, for the composer's repair pass and for the report. */
export const issueLines = (issues: Issue[]) => issues.map(x => `- [${x.code}]${x.scene ? ' scene ' + x.scene : ''}${x.layer ? ' layer ' + x.layer : ''}: ${x.msg}`).join('\n')
export type { Layer }
