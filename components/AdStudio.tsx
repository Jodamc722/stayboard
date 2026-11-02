'use client'
// AD STUDIO — the editor (Jon, 2026-11-02: "a video editor for ads that we can build, prompt, have
// you write scripts, get previews … think Final Cut Pro but AI, built for custom ads").
//
// Left: the brief and the ads. Centre: the viewer, which IS the renderer (lib/ad-engine drawFrame)
// running live. Right: the inspector for the selected scene. Bottom: the timeline — scenes, voice and
// music tracks with a playhead you can drag. Export records that same renderer to a file, so the
// preview cannot disagree with the download.
//
// No drop-downs (Jon's standing UI rule): every choice is a visible button.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AdProject, type AdScene, type AdKind, type AdFormat, type AdAssets, type AdAudience, type AdTemplate,
  FORMATS, FORMAT_LABEL, VOICES, MUSIC, KINDS, LEAD, TEMPLATES, timeline, drawFrame, sceneAt, voiceSig, riskyWords, newSceneId,
} from '@/lib/ad-engine'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

type ListRow = { id: string; name: string; updatedAt: string; updatedBy: string; scenes: number; format: string }
type Hit = { url: string; view?: string; thumb: string; caption: string; unit: string; building: string; width: number | null }
type LibVideo = { key: string; name: string; url: string; thumb: string; dur: number; format: string; builtin: boolean; createdAt: string; by: string; path?: string }

const UI = {
  bg: '#0E1116', panel: '#151A21', panel2: '#1B222B', line: '#262E39', ink: '#E8EBEF', mut: '#8C96A3', gold: '#D2B077', blue: '#4C8DF6', red: '#E5675C', green: '#4CC488',
}
const KIND_COLOR: Record<AdKind, string> = {
  cta: '#E0A64C', title: '#C9A15E', photo: '#5C8FD6', stats: '#6CB28C', wall: '#9A7FD1', cards: '#D07F5C', feed: '#4FA7B8', checks: '#8FB04A', rise: '#D4677C', contact: '#B58B3E',
}
const AUD: Record<AdAudience, { label: string; brief: string; hint: string }> = {
  owners: { label: 'Owners', brief: 'property owners', hint: 'Sell management: revenue, team, Lighthouse; ends on Nick' },
  partners: { label: 'Partners', brief: 'realtors, lenders and tax advisors who refer owners', hint: 'For referral partners; ends on Nick' },
  guests: { label: 'Guests', brief: 'travellers choosing where to stay in South Florida', hint: 'Sell the stay; ends on Book at stay-hospitality.com' },
}
const proxied = (u: string) => (!u ? '' : u.startsWith('/') ? u : /guesty|cloudinary|muscache/i.test(u) ? '/api/img-proxy?url=' + encodeURIComponent(u) : u)
const fmtT = (s: number) => { const m = Math.floor(s / 60); const r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) }

function Btn({ on, children, onClick, title, tone, disabled, small }: { on?: boolean; children: React.ReactNode; onClick?: () => void; title?: string; tone?: 'gold' | 'blue' | 'red'; disabled?: boolean; small?: boolean }) {
  const bg = tone === 'gold' ? UI.gold : tone === 'blue' ? UI.blue : tone === 'red' ? 'transparent' : on ? '#2A3442' : 'transparent'
  const fg = tone === 'gold' ? '#1B1408' : tone === 'blue' ? '#fff' : tone === 'red' ? UI.red : on ? UI.ink : UI.mut
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      style={{ background: bg, color: fg, border: '1px solid ' + (tone ? (tone === 'red' ? '#5a2a26' : 'transparent') : on ? '#3A4657' : UI.line), borderRadius: 8, padding: small ? '4px 8px' : '7px 12px', fontSize: small ? 11.5 : 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
const Label = ({ children }: { children: React.ReactNode }) => <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut, margin: '14px 0 6px' }}>{children}</p>
const field: React.CSSProperties = { boxSizing: 'border-box', width: '100%', background: UI.panel2, color: UI.ink, border: '1px solid ' + UI.line, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.45, fontFamily: 'inherit', resize: 'vertical' }

export default function AdStudio({ display, body, canEdit, canDelete }: { display: string; body: string; canEdit: boolean; canDelete: boolean }) {
  const [list, setList] = useState<ListRow[]>([])
  const [p, setP] = useState<AdProject | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState<string>('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty' | ''>('')
  const [brief, setBrief] = useState('')
  const [seconds, setSeconds] = useState(30)
  const [side, setSide] = useState<'ads' | 'templates' | 'videos'>('ads')
  const [lib, setLib] = useState<LibVideo[]>([])
  const [libPct, setLibPct] = useState<number | null>(null)
  const [watch, setWatch] = useState<LibVideo | null>(null)
  const [keepCopy, setKeepCopy] = useState(true)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgs = useRef<Record<string, HTMLImageElement>>({})
  const logo = useRef<HTMLImageElement | null>(null)
  const actx = useRef<AudioContext | null>(null)
  const voiceBuf = useRef<{ url: string; buf: AudioBuffer } | null>(null)
  const musicBuf = useRef<Record<string, AudioBuffer>>({})
  const play0 = useRef<{ at: number; from: number; nodes: AudioScheduledSourceNode[] } | null>(null)
  const pRef = useRef<AdProject | null>(null)
  const tRef = useRef(0)
  const saveTimer = useRef<any>(null)
  const vids = useRef<Record<string, HTMLVideoElement>>({})
  const libRef = useRef<LibVideo[]>([])
  const live = useRef(false) // true while playing or exporting: videos run instead of seeking
  libRef.current = lib
  pRef.current = p
  tRef.current = t

  const tl = useMemo(() => (p ? timeline(p) : null), [p])
  const stale = !!(p && p.voice && p.voice.sig !== voiceSig(p))
  const hasVoice = !!(p && p.voice && !stale)

  // ── loading ───────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    const r = await fetch('/api/ads').then(x => x.json()).catch(() => null)
    if (r?.ok) setList(r.projects || [])
  }, [])
  const open = useCallback(async (id: string) => {
    stop()
    const r = await fetch('/api/ads?id=' + encodeURIComponent(id)).then(x => x.json()).catch(() => null)
    if (!r?.ok) { setErr(r?.error || 'Could not open that ad.'); return }
    setP(r.project); setAudioUrl(r.audioUrl || null); setSel(0); setT(1.6); setSaved('saved'); setBrief(r.project.prompt || '')
    try { localStorage.setItem('adstudio.last', id) } catch { /* fine */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadList().then(() => {
      let last = ''
      try { last = localStorage.getItem('adstudio.last') || '' } catch { /* fine */ }
      if (last) open(last)
    })
    const l = new Image(); l.src = '/ads/stay-logo-gold.svg'; l.onload = () => { logo.current = l }
    loadLib()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const newAd = async () => {
    setBusy('new'); setErr('')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'Could not start a new ad.'); return }
    setP(r.project); setAudioUrl(null); setSel(0); setT(1.6); setSaved('saved'); setBrief('')
    loadList()
  }

  // ── editing + autosave ────────────────────────────────────────────────
  const change = (fn: (d: AdProject) => AdProject) => {
    if (!canEdit) return
    setP(cur => (cur ? fn(cur) : cur))
    setSaved('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1200)
  }
  const save = async () => {
    const cur = pRef.current
    if (!cur || !canEdit) return
    setSaved('saving')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: cur }) }).then(x => x.json()).catch(() => null)
    if (r?.ok) { setSaved(pRef.current === cur ? 'saved' : 'dirty'); setList(l => l.map(x => (x.id === cur.id ? { ...x, name: cur.name, scenes: cur.scenes.length, updatedAt: r.project.updatedAt } : x))) }
    else { setSaved('dirty'); setErr(r?.error || 'Save failed — your changes are still here; try again.') }
  }
  const setScene = (i: number, patch: Partial<AdScene>) => change(d => ({ ...d, scenes: d.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  const move = (from: number, to: number) => {
    if (!p || from === to || to < 0 || to >= p.scenes.length) return
    change(d => { const a = d.scenes.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...d, scenes: a } })
    setSel(to)
  }
  const addScene = (kind: AdKind) => {
    if (!p) return
    const at = Math.min(p.scenes.length, sel + 1)
    change(d => { const a = d.scenes.slice(); a.splice(at, 0, { id: newSceneId(d), kind, vo: '', head: '', sub: '', items: [], photos: [] }); return { ...d, scenes: a } })
    setSel(at)
  }
  const dupScene = () => { if (!p) return; const s = p.scenes[sel]; change(d => { const a = d.scenes.slice(); a.splice(sel + 1, 0, { ...s, id: newSceneId(d), items: s.items.slice(), photos: s.photos.slice() }); return { ...d, scenes: a } }); setSel(sel + 1) }
  const delScene = () => { if (!p || p.scenes.length < 2) return; change(d => ({ ...d, scenes: d.scenes.filter((_, k) => k !== sel) })); setSel(Math.max(0, sel - 1)) }

  // ── AI: write / rewrite ───────────────────────────────────────────────
  const write = async (rewrite: boolean) => {
    if (!p) return
    setBusy(rewrite ? 'rewrite' : 'write'); setErr('')
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: brief, seconds, audience: AUD[p.audience].brief, format: p.format, current: rewrite ? p : null }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The writer did not answer. Try again.'); return }
    change(d => ({ ...d, prompt: brief, name: d.name === 'Untitled ad' && r.name ? r.name : d.name, scenes: r.scenes }))
    setSel(0); setT(1.6)
  }

  // ── voice ─────────────────────────────────────────────────────────────
  const makeVoice = async () => {
    if (!p) return
    stop(); setBusy('voice'); setErr('')
    clearTimeout(saveTimer.current)
    const r = await fetch('/api/ads/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: p }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The voice could not be made.'); return }
    setP(r.project); setAudioUrl(r.audioUrl || null); setSaved('saved'); setT(0)
  }

  // ── assets for the renderer ───────────────────────────────────────────
  const img = (url: string): HTMLImageElement | null => {
    if (!url) return null
    const c = imgs.current[url]
    if (c) return c.complete && c.naturalWidth ? c : null
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.src = proxied(url)
    imgs.current[url] = im
    return null
  }
  /** A scene's media: a photo, or a library video ('video:<key>') kept in step with the scene clock. */
  const vidUrl = (ref: string): string => {
    if (ref.startsWith('/')) return ref
    const hit = libRef.current.find(v => v.key === ref)
    return hit ? hit.url : ''
  }
  const media = (u: string, local: number): HTMLImageElement | HTMLVideoElement | null => {
    if (!u.startsWith('video:')) return img(u)
    const ref = u.slice(6)
    let el = vids.current[ref]
    if (!el) {
      const src = vidUrl(ref)
      if (!src) return null
      el = document.createElement('video')
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.src = src
      vids.current[ref] = el
      return null
    }
    if (el.readyState < 2) return null
    const d = el.duration || 1
    const want = local % d
    if (live.current) {
      if (el.paused) el.play().catch(() => {})
      if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = want
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - want) > 0.06 && !el.seeking) el.currentTime = want
    }
    return el
  }
  const assets = (): AdAssets => ({
    img, media, logo: logo.current, display, body, mono: 'ui-monospace, Menlo, monospace',
    credit: (MUSIC.find(m => m.key === (pRef.current?.music || '')) || { credit: '' }).credit,
  })

  // ── audio ─────────────────────────────────────────────────────────────
  const ctx = () => { if (!actx.current) actx.current = new AudioContext(); return actx.current }
  const loadAudio = async (): Promise<{ v: AudioBuffer | null; m: AudioBuffer | null }> => {
    const c = ctx()
    let v: AudioBuffer | null = null, m: AudioBuffer | null = null
    if (audioUrl && hasVoice) {
      if (voiceBuf.current?.url === audioUrl) v = voiceBuf.current.buf
      else { try { const ab = await fetch(audioUrl).then(r => r.arrayBuffer()); v = await c.decodeAudioData(ab); voiceBuf.current = { url: audioUrl, buf: v } } catch { v = null } }
    }
    const mu = MUSIC.find(x => x.key === pRef.current?.music)
    if (mu && mu.file) {
      if (musicBuf.current[mu.key]) m = musicBuf.current[mu.key]
      else { try { const ab = await fetch(mu.file).then(r => r.arrayBuffer()); m = await c.decodeAudioData(ab); musicBuf.current[mu.key] = m } catch { m = null } }
    }
    return { v, m }
  }
  /** Wire the voice and the ducked, faded music into `dest`, starting the ad at `from` seconds. */
  const wire = (c: AudioContext, dest: AudioNode, from: number, v: AudioBuffer | null, m: AudioBuffer | null, startAt: number): AudioScheduledSourceNode[] => {
    const cur = pRef.current!, T = timeline(cur)
    const nodes: AudioScheduledSourceNode[] = []
    if (v) {
      const s = c.createBufferSource(); s.buffer = v; s.connect(dest)
      const off = from - LEAD
      if (off < v.duration) { s.start(startAt + Math.max(0, -off), Math.max(0, off)); nodes.push(s) }
    }
    if (m) {
      const s = c.createBufferSource(); s.buffer = m
      const g = c.createGain(); s.connect(g); g.connect(dest)
      const base = cur.musicVol, duck = cur.musicVol * 0.55
      const fadeAt = (T.voiced ? T.voEnd + 0.3 : T.total - 4)
      // The level the music should have at ad-time x: fade in, duck under each spoken line, fade out.
      const lvl = (x: number) => {
        let l = base * Math.min(1, x / 1.0)
        for (let k = 0; k < T.spans.length; k++) if (x > T.spans[k].from - 0.15 && x < T.spans[k].to + 0.25) l = Math.min(l, duck)
        if (x >= fadeAt) l *= Math.max(0, 1 - (x - fadeAt) / Math.max(0.5, T.total - fadeAt))
        return l
      }
      g.gain.setValueAtTime(lvl(from), startAt)
      for (let x = Math.ceil(from * 10) / 10; x <= T.total; x += 0.1) g.gain.linearRampToValueAtTime(lvl(x), startAt + (x - from))
      if (from < m.duration) { s.start(startAt, from); s.stop(startAt + (T.total - from)); nodes.push(s) }
    }
    return nodes
  }
  const stop = () => {
    const pl = play0.current
    if (pl) { pl.nodes.forEach(n => { try { n.stop() } catch { /* already */ } }); play0.current = null }
    live.current = false
    Object.keys(vids.current).forEach(k => { try { vids.current[k].pause() } catch { /* fine */ } })
    setPlaying(false)
  }
  const start = async (from: number) => {
    if (!pRef.current) return
    const c = ctx(); if (c.state === 'suspended') await c.resume()
    const { v, m } = await loadAudio()
    const at = c.currentTime + 0.08
    play0.current = { at, from, nodes: wire(c, c.destination, from, v, m, at) }
    live.current = true
    setPlaying(true)
  }
  const play = () => {
    if (!p || !tl) return
    if (play0.current) { stop(); return }
    start(t >= tl.total - 0.05 ? 0 : t)
  }

  // ── the viewer: draw every frame ──────────────────────────────────────
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const cv = canvasRef.current, cur = pRef.current
      if (cv && cur) {
        const T = timeline(cur)
        let now = tRef.current
        const pl = play0.current
        if (pl && actx.current) {
          now = pl.from + Math.max(0, actx.current.currentTime - pl.at)
          if (now >= T.total) { now = T.total; stop() }
          if (Math.abs(now - tRef.current) > 0.03) setT(now)
        }
        const g = cv.getContext('2d')
        if (g) drawFrame(g, cur, T, Math.min(now, T.total - 0.001), assets())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the playhead with the selection while playing; seek to a scene when it is picked.
  useEffect(() => { if (playing && tl) { const i = sceneAt(tl, t); if (i !== sel) setSel(i) } }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (i: number) => { setSel(i); if (tl && !playing) setT(tl.starts[i] + Math.min(1.6, tl.durs[i] * 0.6)) }
  const seek = (x: number) => { const was = !!play0.current; stop(); const to = Math.max(0, x); setT(to); tRef.current = to; if (was) start(to) }

  // ── export: the same renderer, recorded ───────────────────────────────
  const exportVideo = async () => {
    if (!p || !tl) return
    stop(); setErr('')
    const [W, H] = FORMATS[p.format]
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    // Warm every image first, so the first second of the file is not half-loaded.
    p.scenes.forEach(s => s.photos.forEach(u => img(u))); if (p.contact.photo) img(p.contact.photo)
    await new Promise(r => setTimeout(r, 1200))
    const c = ctx(); if (c.state === 'suspended') await c.resume()
    const { v, m } = await loadAudio()
    const dest = c.createMediaStreamDestination()
    const vs = (cv as any).captureStream(30) as MediaStream
    const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()])
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    const mime = types.find(x => (window as any).MediaRecorder && MediaRecorder.isTypeSupported(x)) || ''
    if (!mime) { setErr('This browser cannot record video. Use Chrome or Safari.'); return }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<void>(res => { rec.onstop = () => res() })
    live.current = true
    drawFrame(g, p, tl, 0, assets())
    rec.start(500)
    const at = c.currentTime + 0.15
    const nodes = wire(c, dest, 0, v, m, at)
    setExportPct(0)
    await new Promise<void>(res => {
      const step = () => {
        const x = Math.max(0, c.currentTime - at)
        drawFrame(g, p, tl, Math.min(x, tl.total - 0.001), assets())
        setExportPct(Math.min(100, Math.round(x / tl.total * 100)))
        if (x >= tl.total + 0.2) { res(); return }
        setTimeout(step, 1000 / 30)
      }
      step()
    })
    nodes.forEach(n => { try { n.stop() } catch { /* done */ } })
    rec.stop(); await done
    live.current = false
    setExportPct(null)
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
    const blob = new Blob(chunks, { type: mime.split(';')[0] })
    download(blob, ext)
    if (keepCopy && canEdit) {
      drawFrame(g, p, tl, Math.min(tl.total - 0.01, tl.starts[0] + 1.6), assets())
      const thumb = await new Promise<Blob | null>(res => cv.toBlob(b => res(b), 'image/jpeg', 0.8))
      await toLibrary(blob, ext, thumb, p.name, tl.total, p.format)
    }
  }
  const fileBase = () => `${(p?.name || 'Stay ad').replace(/[^\w\- ]+/g, '').trim() || 'Stay ad'} (${(p?.format || '16:9').replace(':', 'x')})`
  const download = (blob: Blob, ext: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileBase()}.${ext}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  }
  /** A still of the frame on screen, full size — for a static post. */
  const exportPng = async () => {
    if (!p || !tl) return
    const [W, H] = FORMATS[p.format]
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    drawFrame(cv.getContext('2d')!, p, tl, Math.min(t, tl.total - 0.01), assets())
    const b = await new Promise<Blob | null>(res => cv.toBlob(x => res(x), 'image/png'))
    if (b) download(b, 'png')
  }
  /** An animated GIF of the whole ad (no sound) — "a static image that moves", for posts and email. */
  const exportGif = async () => {
    if (!p || !tl) return
    stop(); setErr('')
    const [W, H] = FORMATS[p.format]
    const k = 480 / Math.max(W, H)
    const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k)
    const g = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D
    p.scenes.forEach(s => s.photos.forEach(u => media(u, 0))); await new Promise(r => setTimeout(r, 1000))
    const fps = tl.total > 16 ? 8 : 10
    const n = Math.ceil(tl.total * fps)
    const enc = GIFEncoder()
    setExportPct(0)
    for (let f = 0; f < n; f++) {
      const x = f / fps
      // a video in the scene has to be at the right frame before it is drawn
      const i = sceneAt(tl, x), ref = (p.scenes[i].photos[0] || '')
      if (ref.startsWith('video:')) {
        const el = vids.current[ref.slice(6)]
        if (el) { el.currentTime = (x - tl.starts[i]) % (el.duration || 1); await new Promise(r => { const done = () => r(null); el.addEventListener('seeked', done, { once: true }); setTimeout(done, 400) }) }
      }
      drawFrame(g, p, tl, Math.min(x, tl.total - 0.001), assets())
      const data = g.getImageData(0, 0, cv.width, cv.height).data
      const pal = quantize(data, 256)
      enc.writeFrame(applyPalette(data, pal), cv.width, cv.height, { palette: pal, delay: Math.round(1000 / fps) })
      if (f % 6 === 0) { setExportPct(Math.round(f / n * 100)); await new Promise(r => setTimeout(r, 0)) }
    }
    enc.finish()
    setExportPct(null)
    download(new Blob([enc.bytes() as any], { type: 'image/gif' }), 'gif')
  }

  // ── the video library ─────────────────────────────────────────────────
  const loadLib = async () => {
    const r = await fetch('/api/ads/library').then(x => x.json()).catch(() => null)
    if (r?.ok) setLib(r.videos || [])
  }
  const putFile = (url: string, body: Blob, type: string, onPct?: (n: number) => void) => new Promise<void>((res, rej) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', type)
    xhr.setRequestHeader('x-upsert', 'true')
    xhr.upload.onprogress = e => { if (e.lengthComputable && onPct) onPct(Math.round(e.loaded / e.total * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error('upload failed (' + xhr.status + ')')))
    xhr.onerror = () => rej(new Error('upload failed'))
    xhr.send(body)
  })
  const toLibrary = async (blob: Blob, ext: string, thumb: Blob | null, name: string, dur: number, format: string) => {
    try {
      setLibPct(0)
      const s = await fetch('/api/ads/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sign: ext }) }).then(x => x.json())
      if (!s?.ok) throw new Error(s?.error || 'could not start the upload')
      await putFile(s.signedUrl, blob, blob.type || 'video/mp4', n => setLibPct(n))
      if (thumb) await putFile(s.thumbUrl, thumb, 'image/jpeg')
      const m = await fetch('/api/ads/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { path: s.path, thumbPath: thumb ? s.thumbPath : '', name, dur, format } }) }).then(x => x.json())
      if (!m?.ok) throw new Error(m?.error || 'could not save it')
      await loadLib()
    } catch (e: any) { setErr('Saved to your computer, but not to the library: ' + (e?.message || e)) }
    finally { setLibPct(null) }
  }
  const uploadVideo = async (f: File) => {
    const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toLowerCase()
    // the first frame as the thumbnail, and the length, read in the browser
    const url = URL.createObjectURL(f)
    const v = document.createElement('video'); v.muted = true; v.src = url; v.preload = 'auto'
    const meta = await new Promise<{ dur: number; thumb: Blob | null; w: number; h: number }>(res => {
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2) }
      v.onseeked = () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(640 * (v.videoHeight || 360) / (v.videoWidth || 640))
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        c.toBlob(b => res({ dur: v.duration || 0, thumb: b, w: v.videoWidth, h: v.videoHeight }), 'image/jpeg', 0.8)
      }
      v.onerror = () => res({ dur: 0, thumb: null, w: 0, h: 0 })
    })
    URL.revokeObjectURL(url)
    const fmt = meta.w && meta.h ? (meta.w > meta.h * 1.2 ? '16:9' : meta.h > meta.w * 1.5 ? '9:16' : meta.h > meta.w * 1.1 ? '4:5' : '1:1') : ''
    await toLibrary(f, ext, meta.thumb, f.name.replace(/\.[a-z0-9]+$/i, ''), meta.dur, fmt)
  }
  const delVideo = async (v: LibVideo) => {
    if (!v.path || !window.confirm('Delete "' + v.name + '" from the library?')) return
    await fetch('/api/ads/library?path=' + encodeURIComponent(v.path), { method: 'DELETE' })
    loadLib()
  }
  const useVideo = (v: LibVideo) => {
    if (!p || !sc) return
    setScene(sel, { photos: ['video:' + (v.builtin ? v.url : v.key)].concat(sc.photos.filter(x => !x.startsWith('video:'))).slice(0, 12) })
  }

  // ── templates: a ready-made ad that fills itself from the photo library ──
  const applyTemplate = async (tp: AdTemplate) => {
    if (!p || !canEdit) return
    if (p.scenes.length > 2 && !window.confirm('Replace the scenes in "' + p.name + '" with the ' + tp.label + ' template?')) return
    stop(); setBusy('template')
    const cache: Record<string, string[]> = {}
    const scenes: AdScene[] = []
    for (let i = 0; i < tp.scenes.length; i++) {
      const s = tp.scenes[i]
      let photos: string[] = []
      if (s.q && s.n) {
        if (!cache[s.q]) {
          const r = await fetch('/api/photos/library?search=' + encodeURIComponent(s.q)).then(x => x.json()).catch(() => null)
          const hs: Hit[] = r?.ok ? r.hits || [] : []
          cache[s.q] = hs.filter((h: any) => h.active !== false).map(h => h.view || h.url)
        }
        // different photos for different scenes that share a search
        const used = scenes.reduce((a: string[], x) => a.concat(x.photos), [])
        const fresh = cache[s.q].filter(u => used.indexOf(u) < 0)
        photos = (fresh.length >= s.n ? fresh : cache[s.q]).slice(0, s.n)
      }
      scenes.push({ id: 's' + (i + 1), kind: s.kind, vo: s.vo, head: s.head, sub: s.sub, items: s.items.slice(), photos, dur: s.dur || null })
    }
    setBusy('')
    change(d => ({ ...d, name: d.name === 'Untitled ad' ? tp.name : d.name, format: tp.format, audience: tp.audience, scenes }))
    setSel(0); setT(1.6); setSide('ads')
  }

  // ── photos ────────────────────────────────────────────────────────────
  const search = async () => {
    if (!q.trim()) return
    setSearching(true)
    const r = await fetch('/api/photos/library?search=' + encodeURIComponent(q.trim())).then(x => x.json()).catch(() => null)
    setSearching(false)
    setHits(r?.ok ? (r.hits || []).slice(0, 60) : [])
    if (!r?.ok) setErr(r?.error || 'Photo search failed.')
  }

  const del = async () => {
    if (!p || !canDelete) return
    if (!window.confirm('Delete "' + p.name + '" and its voice takes? This cannot be undone.')) return
    await fetch('/api/ads?id=' + encodeURIComponent(p.id), { method: 'DELETE' })
    setP(null); loadList()
  }

  // ─────────────────────────────── render ───────────────────────────────
  const sc = p ? p.scenes[sel] : null
  const [FW, FH] = p ? FORMATS[p.format] : [1920, 1080]
  const pw = FW >= FH ? 960 : 540 * (FW / FH) * 1.6
  const totalW = 100 // timeline is % based
  const pct = (x: number) => (tl ? (x / tl.total) * totalW : 0)

  return (
    <div style={{ background: UI.bg, color: UI.ink, borderRadius: 14, border: '1px solid ' + UI.line, overflow: 'hidden', fontFamily: body }}>
      {/* ── top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid ' + UI.line, flexWrap: 'wrap', background: UI.panel }}>
        <span style={{ fontFamily: display, fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>Ad Studio</span>
        {p ? (
          <input value={p.name} disabled={!canEdit} onChange={e => change(d => ({ ...d, name: e.target.value }))} style={{ ...field, width: 260, padding: '6px 10px', fontWeight: 600 }} />
        ) : null}
        {p ? (
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(FORMATS) as AdFormat[]).map(f => <Btn key={f} small on={p.format === f} title={FORMAT_LABEL[f]} onClick={() => change(d => ({ ...d, format: f }))}>{f}</Btn>)}
          </div>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: saved === 'dirty' || saved === 'saving' ? UI.gold : UI.mut }}>
          {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Unsaved changes' : saved === 'saved' ? 'Saved' : ''}
        </span>
        {p && canEdit ? <Btn tone={stale || !p.voice ? 'blue' : undefined} disabled={!!busy} onClick={makeVoice} title="Records the whole script as one take and cuts the scenes to it">{busy === 'voice' ? 'Recording voice…' : p.voice ? (stale ? 'Re-record voice (script changed)' : 'Re-record voice') : 'Make voice'}</Btn> : null}
        {p ? (exportPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600 }}>Exporting {exportPct}% · keep this tab open</span> : libPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600 }}>Saving to the library {libPct}%</span> : (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Btn tone="gold" disabled={!!busy} onClick={exportVideo} title="MP4 with sound, at full size">Export MP4</Btn>
            <Btn small disabled={!!busy} onClick={exportGif} title="An animated GIF, no sound — moves like a post">GIF</Btn>
            <Btn small disabled={!!busy} onClick={exportPng} title="A still of the frame on screen">PNG</Btn>
          </span>
        )) : null}
      </div>
      {err ? <div style={{ background: '#3a1d1b', color: '#F3C2BC', padding: '8px 14px', fontSize: 12.5, display: 'flex', gap: 10 }}><span style={{ flex: 1 }}>{err}</span><button onClick={() => setErr('')} style={{ background: 'none', border: 0, color: '#F3C2BC', cursor: 'pointer' }}>Dismiss</button></div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr) 330px', minHeight: 560 }}>
        {/* ── left: brief + ads ── */}
        <div style={{ borderRight: '1px solid ' + UI.line, padding: '4px 14px 14px', background: UI.panel, minWidth: 0 }}>
          <Label>Brief</Label>
          <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} disabled={!canEdit || !p} placeholder="What is this ad for? e.g. 30-second owner ad for 17WEST, lead with high-date pricing, end on Nick." style={field} />
          <Label>Length</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{[15, 30, 45, 60, 90].map(s => <Btn key={s} small on={seconds === s} onClick={() => setSeconds(s)}>{s}s</Btn>)}</div>
          <Label>Audience</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(Object.keys(AUD) as AdAudience[]).map(k => <Btn key={k} small on={p?.audience === k} disabled={!p || !canEdit} title={AUD[k].hint} onClick={() => change(d => ({ ...d, audience: k }))}>{AUD[k].label}</Btn>)}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <Btn tone="blue" disabled={!p || !canEdit || !!busy} onClick={() => write(false)}>{busy === 'write' ? 'Writing…' : 'Write the ad'}</Btn>
            <Btn disabled={!p || !canEdit || !!busy || !p?.scenes.length} onClick={() => write(true)} title="Keeps what works and tightens the rest">{busy === 'rewrite' ? 'Rewriting…' : 'Improve draft'}</Btn>
          </div>
          <p style={{ fontSize: 11, color: UI.mut, marginTop: 8, lineHeight: 1.5 }}>Writes from the house facts only — no made-up numbers. You edit every line before the voice is made.</p>

          <div style={{ display: 'flex', gap: 4, marginTop: 16, borderTop: '1px solid ' + UI.line, paddingTop: 12 }}>
            {([['ads', 'Ads'], ['templates', 'Templates'], ['videos', 'Videos']] as const).map(([k, l]) => <Btn key={k} small on={side === k} onClick={() => setSide(k)}>{l}</Btn>)}
          </div>
          {side === 'templates' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEMPLATES.map(tp => (
                <button key={tp.key} disabled={!p || !canEdit || !!busy} onClick={() => applyTemplate(tp)} style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, padding: '8px 9px', cursor: 'pointer', color: UI.ink, opacity: !p ? 0.5 : 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{tp.label} <span style={{ color: UI.mut, fontWeight: 500 }}>· {tp.format}</span></span>
                  <span style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 2 }}>{tp.blurb}</span>
                </button>
              ))}
              {busy === 'template' ? <p style={{ fontSize: 11.5, color: UI.gold }}>Filling it with photos from the library…</p> : null}
              {!p ? <p style={{ fontSize: 11.5, color: UI.mut }}>Start an ad first (+ New ad), then pick a template.</p> : null}
            </div>
          ) : side === 'videos' ? (
            <div style={{ marginTop: 10 }}>
              {canEdit ? (
                <label style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: UI.ink, border: '1px solid ' + UI.line, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                  + Upload a video
                  <input type="file" accept="video/mp4,video/quicktime,video/webm" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadVideo(f); e.target.value = '' }} />
                </label>
              ) : null}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: UI.mut, marginTop: 8 }}>
                <input type="checkbox" checked={keepCopy} onChange={e => setKeepCopy(e.target.checked)} /> Keep a copy of every MP4 export here
              </label>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto' }}>
                {lib.map(v => (
                  <div key={v.key} style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, overflow: 'hidden' }}>
                    <button onClick={() => setWatch(v)} title="Watch" style={{ display: 'block', width: '100%', aspectRatio: '16/9', border: 0, padding: 0, cursor: 'pointer', background: '#000 center/cover no-repeat', backgroundImage: v.thumb ? `url(${v.thumb})` : 'none', position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,.65)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>▶ {fmtT(v.dur).replace(/\.\d$/, '')}</span>
                    </button>
                    <div style={{ padding: '6px 8px' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</p>
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '2px 0 6px' }}>{v.builtin ? 'Sales video' : (v.format || 'video') + ' · ' + (v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '')}</p>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {canEdit && p ? <Btn small onClick={() => useVideo(v)} title="Puts this clip behind the selected scene">Use in scene</Btn> : null}
                        <a href={v.url} download style={{ fontSize: 11.5, color: UI.mut, padding: '4px 6px' }}>Download</a>
                        {!v.builtin && canDelete ? <Btn small tone="red" onClick={() => delVideo(v)}>Delete</Btn> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {!lib.length ? <p style={{ fontSize: 12, color: UI.mut }}>Loading the library…</p> : null}
              </div>
            </div>
          ) : (<>
          <Label>Ads</Label>
          {canEdit ? <Btn small disabled={!!busy} onClick={newAd}>+ New ad</Btn> : null}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {list.map(a => (
              <button key={a.id} onClick={() => open(a.id)} style={{ textAlign: 'left', background: p?.id === a.id ? '#232C38' : 'transparent', border: 0, borderRadius: 7, padding: '7px 8px', cursor: 'pointer', color: UI.ink }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <span style={{ fontSize: 10.5, color: UI.mut }}>{a.format} · {a.scenes} scenes · {new Date(a.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
            {!list.length ? <p style={{ fontSize: 12, color: UI.mut }}>No ads yet. Start one with + New ad.</p> : null}
          </div>
          {p && canDelete ? <div style={{ marginTop: 14 }}><Btn small tone="red" onClick={del}>Delete this ad</Btn></div> : null}
          </>)}
        </div>

        {/* ── centre: viewer ── */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 0, background: '#0A0D11' }}>
          {p ? (
            <>
              <canvas ref={canvasRef} width={FW >= FH ? 960 : Math.round(960 * FW / FH)} height={FW >= FH ? Math.round(960 * FH / FW) : 960}
                style={{ width: '100%', maxWidth: FW >= FH ? pw : 360, aspectRatio: `${FW}/${FH}`, borderRadius: 8, background: '#000', boxShadow: '0 20px 50px -25px rgba(0,0,0,.8)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: FW >= FH ? pw : 520 }}>
                <Btn tone="gold" onClick={play}>{playing ? '❚❚ Pause' : '▶ Play'}</Btn>
                <Btn small onClick={() => seek(0)}>⏮ Start</Btn>
                <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: UI.mut }}>{fmtT(t)} / {tl ? fmtT(tl.total) : '0:00'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: hasVoice ? UI.green : UI.gold }}>
                  {hasVoice ? 'Timed to the voice' : p.voice ? 'Script changed since the voice — re-record' : 'Estimated timing · make the voice to lock it'}
                </span>
              </div>
            </>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: UI.mut, maxWidth: 380 }}>
              <p style={{ fontFamily: display, fontSize: 22, color: UI.ink, fontWeight: 800 }}>Make an ad</p>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>Start a new ad, write a one-line brief, and let the writer lay out the scenes with photos from our library. Then edit, make the voice, and export for any platform.</p>
              {canEdit ? <div style={{ marginTop: 12 }}><Btn tone="gold" onClick={newAd}>+ New ad</Btn></div> : null}
            </div>
          )}
        </div>

        {/* ── right: inspector ── */}
        <div style={{ borderLeft: '1px solid ' + UI.line, padding: '4px 14px 14px', background: UI.panel, minWidth: 0, maxHeight: 760, overflowY: 'auto' }}>
          {p && sc ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Scene {sel + 1} of {p.scenes.length}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <Btn small disabled={sel === 0} onClick={() => move(sel, sel - 1)} title="Earlier">↑</Btn>
                  <Btn small disabled={sel === p.scenes.length - 1} onClick={() => move(sel, sel + 1)} title="Later">↓</Btn>
                  <Btn small onClick={dupScene} title="Duplicate">⧉</Btn>
                  <Btn small tone="red" disabled={p.scenes.length < 2} onClick={delScene} title="Delete scene">✕</Btn>
                </span>
              </div>
              <Label>Look</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {KINDS.map(k => <Btn key={k.kind} small on={sc.kind === k.kind} title={k.hint} onClick={() => setScene(sel, { kind: k.kind })}>{k.label}</Btn>)}
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 6 }}>{KINDS.find(k => k.kind === sc.kind)?.hint}</p>

              <Label>Voice line</Label>
              <textarea rows={3} value={sc.vo} disabled={!canEdit} onChange={e => setScene(sel, { vo: e.target.value })} placeholder="Leave empty for a music-only beat" style={field} />
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 4 }}>
                {sc.vo.trim() ? `${sc.vo.trim().split(/\s+/).length} words · about ${(sc.vo.trim().split(/\s+/).length / 2.55).toFixed(1)}s spoken` : 'Music only'}
                {riskyWords(sc.vo).length ? <span style={{ color: UI.red }}> · The voice says {riskyWords(sc.vo).join(' and ')} wrong — keep it on screen only</span> : null}
              </p>

              {sc.kind !== 'contact' ? (
                <>
                  <Label>Headline on screen</Label>
                  <textarea rows={2} value={sc.head} disabled={!canEdit} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Short. **Gold** a word. Enter = new line." style={field} />
                  <Label>Line under it</Label>
                  <input value={sc.sub} disabled={!canEdit} onChange={e => setScene(sel, { sub: e.target.value })} style={field} />
                  {['stats', 'cards', 'feed', 'checks', 'rise', 'wall'].indexOf(sc.kind) >= 0 ? (
                    <>
                      <Label>Rows · one per line</Label>
                      <textarea rows={4} value={sc.items.join('\n')} disabled={!canEdit} onChange={e => setScene(sel, { items: e.target.value.split('\n') })} style={{ ...field, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Label>Headline</Label>
                  <input value={sc.head} disabled={!canEdit} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Book a **call.**" style={field} />
                  <Label>Contact card</Label>
                  {(['name', 'role', 'phone', 'email'] as const).map(k => (
                    <input key={k} value={p.contact[k]} disabled={!canEdit} placeholder={k} onChange={e => change(d => ({ ...d, contact: { ...d.contact, [k]: e.target.value } }))} style={{ ...field, marginBottom: 6 }} />
                  ))}
                </>
              )}

              {!hasVoice ? (
                <>
                  <Label>Hold for (seconds)</Label>
                  <input type="number" min={1} max={30} step={0.5} value={sc.dur || ''} placeholder={tl ? tl.durs[sel].toFixed(1) + ' (auto)' : ''} disabled={!canEdit} onChange={e => setScene(sel, { dur: e.target.value ? Number(e.target.value) : null })} style={{ ...field, width: 140 }} />
                </>
              ) : null}

              <Label>Photos</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                {sc.photos.map((u, k) => (
                  <div key={u + k} style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden', background: UI.panel2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {u.startsWith('video:') ? (
                      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#000', backgroundImage: (() => { const v = lib.find(x => 'video:' + (x.builtin ? x.url : x.key) === u); return v && v.thumb ? `url(${v.thumb})` : 'none' })(), backgroundSize: 'cover', backgroundPosition: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>▶ Video</span>
                      </div>
                    ) : <img src={proxied(u)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {canEdit ? <button onClick={() => setScene(sel, { photos: sc.photos.filter((_, j) => j !== k) })} title="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, border: 0, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>✕</button> : null}
                    {canEdit && k > 0 ? <button onClick={() => { const a = sc.photos.slice(); const [x] = a.splice(k, 1); a.unshift(x); setScene(sel, { photos: a }) }} title="Make first" style={{ position: 'absolute', bottom: 3, left: 3, borderRadius: 5, border: 0, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 10, padding: '2px 5px', cursor: 'pointer' }}>First</button> : null}
                  </div>
                ))}
              </div>
              {canEdit ? (
                <>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder="Search the library: 17west pool" style={{ ...field, padding: '6px 9px' }} />
                    <Btn small onClick={search}>{searching ? '…' : 'Find'}</Btn>
                  </div>
                  {hits.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
                      {hits.map(h => {
                        const on = sc.photos.indexOf(h.view || h.url) >= 0 || sc.photos.indexOf(h.url) >= 0
                        return (
                          <button key={h.url} title={h.unit + (h.caption ? ' · ' + h.caption : '')} onClick={() => { const u = h.view || h.url; setScene(sel, { photos: on ? sc.photos.filter(x => x !== u && x !== h.url) : sc.photos.concat([u]).slice(0, 12) }) }}
                            style={{ padding: 0, border: '2px solid ' + (on ? UI.gold : 'transparent'), borderRadius: 6, overflow: 'hidden', aspectRatio: '4/3', cursor: 'pointer', background: UI.panel2 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={h.thumb || h.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}

              <Label>Whole ad</Label>
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '0 0 6px' }}>Voice</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {VOICES.map(v => <Btn key={v.id} small on={p.voiceId === v.id} title={v.blurb} onClick={() => change(d => ({ ...d, voiceId: v.id }))}>{v.name}</Btn>)}
              </div>
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '10px 0 6px' }}>Music</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {MUSIC.map(m => <Btn key={m.key} small on={p.music === m.key} onClick={() => change(d => ({ ...d, music: m.key }))}>{m.label}</Btn>)}
              </div>
              {p.music !== 'none' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: UI.mut, marginTop: 8 }}>
                  Level <input type="range" min={0.05} max={0.6} step={0.01} value={p.musicVol} onChange={e => change(d => ({ ...d, musicVol: Number(e.target.value) }))} style={{ flex: 1 }} />
                </label>
              ) : null}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={p.captions} onChange={e => change(d => ({ ...d, captions: e.target.checked }))} /> Burn in captions (most people watch muted)
              </label>
            </>
          ) : <p style={{ fontSize: 12, color: UI.mut, marginTop: 16 }}>Pick a scene on the timeline to edit it.</p>}
        </div>
      </div>

      {/* ── timeline ── */}
      {p && tl ? (
        <div style={{ borderTop: '1px solid ' + UI.line, padding: '10px 14px 14px', background: UI.panel }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut }}>Timeline</span>
            <span style={{ fontSize: 11, color: UI.mut }}>Drag scenes to reorder · click to edit · click the ruler to jump</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {canEdit ? KINDS.map(k => <Btn key={k.kind} small onClick={() => addScene(k.kind)} title={'Add a ' + k.label + ' scene after this one'}>+ {k.label}</Btn>) : null}
            </span>
          </div>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '64px 1fr', rowGap: 6 }}>
            <span />
            <div onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); seek((e.clientX - r.left) / r.width * tl.total) }}
              style={{ position: 'relative', height: 18, cursor: 'pointer', borderBottom: '1px solid ' + UI.line }}>
              {Array.from({ length: Math.floor(tl.total / 5) + 1 }, (_, k) => k * 5).map(s => (
                <span key={s} style={{ position: 'absolute', left: pct(s) + '%', fontSize: 9.5, color: UI.mut, fontFamily: 'ui-monospace, Menlo, monospace', transform: 'translateX(-50%)' }}>{fmtT(s).replace(/\.0$/, '')}</span>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Scenes</span>
            <div style={{ position: 'relative', height: 58 }}>
              {p.scenes.map((s, i) => (
                <div key={s.id} draggable={canEdit} onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom != null) move(dragFrom, i); setDragFrom(null) }}
                  onClick={() => pick(i)} title={(s.head || s.vo || KINDS.find(k => k.kind === s.kind)?.label || '').replace(/\*\*/g, '')}
                  style={{ position: 'absolute', left: pct(tl.starts[i]) + '%', width: `calc(${pct(tl.durs[i])}% - 3px)`, top: 0, bottom: 0, borderRadius: 7, cursor: 'pointer', overflow: 'hidden',
                    background: KIND_COLOR[s.kind] + (i === sel ? '' : '55'), border: '2px solid ' + (i === sel ? '#fff' : 'transparent'), padding: '4px 6px', color: i === sel ? '#111' : UI.ink }}>
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>{i + 1} · {KINDS.find(k => k.kind === s.kind)?.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(s.head || s.vo).replace(/\*\*/g, '').replace(/\n/g, ' ')}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Voice</span>
            <div style={{ position: 'relative', height: 22 }}>
              {tl.voiced ? tl.spans.map((s, k) => (
                <div key={k} style={{ position: 'absolute', left: pct(s.from) + '%', width: pct(s.to - s.from) + '%', top: 4, bottom: 4, borderRadius: 4, background: 'repeating-linear-gradient(90deg,#4C8DF6 0 2px,#2c5aa8 2px 4px)' }} />
              )) : p.scenes.map((s, i) => s.vo.trim() ? (
                <div key={i} style={{ position: 'absolute', left: pct(tl.starts[i] + 0.4) + '%', width: `calc(${pct(Math.max(0.5, tl.durs[i] - (i === p.scenes.length - 1 ? 3 : 1)))}%)`, top: 4, bottom: 4, borderRadius: 4, border: '1px dashed #4C8DF6' }} />
              ) : null)}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Music</span>
            <div style={{ position: 'relative', height: 22 }}>
              {p.music !== 'none' ? (
                <div style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, borderRadius: 4, background: `linear-gradient(90deg, rgba(210,176,119,.15), rgba(210,176,119,.55) ${pct(1)}%, rgba(210,176,119,.55) ${pct(tl.voiced ? tl.voEnd + 0.3 : tl.total - 4)}%, rgba(210,176,119,0) 100%)` }}>
                  <span style={{ fontSize: 9.5, color: UI.ink, padding: '0 6px', lineHeight: '14px' }}>{MUSIC.find(m => m.key === p.music)?.label} · ducks under the voice · fades out on the end card</span>
                </div>
              ) : null}
            </div>
            {/* playhead */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(64px + (100% - 64px) * ${tl.total ? t / tl.total : 0})`, width: 2, background: UI.red, pointerEvents: 'none' }} />
          </div>
        </div>
      ) : null}
      {watch ? (
        <div onClick={() => setWatch(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(960px, 100%)' }}>
            <video src={watch.url} controls autoPlay style={{ width: '100%', maxHeight: '80vh', borderRadius: 10, background: '#000' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, color: '#fff' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{watch.name}</span>
              <button onClick={() => setWatch(null)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
