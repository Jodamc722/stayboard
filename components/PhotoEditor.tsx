'use client'
// THE PHOTO EDITOR — Jon, 2026-09-10: "need to be able to customize or edit the photos, look too
// zoomed in, use AI to enhance from the selection. Should have smart feature, make it looks nice."
//
// The complaint that started it was real and structural: the guest card is an 84×84 SQUARE, and the
// Fiji shot is a 330×700 bottle, so the square crop kept the middle of the label and threw away the
// cap and the base. Cropping is not the fix — squaring is, and that happens on the server in
// lib/photo-fix. This is the place to see it and to disagree with it.
//
// Two things it does NOT do, on purpose:
//   · It does not redraw the product. A "restored" bottle that no longer matches what we hand the
//     guest is a worse outcome than a plain photo of the real thing.
//   · It does not preview by guessing. What you drag here is an approximation in CSS; the file is
//     rendered on the server from the ORIGINAL, so the tenth edit is as sharp as the first.
import { useEffect, useState } from 'react'
import { Loader2, RotateCw, Wand2, Check, X, Undo2 } from 'lucide-react'

export type PhotoOps = { smart: boolean; rotate: 0 | 90 | 180 | 270; zoom: number; offsetX: number; offsetY: number; enhance: boolean }
const DEFAULTS: PhotoOps = { smart: true, rotate: 0, zoom: 1, offsetX: 0, offsetY: 0, enhance: true }

export function PhotoEditor({ itemId, name, url, onDone, onClose }: {
  itemId: string; name: string; url: string
  onDone: (nextUrl: string) => void
  onClose: () => void
}) {
  const [ops, setOps] = useState<PhotoOps>(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(url)
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const set = (p: Partial<PhotoOps>) => setOps(o => ({ ...o, ...p }))

  useEffect(() => { setPreview(url) }, [url])
  useEffect(() => {
    const up = () => setDrag(null)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  async function apply(close: boolean) {
    setBusy(true); setErr('')
    try {
      const j = await fetch('/api/guest-orders/photo-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, ops }) }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not save that.'); setBusy(false); return }
      // Cache-bust: the URL changes on every save, but a CDN that has seen this path can still
      // hand back the previous bytes for a moment, and a photo that "did not change" is the most
      // confusing possible outcome of pressing Save.
      const fresh = j.url + (j.url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now()
      setPreview(fresh); setOps(DEFAULTS)
      onDone(fresh)
      if (close) onClose()
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  // The live preview mirrors what the server will do closely enough to judge framing.
  const shift = (v: number) => (-v * (1 - 1 / ops.zoom) * 50) + '%'
  const imgStyle: React.CSSProperties = {
    transform: `scale(${ops.zoom}) translate(${shift(ops.offsetX)}, ${shift(ops.offsetY)}) rotate(${ops.rotate}deg)`,
    filter: ops.enhance ? 'saturate(1.06) contrast(1.04)' : 'none',
    transition: drag ? 'none' : 'transform .12s ease-out',
  }
  const dirty = JSON.stringify(ops) !== JSON.stringify(DEFAULTS)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="text-[14px] font-semibold text-ink">{name} · photo</div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button>
        </div>

        <div className="p-5 grid md:grid-cols-[1fr_240px] gap-5">
          <div>
            {/* Drag to move; the frame is exactly the shape every surface renders. */}
            <div
              onPointerDown={e => { if (ops.zoom > 1) setDrag({ x: e.clientX, y: e.clientY, ox: ops.offsetX, oy: ops.offsetY }) }}
              onPointerMove={e => {
                if (!drag) return
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                set({ offsetX: Math.max(-1, Math.min(1, drag.ox - (e.clientX - drag.x) / (box.width / 2))),
                      offsetY: Math.max(-1, Math.min(1, drag.oy - (e.clientY - drag.y) / (box.height / 2))) })
              }}
              className={'relative aspect-square rounded-2xl overflow-hidden border border-line bg-[#F6F4F0] ' + (ops.zoom > 1 ? 'cursor-move' : '')}>
              <img src={preview} alt="" className="w-full h-full object-contain select-none pointer-events-none" style={imgStyle} draggable={false} />
            </div>
            <div className="text-[11.5px] text-muted mt-1.5">{ops.zoom > 1 ? 'Drag the picture to move it inside the frame.' : 'Zoom in if you want to crop closer.'}</div>
          </div>

          <div className="space-y-3">
            <button onClick={() => set({ smart: true, zoom: 1, offsetX: 0, offsetY: 0, enhance: true })}
              className="w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-3 py-2.5 rounded-xl bg-ink text-white">
              <Wand2 size={14} /> Smart fix
            </button>
            <p className="text-[11.5px] text-muted -mt-1.5 leading-snug">Trims the background, centres the product on a clean square, and evens out the light. This is what a new photo gets automatically.</p>

            <label className="block">
              <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Zoom</span>
              <input type="range" min={1} max={3} step={0.05} value={ops.zoom} onChange={e => set({ zoom: Number(e.target.value) })} className="w-full mt-1" />
              <span className="text-[11.5px] text-muted tabular-nums">{ops.zoom.toFixed(2)}×{ops.zoom > 1 ? '' : ' · the whole photo'}</span>
            </label>

            <div className="flex items-center gap-2">
              <button onClick={() => set({ rotate: (((ops.rotate + 90) % 360) as PhotoOps['rotate']) })} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300"><RotateCw size={13} /> Rotate</button>
              <button onClick={() => setOps(DEFAULTS)} disabled={!dirty} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink disabled:opacity-40"><Undo2 size={13} /> Reset</button>
            </div>

            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <input type="checkbox" checked={ops.smart} onChange={e => set({ smart: e.target.checked })} className="mt-0.5" />
              <span>Square it up<span className="block text-[11px] text-muted">Off for a photo of a room or a scene, where the edges are part of the picture.</span></span>
            </label>
            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <input type="checkbox" checked={ops.enhance} onChange={e => set({ enhance: e.target.checked })} className="mt-0.5" />
              <span>Even out the light<span className="block text-[11px] text-muted">Gentle levels and sharpening — never enough to flatter what arrives.</span></span>
            </label>

            {/* Judge it at the size it is actually seen, not at 400px. */}
            <div className="pt-2 border-t border-line">
              <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">How the guest sees it</div>
              <div className="flex items-end gap-3 mt-2">
                <div className="text-center">
                  <img src={preview} alt="" className="w-[84px] h-[84px] rounded-2xl object-contain bg-neutral-100" style={imgStyle} />
                  <div className="text-[10px] text-muted mt-1">order form</div>
                </div>
                <div className="text-center">
                  <img src={preview} alt="" className="w-12 h-12 rounded-xl object-contain bg-neutral-100" style={imgStyle} />
                  <div className="text-[10px] text-muted mt-1">count sheet</div>
                </div>
              </div>
            </div>

            {err ? <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{err}</div> : null}

            <button onClick={() => apply(true)} disabled={busy} className="w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-3 py-2.5 rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save the photo
            </button>
            <div className="text-[11px] text-muted text-center">Always rendered from the original upload, so this never gets worse.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
