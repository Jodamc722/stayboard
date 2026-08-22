'use client'
// HERO STUDIO — build a listing's hero image with real control. Pick single or collage, choose the
// layout, select which photos fill each cell, reorder them, and crop/zoom each one (drag to pan,
// slider to zoom, or let AI "focus" frame it from a prompt). Enhance uses the sharp pipeline; AI focus
// uses Claude vision to pick the framing (it guides the crop — it does not repaint pixels). Everything
// renders on one canvas so the download/push is exactly what you see.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Download, Sparkles, X, Upload, UploadCloud, Wand2, ZoomIn, RotateCcw, Image as ImageIcon, Check } from 'lucide-react'

type Pic = { _id?: string; original?: string; thumbnail?: string }
type XF = { scale: number; fx: number; fy: number }               // zoom + focal point (0..1)
type PoolItem = { id: string; url: string; synced: boolean }      // synced = a real Guesty photo (enhanceable)

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const GAP = 26

type Layout = { key: string; label: string; cells: (W: number, H: number, g: number) => { x: number; y: number; w: number; h: number }[] }
const LAYOUTS: Layout[] = [
  { key: 'single', label: 'Single', cells: (W, H) => [{ x: 0, y: 0, w: W, h: H }] },
  { key: 'twoup', label: 'Two-up', cells: (W, H, g) => { const hw = (W - g) / 2; return [{ x: 0, y: 0, w: hw, h: H }, { x: hw + g, y: 0, w: hw, h: H }] } },
  { key: 'grid2x2', label: 'Grid', cells: (W, H, g) => { const cw = (W - g) / 2, ch = (H - g) / 2; return [[0, 0], [cw + g, 0], [0, ch + g], [cw + g, ch + g]].map(p => ({ x: p[0], y: p[1], w: cw, h: ch })) } },
  { key: 'big3', label: 'Feature + 3', cells: (W, H, g) => { const bw = W * 0.62, rw = W - bw - g / 2, rh = (H - 2 * g) / 3; const out = [{ x: 0, y: 0, w: bw - g / 2, h: H }]; for (let i = 0; i < 3; i++) out.push({ x: bw + g / 2, y: i * (rh + g), w: rw, h: rh }); return out } },
  { key: 'bigleft2', label: 'Feature + 2', cells: (W, H, g) => { const bw = W * 0.64, rw = W - bw - g / 2, rh = (H - g) / 2; return [{ x: 0, y: 0, w: bw - g / 2, h: H }, { x: bw + g / 2, y: 0, w: rw, h: rh }, { x: bw + g / 2, y: rh + g, w: rw, h: rh }] } },
  { key: 'strip3', label: 'Strip', cells: (W, H, g) => { const cw = (W - 2 * g) / 3; return [0, 1, 2].map(i => ({ x: i * (cw + g), y: 0, w: cw, h: H })) } },
  { key: 'film', label: 'Film', cells: (W, H, g) => { const th = H * 0.68, fh = H - th - g, fw = (W - 3 * g) / 4; const out = [{ x: 0, y: 0, w: W, h: th }]; for (let i = 0; i < 4; i++) out.push({ x: i * (fw + g), y: th + g, w: fw, h: fh }); return out } },
]

// Output shape. A hero is stored once but each channel crops it differently, so let the host pick the
// aspect ratio they're optimizing for. Preview + export + hit-testing all derive their pixel dims here.
type Ratio = { key: string; label: string; hint: string; w: number; h: number }
const RATIOS: Ratio[] = [
  { key: '32', label: 'Wide 3:2', hint: 'Airbnb cover & direct site', w: 3, h: 2 },
  { key: '43', label: 'Classic 4:3', hint: 'Vrbo / Booking galleries', w: 4, h: 3 },
  { key: '11', label: 'Square 1:1', hint: 'Social & map/tile thumbnails', w: 1, h: 1 },
  { key: '45', label: 'Portrait 4:5', hint: 'Instagram / mobile-first', w: 4, h: 5 },
]
const PREVIEW_W = 1500   // on-screen base width; height follows the ratio
const EXPORT_W = 3000    // download/push base width; height follows the ratio

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// Draw an image into a cell honoring the crop transform (scale = zoom, fx/fy = focal point).
function drawCell(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, xf?: XF) {
  const scale = Math.max(1, xf?.scale || 1), fx = clamp01(xf?.fx ?? 0.5), fy = clamp01(xf?.fy ?? 0.5)
  const ir = img.naturalWidth / img.naturalHeight, tr = w / h
  let sw = img.naturalWidth, sh = img.naturalHeight
  if (ir > tr) sw = img.naturalHeight * tr; else sh = img.naturalWidth / tr   // cover base rect
  sw /= scale; sh /= scale
  let sx = fx * img.naturalWidth - sw / 2, sy = fy * img.naturalHeight - sh / 2
  sx = Math.max(0, Math.min(img.naturalWidth - sw, sx)); sy = Math.max(0, Math.min(img.naturalHeight - sh, sy))
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// Best-quality Cloudinary rendition so we don't downscale a giant original in one rough step.
function hiRes(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_2400,q_auto:best,f_jpg/')
  return u
}

export function HeroCollage({ listingId, name, city, building, pictures, amenities }: { listingId: string; name: string; city: string; building: string; pictures: Pic[]; amenities: string[] }) {
  const [open, setOpen] = useState(false)
  const [layoutKey, setLayoutKey] = useState('single')
  const [ratioKey, setRatioKey] = useState('32')
  const [slots, setSlots] = useState<string[]>([])            // photo id per cell ('' = empty)
  const [sel, setSel] = useState(0)                           // selected cell index
  const [xf, setXf] = useState<Record<string, XF>>({})        // crop transform per photo id
  const [overrideUrl, setOverrideUrl] = useState<Record<string, string>>({}) // enhanced/edited url per id
  const [uploads, setUploads] = useState<PoolItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [focusing, setFocusing] = useState(false)
  const [focusPrompt, setFocusPrompt] = useState('')
  const [asCover, setAsCover] = useState(false)              // push as the FIRST (cover) photo vs appended
  const [dragOver, setDragOver] = useState(false)
  const [, force] = useState(0)                               // re-render tick when an image finishes loading

  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const imgCache = useRef<Record<string, HTMLImageElement>>({})
  const loading = useRef<Set<string>>(new Set())
  const dragSlot = useRef<number | null>(null)                // slot being reordered
  const panning = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 })

  // Pool = the unit's synced photos + anything the host uploaded.
  const pool = useMemo<PoolItem[]>(() => {
    const synced = pictures.map((p, i) => ({ id: p._id || `pic_${i}`, url: p.original || p.thumbnail || '', synced: !!p._id })).filter(p => p.url)
    return [...synced, ...uploads]
  }, [pictures, uploads])
  const urlOf = useCallback((id: string) => overrideUrl[id] || pool.find(p => p.id === id)?.url || '', [overrideUrl, pool])
  const layout = LAYOUTS.find(l => l.key === layoutKey) || LAYOUTS[0]
  const ratio = RATIOS.find(r => r.key === ratioKey) || RATIOS[0]
  const pvW = PREVIEW_W, pvH = Math.round(PREVIEW_W * ratio.h / ratio.w)   // preview px dims
  const exW = EXPORT_W, exH = Math.round(EXPORT_W * ratio.h / ratio.w)     // export px dims
  const cellCount = layout.cells(exW, exH, GAP).length

  // Load an image (proxy hi-res for synced/remote, direct for uploads) into the cache; re-render on load.
  const ensureImg = useCallback((id: string) => {
    const url = urlOf(id); if (!url) return
    const cacheKey = id + '|' + url
    if (imgCache.current[cacheKey] || loading.current.has(cacheKey)) return
    loading.current.add(cacheKey)
    const remote = /^https?:/.test(url)
    const tryLoad = (src: string) => new Promise<HTMLImageElement | null>(res => {
      const im = new Image(); let done = false
      const t = setTimeout(() => { if (!done) { done = true; res(null) } }, 15000)
      im.onload = () => { if (!done) { done = true; clearTimeout(t); res(im) } }
      im.onerror = () => { if (!done) { done = true; clearTimeout(t); res(null) } }
      im.src = src
    })
    ;(async () => {
      let im: HTMLImageElement | null = null
      if (remote) im = (await tryLoad(`/api/img-proxy?url=${encodeURIComponent(hiRes(url))}`)) || (await tryLoad(`/api/img-proxy?url=${encodeURIComponent(url)}`))
      else im = await tryLoad(url)
      loading.current.delete(cacheKey)
      if (im) { imgCache.current[cacheKey] = im; force(x => x + 1) }
    })()
  }, [urlOf])

  const imgFor = useCallback((id: string): HTMLImageElement | null => {
    const url = urlOf(id); if (!url) return null
    return imgCache.current[id + '|' + url] || null
  }, [urlOf])

  // Keep slots sized to the layout; auto-fill new empty cells with the next unused pool photos.
  useEffect(() => {
    setSlots(prev => {
      const next = prev.slice(0, cellCount)
      const used = new Set(next.filter(Boolean))
      for (let i = next.length; i < cellCount; i++) { const p = pool.find(x => !used.has(x.id)); if (p) { next.push(p.id); used.add(p.id) } else next.push('') }
      while (next.length < cellCount) next.push('')
      return next
    })
    if (sel >= cellCount) setSel(0)
  }, [cellCount, pool, sel])

  useEffect(() => { slots.forEach(id => { if (id) ensureImg(id) }) }, [slots, ensureImg, overrideUrl])

  // Paint the whole composition to any canvas/resolution.
  const paint = useCallback((canvas: HTMLCanvasElement, W: number, H: number) => {
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, W, H)
    const cells = layout.cells(W, H, W * (GAP / 3000))
    cells.forEach((c, i) => {
      const id = slots[i]; const im = id ? imgFor(id) : null
      if (im) { ctx.save(); roundRectPath(ctx, c.x, c.y, c.w, c.h, Math.min(c.w, c.h) * 0.02); ctx.clip(); drawCell(ctx, im, c.x, c.y, c.w, c.h, xf[id]); ctx.restore() }
      else { ctx.fillStyle = '#e2e8f0'; roundRectPath(ctx, c.x, c.y, c.w, c.h, 10); ctx.fill(); ctx.fillStyle = '#94a3b8'; ctx.font = `${Math.round(c.h * 0.09)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('empty', c.x + c.w / 2, c.y + c.h / 2) }
    })
  }, [layout, slots, xf, imgFor])

  // Live preview (sharp on screen; export renders at higher res). Both follow the chosen ratio.
  useEffect(() => { const c = previewRef.current; if (c) paint(c, pvW, pvH) })

  // --- interactions -------------------------------------------------------
  const cellAt = (clientX: number, clientY: number): number => {
    const c = previewRef.current; if (!c) return -1
    const r = c.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * pvW, py = ((clientY - r.top) / r.height) * pvH
    const cells = layout.cells(pvW, pvH, pvW * (GAP / EXPORT_W))
    for (let i = 0; i < cells.length; i++) { const cc = cells[i]; if (px >= cc.x && px <= cc.x + cc.w && py >= cc.y && py <= cc.y + cc.h) return i }
    return -1
  }
  function onPointerDown(e: React.PointerEvent) {
    const i = cellAt(e.clientX, e.clientY); if (i < 0) return
    setSel(i)
    if (slots[i]) { panning.current = { active: true, lastX: e.clientX, lastY: e.clientY }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!panning.current.active) return
    const id = slots[sel]; if (!id) return
    const c = previewRef.current; if (!c) return
    const r = c.getBoundingClientRect()
    const dx = (e.clientX - panning.current.lastX) / r.width, dy = (e.clientY - panning.current.lastY) / r.height
    panning.current.lastX = e.clientX; panning.current.lastY = e.clientY
    setXf(prev => { const t = prev[id] || { scale: 1, fx: 0.5, fy: 0.5 }; return { ...prev, [id]: { ...t, fx: clamp01(t.fx - dx / t.scale), fy: clamp01(t.fy - dy / t.scale) } } })
  }
  function onPointerUp() { panning.current.active = false }

  const setSelXf = (patch: Partial<XF>) => { const id = slots[sel]; if (!id) return; setXf(prev => { const t = prev[id] || { scale: 1, fx: 0.5, fy: 0.5 }; return { ...prev, [id]: { ...t, ...patch } } }) }
  const selId = slots[sel]
  const selXf = selId ? (xf[selId] || { scale: 1, fx: 0.5, fy: 0.5 }) : null
  const selSynced = !!pool.find(p => p.id === selId)?.synced

  function assignToSel(id: string) { setSlots(prev => { const n = prev.slice(); n[sel] = id; return n }); ensureImg(id) }
  function onSlotDrop(target: number) { const from = dragSlot.current; dragSlot.current = null; if (from == null || from === target) return; setSlots(prev => { const n = prev.slice();[n[from], n[target]] = [n[target], n[from]]; return n }) }

  // --- photo ops ----------------------------------------------------------
  async function enhanceSel() {
    const id = selId; if (!id || !selSynced) return
    setEnhancing(true); setError(null)
    try {
      const r = await fetch('/api/photo-enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, photoIds: [id] }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Enhance failed')
      const eu = (j.photos || [])[0]?.enhancedUrl
      if (eu) setOverrideUrl(prev => ({ ...prev, [id]: eu }))
      else throw new Error('No enhanced version returned.')
    } catch (e: any) { setError(e.message || String(e)) } finally { setEnhancing(false) }
  }
  async function aiFocus() {
    const id = selId; if (!id) return
    setFocusing(true); setError(null)
    try {
      const u = urlOf(id)
      // Remote photos: send the URL (server fetches a small rendition). Uploaded/local photos have a
      // blob: URL the server can't reach — downscale the loaded image to a data URL and send the bytes.
      let payload: any
      if (/^https?:/.test(u)) payload = { url: u, prompt: focusPrompt }
      else {
        const im = imgFor(id)
        if (!im) throw new Error('That photo is still loading — try again in a moment.')
        const maxW = 1024, sc = Math.min(1, maxW / (im.naturalWidth || maxW))
        const cw = Math.max(1, Math.round((im.naturalWidth || maxW) * sc)), ch = Math.max(1, Math.round((im.naturalHeight || maxW) * sc))
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch
        const cx2 = cv.getContext('2d'); if (!cx2) throw new Error('Could not read that image.')
        cx2.drawImage(im, 0, 0, cw, ch)
        payload = { imageData: cv.toDataURL('image/jpeg', 0.85), prompt: focusPrompt }
      }
      const r = await fetch('/api/photo-focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not focus this photo.')
      setXf(prev => ({ ...prev, [id]: { scale: Number(j.zoom) || 1.4, fx: clamp01(Number(j.cx)), fy: clamp01(Number(j.cy)) } }))
    } catch (e: any) { setError(e.message || String(e)) } finally { setFocusing(false) }
  }

  function onFiles(list: FileList | null) {
    if (!list) return
    const next = Array.from(list).filter(f => f.type.startsWith('image/')).map((f, i) => ({ id: `up_${Date.now()}_${i}`, url: URL.createObjectURL(f), synced: false }))
    if (next.length) setUploads(u => [...u, ...next].slice(0, 16))
    if (fileInput.current) fileInput.current.value = ''
  }

  function download() {
    const c = document.createElement('canvas'); paint(c, exW, exH)
    c.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(name || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.jpg`; a.click(); URL.revokeObjectURL(a.href) }, 'image/jpeg', 0.96)
  }
  async function pushToGuesty() {
    if (!slots.some(Boolean)) { setError('Add at least one photo first.'); return }
    const placement = asCover
      ? 'It becomes the COVER (first) photo — the image guests see first — and pushes the current cover back one.'
      : 'It is added at the END of the set (not the cover).'
    const collageWarn = layoutKey === 'single' ? '' : '\n\nAirbnb discourages photos with graphics/collages — a single-photo hero is safest as an Airbnb cover; collages shine on Booking.com, Vrbo and your direct site.'
    if (!confirm(`Push this hero image to Guesty as a NEW photo on this listing?\n\nIt syncs to ALL connected channels. ${placement}${collageWarn}`)) return
    setPushing(true); setPushMsg(null); setError(null)
    try {
      const c = document.createElement('canvas'); paint(c, exW, exH)
      const dataUrl: string = await new Promise(res => c.toBlob(b => { if (!b) return res(''); const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.readAsDataURL(b) }, 'image/jpeg', 0.95))
      if (!dataUrl) throw new Error('Could not read the image.')
      const r = await fetch('/api/hero/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, dataUrl, caption: name || 'Featured', cover: asCover }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Push failed')
      setPushMsg(`Pushed to Guesty${asCover ? ' as the cover photo' : ''} — listing now has ${j.count} photos. Syncing to channels.`)
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold px-2.5 py-1.5 border transition-colors disabled:opacity-50'

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><LayoutGrid size={15} className="text-brand-600" /> Hero image studio</h2>
          <p className="text-[12px] text-muted mt-0.5">Single hero or a collage — pick the photos, crop &amp; zoom each one, enhance, or let AI focus the shot. Then download or push to Guesty.</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 flex-shrink-0"><LayoutGrid size={15} /> {open ? 'Hide' : 'Open studio'}</button>
      </div>

      {open && (
        <div className="px-4 py-4 border-t border-line space-y-4"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
          onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) } }}>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{error}</div>}
          {pushMsg && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700 flex items-center justify-between gap-2"><span>{pushMsg}</span><button onClick={() => setPushMsg(null)} className="text-muted hover:text-ink"><X size={13} /></button></div>}

          {/* Layout picker */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-1">Layout</span>
            {LAYOUTS.map(l => (
              <button key={l.key} onClick={() => setLayoutKey(l.key)} className={`text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${layoutKey === l.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:bg-app'}`}>{l.label}</button>
            ))}
          </div>

          {/* Aspect-ratio / channel presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-1">Shape</span>
            {RATIOS.map(rr => (
              <button key={rr.key} onClick={() => setRatioKey(rr.key)} title={rr.hint} className={`text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${ratioKey === rr.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:bg-app'}`}>{rr.label}</button>
            ))}
            <span className="text-[11px] text-muted ml-1">{ratio.hint}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Live preview — click a cell to select it, drag to pan */}
            <div className="lg:col-span-2">
              <canvas ref={previewRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
                className="w-full block rounded-xl border border-line touch-none cursor-move" style={{ aspectRatio: `${ratio.w} / ${ratio.h}` }} />
              <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                <span className="text-[11px] text-muted">Click a cell to select · drag on it to pan{cellCount > 1 ? ' · drag the thumbnails below to rearrange' : ''}</span>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-muted cursor-pointer select-none" title="Insert as the first photo (the cover guests see first) instead of appending to the end">
                    <input type="checkbox" checked={asCover} onChange={e => setAsCover(e.target.checked)} className="accent-brand-600 w-3.5 h-3.5" /> Set as cover
                  </label>
                  <button onClick={pushToGuesty} disabled={pushing} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50">{pushing ? <Sparkles size={13} className="animate-pulse" /> : <UploadCloud size={13} />} {pushing ? 'Pushing…' : 'Push to Guesty'}</button>
                  <button onClick={download} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink hover:text-brand-700"><Download size={13} /> Download</button>
                </div>
              </div>

              {/* Cell thumbnails (reorder) */}
              {cellCount > 1 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {slots.map((id, i) => (
                    <div key={i} draggable onDragStart={() => { dragSlot.current = i }} onDragOver={e => e.preventDefault()} onDrop={() => onSlotDrop(i)} onClick={() => setSel(i)}
                      className={`relative w-14 h-11 rounded-md overflow-hidden border-2 cursor-pointer ${sel === i ? 'border-brand-500' : 'border-line'}`} title={`Cell ${i + 1}`}>
                      {id && urlOf(id) ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={urlOf(id)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-app grid place-items-center text-[9px] text-muted">empty</div>}
                      <span className="absolute bottom-0 left-0 text-[8px] bg-black/50 text-white px-1 rounded-tr">{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right rail: crop/zoom + enhance + AI focus for the selected cell */}
            <div className="space-y-3">
              <div className="rounded-xl border border-line bg-app/30 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Selected cell {cellCount > 1 ? `(${sel + 1}/${cellCount})` : ''}</div>
                {!selId ? <div className="text-[12px] text-muted">Pick a photo below to fill this cell.</div> : (
                  <div className="space-y-2.5">
                    <label className="block">
                      <span className="text-[11px] text-muted inline-flex items-center gap-1"><ZoomIn size={11} /> Zoom {Math.round((selXf!.scale) * 100)}%</span>
                      <input type="range" min={1} max={3} step={0.05} value={selXf!.scale} onChange={e => setSelXf({ scale: Number(e.target.value) })} className="w-full accent-brand-600" />
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setSelXf({ scale: 1, fx: 0.5, fy: 0.5 })} className={`${btn} border-line text-muted bg-white hover:bg-app`}><RotateCcw size={12} /> Reset crop</button>
                      <button onClick={enhanceSel} disabled={enhancing || !selSynced} title={selSynced ? 'Brighten, sharpen, color-correct (saved copy)' : 'Enhance is available for the unit’s synced photos'} className={`${btn} border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100`}>{enhancing ? <Sparkles size={12} className="animate-pulse" /> : <Wand2 size={12} />} {enhancing ? 'Enhancing…' : 'Enhance'}</button>
                    </div>
                    <div className="pt-1">
                      <span className="text-[11px] text-muted">AI focus — describe what to feature</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <input value={focusPrompt} onChange={e => setFocusPrompt(e.target.value)} placeholder="e.g. the pool and skyline" className="flex-1 text-[12px] border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
                        <button onClick={aiFocus} disabled={focusing} className={`${btn} border-brand-600 bg-brand-600 text-white hover:bg-brand-700`}>{focusing ? <Sparkles size={12} className="animate-pulse" /> : <Sparkles size={12} />} {focusing ? '…' : 'Focus'}</button>
                      </div>
                      <p className="text-[10px] text-muted mt-1">AI frames the crop from the photo — it doesn’t repaint it.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Photo pool */}
              <div className="rounded-xl border border-line bg-app/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Photos {pool.length ? `(${pool.length})` : ''}</span>
                  <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800"><Upload size={12} /> Upload</button>
                  <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
                </div>
                {pool.length === 0 ? <div className={`text-[12px] ${dragOver ? 'text-brand-700' : 'text-muted'}`}>{dragOver ? 'Drop to upload…' : 'No photos yet — upload originals, or this unit has none synced.'}</div> : (
                  <div className="grid grid-cols-3 gap-1.5 max-h-64 overflow-y-auto sm:grid-cols-4">
                    {pool.map(p => { const used = slots[sel] === p.id; return (
                      <button key={p.id} onClick={() => assignToSel(p.id)} title={used ? 'In the selected cell' : 'Put in the selected cell'} className={`relative aspect-square rounded-md overflow-hidden border-2 ${used ? 'border-brand-500' : 'border-transparent hover:border-brand-300'}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="w-full h-full object-cover" />
                        {overrideUrl[p.id] && <span className="absolute top-0.5 left-0.5 bg-brand-600 text-white rounded px-1 text-[8px] font-bold">E</span>}
                        {used && <span className="absolute bottom-0.5 right-0.5 bg-brand-600 text-white rounded-full p-0.5"><Check size={9} /></span>}
                      </button>
                    ) })}
                  </div>
                )}
                <p className="text-[10px] text-muted mt-1.5">Click a photo to drop it into the selected cell. Uploaded originals give the sharpest hero.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
