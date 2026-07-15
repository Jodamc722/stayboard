'use client'
import { useMemo, useRef, useState } from 'react'
import { LayoutGrid, Download, Sparkles, RefreshCw, AlertTriangle, X, Upload, UploadCloud } from 'lucide-react'

type Pic = { _id?: string; original?: string; thumbnail?: string }

// Map a unit's amenities + location into a few short, honest hero tags the host can edit.
function suggestTags(amenities: string[], city: string, building: string): string[] {
  const a = amenities.map(x => String(x).toLowerCase())
  const has = (...k: string[]) => k.some(s => a.some(x => x.includes(s)))
  const out: string[] = []
  if (has('pool')) out.push('Pool Access')
  if (has('balcony', 'patio', 'terrace')) out.push('Private Balcony')
  if (has('gym', 'fitness')) out.push('Fitness Center')
  if (has('parking', 'garage')) out.push('Parking Available')
  if (has('hot tub', 'jacuzzi')) out.push('Hot Tub')
  if (has('beach', 'waterfront', 'ocean')) out.push('Near the Beach')
  if (has('workspace', 'laptop', 'office')) out.push('Workspace')
  if (city) out.push(city)
  if (building) out.push(building)
  return Array.from(new Set(out)).slice(0, 6)
}

// Request a crisp, properly-sized Cloudinary rendition so the canvas isn't downscaling a giant original
// in one rough step (that's what made collages look soft). w_2400 best-quality is sharp for hero cells.
function hiRes(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_2400,q_auto:best,f_jpg/')
  return u
}
const PALETTE = ['#0f766e', '#1d4ed8', '#be123c', '#b45309', '#7c3aed', '#0e7490', '#15803d', '#9d174d']
const LAYOUTS = ['grid2x2', 'big3', 'strip3', 'big2', 'twoup', 'film', 'fivegrid', 'bigleft2', 'hero1'] as const

function pick<T>(arr: readonly T[], rnd: () => number): T { return arr[Math.floor(rnd() * arr.length)] }
function shuffle<T>(arr: T[], rnd: () => number): T[] { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
// tiny seeded RNG so each "idea" is reproducible per seed
function rngFrom(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.naturalWidth / img.naturalHeight, tr = w / h
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0
  if (ir > tr) { sw = img.naturalHeight * tr; sx = (img.naturalWidth - sw) / 2 } else { sh = img.naturalWidth / tr; sy = (img.naturalHeight - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function drawTags(ctx: CanvasRenderingContext2D, tags: string[], accent: string, W: number, H: number, rnd: () => number) {
  // Clean white "Guest favorite"-style pills, centered along the bottom with a soft drop shadow.
  const items = tags.map(t => String(t || '').trim()).filter(Boolean).slice(0, 3)
  if (!items.length) return
  const s = W / 1200
  ctx.font = `600 ${Math.round(31 * s)}px Inter, "Helvetica Neue", system-ui, sans-serif`
  const padX = 28 * s, gap = 16 * s, h = 62 * s
  const widths = items.map(t => ctx.measureText(t).width + padX * 2)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)
  let x = (W - total) / 2
  const y = H - 44 * s - h
  items.forEach((t, i) => {
    const w = widths[i]
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 22 * s; ctx.shadowOffsetY = 7 * s
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, x, y, w, h, h / 2)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = '#222222'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(t, x + padX, y + h / 2 + s)
    x += w + gap
  })
}

function renderIdea(canvas: HTMLCanvasElement, imgs: HTMLImageElement[], tags: string[], seed: number) {
  const W = 3000, H = 2000, g = 22
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; const rnd = rngFrom(seed)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  const layout = pick(LAYOUTS, rnd); const accent = pick(PALETTE, rnd); const ph = shuffle(imgs, rnd)
  const at = (i: number) => ph[i % ph.length]
  if (layout === 'hero1' || ph.length < 2) { drawCover(ctx, at(0), 0, 0, W, H) }
  else if (layout === 'grid2x2') { const cw = (W - g) / 2, ch = (H - g) / 2;[[0, 0], [cw + g, 0], [0, ch + g], [cw + g, ch + g]].forEach((p, i) => drawCover(ctx, at(i), p[0], p[1], cw, ch)) }
  else if (layout === 'big3') { const bw = W * 0.6; drawCover(ctx, at(0), 0, 0, bw - g / 2, H); const rw = W - bw - g / 2, rh = (H - 2 * g) / 3; for (let i = 0; i < 3; i++) drawCover(ctx, at(i + 1), bw + g / 2, i * (rh + g), rw, rh) }
  else if (layout === 'strip3') { const cw = (W - 2 * g) / 3; for (let i = 0; i < 3; i++) drawCover(ctx, at(i), i * (cw + g), 0, cw, H) }
  else if (layout === 'twoup') { const hw = (W - g) / 2; drawCover(ctx, at(0), 0, 0, hw, H); drawCover(ctx, at(1), hw + g, 0, hw, H) }
  else if (layout === 'film') { const th = H * 0.7; drawCover(ctx, at(0), 0, 0, W, th - g / 2); const fy = th + g / 2, fh = H - fy, fw = (W - 3 * g) / 4; for (let i = 0; i < 4; i++) drawCover(ctx, at(i + 1), i * (fw + g), fy, fw, fh) }
  else if (layout === 'fivegrid') { const bw = W * 0.6; drawCover(ctx, at(0), 0, 0, bw - g / 2, H); const rx = bw + g / 2, rw = W - rx, rcw = (rw - g) / 2, rch = (H - g) / 2;[[rx, 0], [rx + rcw + g, 0], [rx, rch + g], [rx + rcw + g, rch + g]].forEach((p, i) => drawCover(ctx, at(i + 1), p[0], p[1], rcw, rch)) }
  else if (layout === 'bigleft2') { const bw = W * 0.62; drawCover(ctx, at(0), 0, 0, bw - g / 2, H); const rx = bw + g / 2, rw = W - rx, rh = (H - g) / 2; drawCover(ctx, at(1), rx, 0, rw, rh); drawCover(ctx, at(2), rx, rh + g, rw, rh) }
  else { const th = H * 0.6; drawCover(ctx, at(0), 0, 0, W, th - g / 2); const bw = (W - g) / 2, by = th + g / 2, bh = H - by; drawCover(ctx, at(1), 0, by, bw, bh); drawCover(ctx, at(2), bw + g, by, bw, bh) }
  drawTags(ctx, tags, accent, W, H, rnd)
}

export function HeroCollage({ listingId, name, city, building, pictures, amenities }: { listingId: string; name: string; city: string; building: string; pictures: Pic[]; amenities: string[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [seeds, setSeeds] = useState<number[]>([])
  const [uploads, setUploads] = useState<{ url: string; name: string }[]>([])
  const [pushing, setPushing] = useState<number | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const refs = useRef<Record<number, HTMLCanvasElement | null>>({})
  const fileInput = useRef<HTMLInputElement | null>(null)

  const fallbackUrls = useMemo(() => pictures.map(p => p.original || p.thumbnail || '').filter(Boolean).slice(0, 8), [pictures])

  // Ask the AI photo analyzer which photos are the strongest REAL property shots, and use those for
  // the collage (skipping stock/location photos and any it flags for removal). Falls back to the first
  // few photos if the analyzer is unavailable.
  async function selectUrls(): Promise<string[]> {
    try {
      const r = await fetch('/api/optimize-photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) })
      const j = await r.json()
      if (!r.ok || !Array.isArray(j.proposedOrder)) return fallbackUrls
      const byId: Record<string, any> = {}
      ;(j.photos || []).forEach((p: any) => { byId[p._id] = p })
      const remove = new Set((j.recommendRemove || []).map((x: any) => x._id))
      const origById: Record<string, string> = {}
      pictures.forEach(p => { if (p._id) origById[p._id] = p.original || p.thumbnail || '' })
      // Build a VARIED set for the collage: guarantee some exterior + pool/view/outdoor shots, then fill
      // with the strongest interiors. (Plain ordering is unit-first, so exteriors would otherwise drop off.)
      const props: any[] = j.proposedOrder.map((id: string) => byId[id]).filter((p: any) => p && p.kind !== 'stock' && !remove.has(p._id))
      const used = new Set<string>(); const chosen: any[] = []
      const take = (test: (c: string) => boolean, max: number) => { let n = 0; for (const p of props) { if (used.has(p._id)) continue; if (test(String(p.category || ''))) { chosen.push(p); used.add(p._id); if (++n >= max) break } } }
      take(c => c === 'exterior', 2)
      take(c => c === 'view' || c === 'outdoor' || c === 'amenity', 2)
      for (const p of props) { if (chosen.length >= 8) break; if (!used.has(p._id)) { chosen.push(p); used.add(p._id) } }
      const picks = chosen.slice(0, 8).map((p: any) => origById[p._id] || p.url || '').filter(Boolean)
      return picks.length >= 2 ? picks : fallbackUrls
    } catch { return fallbackUrls }
  }

  // Generic image loader. `proxy` routes Guesty/Cloudinary URLs through our same-origin proxy and tries a
  // hi-res rendition first; uploaded files are local object URLs that load directly at full resolution.
  function loadImages(urls: string[], proxy: boolean): Promise<HTMLImageElement[]> {
    const tryLoad = (src: string) => new Promise<HTMLImageElement | null>((res) => {
      const im = new Image(); let done = false
      const t = setTimeout(() => { if (!done) { done = true; res(null) } }, 15000)
      im.onload = () => { if (!done) { done = true; clearTimeout(t); res(im) } }
      im.onerror = () => { if (!done) { done = true; clearTimeout(t); res(null) } }
      im.src = src
    })
    const list = urls.map(async (u) => proxy
      ? ((await tryLoad(`/api/img-proxy?url=${encodeURIComponent(hiRes(u))}`)) || (await tryLoad(`/api/img-proxy?url=${encodeURIComponent(u)}`)) || (await tryLoad(u)))
      : (await tryLoad(u)))
    return Promise.all(list).then(r => r.filter((x): x is HTMLImageElement => !!x))
  }

  async function generate() {
    setBusy(true); setError(null)
    try {
      let imgs: HTMLImageElement[]
      if (uploads.length) {
        // Best quality: build straight from the host's own full-resolution uploads (no compression/proxy).
        imgs = await loadImages(uploads.map(u => u.url), false)
        if (imgs.length < 1) throw new Error('Could not read the uploaded photos. Try different files.')
      } else {
        throw new Error('Please upload photos first - hero images are built from your uploads only.')
      }
      const newSeeds = Array.from({ length: 3 }, () => Math.floor(Math.random() * 1e9))
      setSeeds(newSeeds)
      // render after canvases mount
      setTimeout(() => newSeeds.forEach(s => { const c = refs.current[s]; if (c) renderIdea(c, imgs, tags, s) }), 50)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  function onFiles(list: FileList | null) {
    if (!list) return
    const next = Array.from(list).filter(f => f.type.startsWith('image/')).map(f => ({ url: URL.createObjectURL(f), name: f.name }))
    if (next.length) setUploads(u => [...u, ...next].slice(0, 12))
    if (fileInput.current) fileInput.current.value = ''
  }
  function removeUpload(i: number) { setUploads(u => { const n = u.slice(); const [rm] = n.splice(i, 1); if (rm) URL.revokeObjectURL(rm.url); return n }) }
  function clearUploads() { setUploads(u => { u.forEach(x => URL.revokeObjectURL(x.url)); return [] }) }

  async function pushToGuesty(seed: number) {
    const c = refs.current[seed]; if (!c) return
    if (!confirm('Push this image to Guesty as a NEW photo on this listing?\n\nIt syncs to ALL connected channels (Airbnb, Booking.com, Vrbo, etc.) and is added at the END of the photo set - not the cover.\n\nNote: Airbnb discourages photos with text/graphics, so collages are best for Booking.com, Vrbo and your direct site.')) return
    setPushing(seed); setPushMsg(null)
    try {
      const dataUrl: string = await new Promise((res) => c.toBlob((b) => {
        if (!b) return res(''); const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.readAsDataURL(b)
      }, 'image/jpeg', 0.95))
      if (!dataUrl) throw new Error('Could not read the image.')
      const r = await fetch('/api/hero/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, dataUrl, caption: (tags.find(t => (t || '').trim()) || name || 'Featured') }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Push failed')
      setPushMsg(`Pushed to Guesty - listing now has ${j.count} photos. Syncing to channels.`)
    } catch (e: any) { setPushMsg(e.message || String(e)) } finally { setPushing(null) }
  }

  function download(seed: number) {
    const c = refs.current[seed]; if (!c) return
    c.toBlob((blob) => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(name || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${seed}.jpg`; a.click(); URL.revokeObjectURL(a.href) }, 'image/jpeg', 1.0)
  }

  function setTag(i: number, v: string) { setTags(t => { const n = t.slice(); n[i] = v; return n }) }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><LayoutGrid size={15} className="text-brand-600" /> Hero collage ideas</h2>
          <p className="text-[12px] text-muted mt-0.5">Builds clean hero images from your uploaded photos — no text or tag overlays. Upload photos, generate a few ideas, then download or push the one you like.</p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 flex-shrink-0">
          <LayoutGrid size={15} /> {open ? 'Hide' : 'Open'}
        </button>
      </div>

      {open && (
        <div className="px-4 py-4 border-t border-line space-y-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
          {pushMsg && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700 flex items-center justify-between gap-2"><span>{pushMsg}</span><button onClick={() => setPushMsg(null)} className="text-muted hover:text-ink"><X size={13} /></button></div>}

          {/* Photo source: upload your own (best quality) or fall back to the unit's synced photos */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files) }}
            className={`rounded-xl border p-3 transition-colors ${dragOver ? 'border-brand-400 border-dashed bg-brand-50' : 'border-line bg-app/30'}`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-[12px] font-semibold text-ink">Photos</p>
                <p className="text-[11px] text-muted">{uploads.length ? `Using your ${uploads.length} uploaded photo${uploads.length > 1 ? 's' : ''} (best quality).` : (dragOver ? 'Drop your photos to upload…' : 'No uploads — drag & drop photos here, or upload originals for the sharpest hero.')}</p>
              </div>
              <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
              <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white text-brand-700 px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-50 flex-shrink-0">
                <Upload size={14} /> Upload photos
              </button>
            </div>
            {!!uploads.length && (
              <div className="flex flex-wrap gap-2 mt-3 items-center">
                {uploads.map((u, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.url} alt={u.name} className="w-full h-full object-cover" />
                    <button onClick={() => removeUpload(i)} title="Remove" className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-rose-600"><X size={11} /></button>
                  </div>
                ))}
                <button onClick={clearUploads} className="text-[11px] text-muted hover:text-rose-600 self-center ml-1">Clear all</button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button onClick={generate} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">
              {busy ? <Sparkles size={14} className="animate-pulse" /> : <RefreshCw size={14} />} {busy ? 'Building…' : seeds.length ? 'New ideas' : 'Generate ideas'}
            </button>
          </div>
          <p className="text-[11px] text-muted">Upload photos above, then hit Generate.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {seeds.map(s => (
              <div key={s} className="rounded-xl border border-line overflow-hidden bg-app/30">
                <canvas ref={el => { refs.current[s] = el }} className="w-full block" style={{ aspectRatio: '3 / 2' }} />
                <div className="flex items-center justify-between px-3 py-2 gap-2">
                  <span className="text-[11px] text-muted">3000 &times; 2000</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => pushToGuesty(s)} disabled={pushing === s} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50">{pushing === s ? <Sparkles size={13} className="animate-pulse" /> : <UploadCloud size={13} />} {pushing === s ? 'Pushing…' : 'Push to Guesty'}</button>
                    <button onClick={() => download(s)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink hover:text-brand-700"><Download size={13} /> Download</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted">Tip: use bright, high-resolution originals for the sharpest result.</p>
        </div>
      )}
    </section>
  )
}
