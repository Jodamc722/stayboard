// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// What the player needs before it draws a frame, loaded and AWAITED: the fonts (the old exporter drew with whatever
// face had arrived), the logo, and each photograph. A photograph is fetched at the size it will be drawn — never
// larger than its real pixels — and, where the listing photo host can do it (Guesty serves Cloudinary), already
// cropped to its window around the subject (g_auto); a layer with its own focal point gets the whole photograph and
// is cropped by the player instead. Everything remote goes through the studio's same-origin image proxy so the canvas
// can be exported. Browser only.
import type { Composition, PhotoLayer, PhotoAsset } from './composition'
import { FONT_FILES, LOGO, photoSrcAllowed, videoSrcAllowed } from './composition'
import { videoTimes, type Assets, type Img } from './player'

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

// ── VIDEO CLIPS (Jon, 2026-11-21: "add video, shorten the video, cut the video") ──────────────────────────────
// A clip is drawn from a <video> element, one per layer, so two scenes cut from the same file each hold their own
// place in it. The player only draws whatever frame the element is showing; putting it on the right frame is done
// here, two ways: loosely while the preview plays (the element plays itself and is nudged back if it drifts), and
// exactly, one seek per frame, for the export and the stills.
const videoCache = new Map<string, Promise<HTMLVideoElement | null>>()
let onVideoFrame: (() => void) | null = null
/** The preview asks to be told when a held clip has landed on a new frame, so it can draw it. */
export function setVideoListener(fn: (() => void) | null) { onVideoFrame = fn }
/** Stop every clip (the editor closed, or an export is about to drive them itself). */
export function pauseVideos() { videoCache.forEach(p => p.then(v => { try { v?.pause() } catch { /* already stopped */ } })) }
function loadVideo(key: string, url: string): Promise<HTMLVideoElement | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null)
  let p = videoCache.get(key)
  if (!p) {
    p = new Promise<HTMLVideoElement | null>(res => {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'
      let settled = false
      const ok = () => { if (settled) return; settled = true; v.width = v.videoWidth; v.height = v.videoHeight; res(v.videoWidth ? v : null) }
      const bad = () => { if (settled) return; settled = true; videoCache.delete(key); res(null) }
      v.addEventListener('loadeddata', ok, { once: true }); v.addEventListener('error', bad, { once: true })
      v.addEventListener('seeked', () => { onVideoFrame?.() })
      setTimeout(bad, 25000)
      v.src = url; v.load()
    })
    videoCache.set(key, p)
  }
  return p
}
const seekTo = (v: HTMLVideoElement, time: number) => new Promise<void>(res => {
  if (Math.abs(v.currentTime - time) < 0.004 && !v.seeking) { res(); return }
  let settled = false
  const done = () => { if (settled) return; settled = true; v.removeEventListener('seeked', done); res() }
  v.addEventListener('seeked', done); setTimeout(done, 2000)
  try { v.currentTime = time } catch { done() }
})

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
  const videos = new Map<string, HTMLVideoElement | null>()
  for (const s of doc.scenes) for (const l of s.layers) {
    if (l.type !== 'photo') continue
    const a = doc.assets.photos[l.photo]; if (!a) continue
    if (a.kind === 'video') {
      const src = videoSrcAllowed(a.src) ? resolve(a.src) : ''
      jobs.push(loadVideo(l.id + '|' + src, src).then(v => { videos.set(l.id, v); if (!v) missing.push(l.photo) }))
      continue
    }
    const url = photoUrl(a, l)
    jobs.push(loadImg(url ? resolve(url) : '').then(im => { byLayer.set(l.id, im); if (!im) missing.push(l.photo) }))
  }
  const logos: Record<string, HTMLImageElement | null> = { black: null, white: null }
  jobs.push(loadImg(resolve(LOGO.black)).then(im => { logos.black = im }), loadImg(resolve(LOGO.white)).then(im => { logos.white = im }))
  await Promise.all(jobs)
  const sync: Assets['sync'] = (d, t, playing, silent) => {
    const on = new Map(videoTimes(d, t).map(x => [x.layer.id, x] as const))
    videos.forEach((v, id) => {
      if (!v) return
      const x = on.get(id)
      try {
        if (!x) { if (!v.paused) v.pause(); return }
        v.playbackRate = x.speed; v.volume = Math.max(0, Math.min(1, x.sound || 0)); v.muted = !!silent || !(playing && x.sound > 0)
        if (playing) {
          // it plays itself; it is only moved when it has drifted from where the piece says it should be
          if (v.paused) { if (Math.abs(v.currentTime - x.time) > 0.08) v.currentTime = x.time; v.play().catch(() => {}) }
          else if (Math.abs(v.currentTime - x.time) > 0.35) v.currentTime = x.time
        } else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - x.time) > 0.02) v.currentTime = x.time }
      } catch { /* a clip that will not seek draws the frame it has */ }
    })
  }
  const seek: Assets['seek'] = async (d, t) => {
    const jobs2: Promise<void>[] = []
    for (const x of videoTimes(d, t)) { const v = videos.get(x.layer.id); if (!v) continue; try { if (!v.paused) v.pause(); v.muted = true } catch { /* fine */ } jobs2.push(seekTo(v, x.time)) }
    await Promise.all(jobs2)
  }
  const hasVideo = Array.from(videos.values()).some(Boolean)
  return { assets: { photo: l => ((videos.get(l.id) || byLayer.get(l.id)) as unknown as Img) || null, logo: v => (logos[v] as unknown as Img) || null, ...(hasVideo ? { sync, seek, hasVideo } : {}) }, missing }
}
