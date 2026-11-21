'use client'
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// A PIECE, OPEN. The canvas is drawn by the same player that exports it, so the preview is the file.
//
// THE EDITOR (Jon, 2026-11-20: "need to be able to change themes, songs, length of videos or scenes, transitions etc.
// Make it super interactive and easy to customize. Maybe a feature where you can click into the video and change
// things, give you options, delete visuals, add photos, swap photo"):
//   · click anything in the picture — a photograph, a line of words, a leaf, the logo, the button — and it is selected:
//     drag it to move, drag its corner to resize, and its options open beside the picture and in a small bar under it
//     (type the words, swap the photo, change the colour, delete). Clicking the same spot again picks what is behind.
//   · Edit: the selected thing, then the scene on screen (length, how it comes in, background, what is in it, add a
//     headline / a photo / a scene, move or delete the scene).
//   · Look & sound: colour theme, headline type, the song and its volume, the length of the whole video.
//   · Words and Files are as before. Undo and redo (⌘Z) cover every change.
//
// ON A PHONE (Jon, 2026-11-21: "Make it where if on phone when click on video I can watch too"): the picture and the
// options no longer sit side by side (the picture was squeezed to the width of a finger). On a narrow screen the
// picture comes first, as tall as the screen allows, with a play button on it: tap it to watch, tap the picture to
// pause. The timeline and the options follow underneath. Tapping the picture while it plays only pauses it; it never
// starts an edit by accident.
//
// THE TIMELINE AND VIDEO (Jon, 2026-11-21: "Make the edit feature amazing and similar to the best editing tools";
// "want to be able to add video, shorten the video, cut the video"): under the picture is a timeline (AdxTimeline):
// drag the playhead, drag a clip's edges to trim it, drag a clip to move it, S cuts at the playhead, Space plays.
// "+ Video" adds a clip from the video library or the computer as a scene of its own; it trims, cuts, changes speed
// and keeps or mutes its own sound like in any editor. Clips are held on the right frame by lib/adx/assets.ts.
// None of it calls a model: every change is instant and free, and the measured audit runs again after each one
// (does it still fit, is it still readable, is a photograph being stretched). No drop-down menus.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MUSIC } from '@/lib/ad-engine'
import { type Composition, type TextLayer, type ButtonLayer, type Layer, type Box, type PhotoAsset, type ChannelKey, runsToPlain, plainToRuns, cleanText, musicLevel, lum as lumOf } from '@/lib/adx/composition'
import { renderFrame, restTime, sceneAt, canvasMeasure, type Assets, type Ctx } from '@/lib/adx/player'
import { auditComposition, canvasSampler, type AuditResult } from '@/lib/adx/audit'
import { loadAssets, setVideoListener, pauseVideos } from '@/lib/adx/assets'
import { exportVideo, exportPng, hasClipSound, type ExportResult } from '@/lib/adx/export'
import * as E from '@/lib/adx/edit'
import { UI } from './BriefWizard'
import { LayerPanel, ScenePanel, StylePanel, PhotoPicker, VideoPicker, AddBar, Swatches, Sec, chip, type Pool } from './AdxPanels'
import AdxTimeline from './AdxTimeline'
import { scorePiece, platformFit, type Scorecard } from '@/lib/adx/scorecard'

const btn = (primary = false, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: '8px 13px', borderRadius: 9, border: primary ? 0 : '1px solid ' + UI.line, background: primary ? UI.gold : UI.panel2, color: primary ? '#0B0F16' : UI.ink, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' })
const mmss = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
const fileBase = (d: Composition) => (d.title || 'Stay piece').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'Stay piece'
function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}
type Tab = 'edit' | 'style' | 'words' | 'files'
type Picker = { mode: 'swap'; layerId: string } | { mode: 'add'; sceneId: string } | { mode: 'scene'; sceneId: string } | { mode: 'video'; sceneId: string } | { mode: 'swapVideo'; layerId: string }
type Drag = { id: string; mode: 'move' | 'size'; sx: number; sy: number; k: number; box: Box; live: Box; moved: boolean; lock: '' | 'aspect' | 'width' }
/** A picked file made small enough to send: at most 2000 px on its long side, transparency kept. */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.size < 3_000_000 && /^image\/(png|jpeg|webp)$/.test(file.type)) return file
  const bmp = await createImageBitmap(file), k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const to = (type: string) => new Promise<Blob | null>(res => c.toBlob(res, type, 0.9))
  const first = await to(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png')
  const out = first && first.size > 4_000_000 ? await to('image/webp') : first
  if (!out) throw new Error('That image could not be read.')
  return out
}

export default function AdxPlayer({ doc, onChange, canEdit, display, hold, onVariant }: { doc: Composition; onChange: (d: Composition) => void; canEdit: boolean; display: string; /** true while something else is drawing this piece (the creative director's review): the preview leaves the video clips alone */ hold?: boolean; /** make a copy of this piece in another shape (a feed post, a square, a story) and open it */ onVariant?: (channel: ChannelKey) => void }) {
  const W = doc.canvas.w, H = doc.canvas.h, dur = doc.canvas.duration
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const assets = useRef<Assets | null>(null)
  const docRef = useRef(doc); docRef.current = doc
  const tRef = useRef(0)
  /** Each text layer as it was when the piece opened: the accent's look is taken from here, so retyping never loses it. */
  const orig = useRef<Record<string, TextLayer>>({})
  /** The colours the piece was designed in, for "As designed". */
  const origColors = useRef<{ id: string; color: Record<string, string> }>({ id: doc.id, color: doc.tokens.color })
  if (origColors.current.id !== doc.id) origColors.current = { id: doc.id, color: doc.tokens.color }
  const hist = useRef<{ id: string; past: Composition[]; future: Composition[]; key: string; at: number }>({ id: doc.id, past: [], future: [], key: '', at: 0 })
  if (hist.current.id !== doc.id) hist.current = { id: doc.id, past: [], future: [], key: '', at: 0 }
  /** The piece as this editor last gave it out, and as it last was: a change from outside (the creative director's
   *  enhancement, the title) becomes a step of undo like any other. */
  const emitted = useRef<Composition>(doc), prevDoc = useRef<Composition>(doc)
  const dragRef = useRef<Drag | null>(null)
  /** The editor's own width and the window's height: under 760 px wide it is laid out for a phone. */
  const rootRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 1200, h: 900 })
  useEffect(() => {
    const el = rootRef.current; if (!el) return
    const read = () => setFrame({ w: el.clientWidth || 1200, h: window.innerHeight || 900 })
    read()
    window.addEventListener('resize', read)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => { window.removeEventListener('resize', read); ro?.disconnect() }
  }, [])
  const narrow = frame.w < 760
  /** Where the picture was last clicked (canvas pixels, with the scene it was in): new things land there. */
  const lastPt = useRef<{ scene: string; x: number; y: number } | null>(null)
  const poolCache = useRef<Record<string, Pool>>({})
  const [, setHv] = useState(0)
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)
  const [missing, setMissing] = useState(0)
  const [t, setT] = useState(() => restTime(doc.scenes[0]))
  const [playing, setPlaying] = useState(false)
  const [guides, setGuides] = useState(false)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  /** The craft score (lib/adx/scorecard): how good the piece is, measured on the piece itself after every change. */
  const [score, setScore] = useState<Scorecard | null>(null)
  const [scoreOpen, setScoreOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('edit')
  const [picker, setPicker] = useState<Picker | null>(null)
  const [pool, setPool] = useState<Pool | null>(null)
  const [poolQ, setPoolQ] = useState('')
  const [poolBusy, setPoolBusy] = useState(false)
  const [poolErr, setPoolErr] = useState('')
  const [dragBox, setDragBox] = useState<{ id: string; box: Box } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [exp, setExp] = useState<null | { pct: number; stage: string }>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  /** While a clip's edge is dragged in the timeline: the piece as it would be. */
  const [ghost, setGhost] = useState<Composition | null>(null)
  /** The clip last clicked in the timeline (Delete removes it). */
  const [sceneSel, setSceneSel] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbCache = useRef<Map<string, string>>(new Map())
  const thumbRun = useRef({ on: false, again: false })
  const playRef = useRef(false)
  /** Which set of pictures is loaded, so a thumbnail is never drawn (and kept) before its photograph has arrived. */
  const loadedKey = useRef('')
  /** True while the exporter or the review drives the video clips: the preview must not move them. */
  const busyRef = useRef(false); busyRef.current = !!exp || !!hold
  tRef.current = t; playRef.current = playing

  const music = MUSIC.find(m => m.key === doc.assets.audio.music.track && m.file)
  /** What is drawn: the piece, with the thing being dragged where the pointer has it. */
  const view = useMemo(() => ghost || (dragBox ? E.setBox(doc, dragBox.id, dragBox.box) : doc), [doc, dragBox, ghost])
  // which photographs are drawn, and where: when that changes the pictures are fetched again
  const photoKey = useMemo(() => doc.id + '|' + doc.scenes.map(s => s.layers.map(l => (l.type === 'photo' ? [l.id, l.photo, l.box.w, l.box.h, l.focal ? 1 : 0, l.camera ? 1 : 0].join(':') : '')).join(',')).join(';'), [doc])

  useEffect(() => {
    for (const s of doc.scenes) for (const l of s.layers) if (l.type === 'text' && !orig.current[l.id]) orig.current[l.id] = l
  }, [doc])

  useEffect(() => {
    let live = true
    if (!assets.current) setReady(false)          // after the first load the picture stays up while a new photograph arrives
    loadAssets(docRef.current).then(r => { if (!live) return; assets.current = r.assets; loadedKey.current = photoKey; setMissing(r.missing.length); setReady(true); setTick(x => x + 1) })
    return () => { live = false }
  }, [photoKey])

  // a video clip that has landed on a new frame asks to be drawn; clips stop when the editor closes
  useEffect(() => {
    setVideoListener(() => { if (!busyRef.current) setTick(x => x + 1) })
    return () => { setVideoListener(null); pauseVideos() }
  }, [])

  // draw the frame on screen
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !assets.current) return
    // video clips are put on the moment the playhead is at (they play themselves while the piece plays)
    if (!busyRef.current && assets.current.sync) assets.current.sync(view, t, playing)
    const g = cv.getContext('2d'); if (g) renderFrame(g as Ctx, view, t, assets.current)
  }, [view, t, ready, tick, playing, hold])

  // a small picture of every scene, for the timeline (drawn by the same player; kept until the scene changes)
  useEffect(() => {
    if (!ready || !assets.current || loadedKey.current !== photoKey) return
    const pass = async () => {
      const run = thumbRun.current
      if (run.on) { run.again = true; return }
      run.on = true
      try {
        const d = docRef.current, A = assets.current!, cache = thumbCache.current
        const look = JSON.stringify([d.tokens, W, H, loadedKey.current.length])
        let full: HTMLCanvasElement | null = null, small: HTMLCanvasElement | null = null
        const out: Record<string, string> = {}
        for (let i = 0; i < d.scenes.length; i++) {
          const s = d.scenes[i], key = look + JSON.stringify(s.layers)
          let url = cache.get(key)
          if (!url) {
            const at = Math.min(restTime(s), s.start + s.dur - 0.02)
            // a video clip that is not on screen is put on its own moment first (the one on screen already is);
            // while the piece plays or exports the clips are left alone and the picture is taken afterwards
            let keep = true
            if (A.seek && E.videoOf(d, s) && sceneAt(d, tRef.current) !== i) { if (playRef.current || busyRef.current) keep = false; else await A.seek(d, at) }
            if (!full) { full = document.createElement('canvas'); full.width = W; full.height = H; small = document.createElement('canvas'); small.height = 120; small.width = Math.max(2, Math.round((120 * W) / H)) }
            renderFrame(full.getContext('2d') as Ctx, d, at, A)
            const sg = small!.getContext('2d')!; sg.imageSmoothingQuality = 'high'; sg.drawImage(full, 0, 0, small!.width, small!.height)
            url = small!.toDataURL('image/jpeg', 0.7)
            if (cache.size > 160) cache.clear()
            if (keep) cache.set(key, url)
          }
          out[s.id] = url
        }
        setThumbs(prev => (Object.keys(out).length === Object.keys(prev).length && Object.keys(out).every(k => prev[k] === out[k]) ? prev : out))
      } catch { /* a clip without its picture still shows its name and length */ }
      run.on = false
      if (run.again) { run.again = false; setTimeout(pass, 200) }
    }
    const h = setTimeout(pass, 420)
    return () => clearTimeout(h)
  }, [doc, ready, tick, photoKey, W, H, playing, exp, hold])

  // the measured audit, a moment after every change
  useEffect(() => {
    if (!ready || !assets.current) return
    const h = setTimeout(() => {
      try {
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const g = c.getContext('2d', { willReadFrequently: true }) as Ctx
        const a = auditComposition(docRef.current, canvasMeasure(g), { sample: canvasSampler(docRef.current, assets.current!, g) })
        setAudit(a); setScore(scorePiece(docRef.current, canvasMeasure(g), a))
      } catch { /* keep the last result */ }
    }, 350)
    return () => clearTimeout(h)
  }, [doc, ready, tick, W, H])

  // a shorter piece (a scene deleted, an undo) never leaves the playhead past the end
  useEffect(() => { if (t > dur - 0.02) setT(Math.max(0, dur - 0.02)) }, [dur]) // eslint-disable-line react-hooks/exhaustive-deps

  // play
  useEffect(() => {
    if (!playing) { audioRef.current?.pause(); return }
    const start = performance.now() - tRef.current * 1000
    const a = audioRef.current
    if (a && music) { try { a.currentTime = Math.min((docRef.current.assets.audio.music.start || 0) + tRef.current, Math.max(0, (a.duration || 100) - 0.2)); a.volume = Math.max(0, Math.min(1, docRef.current.assets.audio.music.gain)); a.play().catch(() => {}) } catch { /* no sound in the preview is fine */ } }
    let raf = 0
    const tick2 = () => {
      const x = (performance.now() - start) / 1000
      if (x >= dur) { setT(dur - 0.02); setPlaying(false); return }
      // the music comes up and fades out in the preview exactly as it will in the file
      if (a && music) { try { const m = docRef.current.assets.audio.music; a.volume = musicLevel(x, dur, m.gain, m.fadeOut) } catch { /* volume is best-effort */ } }
      setT(x); raf = requestAnimationFrame(tick2)
    }
    raf = requestAnimationFrame(tick2)
    return () => cancelAnimationFrame(raf)
  }, [playing, dur, music])

  const seek = (x: number) => { setPlaying(false); setT(Math.max(0, Math.min(docRef.current.canvas.duration - 0.02, x))) }
  const togglePlay = () => { if (!ready) return; if (!playing && t >= dur - 0.1) setT(0); setPlaying(p => !p); setSel(null) }

  // ── every change goes through here: it can be undone ──
  const commit = useCallback((next: Composition, key = '') => {
    const d = docRef.current; if (next === d) return
    const h = hist.current, now = Date.now()
    // a run of the same small change (typing a line, dragging a slider) is one step back, not fifty
    if (!(key && key === h.key && now - h.at < 1200)) { h.past.push(d); if (h.past.length > 80) h.past.shift() }
    h.future = []; h.key = key; h.at = now
    emitted.current = next; setHv(x => x + 1); onChange(next)
  }, [onChange])
  const undo = () => { const h = hist.current, p = h.past.pop(); if (!p) return; h.future.push(docRef.current); h.key = ''; emitted.current = p; setHv(x => x + 1); setDrafts({}); onChange(p) }
  const redo = () => { const h = hist.current, n = h.future.pop(); if (!n) return; h.past.push(docRef.current); h.key = ''; emitted.current = n; setHv(x => x + 1); setDrafts({}); onChange(n) }
  useEffect(() => {
    const was = prevDoc.current
    if (doc !== emitted.current && was !== doc && was.id === doc.id) {
      const h = hist.current, now = Date.now()
      if (!(h.key === 'outside' && now - h.at < 1200)) { h.past.push(was); if (h.past.length > 80) h.past.shift() }
      h.future = []; h.key = 'outside'; h.at = now; setHv(x => x + 1)
    }
    prevDoc.current = doc; emitted.current = doc
  }, [doc])

  // ── the words ──
  const setWords = (l: TextLayer | ButtonLayer, text: string) => {
    setDrafts(x => ({ ...x, [l.id]: text }))
    if (l.type === 'button') commit(E.patchLayer(docRef.current, l.id, x => ({ ...(x as ButtonLayer), label: cleanText(text, 60) || (x as ButtonLayer).label })), 'words:' + l.id)
    else commit(E.patchLayer(docRef.current, l.id, x => ({ ...(x as TextLayer), runs: plainToRuns(text, orig.current[l.id] || (x as TextLayer)) })), 'words:' + l.id)
  }
  const wordsOf = (l: TextLayer | ButtonLayer) => (drafts[l.id] != null ? drafts[l.id] : l.type === 'button' ? l.label : runsToPlain(l))
  const select = (id: string | null) => { setSel(id); setDrafts({}); if (id) { setPicker(null); setTab('edit') } }

  const si = sceneAt(view, t)
  const cur = view.scenes[si] || doc.scenes[0]
  const found = sel ? E.findLayer(view, sel) : null
  const selLayer = found && found.si === si ? found.layer : null
  const selRect = selLayer ? E.layerRect(view, selLayer) : null

  // ── clicking into the picture ──
  const pickAt = (clientX: number, clientY: number) => {
    const cv = canvasRef.current; if (!cv) return
    const r = cv.getBoundingClientRect(), k = W / r.width
    lastPt.current = { scene: cur.id, x: (clientX - r.left) * k, y: (clientY - r.top) * k }
    const hits = E.hitLayers(doc, si, (clientX - r.left) * k, (clientY - r.top) * k, canvasMeasure(cv.getContext('2d') as Ctx))
    setPlaying(false)
    if (!hits.length) { select(null); return }
    if (t < restTime(cur) - 0.01) setT(restTime(cur))
    const at = hits.findIndex(l => l.id === sel)
    select(hits[at >= 0 ? (at + 1) % hits.length : 0].id)
  }
  // a tap on the picture while it plays only pauses it; someone who cannot edit plays and pauses with it
  const onCanvasClick = (e: React.MouseEvent) => {
    if (playing) { setPlaying(false); return }
    if (!canEdit) { togglePlay(); return }
    setSceneSel(null); pickAt(e.clientX, e.clientY)
  }

  const startDrag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (!canEdit || !selLayer || selLayer.type === 'fill') return
    const cv = canvasRef.current; if (!cv) return
    e.preventDefault(); e.stopPropagation()
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* the drag still works without capture */ }
    const b = selLayer.box as Box, box: Box = { x: b.x, y: b.y, w: b.w, h: selLayer.type === 'logo' ? (selRect ? selRect.y1 - selRect.y0 : 0) : b.h }
    const lock = E.isAdded(doc, selLayer) ? 'aspect' : selLayer.type === 'shape' && selLayer.shape === 'line' && b.h < 28 ? 'width' : ''
    dragRef.current = { id: selLayer.id, mode, sx: e.clientX, sy: e.clientY, k: W / cv.getBoundingClientRect().width, box, live: box, moved: false, lock }
  }
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return
    const dx = (e.clientX - d.sx) * d.k, dy = (e.clientY - d.sy) * d.k
    if (!d.moved && Math.hypot(dx, dy) < 4 * d.k) return
    d.moved = true
    const sf = doc.canvas.safe
    let b: Box
    if (d.mode === 'move') {
      let x = d.box.x + dx, y = d.box.y + dy
      // it settles on the centre line and on the edges of the safe area
      const snapX = [(W - d.box.w) / 2, sf.left, W - sf.right - d.box.w, 0, W - d.box.w], snapY = [sf.top, H - sf.bottom - d.box.h, 0, H - d.box.h]
      for (const sx of snapX) if (Math.abs(x - sx) < 14) { x = sx; break }
      for (const sy of snapY) if (Math.abs(y - sy) < 14) { y = sy; break }
      b = { ...d.box, x: Math.round(x), y: Math.round(y) }
    } else {
      let w = Math.max(40, d.box.w + dx), h = d.lock === 'width' ? d.box.h : Math.max(30, d.box.h + dy)
      if (Math.abs(d.box.x + w - (W - sf.right)) < 14) w = W - sf.right - d.box.x
      if (Math.abs(d.box.x + w - W) < 14) w = W - d.box.x
      if (Math.abs(d.box.y + h - H) < 14) h = H - d.box.y
      if (d.lock === 'aspect') h = (w * d.box.h) / Math.max(1, d.box.w)       // an added image keeps its shape
      b = { ...d.box, w: Math.round(w), h: Math.round(h) }
    }
    d.live = b; setDragBox({ id: d.id, box: b })
  }
  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null
    if (!d) return
    if (d.moved) commit(E.setBox(docRef.current, d.id, d.live))
    else if (d.mode === 'move') pickAt(e.clientX, e.clientY)      // a click, not a drag: pick what is under it (or behind it)
    setDragBox(null)
  }

  // ── the keyboard: undo, delete, nudge ──
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    if (typing || exp) return
    const plain = !(e.metaKey || e.ctrlKey || e.altKey)
    // Space plays and pauses, as in every editor (a focused button is let go of first, so it is not pressed too)
    if (plain && (e.key === ' ' || e.code === 'Space')) { e.preventDefault(); if (el && el.tagName === 'BUTTON') el.blur(); togglePlay(); return }
    if (!canEdit) {
      if (plain && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); seek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)) }
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateCur(); return }
    if (!plain) return
    if (e.key === 'Escape') { setPicker(null); select(null); setSceneSel(null); return }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); splitAt(); return }
    if (e.key === 'Home') { e.preventDefault(); seek(0); return }
    if (e.key === 'End') { e.preventDefault(); seek(dur); return }
    if (!selLayer || selLayer.type === 'fill') {
      // nothing in the picture is selected: the arrows step through the piece a frame at a time (Shift: a second)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sceneSel && cur && sceneSel === cur.id && doc.scenes.length > 1) { e.preventDefault(); deleteCur() }
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(E.deleteLayer(doc, selLayer.id)); select(null); return }
    const step = e.shiftKey ? 20 : 4, b = selLayer.box as Box
    const move = e.key === 'ArrowLeft' ? { x: b.x - step } : e.key === 'ArrowRight' ? { x: b.x + step } : e.key === 'ArrowUp' ? { y: b.y - step } : e.key === 'ArrowDown' ? { y: b.y + step } : null
    if (move) { e.preventDefault(); commit(E.setBox(doc, selLayer.id, move), 'nudge:' + selLayer.id) }
  }
  const keyRef = useRef(onKey); keyRef.current = onKey
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])

  // ── photographs to swap in or add ──
  const loadPool = async (q: string) => {
    setPoolQ(q); setPoolErr('')
    const hit = poolCache.current[q]
    if (hit) { setPool(hit); return }
    setPoolBusy(true)
    const qs = new URLSearchParams({ moment: doc.brief.moment, area: doc.brief.area, q })
    const j = await fetch('/api/adx/photos?' + qs.toString()).then(r => r.json()).catch(() => null)
    setPoolBusy(false)
    if (!j?.ok) { setPoolErr(j?.error || 'The photographs did not load. Try again.'); return }
    const p: Pool = { photos: j.photos || {}, thumbs: j.thumbs || {}, subjects: j.subjects || [] }
    poolCache.current[q] = p; setPool(p)
  }
  const openPicker = (p: Picker) => { setPicker(p); setTab('edit'); setPlaying(false); if (!pool && !poolBusy) loadPool('') }
  const pickPhoto = (key: string, asset: PhotoAsset) => {
    if (!picker) return
    if (picker.mode === 'swap') commit(E.swapPhoto(doc, picker.layerId, key, asset))
    else if (picker.mode === 'add') { const r = E.addPhoto(doc, picker.sceneId, key, asset); commit(r.doc); setSel(r.layerId) }
    else if (picker.mode === 'scene') {
      // the new scene opens with its headline selected, ready to be retyped (it starts as a copy of the scene before)
      const r = E.addSceneLike(doc, picker.sceneId, key, asset); commit(r.doc)
      const s = r.doc.scenes.find(x => x.id === r.sceneId); if (s) setT(restTime(s))
      const head = s ? s.layers.find(l => l.type === 'text' && !!l.fit) : null; setDrafts({}); setSel(head ? head.id : null)
    }
    setPicker(null)
  }
  // ── an image or PNG from the person's computer ──
  const addImageFile = async (file: File) => {
    setAddErr(''); setAdding(true)
    try {
      const body = await shrinkImage(file)
      const r = await fetch('/api/adx/upload?name=' + encodeURIComponent(file.name.slice(0, 80)), { method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body })
      const j = await r.json().catch(() => null)
      if (!j?.ok) throw new Error(j?.error || 'The image did not upload. Try again.')
      const d = docRef.current, sc = d.scenes[sceneAt(d, tRef.current)]
      const at = lastPt.current && lastPt.current.scene === sc.id ? { x: lastPt.current.x, y: lastPt.current.y } : undefined
      const res = E.addImage(d, sc.id, { src: j.src, w: j.w, h: j.h, source: 'upload', building: '', unit: '', area: '', shows: String(j.name || file.name).replace(/\.[a-z0-9]+$/i, '').slice(0, 60) }, at)
      commit(res.doc); select(res.layerId)
    } catch (e: any) { setAddErr(String(e?.message || e)) }
    setAdding(false)
  }
  // ── a 3D object made for this piece (Jon, 2026-11-20: "add some 3d generation to the mix to fit the look") ──
  const addObject = async (what: string, kind: 'object' | 'illustration' | 'backdrop' = 'object', style = '3d') => {
    setAddErr(''); setAdding(true)
    try {
      const d0 = docRef.current
      // its colours: the piece's mid-tones first (not the lightest or darkest ground)
      const cols = Object.values(d0.tokens.color).slice().sort((a, b) => Math.abs(0.4 - lumOf(a)) - Math.abs(0.4 - lumOf(b))).slice(0, 3)
      const r = await fetch('/api/adx/prop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what, colors: cols, kind, style, frame: W > H ? 'wide' : W === H ? 'square' : 'tall' }) })
      const j = await r.json().catch(() => null)
      if (!j?.ok) throw new Error(j?.error || 'The object was not made. Try again.')
      const d = docRef.current, sc = d.scenes[sceneAt(d, tRef.current)]
      const at = lastPt.current && lastPt.current.scene === sc.id ? { x: lastPt.current.x, y: lastPt.current.y } : undefined
      const res = E.placeArt(d, sc.id, { src: j.src, w: j.w, h: j.h, source: 'upload', building: '', unit: '', area: '', shows: (kind === 'backdrop' ? 'Backdrop: ' : 'Graphic: ') + String(j.name || what).slice(0, 50) }, { backdrop: kind === 'backdrop', at, idle: kind === 'object' ? 'float' : undefined })
      commit(res.doc); select(res.layerId)
    } catch (e: any) { setAddErr(String(e?.message || e)) }
    setAdding(false)
  }
  const goScene = (sid: string, d: Composition) => { const s = d.scenes.find(x => x.id === sid); if (s) { setPlaying(false); setT(restTime(s)) } }

  // ── the timeline's tools: cut, duplicate, delete, and a video clip from the library or the computer ──
  const splitAt = () => {
    const d = docRef.current, x = tRef.current, s = d.scenes[sceneAt(d, x)]
    if (!s || !E.canSplit(d, s.id, x - s.start)) return
    const r = E.splitScene(d, s.id, x - s.start); if (r.sceneId === s.id) return
    commit(r.doc); setPlaying(false); select(null); setSceneSel(r.sceneId)
    const ns = r.doc.scenes.find(y => y.id === r.sceneId); if (ns) setT(ns.start + 0.0005)     // the playhead sits on the cut
  }
  const duplicateCur = () => {
    const d = docRef.current, s = d.scenes[sceneAt(d, tRef.current)]; if (!s) return
    const r = E.duplicateScene(d, s.id); if (r.sceneId === s.id) return
    commit(r.doc); select(null); setSceneSel(r.sceneId); goScene(r.sceneId, r.doc)
  }
  const deleteCur = () => {
    const d = docRef.current, i = sceneAt(d, tRef.current), s = d.scenes[i]; if (!s || d.scenes.length < 2) return
    const next = d.scenes[i + 1] || d.scenes[i - 1], nd = E.deleteScene(d, s.id)
    commit(nd); select(null); setSceneSel(null); if (next) goScene(next.id, nd)
  }
  const pickVideo = (key: string, asset: PhotoAsset) => {
    if (!picker) return
    const d = docRef.current
    if (picker.mode === 'swapVideo') { commit(E.swapPhoto(d, picker.layerId, key, asset)); setSel(picker.layerId) }
    else if (picker.mode === 'video') {
      const r = E.addVideoScene(d, picker.sceneId, key, asset)
      if (!r.layerId) setAddErr('There is no room for another clip: a piece runs up to ' + E.MAX_PIECE_SECONDS + ' seconds and ' + E.MAX_SCENES + ' scenes.')
      else { commit(r.doc); setPlaying(false); setDrafts({}); setSel(r.layerId); setSceneSel(r.sceneId); const ns = r.doc.scenes.find(y => y.id === r.sceneId); if (ns) setT(ns.start + 0.0005) }
    }
    setPicker(null)
  }

  // ── export ──
  const run = async (withSound: boolean) => {
    if (!assets.current || exp) return
    setErr(''); setResult(null); setPlaying(false); busyRef.current = true; pauseVideos(); setExp({ pct: 0, stage: 'Starting' })
    try {
      const r = await exportVideo(doc, assets.current, { musicUrl: withSound && music ? music.file : undefined, musicGain: doc.assets.audio.music.gain, clipSound: withSound, onProgress: (a, b, stage) => setExp({ pct: Math.round((a / Math.max(1, b)) * 100), stage }) })
      download(r.blob, `${fileBase(doc)} (${W}x${H}).${r.ext}`)
      setResult(r)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setExp(null); setTick(x => x + 1)          // the clips go back to the frame the playhead is on
  }
  const still = async () => {
    if (!assets.current) return
    try { download(await exportPng(doc, assets.current, t), `${fileBase(doc)} (${W}x${H}) ${mmss(t).replace(':', 'm')}s.png`) } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const captionText = [doc.social.caption, doc.social.hashtags.join(' '), music ? doc.assets.audio.music.credit : ''].filter(Boolean).join('\n\n')
  const copyCaption = async () => { try { await navigator.clipboard.writeText(captionText); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* the text is selectable below */ } }

  const clipSound = hasClipSound(doc)
  const weakest = score ? score.parts.filter(p => p.score < 10).sort((a, b) => a.score - b.score)[0] || null : null
  const fits = useMemo(() => platformFit(doc), [doc])
  const fails = audit ? audit.issues.filter(x => x.sev === 'fail') : []
  const warns = audit ? audit.issues.filter(x => x.sev === 'warn') : []
  const sf = doc.canvas.safe
  const tall = H > W
  const area: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: UI.bg, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.ink, padding: '7px 9px', fontSize: 13, lineHeight: 1.35, resize: 'vertical', fontFamily: 'inherit' }
  const pct = (v: number, of: number) => (v / of) * 100 + '%'
  // the frame is drawn where the thing meets the canvas, so its corner can always be reached
  const vis = selRect && Math.min(W, selRect.x1) - Math.max(0, selRect.x0) > 8 && Math.min(H, selRect.y1) - Math.max(0, selRect.y0) > 8 ? { x0: Math.max(0, selRect.x0), y0: Math.max(0, selRect.y0), x1: Math.min(W, selRect.x1), y1: Math.min(H, selRect.y1) } : selRect
  // the quick bar goes under the thing, or over it, or (for something that fills the frame) inside at the foot
  const barAt: React.CSSProperties = !vis ? {} : (vis.y1 - vis.y0) / H > 0.4 ? { bottom: 14 } : vis.y1 / H < 0.7 ? { top: `calc(${pct(vis.y1, H)} + 12px)` } : { bottom: `calc(${pct(H - vis.y0, H)} + 12px)` }
  const h = hist.current

  return (
    <div ref={rootRef} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) clamp(330px, 31vw, 450px)', gap: narrow ? 14 : 18, alignItems: 'start', color: UI.ink }}>
      {/* ── the picture ── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ position: 'relative', margin: '0 auto', width: narrow ? `min(100%, ${Math.max(200, Math.round((frame.h - 150) * (W / H)))}px)` : tall ? `min(100%, calc((100vh - 290px) * ${W / H}))` : '100%', maxWidth: tall ? 480 : 820 }}>
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick} title={canEdit ? 'Click anything to change it' : undefined}
            style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 10, background: '#000', cursor: canEdit ? 'pointer' : 'default', boxShadow: '0 12px 40px rgba(0,0,0,.45)' }} />
          {guides || dragBox ? <div style={{ position: 'absolute', left: pct(sf.left, W), top: pct(sf.top, H), right: pct(sf.right, W), bottom: pct(sf.bottom, H), border: '1.5px dashed rgba(255,255,255,0.85)', borderRadius: 4, pointerEvents: 'none', boxShadow: '0 0 0 2000px rgba(255,60,60,0.10)' }} /> : null}
          {!ready ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)', borderRadius: 10, fontSize: 13, color: UI.ink }}>Loading the photographs and type…</div> : null}
          {/* watch it: a play button on the picture, on a phone and for anyone who is only viewing */}
          {ready && !playing && !exp && !dragBox && !selLayer && (narrow || !canEdit) ? (
            <button type="button" onClick={e => { e.stopPropagation(); togglePlay() }} aria-label="Play" title="Play"
              style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 72, height: 72, borderRadius: 72, border: '2px solid rgba(255,255,255,0.85)', background: 'rgba(11,15,22,0.55)', color: '#fff', fontSize: 28, lineHeight: 1, paddingLeft: 6, cursor: 'pointer', boxShadow: '0 6px 22px rgba(0,0,0,.5)', zIndex: 4 }}>▶</button>
          ) : null}

          {/* the selected thing: a frame to drag, a corner to resize */}
          {canEdit && selLayer && vis ? (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div onPointerDown={e => startDrag(e, 'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                style={{ position: 'absolute', left: pct(vis.x0, W), top: pct(vis.y0, H), width: pct(vis.x1 - vis.x0, W), height: pct(vis.y1 - vis.y0, H), border: '2px solid ' + UI.gold, boxShadow: '0 0 0 1px rgba(0,0,0,0.6)', boxSizing: 'border-box', cursor: 'move', pointerEvents: 'auto', touchAction: 'none' }}>
                <div onPointerDown={e => startDrag(e, 'size')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Drag to resize"
                  style={{ position: 'absolute', right: -2, bottom: -2, width: 16, height: 16, borderRadius: 4, background: UI.gold, border: '2px solid #0B0F16', cursor: 'nwse-resize', touchAction: 'none' }} />
              </div>
            </div>
          ) : null}
          {/* the quick bar by it: the commonest changes, right where the click was */}
          {canEdit && selLayer && vis && !dragBox && !picker ? (
            <div style={{ position: 'absolute', zIndex: 5, width: 280, maxWidth: '100%', left: `clamp(0px, ${pct(vis.x0, W)}, calc(100% - 280px))`, ...barAt, background: UI.panel, border: '1px solid ' + UI.gold, borderRadius: 10, padding: 9, boxShadow: '0 10px 30px rgba(0,0,0,.6)' }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: UI.gold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{E.layerName(doc, selLayer)}</p>
              {selLayer.type === 'text' || selLayer.type === 'button' ? <textarea key={selLayer.id} autoFocus rows={selLayer.type === 'button' ? 1 : 2} value={wordsOf(selLayer)} onChange={e => setWords(selLayer, e.target.value)} onKeyDown={e => { if (e.key === 'Escape') select(null) }} aria-label="Words" style={{ ...area, marginBottom: 6 }} /> : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {selLayer.type === 'photo' && E.isVideo(doc, selLayer) ? <button type="button" onClick={() => { setPicker({ mode: 'swapVideo', layerId: selLayer.id }); setTab('edit') }} style={btn(true)}>Replace video</button>
                  : selLayer.type === 'photo' && !E.isAdded(doc, selLayer) ? <button type="button" onClick={() => openPicker({ mode: 'swap', layerId: selLayer.id })} style={btn(true)}>Swap photo</button> : null}
                {selLayer.type === 'text' || selLayer.type === 'button' ? (<>
                  <button type="button" onClick={() => commit(E.resizeText(doc, selLayer.id, -2))} style={chip()}>A −</button>
                  <button type="button" onClick={() => commit(E.resizeText(doc, selLayer.id, 2))} style={chip()}>A +</button>
                </>) : null}
                {selLayer.type === 'logo' ? (<>
                  <button type="button" onClick={() => commit(E.patchLayer(doc, selLayer.id, l => ({ ...l, variant: 'black', tint: undefined } as Layer)))} style={chip(selLayer.variant === 'black')}>Black</button>
                  <button type="button" onClick={() => commit(E.patchLayer(doc, selLayer.id, l => ({ ...l, variant: 'white' } as Layer)))} style={chip(selLayer.variant === 'white')}>White</button>
                </>) : null}
                {selLayer.type !== 'photo' && selLayer.type !== 'logo' && (E.layerColor(doc, selLayer) || selLayer.type === 'motif') ? <Swatches small doc={doc} value={E.layerColor(doc, selLayer)} onPick={k => commit(E.setLayerColor(doc, selLayer.id, k))} /> : null}
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => { commit(E.deleteLayer(doc, selLayer.id)); select(null) }} style={{ ...chip(), color: UI.red, borderColor: 'rgba(224,108,108,0.4)' }}>Delete</button>
              </div>
            </div>
          ) : null}
        </div>

        {/* the timeline: play, scrub, trim, cut, move, add */}
        <AdxTimeline doc={doc} t={t} playing={playing} ready={ready} canEdit={canEdit} thumbs={thumbs} sceneSel={sceneSel} song={music ? music.label : ''}
          canUndo={!!h.past.length} canRedo={!!h.future.length} guides={guides}
          onSeek={seek} onTogglePlay={togglePlay} onUndo={undo} onRedo={redo} onGuides={() => setGuides(v => !v)}
          onPickScene={(sid, at) => { seek(at); select(null); setSceneSel(sid); setTab('edit'); setPicker(null) }}
          onPreview={(next, showT) => { setGhost(next); if (next) { setPlaying(false); if (showT != null) setT(Math.max(0, Math.min(next.canvas.duration - 0.02, showT))) } }}
          onEdit={(next, sid, kind) => { commit(next); setSceneSel(sid); if (kind === 'move') goScene(sid, next) }}
          onSplit={splitAt} onDuplicate={duplicateCur} onDelete={deleteCur}
          onAddScene={() => openPicker({ mode: 'scene', sceneId: cur.id })} onAddVideo={() => { setAddErr(''); setPicker({ mode: 'video', sceneId: cur.id }); setTab('edit'); setPlaying(false) }}
          onSong={() => { setTab('style'); setPicker(null) }} compact={narrow} />
        {canEdit && cur ? <AddBar doc={doc} scene={cur} at={lastPt.current && lastPt.current.scene === cur.id ? { x: lastPt.current.x, y: lastPt.current.y } : undefined} commit={commit} onSelect={id => { if (id && t < restTime(cur) - 0.01) seek(restTime(cur)); select(id) }} onAddPhoto={sid => openPicker({ mode: 'add', sceneId: sid })} onImage={addImageFile} onObject={addObject} busy={adding} err={addErr} /> : null}
        {canEdit ? <p style={{ margin: '10px auto 0', maxWidth: 820, fontSize: 11.5, color: UI.mut, textAlign: 'center' }}>{narrow ? 'Tap ▶ to watch. Tap anything in the picture to change it; drag to move it.' : 'Click anything in the picture to change it. Drag to move, drag the corner to resize, Delete removes it.'}</p> : null}
        {music ? <audio ref={audioRef} src={music.file} preload="auto" /> : null}
      </div>

      {/* ── beside it: the check, then Edit · Look & sound · Words · Files ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <section style={{ background: UI.panel, border: '1px solid ' + (fails.length ? 'rgba(224,108,108,0.5)' : UI.line), borderRadius: 12, padding: '11px 13px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>
            {!audit ? 'Checking the piece…' : fails.length ? <span style={{ color: UI.red }}>{fails.length} thing{fails.length === 1 ? '' : 's'} to fix before it goes out</span> : <span style={{ color: UI.green }}>✓ Passed the check</span>}
            {audit ? <span style={{ fontWeight: 500, color: UI.mut, marginLeft: 8, fontSize: 11.5 }}>{audit.measured.text} lines measured · {audit.measured.photos} photos · {audit.measured.scenes} scenes</span> : null}
          </p>
          {missing ? <p style={{ margin: '6px 0 0', fontSize: 12, color: UI.red }}>{missing} photograph{missing === 1 ? '' : 's'} could not be loaded.</p> : null}
          {/* the craft score: one line, and the reasons on request (Jon, 2026-11-21: "real audits") */}
          {score ? (
            <p style={{ margin: '7px 0 0', fontSize: 12.5, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 800, color: score.total >= 90 ? UI.green : score.total >= 75 ? UI.gold : UI.red }}>Craft score {score.total}</span>
              <span style={{ color: UI.mut }}> of 100{weakest ? ' · weakest: ' + weakest.label + ' ' + weakest.score : ' · nothing marked down'}</span>
              <button type="button" onClick={() => setScoreOpen(v => !v)} aria-expanded={scoreOpen} style={{ background: 'none', border: 0, padding: '0 0 0 8px', color: UI.gold, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>{scoreOpen ? 'Hide' : 'Why'}</button>
            </p>
          ) : null}
          {score && scoreOpen ? (
            <div style={{ margin: '6px 0 2px', borderTop: '1px solid ' + UI.line, paddingTop: 6 }}>
              {score.parts.map(p => (
                <p key={p.key} style={{ margin: '3px 0 0', fontSize: 12, lineHeight: 1.45, color: UI.ink }}>
                  <span style={{ display: 'inline-block', minWidth: 104, fontWeight: 700 }}>{p.label}</span>
                  <span style={{ fontWeight: 800, color: p.score >= 9 ? UI.green : p.score >= 7 ? UI.gold : UI.red, fontVariantNumeric: 'tabular-nums' }}>{p.score}</span>
                  <span style={{ color: UI.mut }}>{p.notes.length ? ' · ' + p.notes.join(' ') : ''}</span>
                </p>
              ))}
            </div>
          ) : null}
          {fails.concat(warns).slice(0, 6).map((x, i) => (
            <button key={i} type="button" onClick={() => { const s = doc.scenes.find(y => y.id === x.scene); if (s) seek(restTime(s)); if (x.layer && canEdit) select(x.layer) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: '7px 0 0', color: UI.ink, cursor: x.scene ? 'pointer' : 'default', fontSize: 12.5, lineHeight: 1.45 }}>
              <span style={{ color: x.sev === 'fail' ? UI.red : UI.gold, fontWeight: 800, marginRight: 6 }}>{x.sev === 'fail' ? 'Fix' : 'Note'}</span>{x.msg}
            </button>
          ))}
        </section>

        <div style={{ display: 'flex', gap: 6 }}>
          {([['edit', 'Edit'], ['style', 'Look & sound'], ['words', 'Words'], ['files', 'Files']] as const).map(([k, name]) => (
            <button key={k} type="button" onClick={() => { setTab(k); if (k !== 'edit') setPicker(null) }} aria-pressed={tab === k} style={{ ...btn(), flex: 1, background: tab === k ? UI.gold : UI.panel2, color: tab === k ? '#0B0F16' : UI.ink, border: tab === k ? 0 : '1px solid ' + UI.line }}>{name}</button>
          ))}
        </div>

        {tab === 'edit' ? (!canEdit ? <Sec title="View only"><p style={{ margin: '6px 0 0', fontSize: 12.5, color: UI.mut }}>You can play and download this piece. Editing needs Ad Studio edit access.</p></Sec> : picker && (picker.mode === 'video' || picker.mode === 'swapVideo') ? (
          <VideoPicker title={picker.mode === 'video' ? 'Add a video clip' : 'Use a video here'} onPick={pickVideo} onCancel={() => setPicker(null)} />
        ) : picker ? (
          <PhotoPicker doc={doc} title={picker.mode === 'swap' ? 'Swap this photo' : picker.mode === 'add' ? 'Add a photo to this scene' : 'New scene — pick its photo'} pool={pool} busy={poolBusy} err={poolErr} q={poolQ} onQ={loadPool} onPick={pickPhoto} onCancel={() => setPicker(null)} exceptLayer={picker.mode === 'swap' ? picker.layerId : undefined} />
        ) : (<>
          {selLayer ? <LayerPanel doc={doc} scene={cur} layer={(E.findLayer(doc, selLayer.id)?.layer) || selLayer} commit={commit} wordsOf={wordsOf} setWords={setWords} onSwap={id => openPicker({ mode: 'swap', layerId: id })} onSwapVideo={id => { setPicker({ mode: 'swapVideo', layerId: id }); setTab('edit'); setPlaying(false) }} onDeselect={() => select(null)} /> : null}
          <ScenePanel doc={doc} scene={cur} index={si} sel={sel} commit={commit} onSelect={id => { if (id && t < restTime(cur) - 0.01) seek(restTime(cur)); select(id) }} onAddScene={sid => openPicker({ mode: 'scene', sceneId: sid })} onGo={goScene} />
        </>)) : null}

        {tab === 'style' ? (canEdit ? <StylePanel doc={doc} original={origColors.current.color} commit={commit} /> : null) : null}

        {tab === 'files' ? (
          <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 800 }}>Files</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" disabled={!ready || !!exp || !!fails.length} onClick={() => run(true)} style={btn(true, !ready || !!exp || !!fails.length)}>{music ? 'MP4 with music' : clipSound ? 'MP4 with sound' : 'MP4'}</button>
              {music || clipSound ? <button type="button" disabled={!ready || !!exp || !!fails.length} onClick={() => run(false)} style={btn(false, !ready || !!exp || !!fails.length)}>MP4 without sound</button> : null}
              <button type="button" disabled={!ready} onClick={still} title="The frame on screen, full size — for a photo post" style={btn(false, !ready)}>PNG of this frame</button>
            </div>
            {fails.length && ready && !exp ? <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>Video export waits for the check to pass. <button type="button" onClick={() => run(true)} style={{ background: 'none', border: 0, padding: 0, color: UI.gold, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline' }}>Export anyway</button></p> : null}
            {exp ? (
              <div style={{ marginTop: 9 }}>
                <div style={{ height: 6, borderRadius: 3, background: UI.panel2, overflow: 'hidden' }}><div style={{ width: exp.pct + '%', height: '100%', background: UI.gold, transition: 'width .2s' }} /></div>
                <p style={{ margin: '5px 0 0', fontSize: 11.5, color: UI.mut }}>{exp.stage} · {exp.pct}%</p>
              </div>
            ) : null}
            {result ? <p style={{ margin: '8px 0 0', fontSize: 12, color: result.path === 'webcodecs' ? UI.green : UI.gold, lineHeight: 1.45 }}>{result.path === 'webcodecs' ? '✓ ' : ''}{result.note} ({(result.blob.size / 1048576).toFixed(1)} MB in {(result.ms / 1000).toFixed(1)} s)</p> : null}
            {err ? <p style={{ margin: '8px 0 0', fontSize: 12, color: UI.red }}>{err}</p> : null}
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: UI.mut }}>{W} × {H} · 30 frames a second · {doc.scenes.length} scenes · {dur.toFixed(1)} s{music ? ' · ' + music.label : ' · no music'}</p>

            {/* where it can go, and the same piece in another shape (Jon, 2026-11-21: "From posts, to videos to shorts") */}
            <p style={{ margin: '14px 0 4px', fontSize: 13, fontWeight: 800 }}>Where it can go</p>
            {fits.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderTop: '1px solid ' + UI.line }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 118 }}>{f.label}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: f.state === 'ready' ? UI.green : UI.mut }}>{f.state === 'ready' ? '✓ Ready' : f.state === 'notes' ? <><span style={{ color: UI.gold, fontWeight: 700 }}>Ready, with a note. </span>{f.notes.join(' ')}</> : f.notes[0]}</span>
                {f.state === 'shape' && onVariant && canEdit ? <button type="button" onClick={() => onVariant(f.channel)} title="Makes a copy of this piece laid out for this shape and opens it. No AI is used; this piece stays as it is." style={chip()}>Make this shape</button> : null}
              </div>
            ))}
            <p style={{ margin: '6px 0 0', fontSize: 11, color: UI.mut }}>The studio keeps words clear of every platform’s own buttons. A still for a photo post is “PNG of this frame”.</p>
          </section>
        ) : null}

        {tab === 'words' ? (<>
          <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 800 }}>Words</p>
            <p style={{ margin: '0 0 10px', fontSize: 11.5, color: UI.mut }}>Every line is editable, here or by clicking it on the picture. *Stars* mark the accent words.</p>
            {doc.scenes.map((s, i) => {
              const line = doc.script.lines.find(l => l.scene === s.id)
              return (
                <div key={s.id} style={{ borderTop: i ? '1px solid ' + UI.line : 0, padding: i ? '9px 0 2px' : '0 0 2px' }}>
                  <button type="button" onClick={() => seek(restTime(s))} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: i === si ? UI.gold : UI.mut, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{i + 1} · {s.name}</button>
                  {s.layers.filter((l): l is TextLayer | ButtonLayer => l.type === 'text' || l.type === 'button').map(l => (
                    <textarea key={l.id} rows={l.type === 'text' && l.fit ? 2 : 1} disabled={!canEdit} value={wordsOf(l)} onFocus={() => { if (si !== i) seek(restTime(s)) }} onChange={e => setWords(l, e.target.value)}
                      onBlur={() => setDrafts(x => { const y = { ...x }; delete y[l.id]; return y })} aria-label={(l.type === 'button' ? 'Button' : l.fit ? 'Headline' : 'Label') + ' in scene ' + (i + 1)}
                      style={{ ...area, marginTop: 6, fontWeight: l.type === 'text' && l.fit ? 700 : 500, fontFamily: l.type === 'text' && l.fit ? display : 'inherit', fontSize: l.type === 'text' && l.fit ? 14.5 : 12.5 }} />
                  ))}
                  {line ? (
                    <label style={{ display: 'block', marginTop: 6 }}>
                      <span style={{ fontSize: 10.5, color: UI.mut, fontWeight: 700 }}>Spoken line (for the voice, next phase)</span>
                      <textarea rows={1} disabled={!canEdit} value={line.vo} onChange={e => commit({ ...doc, script: { ...doc.script, lines: doc.script.lines.map(x => (x.scene === s.id ? { ...x, vo: e.target.value.slice(0, 300) } : x)) } }, 'vo:' + s.id)} style={{ ...area, marginTop: 3, fontSize: 12.5, color: UI.mut }} />
                    </label>
                  ) : null}
                </div>
              )
            })}
          </section>

          <section style={{ background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '11px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, flex: 1 }}>Caption</p>
              <button type="button" onClick={copyCaption} style={btn()}>{copied ? '✓ Copied' : 'Copy caption'}</button>
            </div>
            <textarea rows={4} disabled={!canEdit} value={doc.social.caption} onChange={e => commit({ ...doc, social: { ...doc.social, caption: e.target.value.slice(0, 2200) } }, 'caption')} style={area} />
            {doc.social.captionAlternates.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7 }}>
                {doc.social.captionAlternates.map((c, i) => <button key={i} type="button" disabled={!canEdit} onClick={() => commit({ ...doc, social: { ...doc.social, caption: c, captionAlternates: doc.social.captionAlternates.map((x, k) => (k === i ? doc.social.caption : x)) } })} title="Use this caption instead" style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, color: UI.mut, padding: '6px 9px', fontSize: 12, lineHeight: 1.4, cursor: 'pointer' }}>↺ {c}</button>)}
              </div>
            ) : null}
            <p style={{ margin: '7px 0 0', fontSize: 11.5, color: UI.mut }}>{doc.social.hashtags.join(' ')}{music ? ' · the music credit is copied with it' : ''}</p>
          </section>
        </>) : null}
      </div>
    </div>
  )
}
