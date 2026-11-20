// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// EXPORT, FRAME BY FRAME. The old studio recorded its canvas in real time, so a slow frame was skipped and the file's
// frame rate wandered. Here every frame is drawn by the player at its exact time and handed to the browser's own
// H.264 encoder (WebCodecs); the samples are written to an MP4 by lib/adx/mp4. The result is a constant 30 fps at the
// canvas size, however busy the computer is, and usually faster than real time. Music is mixed offline and encoded to
// AAC the same way.
//
// When the browser cannot do that (no WebCodecs, no H.264 encoder, or no AAC encoder when music is wanted) the piece
// is recorded the way the studio always has (MediaRecorder on the canvas, in real time) and the result says so.
// Browser only.
import type { Composition } from './composition'
import { MUSIC_FADE_IN } from './composition'
import { renderFrame, type Assets, type Ctx } from './player'
import { muxMp4, type Mp4Sample } from './mp4'

export type ExportPath = 'webcodecs' | 'recorder'
export type ExportResult = { blob: Blob; ext: 'mp4' | 'webm'; path: ExportPath; note: string; frames: number; ms: number; audio: boolean }
export type ExportOpts = { musicUrl?: string; musicGain?: number; onProgress?: (done: number, total: number, stage: string) => void; forceRecorder?: boolean }

const H264 = ['avc1.64002A', 'avc1.640028', 'avc1.4D402A', 'avc1.4D0028', 'avc1.42E02A', 'avc1.42E028']
const tick = () => new Promise<void>(r => setTimeout(r, 0))

/** What this browser can do, in words the studio can show. */
export async function exportSupport(doc: Composition, wantAudio: boolean): Promise<{ video: string | null; audio: boolean; why: string }> {
  const VE = (globalThis as any).VideoEncoder, AE = (globalThis as any).AudioEncoder
  if (!VE || !(globalThis as any).VideoFrame) return { video: null, audio: false, why: 'this browser has no frame-by-frame video encoder (WebCodecs)' }
  let video: string | null = null
  for (const codec of H264) {
    try { const r = await VE.isConfigSupported({ codec, width: doc.canvas.w, height: doc.canvas.h, bitrate: 12_000_000, framerate: 30, avc: { format: 'avc' } }); if (r && r.supported) { video = codec; break } } catch { /* next */ }
  }
  if (!video) return { video: null, audio: false, why: 'this browser cannot encode H.264 at this size' }
  let audio = false
  if (wantAudio && AE) { try { const r = await AE.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }); audio = !!(r && r.supported) } catch { audio = false } }
  return { video, audio, why: wantAudio && !audio ? 'this browser cannot encode AAC sound' : '' }
}

function canvasFor(doc: Composition): { cv: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } {
  const cv = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: doc.canvas.w, height: doc.canvas.h }) : new OffscreenCanvas(doc.canvas.w, doc.canvas.h)
  return { cv, ctx: cv.getContext('2d', { alpha: false }) as Ctx }
}

/** The music bed for the whole piece, mixed offline: fade in, hold, fade out with the end card. (Phase 2 adds the voice here.) */
async function mixAudio(doc: Composition, musicUrl: string, gain: number): Promise<AudioBuffer | null> {
  const OAC = (globalThis as any).OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext
  if (!OAC || !musicUrl) return null
  const dur = doc.canvas.duration, sr = 48000
  const ctx: OfflineAudioContext = new OAC(2, Math.ceil(dur * sr), sr)
  const ab = await fetch(musicUrl).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  if (!ab) return null
  const music = await ctx.decodeAudioData(ab)
  const src = ctx.createBufferSource(); src.buffer = music
  const g = ctx.createGain(); src.connect(g); g.connect(ctx.destination)
  // the fade a person chose in the editor (0 = the music stops with the picture, with a breath of a ramp so it does not click)
  const out = Math.max(0.04, Math.min(doc.assets.audio.music.fadeOut, Math.max(0.1, dur - MUSIC_FADE_IN)))
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(gain, MUSIC_FADE_IN); g.gain.setValueAtTime(gain, Math.max(MUSIC_FADE_IN, dur - out)); g.gain.linearRampToValueAtTime(0, dur)
  src.start(0)
  return ctx.startRendering()
}

async function encodeAac(buf: AudioBuffer): Promise<{ samples: Mp4Sample[]; asc: Uint8Array }> {
  const AE = (globalThis as any).AudioEncoder, AD = (globalThis as any).AudioData
  const samples: Mp4Sample[] = []; let asc: Uint8Array | null = null, err: any = null
  const enc = new AE({
    output: (chunk: any, meta: any) => {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); samples.push({ data: d, dur: 1024, key: true })
      const desc = meta?.decoderConfig?.description; if (desc && !asc) asc = new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength))
    },
    error: (e: any) => { err = e },
  })
  enc.configure({ codec: 'mp4a.40.2', sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 192000 })
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, N = 4096
  for (let o = 0; o < buf.length; o += N) {
    const n = Math.min(N, buf.length - o), data = new Float32Array(n * 2)
    data.set(L.subarray(o, o + n), 0); data.set(R.subarray(o, o + n), n)
    const ad = new AD({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / buf.sampleRate) * 1e6), data })
    enc.encode(ad); ad.close()
    if (o % (N * 32) === 0) await tick()
  }
  await enc.flush(); enc.close()
  if (err) throw err
  // AAC-LC at 48 kHz stereo when the encoder did not hand its configuration over
  return { samples, asc: asc || new Uint8Array([0x11, 0x90]) }
}

async function viaWebCodecs(doc: Composition, A: Assets, codec: string, audioBuf: AudioBuffer | null, o: ExportOpts): Promise<ExportResult> {
  const t0 = performance.now(), fps = doc.canvas.fps, total = Math.round(doc.canvas.duration * fps), TS = 90000, FD = TS / fps
  const { cv, ctx } = canvasFor(doc)
  const VE = (globalThis as any).VideoEncoder, VF = (globalThis as any).VideoFrame
  const samples: Mp4Sample[] = []; let avcC: Uint8Array | null = null, err: any = null, lastTs = -1
  const enc = new VE({
    output: (chunk: any, meta: any) => {
      if (chunk.timestamp <= lastTs) err = err || new Error('frames came back out of order'); lastTs = chunk.timestamp
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); samples.push({ data: d, dur: FD, key: chunk.type === 'key' })
      const desc = meta?.decoderConfig?.description; if (desc && !avcC) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength))
    },
    error: (e: any) => { err = e },
  })
  enc.configure({ codec, width: doc.canvas.w, height: doc.canvas.h, bitrate: 12_000_000, framerate: fps, avc: { format: 'avc' } })
  for (let f = 0; f < total; f++) {
    if (err) break
    renderFrame(ctx, doc, f / fps, A)
    const vf = new VF(cv, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) })
    enc.encode(vf, { keyFrame: f % fps === 0 }); vf.close()
    while (enc.encodeQueueSize > 6 && !err) await tick()
    if (f % 6 === 0) { o.onProgress?.(f, total, 'Drawing and encoding'); await tick() }
  }
  await enc.flush(); enc.close()
  if (err) throw err
  if (!avcC) throw new Error('the encoder gave no stream description')
  if (samples.length !== total) throw new Error(`the encoder returned ${samples.length} of ${total} frames`)
  let audio: { samples: Mp4Sample[]; asc: Uint8Array } | null = null
  if (audioBuf) { o.onProgress?.(total, total, 'Encoding the sound'); audio = await encodeAac(audioBuf) }
  const file = muxMp4({ video: { width: doc.canvas.w, height: doc.canvas.h, timescale: TS, avcC, samples }, audio: audio ? { sampleRate: audioBuf!.sampleRate, channels: 2, asc: audio.asc, samples: audio.samples } : null })
  return { blob: new Blob([file.buffer as ArrayBuffer], { type: 'video/mp4' }), ext: 'mp4', path: 'webcodecs', note: `Frame by frame, ${total} frames at a constant ${fps} fps${audio ? ', with sound' : ', no sound'}.`, frames: total, ms: Math.round(performance.now() - t0), audio: !!audio }
}

/** The studio's original way: record the canvas while it plays, in real time. Kept as the fallback. */
async function viaRecorder(doc: Composition, A: Assets, o: ExportOpts, why: string): Promise<ExportResult> {
  const t0 = performance.now(), fps = doc.canvas.fps, total = Math.round(doc.canvas.duration * fps)
  if (typeof document === 'undefined' || !(globalThis as any).MediaRecorder) throw new Error('This browser can neither encode frame by frame nor record video. Use a current Chrome, Edge or Safari.')
  const { cv, ctx } = canvasFor(doc)
  const canvas = cv as HTMLCanvasElement
  let vs = (canvas as any).captureStream(0) as MediaStream, vtrack: any = vs.getVideoTracks()[0]
  if (!vtrack || typeof vtrack.requestFrame !== 'function') { vs = (canvas as any).captureStream(fps); vtrack = null }
  const tracks = [...vs.getVideoTracks()]
  let actx: AudioContext | null = null, src: AudioBufferSourceNode | null = null, hasAudio = false
  if (o.musicUrl) {
    try {
      actx = new AudioContext(); if (actx.state === 'suspended') await actx.resume()
      const ab = await fetch(o.musicUrl).then(r => r.arrayBuffer()), buf = await actx.decodeAudioData(ab), dest = actx.createMediaStreamDestination()
      src = actx.createBufferSource(); src.buffer = buf
      const g = actx.createGain(), dur = doc.canvas.duration, t = actx.currentTime + 0.12, gain = o.musicGain ?? 0.5
      const out = Math.max(0.04, Math.min(doc.assets.audio.music.fadeOut, Math.max(0.1, dur - MUSIC_FADE_IN)))
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + MUSIC_FADE_IN); g.gain.setValueAtTime(gain, t + Math.max(MUSIC_FADE_IN, dur - out)); g.gain.linearRampToValueAtTime(0, t + dur)
      src.connect(g); g.connect(dest); tracks.push(...dest.stream.getAudioTracks()); hasAudio = true
    } catch { actx = null; src = null }
  }
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  const mime = types.find(x => MediaRecorder.isTypeSupported(x)) || ''
  if (!mime) throw new Error('This browser cannot record video. Use a current Chrome, Edge or Safari.')
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 20_000_000, audioBitsPerSecond: 192_000 })
  const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise<void>(res => { rec.onstop = () => res() })
  renderFrame(ctx, doc, 0, A); vtrack?.requestFrame()
  rec.start(500)
  const start = performance.now() + 120
  if (src && actx) src.start(actx.currentTime + 0.12)
  let last = -1
  await new Promise<void>(res => {
    const step = () => {
      const x = Math.max(0, (performance.now() - start) / 1000), n = Math.floor(x * fps)
      if (n > last && n < total) { last = n; renderFrame(ctx, doc, n / fps, A); vtrack?.requestFrame(); if (n % 6 === 0) o.onProgress?.(n, total, 'Recording in real time') }
      if (x >= doc.canvas.duration + 0.15) { res(); return }
      if (document.visibilityState === 'visible') requestAnimationFrame(step); else setTimeout(step, 1000 / fps)
    }
    step()
  })
  try { src?.stop() } catch { /* done */ }
  rec.stop(); await done
  try { await actx?.close() } catch { /* fine */ }
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext, path: 'recorder', note: `Recorded in real time with the studio's recorder because ${why}. Keep this tab in front while it records.${ext === 'webm' ? ' The file is WebM; Instagram needs MP4, so export from Chrome or Safari for posting.' : ''}`, frames: last + 1, ms: Math.round(performance.now() - t0), audio: hasAudio }
}

/** The piece as a video file. Says which way it was made. */
export async function exportVideo(doc: Composition, A: Assets, o: ExportOpts = {}): Promise<ExportResult> {
  const wantAudio = !!o.musicUrl
  const sup = await exportSupport(doc, wantAudio)
  if (o.forceRecorder) return viaRecorder(doc, A, o, 'the recorder was asked for')
  if (!sup.video) return viaRecorder(doc, A, o, sup.why)
  if (wantAudio && !sup.audio) return viaRecorder(doc, A, o, sup.why)
  try {
    let audioBuf: AudioBuffer | null = null
    if (wantAudio) { o.onProgress?.(0, 1, 'Mixing the sound'); audioBuf = await mixAudio(doc, o.musicUrl!, o.musicGain ?? 0.5) }
    return await viaWebCodecs(doc, A, sup.video, audioBuf, o)
  } catch (e: any) {
    return viaRecorder(doc, A, o, 'the frame-by-frame encoder stopped (' + String(e?.message || e).slice(0, 80) + ')')
  }
}

/** One frame as a PNG at full size. */
export async function exportPng(doc: Composition, A: Assets, t: number): Promise<Blob> {
  const { cv, ctx } = canvasFor(doc)
  renderFrame(ctx, doc, t, A)
  if ('convertToBlob' in cv) return (cv as OffscreenCanvas).convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((res, rej) => (cv as HTMLCanvasElement).toBlob(b => (b ? res(b) : rej(new Error('could not make the image'))), 'image/png'))
}
