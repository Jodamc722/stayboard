// AD STUDIO EDITOR (Jon, 2026-11-20: "need to be able to change themes, songs, length of videos or scenes, transitions
// etc. Make it super interactive and easy to customize. Click into the video and change things, give you options,
// delete visuals, add photos, swap photo").
//
// EVERY CHANGE A PERSON CAN MAKE TO A PIECE, as pure functions: document in, new document out. The screen calls
// these; the player draws the result; the measured audit runs again. Nothing here talks to a model or the network,
// so every edit is instant and free, and the plain-node tests run the same code the browser does.
// What is saved still passes through sanitizeComposition (lib/adx/composition): an edit can never put anything into
// a piece that the composer could not.
import type { Composition, Scene, Layer, PhotoLayer, TextLayer, ShapeLayer, MotifLayer, MotifKey, PhotoAsset, Transition, Box, Entrance } from './composition'
import { lum, contrast, resolveColor } from './composition'
import { layoutText, logoHeight, maxUpscale, drawnScale, groundOf, type Measure } from './player'

const r30 = (x: number) => Math.round(x * 30) / 30
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
export const SCENE_MIN = 1.2, SCENE_MAX = 14

function touch(d: Composition): Composition {
  return { ...d, meta: { ...d.meta, origin: d.meta.origin === 'house' ? 'house' : 'edited' } }
}

/** Scenes laid end to end again after any change to their order or length; entrances and transitions kept inside. */
export function retime(doc: Composition, syncBrief = false): Composition {
  let at = 0
  const scenes = doc.scenes.map((s, i) => {
    const dur = r30(clamp(s.dur, SCENE_MIN, SCENE_MAX))
    let tr: Transition = s.transitionIn
    if (i === 0) tr = { type: 'none' }
    else if (tr.type === 'none') tr = { type: 'cut' }
    else if (tr.type !== 'cut') tr = { ...tr, dur: clamp(tr.dur ?? 0.5, 0.2, Math.min(1, dur * 0.4)) }
    const layers = s.layers.map(l => (l.in && l.in.at > Math.max(0, dur - 0.9) ? { ...l, in: { ...l.in, at: Math.max(0, r30(dur - 0.9 - Math.min(0.3, l.in.dur))) } } as Layer : l))
    const out: Scene = { ...s, start: Math.round(at * 1000) / 1000, dur, transitionIn: tr, layers }
    at += dur
    return out
  })
  const duration = Math.round(at * 1000) / 1000
  return touch({ ...doc, scenes, canvas: { ...doc.canvas, duration }, brief: syncBrief ? { ...doc.brief, seconds: Math.round(clamp(duration, 6, 60)) } : doc.brief })
}

// ── scenes ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function setSceneDur(doc: Composition, sid: string, dur: number): Composition {
  return retime({ ...doc, scenes: doc.scenes.map(s => (s.id === sid ? { ...s, dur } : s)) }, true)
}
/** The whole piece to `seconds`: every scene keeps its share (the end card never drops under 3 s). */
export function setTotal(doc: Composition, seconds: number): Composition {
  const cur = doc.scenes.reduce((a, s) => a + s.dur, 0) || 1, k = seconds / cur, last = doc.scenes.length - 1
  let scenes = doc.scenes.map((s, i) => ({ ...s, dur: clamp(s.dur * k, i === last ? 3 : SCENE_MIN, SCENE_MAX) }))
  // what the clamps took or gave is spread over the scenes that can still move
  const off = seconds - scenes.reduce((a, s) => a + s.dur, 0)
  if (Math.abs(off) > 0.05) { const free = scenes.filter((s, i) => s.dur + off / scenes.length > (i === last ? 3 : SCENE_MIN) && s.dur + off / scenes.length < SCENE_MAX); if (free.length) scenes = scenes.map(s => (free.indexOf(s) >= 0 ? { ...s, dur: s.dur + off / free.length } : s)) }
  return retime({ ...doc, scenes }, true)
}
export function setTransition(doc: Composition, sid: string, patch: Partial<Transition>): Composition {
  return retime({ ...doc, scenes: doc.scenes.map(s => (s.id === sid ? { ...s, transitionIn: cleanTransition({ ...s.transitionIn, ...patch }) } : s)) })
}
export function setAllTransitions(doc: Composition, tr: Transition): Composition {
  return retime({ ...doc, scenes: doc.scenes.map((s, i) => (i === 0 ? s : { ...s, transitionIn: cleanTransition(tr) })) })
}
function cleanTransition(t: Transition): Transition {
  if (t.type === 'none' || t.type === 'cut') return { type: t.type }
  const out: Transition = { type: t.type, dur: t.dur ?? 0.5 }
  if (t.ease) out.ease = t.ease
  if (t.type === 'push' || t.type === 'slide' || t.type === 'wipe') out.dir = t.dir || 'up'
  return out
}
export function renameScene(doc: Composition, sid: string, name: string): Composition {
  return touch({ ...doc, scenes: doc.scenes.map(s => (s.id === sid ? { ...s, name: name.slice(0, 60) } : s)) })
}
export function moveScene(doc: Composition, sid: string, by: -1 | 1): Composition {
  const i = doc.scenes.findIndex(s => s.id === sid), j = i + by
  if (i < 0 || j < 0 || j >= doc.scenes.length) return doc
  const scenes = doc.scenes.slice(); const [s] = scenes.splice(i, 1); scenes.splice(j, 0, s)
  return retime({ ...doc, scenes })
}
export function deleteScene(doc: Composition, sid: string): Composition {
  if (doc.scenes.length < 2) return doc
  return retime({ ...doc, scenes: doc.scenes.filter(s => s.id !== sid), script: { ...doc.script, lines: doc.script.lines.filter(l => l.scene !== sid) } }, true)
}
function allIds(doc: Composition): Set<string> {
  const ids = new Set<string>()
  for (const s of doc.scenes) { ids.add(s.id); for (const l of s.layers) ids.add(l.id) }
  return ids
}
function freshId(ids: Set<string>, base: string): string {
  const stem = base.replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'x'
  let n = 2, id = stem + '-' + n
  while (ids.has(id)) id = stem + '-' + ++n
  ids.add(id); return id
}
/** A new scene after `sid`, laid out like it, showing another photograph (every scene gets its own). */
export function addSceneLike(doc: Composition, sid: string, photoKey: string, asset: PhotoAsset): { doc: Composition; sceneId: string } {
  const i = doc.scenes.findIndex(s => s.id === sid); if (i < 0) return { doc, sceneId: sid }
  const src = doc.scenes[i], ids = allIds(doc), map = new Map<string, string>()
  const nid = freshId(ids, src.id)
  const key = photoKeyFor(doc, photoKey, asset)
  let layers = src.layers.map(l => { const id = freshId(ids, l.id); map.set(l.id, id); return { ...l, id } as Layer })
  layers = layers.map(l => (l.type === 'motif' && l.target && map.has(l.target) ? { ...l, target: map.get(l.target) } : l))
  let had = false
  layers = layers.map(l => { if (l.type !== 'photo') return l; had = true; return fitPhoto({ ...l, photo: key, focal: undefined }, asset) })
  const scene: Scene = { ...src, id: nid, name: (asset.shows || 'New scene').split(/[.,;:]/)[0].trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 30) || 'New scene', transitionIn: src.transitionIn.type === 'none' ? { type: 'cut' } : src.transitionIn, layers }
  let out: Composition = { ...doc, assets: { ...doc.assets, photos: { ...doc.assets.photos, [key]: asset } }, scenes: [...doc.scenes.slice(0, i + 1), scene, ...doc.scenes.slice(i + 1)] }
  if (!had) out = addPhoto(out, nid, key, asset).doc
  return { doc: retime(out, true), sceneId: nid }
}

// ── layers ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function findLayer(doc: Composition, lid: string): { scene: Scene; layer: Layer; si: number; li: number } | null {
  for (let si = 0; si < doc.scenes.length; si++) { const li = doc.scenes[si].layers.findIndex(l => l.id === lid); if (li >= 0) return { scene: doc.scenes[si], layer: doc.scenes[si].layers[li], si, li } }
  return null
}
export function patchLayer(doc: Composition, lid: string, fn: (l: Layer) => Layer): Composition {
  return touch({ ...doc, scenes: doc.scenes.map(s => (s.layers.some(l => l.id === lid) ? { ...s, layers: s.layers.map(l => (l.id === lid ? fn(l) : l)) } : s)) })
}
export function deleteLayer(doc: Composition, lid: string): Composition {
  return touch({ ...doc, scenes: doc.scenes.map(s => (s.layers.some(l => l.id === lid) ? { ...s, layers: s.layers.filter(l => l.id !== lid).map(l => (l.type === 'motif' && l.target === lid ? { ...l, target: undefined } : l)) } : s)) })
}
/** One step forward (drawn later, so on top) or back. The ground stays at the bottom. */
export function reorderLayer(doc: Composition, lid: string, by: -1 | 1): Composition {
  const f = findLayer(doc, lid); if (!f) return doc
  const layers = f.scene.layers.slice(), j = f.li + by
  if (j < (layers[0].type === 'fill' ? 1 : 0) || j >= layers.length) return doc
  const [l] = layers.splice(f.li, 1); layers.splice(j, 0, l)
  return touch({ ...doc, scenes: doc.scenes.map(s => (s.id === f.scene.id ? { ...s, layers } : s)) })
}
export function setBox(doc: Composition, lid: string, box: Partial<Box>): Composition {
  const W = doc.canvas.w, H = doc.canvas.h
  return patchLayer(doc, lid, l => {
    if (l.type === 'fill') return l
    const b = { ...(l.box as Box), ...box }
    const nb: any = { x: Math.round(clamp(b.x, -W, 2 * W)), y: Math.round(clamp(b.y, -H, 2 * H)), w: Math.round(clamp(b.w, l.type === 'logo' ? 60 : 24, l.type === 'logo' ? W : 2 * W)) }
    if (l.type !== 'logo') nb.h = Math.round(clamp(b.h ?? 1, l.type === 'shape' && l.shape === 'line' ? 1 : 24, 2 * H))
    return { ...l, box: nb } as Layer
  })
}
export function setEntrance(doc: Composition, lid: string, patch: Partial<Entrance> | null): Composition {
  const f = findLayer(doc, lid); if (!f) return doc
  return patchLayer(doc, lid, l => {
    if (patch === null) { const { in: _drop, ...rest } = l as any; return rest as Layer }
    const was: Entrance = l.in || { preset: 'fade', at: 0.2, dur: 0.6 }
    const next: Entrance = { ...was, ...patch }
    next.at = clamp(next.at, 0, Math.max(0, f.scene.dur - 0.9)); next.dur = clamp(next.dur, 0.15, 2.4)
    return { ...l, in: next } as Layer
  })
}
/** The entrances each kind of layer can make (the player draws nothing else for it). */
export const ENTRANCES: Record<string, { key: Entrance['preset']; label: string }[]> = {
  text: [{ key: 'fade', label: 'Fade' }, { key: 'fade-up', label: 'Float up' }, { key: 'rise-lines', label: 'Rise line by line' }, { key: 'track-in', label: 'Letters close in' }],
  photo: [{ key: 'fade', label: 'Fade' }, { key: 'wipe', label: 'Wipe open' }],
  shape: [{ key: 'fade', label: 'Fade' }, { key: 'draw', label: 'Draw on' }],
  vector: [{ key: 'fade', label: 'Fade' }, { key: 'fade-up', label: 'Float up' }, { key: 'draw', label: 'Draw on' }],
  logo: [{ key: 'fade', label: 'Fade' }, { key: 'fade-up', label: 'Float up' }],
  button: [{ key: 'pop', label: 'Pop' }],
  motif: [{ key: 'fade', label: 'Fade' }, { key: 'settle', label: 'Drop in' }],
}

// ── photographs ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The key a photograph goes under in this piece: its own if it is already here, a fresh one otherwise. */
export function photoKeyFor(doc: Composition, wanted: string, asset: PhotoAsset): string {
  for (const [k, a] of Object.entries(doc.assets.photos)) if (a.src === asset.src) return k
  let k = /^[a-z][a-z0-9-]{0,20}$/i.test(wanted) && !doc.assets.photos[wanted] ? wanted : 'u1'
  for (let n = 2; doc.assets.photos[k]; n++) k = 'u' + n
  return k
}
/** A photograph is never drawn past its real pixels: the camera's push is dropped first, then the window is made
 *  smaller round its centre. */
export function fitPhoto(l: PhotoLayer, a: PhotoAsset, max = 1): PhotoLayer {
  let out = l
  if (out.camera && maxUpscale(out, a.w, a.h) > max + 0.005) { const { camera: _c, ...rest } = out; out = rest as PhotoLayer }
  const up = maxUpscale(out, a.w, a.h)
  if (up > max + 0.005) {
    const k = max / up, w = Math.floor(out.box.w * k), h = Math.floor(out.box.h * k)
    out = { ...out, box: { x: Math.round(out.box.x + (out.box.w - w) / 2), y: Math.round(out.box.y + (out.box.h - h) / 2), w, h } }
  }
  return out
}
/** Which scene already shows this photograph (null if none) — every scene gets its own. */
export function photoInUse(doc: Composition, src: string, exceptLayer = ''): string | null {
  for (const s of doc.scenes) for (const l of s.layers) if (l.type === 'photo' && l.id !== exceptLayer && doc.assets.photos[l.photo]?.src === src) return s.name
  return null
}
export function swapPhoto(doc: Composition, lid: string, wantedKey: string, asset: PhotoAsset): Composition {
  const key = photoKeyFor(doc, wantedKey, asset)
  const d = { ...doc, assets: { ...doc.assets, photos: { ...doc.assets.photos, [key]: asset } } }
  return patchLayer(d, lid, l => (l.type === 'photo' ? fitPhoto({ ...l, photo: key, focal: undefined }, asset) : l))
}
/** A photograph into a scene that has none, as a window inside the safe area, under the words. */
export function addPhoto(doc: Composition, sid: string, wantedKey: string, asset: PhotoAsset): { doc: Composition; layerId: string } {
  const s = doc.scenes.find(x => x.id === sid); if (!s) return { doc, layerId: '' }
  const key = photoKeyFor(doc, wantedKey, asset), sf = doc.canvas.safe, W = doc.canvas.w, H = doc.canvas.h
  const w = W - sf.left - sf.right, h = Math.min(Math.round(w * 1.1), Math.round((H - sf.top - sf.bottom) * 0.55))
  const id = freshId(allIds(doc), sid + '-photo')
  const layer = fitPhoto({ id, type: 'photo', photo: key, box: { x: sf.left, y: Math.round(sf.top + (H - sf.top - sf.bottom - h) / 2), w, h }, treatment: 'none', mask: { shape: 'round', radius: 28 }, in: { preset: 'fade', at: 0, dur: 0.5 } }, asset)
  const at = Math.max(1, s.layers.findIndex(l => l.type === 'text' || l.type === 'logo' || l.type === 'button'))
  const layers = [...s.layers.slice(0, at), layer, ...s.layers.slice(at)]
  return { doc: touch({ ...doc, assets: { ...doc.assets, photos: { ...doc.assets.photos, [key]: asset } }, scenes: doc.scenes.map(x => (x.id === sid ? { ...x, layers } : x)) }), layerId: id }
}
export const CAMERAS: { key: string; label: string; camera?: PhotoLayer['camera'] }[] = [
  { key: 'still', label: 'Still' },
  { key: 'in', label: 'Push in', camera: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.08, x: 0, y: 0 } } },
  { key: 'out', label: 'Pull out', camera: { from: { scale: 1.08, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 } } },
  { key: 'left', label: 'Drift left', camera: { from: { scale: 1.06, x: 0.03, y: 0 }, to: { scale: 1.06, x: -0.03, y: 0 } } },
  { key: 'right', label: 'Drift right', camera: { from: { scale: 1.06, x: -0.03, y: 0 }, to: { scale: 1.06, x: 0.03, y: 0 } } },
]
export function cameraKey(l: PhotoLayer): string {
  const c = l.camera; if (!c) return 'still'
  const fs = c.from.scale || 1, ts = c.to.scale || 1, fx = c.from.x || 0, tx = c.to.x || 0
  if (Math.abs(fx - tx) > 0.005) return tx < fx ? 'left' : 'right'
  return ts > fs + 0.005 ? 'in' : fs > ts + 0.005 ? 'out' : 'still'
}

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** The palette colour that reads best on a ground. */
export function inkOn(doc: Composition, ground: string): string {
  const g = lum(ground)
  let best = Object.keys(doc.tokens.color)[0] || '#FFFFFF', top = 0
  for (const [k, v] of Object.entries(doc.tokens.color)) { const c = contrast(lum(v), g); if (c > top) { top = c; best = k } }
  return top >= 4.5 ? best : g > 0.4 ? '#000000' : '#FFFFFF'
}
export function addText(doc: Composition, sid: string, kind: 'headline' | 'label'): { doc: Composition; layerId: string } {
  const s = doc.scenes.find(x => x.id === sid); if (!s) return { doc, layerId: '' }
  const sf = doc.canvas.safe, W = doc.canvas.w, H = doc.canvas.h, w = W - sf.left - sf.right
  const id = freshId(allIds(doc), sid + (kind === 'headline' ? '-head' : '-label'))
  const color = inkOn(doc, groundOf(doc, s))
  const y = Math.round(sf.top + (H - sf.top - sf.bottom) * 0.42)
  const layer: TextLayer = kind === 'headline'
    ? { id, type: 'text', style: 'display', color, box: { x: sf.left, y, w, h: 230 }, fit: { max: 96, min: 64, lines: 2 }, runs: [{ t: 'Your words here' }], in: { preset: 'fade-up', at: 0.3, dur: 0.6 } }
    : { id, type: 'text', style: 'label', color, box: { x: sf.left, y: y + 250, w, h: 44 }, size: 30, runs: [{ t: 'A short label' }], in: { preset: 'fade', at: 0.5, dur: 0.5 } }
  return { doc: touch({ ...doc, scenes: doc.scenes.map(x => (x.id === sid ? { ...x, layers: [...x.layers, layer] } : x)) }), layerId: id }
}
/** Bigger or smaller, inside what a phone can read. */
export function resizeText(doc: Composition, lid: string, by: number): Composition {
  return patchLayer(doc, lid, l => {
    if (l.type === 'button') return { ...l, size: clamp(l.size + by, 26, 72) }
    if (l.type !== 'text') return l
    if (l.fit) { const max = clamp(l.fit.max + by * 4, 40, 280); return { ...l, fit: { ...l.fit, max, min: Math.min(l.fit.min, max) } } }
    return { ...l, size: clamp((l.size || 28) + by, 26, 280) }
  })
}

// ── themes: the colours of a piece, changed all at once ─────────────────────────────────────────────────────────
// A theme is a light, a dark and four accents. The piece's own colours are mapped onto it by role: its lightest
// colour becomes the theme's light, its darkest the dark, and the colours between take the accents in order of
// brightness — so what was a light ground stays light, what was dark type stays dark, and the measured check still
// has the last word on legibility. "Swap light and dark" turns a white page into a black one and back.
export type Theme = { key: string; label: string; light: string; dark: string; accents: [string, string, string, string] }
export const THEMES: Theme[] = [
  { key: 'stay', label: 'Stay black', light: '#FFFFFF', dark: '#000000', accents: ['#1E1E1E', '#6E6E6E', '#D2B077', '#EDEDED'] },
  { key: 'fall', label: 'Fall', light: '#F5EBDC', dark: '#2A1A12', accents: ['#7C1F2A', '#C4541C', '#8A9A7B', '#D9A441'] },
  { key: 'christmas', label: 'Christmas', light: '#F7EEDD', dark: '#07251A', accents: ['#17543B', '#B3122A', '#E3BC62', '#FFFFFF'] },
  { key: 'midnight', label: 'Midnight gold', light: '#FFFFFF', dark: '#0B0B0D', accents: ['#17171C', '#C9A45C', '#F0C7B4', '#EBD6A6'] },
  { key: 'gallery', label: 'Gallery colour', light: '#FAF8F3', dark: '#0B0B0B', accents: ['#1F3FD6', '#F0442B', '#F7B7C9', '#F5C400'] },
  { key: 'ocean', label: 'Ocean', light: '#F4F1EA', dark: '#0A2540', accents: ['#12507A', '#E8674A', '#5BB8C4', '#E9D8B4'] },
  { key: 'sunset', label: 'Sunset', light: '#FFF4E6', dark: '#2B1330', accents: ['#7A2E5C', '#E4572E', '#F29E4C', '#F7CFA0'] },
  { key: 'tropical', label: 'Tropical', light: '#F8F5EC', dark: '#0E2A22', accents: ['#1F6B4F', '#E0457B', '#F2A93B', '#BFE3C8'] },
  { key: 'mono', label: 'Black and white', light: '#FFFFFF', dark: '#111111', accents: ['#3A3A3A', '#7A7A7A', '#BDBDBD', '#E6E6E6'] },
]
// The mapping never costs legibility. Contrast between two colours depends only on how bright each is, so:
//   · every colour between the lightest and the darkest takes a theme accent's HUE but keeps its own brightness;
//   · the lightest may only get lighter and the darkest darker.
// Every pair of colours in the piece is therefore at least as far apart as the designer left it.
function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d < 1e-6) return [0, 0, l]
  const sat = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, Math.min(1, sat), l]
}
function hex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round(clamp((v + m) * 255, 0, 255)).toString(16).padStart(2, '0')
  return ('#' + to(r) + to(g) + to(b)).toUpperCase()
}
/** The same hue and saturation, as bright as `target` (WCAG relative luminance, 0 to 1). */
export function withLum(color: string, target: number, maxSat = 1): string {
  const [h, s0] = hsl(color), s = Math.min(s0, maxSat)
  let lo = 0, hi = 1
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (lum(hex(h, s, mid)) < target) lo = mid; else hi = mid }
  return hex(h, s, (lo + hi) / 2)
}
const HEX6 = /^#[0-9a-f]{6}$/i
/** Every colour written straight into a layer (not a palette key), mapped. */
function mapLiterals(doc: Composition, fn: (hex: string) => string): Composition {
  const c = (v: string | undefined) => (v && HEX6.test(v) ? fn(v) : v)
  const scenes = doc.scenes.map(s => ({ ...s, layers: s.layers.map(l => {
    if (l.type === 'fill' || l.type === 'shape') return { ...l, color: c(l.color)! }
    if (l.type === 'text') return { ...l, color: c(l.color)!, runs: l.runs.map(r => ('br' in r || !r.color ? r : { ...r, color: c(r.color) })) }
    if (l.type === 'button') return { ...l, fill: c(l.fill)!, color: c(l.color)! }
    if (l.type === 'motif') return l.color ? { ...l, color: c(l.color) } : l
    if (l.type === 'vector') return { ...l, paths: l.paths.map(p => ({ ...p, ...(p.fill ? { fill: c(p.fill) } : {}), ...(p.stroke ? { stroke: c(p.stroke) } : {}) })) }
    if (l.type === 'logo') return l.tint ? { ...l, tint: c(l.tint) } : l
    return l
  }) as Layer[] }))
  return { ...doc, scenes }
}
export function applyTheme(doc: Composition, theme: Theme): Composition {
  const entries = Object.entries(doc.tokens.color).sort((a, b) => lum(a[1]) - lum(b[1]))
  if (!entries.length) return doc
  const acc = theme.accents.slice().sort((a, b) => lum(a) - lum(b))
  const color: Record<string, string> = { ...doc.tokens.color }
  const mid = entries.slice(1, -1)
  const [dk, dv] = entries[0]
  color[dk] = lum(theme.dark) <= lum(dv) ? theme.dark : withLum(theme.dark, lum(dv))
  if (entries.length > 1) { const [lk, lv] = entries[entries.length - 1]; color[lk] = lum(theme.light) >= lum(lv) ? theme.light : withLum(theme.light, lum(lv)) }
  mid.forEach(([k, v], i) => { color[k] = withLum(acc[mid.length === 1 ? 1 : Math.round((i * (acc.length - 1)) / (mid.length - 1))], lum(v)) })
  return touch({ ...doc, tokens: { ...doc.tokens, color } })
}
/** Light grounds become dark and dark type becomes light. Each colour keeps its hue; its brightness is turned over
 *  in a way that leaves the contrast between every two colours exactly what it was. */
export function flipLightDark(doc: Composition): Composition {
  const vals = Object.values(doc.tokens.color).map(lum)
  if (!vals.length) return doc
  // a logo is pure black or white, so they are the ends of the scale whatever the palette holds
  const k = (0 + 0.05) * (1 + 0.05)
  // a deep colour turned light is softened, so a dark green ground becomes a pale one rather than a loud mint
  const turn = (c: string) => { const to = clamp(k / (lum(c) + 0.05) - 0.05, 0, 1); return withLum(c, to, to > 0.45 && lum(c) < 0.2 ? 0.34 : 1) }
  const color: Record<string, string> = {}
  for (const [key, v] of Object.entries(doc.tokens.color)) color[key] = turn(v)
  const d = mapLiterals({ ...doc, tokens: { ...doc.tokens, color } }, turn)
  // the mark follows the ground it now sits on (a tinted mark turns with its tint)
  const scenes = d.scenes.map(s => ({ ...s, layers: s.layers.map(l => (l.type !== 'logo' || (l.variant === 'white' && l.tint) ? l : { ...l, variant: l.variant === 'black' ? 'white' as const : 'black' as const, tint: undefined })) }))
  return touch({ ...d, scenes })
}
export function setColor(doc: Composition, key: string, hex: string): Composition {
  if (!/^#[0-9a-f]{6}$/i.test(hex) || !Object.prototype.hasOwnProperty.call(doc.tokens.color, key)) return doc
  return touch({ ...doc, tokens: { ...doc.tokens, color: { ...doc.tokens.color, [key]: hex.toUpperCase() } } })
}
export const HEADLINE_FACES: { key: string; label: string; family: string; weight: number }[] = [
  { key: 'serif', label: 'Serif', family: 'Fraunces', weight: 600 },
  { key: 'bold', label: 'Bold sans', family: 'Bricolage Grotesque', weight: 800 },
  { key: 'clean', label: 'Clean sans', family: 'Instrument Sans', weight: 700 },
]
export function setHeadlineFace(doc: Composition, family: string, weight: number): Composition {
  const was = doc.tokens.type.display
  return touch({ ...doc, tokens: { ...doc.tokens, type: { ...doc.tokens.type, display: { ...was, family, weight, style: 'normal' } } } })
}
export function setMusic(doc: Composition, track: string, credit: string, gain?: number): Composition {
  const m = doc.assets.audio.music
  return touch({ ...doc, assets: { ...doc.assets, audio: { ...doc.assets.audio, music: { ...m, track, credit, gain: gain == null ? m.gain : clamp(gain, 0, 1) } } } })
}
/** How long the music takes to fade out at the end (0 = it stops with the picture). */
export function setMusicFade(doc: Composition, seconds: number): Composition {
  const m = doc.assets.audio.music
  return touch({ ...doc, assets: { ...doc.assets, audio: { ...doc.assets.audio, music: { ...m, fadeOut: clamp(seconds, 0, 8) } } } })
}

// ── clicking into the picture ───────────────────────────────────────────────────────────────────────────────────
export type Rect = { x0: number; y0: number; x1: number; y1: number }
/** Where a layer sits on the canvas (the ground has no box: it is the whole frame). */
export function layerRect(doc: Composition, l: Layer): Rect | null {
  if (l.type === 'fill') return null
  if (l.type === 'logo') return { x0: l.box.x, y0: l.box.y, x1: l.box.x + l.box.w, y1: l.box.y + logoHeight(l) }
  const b = l.box as Box
  // a line is too thin to click or hold: its frame is a band round it
  if (l.type === 'shape' && l.shape === 'line' && b.h < 28) return { x0: b.x, y0: b.y - 14, x1: b.x + b.w, y1: b.y + b.h + 14 }
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
}
/** Everything under a point of the canvas in the scene on screen, the likeliest target first: words, the button and
 *  the logo before pictures; then the smallest thing, so a leaf on a photograph is picked before the photograph and
 *  the photograph before the colour block behind it. Clicking the same spot again walks down the list. */
export function hitLayers(doc: Composition, sceneIndex: number, px: number, py: number, measure: Measure): Layer[] {
  const sc = doc.scenes[sceneIndex]; if (!sc) return []
  const hits: { l: Layer; area: number; z: number; words: boolean }[] = []
  sc.layers.forEach((l, z) => {
    let r = layerRect(doc, l); if (!r) return
    if (l.type === 'text') { const t = layoutText(doc, l, measure).rect; r = { x0: t.x0 - 14, y0: t.y0 - 14, x1: t.x1 + 14, y1: t.y1 + 14 } }
    if (px < r.x0 || px > r.x1 || py < r.y0 || py > r.y1) return
    hits.push({ l, area: Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0)), z, words: l.type === 'text' || l.type === 'button' || l.type === 'logo' })
  })
  hits.sort((a, b) => (a.words !== b.words ? (a.words ? -1 : 1) : a.words ? b.z - a.z : a.area - b.area))
  return hits.map(h => h.l)
}
/** What a layer is, in words a person would use. */
export function layerName(doc: Composition, l: Layer): string {
  if (l.type === 'fill') return 'Background'
  if (l.type === 'photo' && doc.assets.photos[l.photo]?.source === 'upload') return 'Image' + (doc.assets.photos[l.photo].shows ? ' · ' + doc.assets.photos[l.photo].shows.slice(0, 40) : '')
  if (l.type === 'photo') { const a = doc.assets.photos[l.photo]; return 'Photo' + (a ? ' · ' + ([a.building, (a.shows || '').split(/[.,;]/)[0]].filter(Boolean).join(' · ').slice(0, 48)) : '') }
  if (l.type === 'text') { const t = l.runs.map(r => ('br' in r ? ' ' : r.t)).join('').replace(/\s+/g, ' ').trim(); return (l.fit ? 'Headline' : 'Label') + ' · “' + t.slice(0, 30) + (t.length > 30 ? '…' : '') + '”' }
  if (l.type === 'button') return 'Button · “' + l.label.slice(0, 30) + '”'
  if (l.type === 'logo') return 'Stay logo'
  if (l.type === 'shape') return l.shape === 'line' ? 'Line' : l.stroke ? 'Frame' : l.shape === 'ellipse' ? 'Circle' : 'Colour block'
  if (l.type === 'vector') return 'Drawn shape'
  const names: Record<string, string> = { leaf: 'Leaf', 'string-lights': 'String of lights', 'bulbs-around': 'Lights round the button', ornament: 'Ornament', tree: 'Tree', snow: 'Snow', sparkle: 'Sparkle', firework: 'Firework', rays: 'Rays', star: 'Star' }
  return names[l.motif] || 'Decoration'
}
/** The colour a layer is drawn in, when it has one a person can change. */
export function layerColor(doc: Composition, l: Layer): string | null {
  if (l.type === 'fill' || l.type === 'shape' || l.type === 'text') return resolveColor(doc, l.color)
  if (l.type === 'button') return resolveColor(doc, l.fill)
  if (l.type === 'motif') return l.color ? resolveColor(doc, l.color) : null
  if (l.type === 'vector') { const p = l.paths[0]; return p ? resolveColor(doc, p.fill || p.stroke) : null }
  return null
}
export function setLayerColor(doc: Composition, lid: string, color: string): Composition {
  return patchLayer(doc, lid, l => {
    if (l.type === 'fill' || l.type === 'shape' || l.type === 'text') return { ...l, color }
    if (l.type === 'button') return { ...l, fill: color }
    if (l.type === 'motif') return { ...l, color }
    if (l.type === 'vector') return { ...l, paths: l.paths.map(p => ({ ...p, ...(p.fill ? { fill: color } : {}), ...(p.stroke ? { stroke: color } : {}) })) }
    return l
  })
}

// ── adding things: shapes, decorations, your own image ──────────────────────────────────────────────────────────
// Jon, 2026-11-20: "Should be add shape or image or png tree or lights etc option when you click." Each lands where
// the picture was last clicked (or in the middle), UNDER the words so it can never cover them, and is selected so its
// options are open. Decorations are the engine's own drawn ones (the same the designer uses), so they animate.
export type Pt = { x: number; y: number }
/** Is this photo layer an image a person added (drawn whole, not one of the piece's photographs)? */
export const isAdded = (doc: Composition, l: Layer): boolean => l.type === 'photo' && doc.assets.photos[l.photo]?.source === 'upload'
/** A palette colour that shows on the scene's ground without shouting: the mid-tone furthest from it. */
export function accentOn(doc: Composition, scene: Scene): string {
  const g = lum(groundOf(doc, scene)), vals = Object.entries(doc.tokens.color)
  const mids = vals.filter(([, v]) => { const c = contrast(lum(v), g); return c >= 1.6 && lum(v) > 0.03 && lum(v) < 0.9 })
  const pickFrom = mids.length ? mids : vals
  return (pickFrom.slice().sort((a, b) => contrast(lum(b[1]), g) - contrast(lum(a[1]), g))[mids.length > 1 ? 1 : 0] || vals[0] || ['#888888'])[0]
}
function place(doc: Composition, w: number, h: number, at?: Pt): Box {
  const W = doc.canvas.w, H = doc.canvas.h, sf = doc.canvas.safe
  const cx = at ? at.x : W / 2, cy = at ? at.y : sf.top + (H - sf.top - sf.bottom) / 2
  return { x: Math.round(clamp(cx - w / 2, 0, Math.max(0, W - w))), y: Math.round(clamp(cy - h / 2, 0, Math.max(0, H - h))), w: Math.round(w), h: Math.round(h) }
}
/** Under the words (and the logo and button), over the ground, the photograph and whatever was already there. */
function insertUnderWords(doc: Composition, sid: string, layer: Layer, bottom = false): Composition {
  return touch({ ...doc, scenes: doc.scenes.map(s => {
    if (s.id !== sid) return s
    const first = s.layers.findIndex(l => l.type === 'text' || l.type === 'logo' || l.type === 'button')
    const at = bottom ? (s.layers[0]?.type === 'fill' ? 1 : 0) : first < 0 ? s.layers.length : first
    return { ...s, layers: [...s.layers.slice(0, at), layer, ...s.layers.slice(at)] }
  }) })
}
export const SHAPE_KINDS: { key: string; label: string }[] = [
  { key: 'block', label: 'Block' }, { key: 'rounded', label: 'Rounded block' }, { key: 'circle', label: 'Circle' }, { key: 'frame', label: 'Frame' }, { key: 'line', label: 'Line' },
]
export function addShape(doc: Composition, sid: string, kind: string, at?: Pt): { doc: Composition; layerId: string } {
  const s = doc.scenes.find(x => x.id === sid); if (!s) return { doc, layerId: '' }
  const id = freshId(allIds(doc), sid + '-' + kind), color = accentOn(doc, s), u = doc.canvas.w / 1080
  const base = { id, type: 'shape' as const, color, in: { preset: 'fade' as const, at: 0.2, dur: 0.5 } }
  const layer: ShapeLayer =
    kind === 'circle' ? { ...base, shape: 'ellipse', box: place(doc, 320 * u, 320 * u, at) }
    : kind === 'line' ? { ...base, shape: 'line', stroke: 6, box: { ...place(doc, 420 * u, 6, at), h: 1 }, in: { preset: 'draw', at: 0.2, dur: 0.6, from: 'left' } }
    : kind === 'frame' ? { ...base, shape: 'rect', stroke: 6, box: place(doc, 460 * u, 560 * u, at) }
    : kind === 'rounded' ? { ...base, shape: 'rect', radius: 36, box: place(doc, 420 * u, 300 * u, at) }
    : { ...base, shape: 'rect', box: place(doc, 420 * u, 300 * u, at) }
  return { doc: insertUnderWords(doc, sid, layer), layerId: id }
}
/** What a shape is now, in the words of SHAPE_KINDS. */
export function shapeKind(l: ShapeLayer): string { return l.shape === 'line' ? 'line' : l.shape === 'ellipse' ? 'circle' : l.stroke ? 'frame' : l.radius ? 'rounded' : 'block' }

export const DECORATIONS: { key: MotifKey; label: string; needsButton?: boolean }[] = [
  { key: 'string-lights', label: 'String of lights' }, { key: 'tree', label: 'Tree' }, { key: 'ornament', label: 'Ornament' }, { key: 'star', label: 'Star' },
  { key: 'snow', label: 'Snow' }, { key: 'sparkle', label: 'Sparkle' }, { key: 'firework', label: 'Firework' }, { key: 'leaf', label: 'Leaf' }, { key: 'rays', label: 'Rays' },
  { key: 'bulbs-around', label: 'Lights round the button', needsButton: true },
]
export const VARIANT_LABEL: Record<string, string> = { maple: 'Maple', oval: 'Oval', palm: 'Palm', multi: 'Coloured', warm: 'Warm white', white: 'White', ball: 'Ball', drop: 'Drop', four: 'Four points', five: 'Five points', dot: 'Dots', fan: 'Fan', full: 'Full circle', evergreen: 'Evergreen', soft: 'Soft', burst: 'Burst' }
export function addDecoration(doc: Composition, sid: string, motif: MotifKey, at?: Pt): { doc: Composition; layerId: string } {
  const s = doc.scenes.find(x => x.id === sid); if (!s) return { doc, layerId: '' }
  const W = doc.canvas.w, H = doc.canvas.h, u = W / 1080, sf = doc.canvas.safe
  const id = freshId(allIds(doc), sid + '-' + motif), accent = accentOn(doc, s)
  const settle = { preset: 'settle' as const, at: 0.4, dur: 0.9, fromY: -240, spin: 30 }, fade = { preset: 'fade' as const, at: 0.2, dur: 0.6 }
  let layer: MotifLayer, bottom = false
  if (motif === 'string-lights') layer = { id, type: 'motif', motif, variant: 'multi', box: { x: 0, y: Math.round(at ? clamp(at.y - 40 * u, 0, H - 120 * u) : 96 * u), w: W, h: Math.round(64 * u) }, in: { preset: 'light-up', at: 0.2, dur: 1.2 } }
  else if (motif === 'bulbs-around') { const b = s.layers.find(l => l.type === 'button'); if (!b || b.type !== 'button') return { doc, layerId: '' }; layer = { id, type: 'motif', motif, variant: 'multi', box: { ...b.box }, target: b.id, in: { preset: 'light-up', at: 0.6, dur: 1.2 } } }
  else if (motif === 'tree') layer = { id, type: 'motif', motif, variant: 'evergreen', box: place(doc, 260 * u, 340 * u, at || { x: W - sf.right - 150 * u, y: H - sf.bottom - 190 * u }), in: fade }
  else if (motif === 'ornament') layer = { id, type: 'motif', motif, variant: 'ball', color: accent, box: place(doc, 84 * u, 250 * u, at ? { x: at.x, y: at.y - 80 * u } : undefined), in: { ...settle, spin: 0 } }
  else if (motif === 'star') layer = { id, type: 'motif', motif, variant: 'five', color: accent, box: place(doc, 110 * u, 110 * u, at), in: fade }
  else if (motif === 'leaf') layer = { id, type: 'motif', motif, variant: 'maple', color: accent, rotate: -18, box: place(doc, 150 * u, 150 * u, at), in: settle }
  else if (motif === 'snow') layer = { id, type: 'motif', motif, variant: 'soft', count: 40, box: { x: 0, y: 0, w: W, h: H }, in: fade }
  else if (motif === 'sparkle') layer = { id, type: 'motif', motif, variant: 'four', count: 12, color: accent, box: place(doc, 520 * u, 420 * u, at), in: fade }
  else if (motif === 'firework') layer = { id, type: 'motif', motif, variant: 'burst', color: accent, box: place(doc, 520 * u, 520 * u, at), in: { preset: 'fade', at: 0.3, dur: 1.4 } }
  else { layer = { id, type: 'motif', motif: 'rays', variant: 'fan', color: accent, opacity: 0.35, box: place(doc, 760 * u, 520 * u, at), in: { preset: 'fade', at: 0.1, dur: 0.9 } }; bottom = true }
  return { doc: insertUnderWords(doc, sid, layer, bottom), layerId: id }
}
/** An image or PNG a person added: shown whole, at up to 40% of the frame's width and never past its real pixels. */
export function addImage(doc: Composition, sid: string, asset: PhotoAsset, at?: Pt): { doc: Composition; layerId: string } {
  const s = doc.scenes.find(x => x.id === sid); if (!s) return { doc, layerId: '' }
  const a: PhotoAsset = { ...asset, source: 'upload' }
  const key = photoKeyFor(doc, 'img1', a), W = doc.canvas.w
  const w = Math.min(a.w, Math.round(W * 0.4)), h = Math.round((w * a.h) / a.w)
  const id = freshId(allIds(doc), sid + '-image')
  const layer: PhotoLayer = { id, type: 'photo', photo: key, box: place(doc, w, h, at), treatment: 'none', in: { preset: 'fade', at: 0.2, dur: 0.5 } }
  const d = { ...doc, assets: { ...doc.assets, photos: { ...doc.assets.photos, [key]: a } } }
  return { doc: insertUnderWords(d, sid, layer), layerId: id }
}
/** How far past its real pixels a picture is drawn (1 = exactly its own size). */
export function upscaleOf(doc: Composition, l: PhotoLayer): number { const a = doc.assets.photos[l.photo]; return a ? drawnScale(l, a) : 1 }
