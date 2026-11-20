// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// What the player needs before it draws a frame, loaded and AWAITED: the fonts (the old exporter drew with whatever
// face had arrived), the logo, and each photograph. A photograph is fetched at the size it will be drawn — never
// larger than its real pixels — and, where the listing photo host can do it (Guesty serves Cloudinary), already
// cropped to its window around the subject (g_auto); a layer with its own focal point gets the whole photograph and
// is cropped by the player instead. Everything remote goes through the studio's same-origin image proxy so the canvas
// can be exported. Browser only.
import type { Composition, PhotoLayer, PhotoAsset } from './composition'
import { FONT_FILES, LOGO, photoSrcAllowed } from './composition'
import type { Assets, Img } from './player'

const CLOUD = /^https:\/\/(assets\.guesty\.com|res\.cloudinary\.com)\/(.*\/)?image\/upload\//i
/** Same-origin for the hosts the proxy serves; our own storage already allows the canvas to read it. */
const proxied = (u: string) => (u.startsWith('/') || /^https:\/\/[a-z0-9]+\.supabase\.co\//i.test(u) ? u : '/api/img-proxy?url=' + encodeURIComponent(u))

/** The address a photo layer's picture is fetched from. Exported for the tests. */
export function photoUrl(asset: PhotoAsset, l: PhotoLayer): string {
  if (!photoSrcAllowed(asset.src)) return ''
  if (!CLOUD.test(asset.src)) return asset.src
  const focal = l.focal || asset.focal
  const camMax = Math.max(l.camera?.from.scale || 1, l.camera?.to.scale || 1)
  if (focal) return asset.src.replace('/image/upload/', `/image/upload/c_limit,w_${Math.min(asset.w, 2800)},h_${Math.min(asset.h, 2800)},q_92,f_jpg/`)
  // cropped to the window around the subject, at the size it is drawn — and never beyond the photograph's own pixels
  let w = Math.round(l.box.w * camMax), h = Math.round(l.box.h * camMax)
  const k = Math.min(1, asset.w / w, asset.h / h)
  w = Math.max(2, Math.round(w * k)); h = Math.max(2, Math.round(h * k))
  return asset.src.replace('/image/upload/', `/image/upload/c_fill,g_auto,w_${w},h_${h},q_92,f_jpg/`)
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadImg(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise<HTMLImageElement | null>(res => {
      const im = new Image(); im.crossOrigin = 'anonymous'
      im.onload = () => { const done = () => res(im); if (im.decode) im.decode().then(done, done); else done() }
      im.onerror = () => res(null)
      im.src = url
    })
    imgCache.set(url, p)
  }
  return p
}

let fontsReady: Promise<void> | null = null
/** Every face the studio draws with, loaded and registered before the first frame. */
export function loadFonts(base = ''): Promise<void> {
  if (fontsReady) return fontsReady
  fontsReady = (async () => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return
    await Promise.all(FONT_FILES.map(async f => {
      try { const face = new FontFace(f.family, `url(${base}${f.file})`, { style: f.style, weight: f.weight }); await face.load(); (document as any).fonts.add(face) } catch { /* the fallback face draws; the audit still measures what is drawn */ }
    }))
  })()
  return fontsReady
}

export type Loaded = { assets: Assets; missing: string[] }
/** Load everything a composition draws. `resolve` lets a harness serve files from somewhere else. */
export async function loadAssets(doc: Composition, opts: { resolve?: (url: string) => string; fontBase?: string } = {}): Promise<Loaded> {
  const resolve = opts.resolve || proxied
  await loadFonts(opts.fontBase || '')
  const byLayer = new Map<string, HTMLImageElement | null>(), missing: string[] = []
  const jobs: Promise<void>[] = []
  for (const s of doc.scenes) for (const l of s.layers) {
    if (l.type !== 'photo') continue
    const a = doc.assets.photos[l.photo]; if (!a) continue
    const url = photoUrl(a, l)
    jobs.push(loadImg(url ? resolve(url) : '').then(im => { byLayer.set(l.id, im); if (!im) missing.push(l.photo) }))
  }
  const logos: Record<string, HTMLImageElement | null> = { black: null, white: null }
  jobs.push(loadImg(resolve(LOGO.black)).then(im => { logos.black = im }), loadImg(resolve(LOGO.white)).then(im => { logos.white = im }))
  await Promise.all(jobs)
  return { assets: { photo: l => (byLayer.get(l.id) as unknown as Img) || null, logo: v => (logos[v] as unknown as Img) || null }, missing }
}
