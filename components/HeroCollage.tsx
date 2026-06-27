'use client'
import { useMemo, useRef, useState } from 'react'
import { LayoutGrid, Download, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react'

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

const PALETTE = ['#0f766e', '#1d4ed8', '#be123c', '#b45309', '#7c3aed', '#0e7490', '#15803d', '#9d174d']
const LAYOUTS = ['grid2x2', 'big3', 'strip3', 'big2', 'hero1'] as const

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
  if (!tags.length) return
  const style = pick(['bottomBar', 'pills', 'pills'] as const, rnd)
  ctx.font = '600 30px Inter, system-ui, sans-serif'
  if (style === 'bottomBar') {
    const barH = 86
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H - barH, W, barH)
    let x = 32; const y = H - barH / 2
    ctx.textBaseline = 'middle'
    tags.slice(0, 3).forEach((t, i) => {
      const tw = ctx.measureText(t).width
      if (i > 0) { ctx.fillStyle = accent; ctx.fillRect(x, y - 12, 4, 24); x += 18 }
      ctx.fillStyle = '#fff'; ctx.fillText(t, x, y); x += tw + 26
    })
  } else {
    const corner = pick(['bl', 'br', 'tl'] as const, rnd)
    let y = corner === 'tl' ? 34 : H - 34 - 52
    const rows = tags.slice(0, 3)
    rows.forEach((t) => {
      const tw = ctx.measureText(t).width, padX = 22, w = tw + padX * 2, h = 52
      const x = corner === 'br' ? W - w - 30 : 30
      ctx.fillStyle = accent; roundRect(ctx, x, y, w, h, 12); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + padX, y + h / 2)
      y += corner === 'tl' ? 64 : -64
    })
  }
}

function renderIdea(canvas: HTMLCanvasElement, imgs: HTMLImageElement[], tags: string[], seed: number) {
  const W = 1200, H = 800, g = 10
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!; const rnd = rngFrom(seed)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  const layout = pick(LAYOUTS, rnd); const accent = pick(PALETTE, rnd); const ph = shuffle(imgs, rnd)
  const at = (i: number) => ph[i % ph.length]
  if (layout === 'hero1' || ph.length < 2) { drawCover(ctx, at(0), 0, 0, W, H) }
  else if (layout === 'grid2x2') { const cw = (W - g) / 2, ch = (H - g) / 2;[[0, 0], [cw + g, 0], [0, ch + g], [cw + g, ch + g]].forEach((p, i) => drawCover(ctx, at(i), p[0], p[1], cw, ch)) }
  else if (layout === 'big3') { const bw = W * 0.6; drawCover(ctx, at(0), 0, 0, bw - g / 2, H); const rw = W - bw - g / 2, rh = (H - 2 * g) / 3; for (let i = 0; i < 3; i++) drawCover(ctx, at(i + 1), bw + g / 2, i * (rh + g), rw, rh) }
  else if (layout === 'strip3') { const cw = (W - 2 * g) / 3; for (let i = 0; i < 3; i++) drawCover(ctx, at(i), i * (cw + g), 0, cw, H) }
  else { const th = H * 0.6; drawCover(ctx, at(0), 0, 0, W, th - g / 2); const bw = (W - g) / 2, by = th + g / 2, bh = H - by; drawCover(ctx, at(1), 0, by, bw, bh); drawCover(ctx, at(2), bw + g, by, bw, bh) }
  drawTags(ctx, tags, accent, W, H, rnd)
}

export function HeroCollage({ listingId, name, city, building, pictures, amenities }: { listingId: string; name: string; city: string; building: string; pictures: Pic[]; amenities: string[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>(() => suggestTags(amenities, city, building))
  const [seeds, setSeeds] = useState<number[]>([])
  const refs = useRef<Record<number, HTMLCanvasElement | null>>({})

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
      const picks = j.proposedOrder
        .filter((id: string) => { const p = byId[id]; return p && p.kind !== 'stock' && !remove.has(id) })
        .map((id: string) => origById[id] || (byId[id] && byId[id].url) || '')
        .filter(Boolean)
        .slice(0, 8)
      return picks.length >= 2 ? picks : fallbackUrls
    } catch { return fallbackUrls }
  }

  async function loadImgs(urls: string[]): Promise<HTMLImageElement[]> {
    const list = urls.map(u => new Promise<HTMLImageElement | null>((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null)
      im.src = `/api/img-proxy?url=${encodeURIComponent(u)}`
    }))
    return (await Promise.all(list)).filter((x): x is HTMLImageElement => !!x)
  }

  async function generate() {
    setBusy(true); setError(null)
    try {
      const chosen = await selectUrls()
      const imgs = await loadImgs(chosen)
      if (imgs.length < 1) throw new Error('Could not load this listing’s photos to build a collage.')
      const newSeeds = Array.from({ length: 6 }, () => Math.floor(Math.random() * 1e9))
      setSeeds(newSeeds)
      // render after canvases mount
      setTimeout(() => newSeeds.forEach(s => { const c = refs.current[s]; if (c) renderIdea(c, imgs, tags, s) }), 50)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  function download(seed: number) {
    const c = refs.current[seed]; if (!c) return
    c.toBlob((blob) => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(name || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${seed}.png`; a.click(); URL.revokeObjectURL(a.href) }, 'image/png')
  }

  function setTag(i: number, v: string) { setTags(t => { const n = t.slice(); n[i] = v; return n }) }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><LayoutGrid size={15} className="text-brand-600" /> Hero collage ideas</h2>
          <p className="text-[12px] text-muted mt-0.5">Builds marketing hero images from this unit&apos;s real photos with amenity tags. Generate a few design ideas, then download the ones you like.</p>
        </div>
        <button onClick={() => { setOpen(o => !o); if (!open && seeds.length === 0) generate() }} disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
          {busy ? <Sparkles size={15} className="animate-pulse" /> : <LayoutGrid size={15} />} {busy ? 'Building…' : open ? 'Hide' : 'Generate ideas'}
        </button>
      </div>

      {open && (
        <div className="px-4 py-4 border-t border-line space-y-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
          <div className="flex flex-wrap items-end gap-2">
            {[0, 1, 2].map(i => (
              <div key={i}>
                <label className="block text-[11px] font-semibold text-muted mb-1">Tag {i + 1}</label>
                <input value={tags[i] || ''} onChange={e => setTag(i, e.target.value)} placeholder="e.g. Pool Access"
                  className="w-40 text-[13px] rounded-lg border border-line bg-app px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            ))}
            <button onClick={generate} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-app disabled:opacity-50"><RefreshCw size={13} /> New ideas</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {seeds.map(s => (
              <div key={s} className="rounded-xl border border-line overflow-hidden bg-app/30">
                <canvas ref={el => { refs.current[s] = el }} className="w-full block" style={{ aspectRatio: '3 / 2' }} />
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[11px] text-muted">1200 &times; 800 PNG</span>
                  <button onClick={() => download(s)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-700"><Download size={13} /> Download</button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted">Tip: collages shine on Booking.com, Vrbo, your direct site and social. Keep your Airbnb cover a single clean real photo to stay on the right side of their photo policy.</p>
        </div>
      )}
    </section>
  )
}
