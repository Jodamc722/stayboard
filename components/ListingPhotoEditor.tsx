'use client'
// THE PHOTO EDITOR — everything about one photo, opened from the photo itself (Jon, 2026-10-31: "make
// it easier to optimize photos, can we do it from the photo without a different section … it should
// give real customization options, since this is the most important page").
//
// Tap any photo in the grid → this sheet. One place for:
//   LOOKS        five one-tap looks rendered from the photo (Auto, Natural, Bright, Warm, Crisp)
//   FINE-TUNE    brightness, contrast, colour, warmth (warmer ↔ cooler), sharpness, quarter turns,
//                mirror — rendered by the server's photo pipeline inside the honesty caps (a
//                correction, never a repaint), previewed, then kept
//   CAPTION      edit it, or have AI write it from the photo (optionally with a steer)
//   PLACE        make it the cover, or send it to any position
//   REPLACE      swap the image for any photo in the library (keeps the slot and caption)
//   DELETE
// Hold the image to see the original. ← → step through the set without closing. Nothing goes to
// Guesty until "Save" on the photo grid — the editor stages, the grid pushes.
//
// 2026-11-09 (Jon: "improve the enhance photo mode, have watermark feature"):
//   COMPARE      a before / after slider over the photo, once there is an edit to compare
//   STRENGTH     Subtle · Standard · Stronger for the looks (the server scales every look, still capped)
//   BRANDED COPY the Stay watermark, see-through, as a DOWNLOAD of this photo — for the direct site,
//                social, email and print. It is never staged and never sent to Guesty: the booking
//                sites do not allow logos on listing photos (lib/photo-watermark has the one rule).
import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, Sparkles, RotateCcw, RotateCw, FlipHorizontal2, Crown, Trash2, LibraryBig, Wand2, Check, Undo2, SlidersHorizontal, Columns2, Download, Stamp } from 'lucide-react'
import { LibraryPicker, type LibraryPick } from '@/components/LibraryPicker'
import { WatermarkOptions, useWatermark, withWatermark } from '@/components/WatermarkOptions'

export type EditorPhoto = { id: string; url: string; caption: string }
type Variant = { preset: string; name: string; url: string; why?: string }
type Dials = { brightness: number; contrast: number; saturation: number; warmth: number; sharpen: number; rotate: number; flip: boolean }
const ZERO: Dials = { brightness: 1, contrast: 1, saturation: 1, warmth: 0, sharpen: 0, rotate: 0, flip: false }
const LOOKS = ['auto', 'natural', 'bright', 'warm', 'crisp']
const STRENGTHS: { v: number; label: string; title: string }[] = [
  { v: 0.6, label: 'Subtle', title: 'About half the correction — for a photo that is nearly right' },
  { v: 1, label: 'Standard', title: 'The look as designed' },
  { v: 1.3, label: 'Stronger', title: 'A little more — still inside the limits that keep a photo honest' },
]

export function ListingPhotoEditor({ listingId, photo, position, total, current, onClose, onPrev, onNext, onUse, onRevert, onCaption, caption, onMove, deleted, onDelete, strength: strengthProp, onStrength }: {
  listingId: string
  photo: EditorPhoto
  position: number
  total: number
  /** The image staged for this photo (an edit), or null = the original. */
  current: { url: string; label: string } | null
  caption: string
  deleted: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onUse: (url: string, label: string) => void
  onRevert: () => void
  onCaption: (text: string) => void
  onMove: (pos: number) => void
  onDelete: () => void
  /** How far the looks move the photo (0.6 / 1 / 1.3). Owned by the grid when given, so both agree. */
  strength?: number
  onStrength?: (v: number) => void
}) {
  const [dials, setDials] = useState<Dials>(ZERO)
  const [preview, setPreview] = useState<string | null>(null)
  const [looks, setLooks] = useState<Variant[] | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [peek, setPeek] = useState(false)
  const [steer, setSteer] = useState('')
  const [libOpen, setLibOpen] = useState(false)
  const [pos, setPos] = useState(String(position))
  const [cmp, setCmp] = useState(false)      // before / after slider
  const [cmpX, setCmpX] = useState(50)       // where the divider sits, percent from the left
  const [ownStrength, setOwnStrength] = useState(1)
  const strength = strengthProp ?? ownStrength
  const [wm, setWm] = useWatermark()

  // A new photo → a clean editor.
  useEffect(() => { setDials(ZERO); setPreview(null); setLooks(null); setErr(''); setPeek(false); setSteer(''); setPos(String(position)); setCmp(false); setCmpX(50) }, [photo.id, position])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /input|textarea|select/i.test(t.tagName)) return
      if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowLeft') onPrev(); else if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, onPrev, onNext])

  const call = async (body: any) => {
    const r = await fetch('/api/photo-enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, photoIds: [photo.id], ...body }) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || j.error) throw new Error((j && j.error) || 'The photo service did not answer — try again.')
    const p = j.photos?.[0]
    if (p?.error) throw new Error(p.error)
    return p
  }
  const makeLooks = async (s: number = strength) => {
    setBusy('looks'); setErr('')
    try { const p = await call({ variants: LOOKS, strength: s }); setLooks(p?.variants || []) } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const pickStrength = (v: number) => {
    if (v === strength) return
    if (onStrength) onStrength(v); else setOwnStrength(v)
    // Looks already on screen were made at the old strength — make them again at the new one.
    if (looks) makeLooks(v)
  }
  const renderCustom = async (d: Dials = dials) => {
    setBusy('custom'); setErr('')
    try { const p = await call({ custom: d }); if (!p?.customUrl) throw new Error('No preview came back.'); setPreview(p.customUrl) } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const writeCaption = async () => {
    setBusy('caption'); setErr('')
    try {
      const r = await fetch('/api/photo-caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, photoId: photo.id, ...(steer.trim() ? { instruction: steer.trim() } : {}) }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.caption) throw new Error((j && j.error) || 'No caption came back.')
      onCaption(String(j.caption))
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const set = (k: keyof Dials, v: number | boolean) => { setDials(d => ({ ...d, [k]: v })); setPreview(null) }
  const dirty = JSON.stringify(dials) !== JSON.stringify(ZERO)
  const shown = peek ? photo.url : (preview || current?.url || photo.url)
  const edited = preview || current?.url || ''
  // A quarter turn changes the shape, so the two images no longer line up under a slider.
  const canCompare = !!edited && dials.rotate % 180 === 0
  const comparing = cmp && canCompare
  // The watermark is made from the photo Guesty holds — a photo not saved to the listing yet has none.
  const brandHref = photo.id.startsWith('idx-') ? null : '/api/photos/file?listing=' + encodeURIComponent(listingId) + '&pic=' + encodeURIComponent(photo.id)

  const slider = (k: keyof Dials, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="block">
      <span className="flex items-center justify-between text-[11.5px]"><span className="font-semibold text-ink">{label}</span><span className="tabular-nums text-muted">{fmt(dials[k] as number)}</span></span>
      <input type="range" min={min} max={max} step={step} value={dials[k] as number} onChange={e => set(k, Number(e.target.value))} onMouseUp={() => renderCustom()} onTouchEnd={() => renderCustom()} className="w-full accent-ink" />
    </label>
  )
  const pct = (v: number) => (v === 1 ? '0' : (v > 1 ? '+' : '') + Math.round((v - 1) * 100)) + '%'
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink/40 disabled:opacity-40'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-6xl sm:rounded-2xl overflow-hidden flex flex-col lg:flex-row max-h-full" onClick={e => e.stopPropagation()}>
        {/* the photo */}
        <div className="relative bg-black flex-1 min-h-[260px] flex items-center justify-center select-none">
          {comparing ? (
            // BEFORE / AFTER: the edit underneath, the original on top, cut at the divider. The range
            // input covers the photo, so dragging anywhere on it moves the divider (mouse or finger).
            <div className="relative inline-block max-w-full leading-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={edited} alt={caption} className="block max-h-[70vh] max-w-full" draggable={false} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" style={{ clipPath: `inset(0 ${100 - cmpX}% 0 0)` }} draggable={false} />
              <span className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none" style={{ left: cmpX + '%' }} />
              <span className="absolute bottom-2 left-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-white/90 text-ink pointer-events-none">Before</span>
              <span className="absolute bottom-2 right-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white pointer-events-none">After</span>
              <input type="range" min={0} max={100} step={1} value={cmpX} onChange={e => setCmpX(Number(e.target.value))} aria-label="Before and after — drag to compare"
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt={caption} className={'max-h-[70vh] max-w-full object-contain ' + (deleted ? 'opacity-30 grayscale' : '')}
              onMouseDown={() => setPeek(true)} onMouseUp={() => setPeek(false)} onMouseLeave={() => setPeek(false)} onTouchStart={() => setPeek(true)} onTouchEnd={() => setPeek(false)} />
          )}
          {canCompare && (
            <button onClick={() => setCmp(c => !c)} aria-pressed={comparing} title="Before / after slider"
              className={'absolute top-3 right-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-bold ' + (comparing ? 'bg-ink text-white' : 'bg-white/90 text-ink hover:bg-white')}>
              <Columns2 size={12} /> {comparing ? 'Done comparing' : 'Compare'}
            </button>
          )}
          <span className="absolute top-3 left-3 text-[11px] font-bold px-2 py-0.5 rounded bg-white/90 text-ink">{position === 1 ? 'Cover · ' : ''}{position} of {total}</span>
          {(preview || current) && !peek && <span className="absolute top-3 left-28 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-600 text-white">{preview ? 'Preview' : current!.label}</span>}
          {peek && <span className="absolute top-3 left-28 text-[11px] font-bold px-2 py-0.5 rounded bg-white/90 text-ink">Original</span>}
          {!comparing && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10.5px] text-white/80 text-center w-[90%]">Hold the photo to see the original · ← → to move through the set</span>}
          <button onClick={onPrev} className="absolute left-2 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-full bg-white/80 hover:bg-white" aria-label="Previous photo"><ChevronLeft size={18} /></button>
          <button onClick={onNext} className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-full bg-white/80 hover:bg-white" aria-label="Next photo"><ChevronRight size={18} /></button>
          {busy && busy !== 'caption' && <span className="absolute inset-0 grid place-items-center"><Loader2 size={28} className="animate-spin text-white" /></span>}
        </div>

        {/* the controls */}
        <div className="w-full lg:w-[380px] shrink-0 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-ink flex-1">Edit photo</span>
            <button onClick={onClose} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-app" aria-label="Close"><X size={16} /></button>
          </div>
          {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{err}</p>}

          {/* LOOKS */}
          <section className="space-y-2">
            <div className="flex items-center gap-2"><Sparkles size={13} className="text-brand-600" /><span className="text-[12px] font-bold uppercase tracking-wide text-muted flex-1">Looks</span>
              {!looks && <button onClick={() => makeLooks()} disabled={!!busy} className={btn}>{busy === 'looks' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Show 5 looks</button>}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11.5px] text-muted">Strength</span>
              {STRENGTHS.map(o => (
                <button key={o.v} onClick={() => pickStrength(o.v)} disabled={!!busy} aria-pressed={strength === o.v} title={o.title}
                  className={'rounded-md border px-2 py-0.5 text-[11.5px] font-semibold disabled:opacity-40 ' + (strength === o.v ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')}>{o.label}</button>
              ))}
            </div>
            {looks && looks.length === 0 && <p className="text-[11.5px] text-muted">No look came back for this photo. <button onClick={() => makeLooks()} disabled={!!busy} className="font-semibold text-ink underline">Try again</button></p>}
            {looks && (
              <div className="grid grid-cols-3 gap-1.5">
                {looks.map(v => (
                  <button key={v.preset} onClick={() => { onUse(v.url, v.name); setPreview(null); setDials(ZERO) }} title={v.why || v.name}
                    className={'rounded-lg overflow-hidden border text-left ' + (current?.url === v.url ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-line hover:border-ink/40')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.url} alt="" className="w-full aspect-[4/3] object-cover" />
                    <span className="block px-1.5 py-0.5 text-[10.5px] font-semibold truncate">{v.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* FINE-TUNE */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2"><SlidersHorizontal size={13} className="text-brand-600" /><span className="text-[12px] font-bold uppercase tracking-wide text-muted flex-1">Fine-tune</span>
              {dirty && <button onClick={() => { setDials(ZERO); setPreview(null) }} className="text-[11.5px] text-muted hover:text-ink">Reset</button>}</div>
            {slider('brightness', 'Brightness', 0.85, 1.15, 0.01, pct)}
            {slider('contrast', 'Contrast', 0.9, 1.15, 0.01, pct)}
            {slider('saturation', 'Colour', 0.85, 1.2, 0.01, pct)}
            {slider('warmth', 'Warmth', -8, 8, 0.5, v => (v === 0 ? 'neutral' : v > 0 ? 'warmer +' + v : 'cooler ' + v))}
            {slider('sharpen', 'Sharpness', 0, 1.5, 0.1, v => (v === 0 ? 'off' : v.toFixed(1)))}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => { const d = { ...dials, rotate: (dials.rotate + 270) % 360 }; setDials(d); renderCustom(d) }} disabled={!!busy} className={btn} title="Turn left"><RotateCcw size={12} /> Left</button>
              <button onClick={() => { const d = { ...dials, rotate: (dials.rotate + 90) % 360 }; setDials(d); renderCustom(d) }} disabled={!!busy} className={btn} title="Turn right"><RotateCw size={12} /> Right</button>
              <button onClick={() => { const d = { ...dials, flip: !dials.flip }; setDials(d); renderCustom(d) }} disabled={!!busy} className={btn + (dials.flip ? ' border-ink' : '')} title="Mirror left-to-right"><FlipHorizontal2 size={12} /> Mirror</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {dirty && !preview && <button onClick={() => renderCustom()} disabled={!!busy} className={btn}>{busy === 'custom' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Preview</button>}
              {preview && <button onClick={() => { onUse(preview, 'Edited'); setPreview(null); setDials(ZERO) }} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold"><Check size={12} /> Use this edit</button>}
              {current && <button onClick={onRevert} className={btn}><Undo2 size={12} /> Back to original</button>}
            </div>
            <p className="text-[10.5px] text-muted">Corrections only — light, colour, sharpness and orientation. Nothing is painted in, so the photo stays honest.</p>
          </section>

          {/* CAPTION */}
          <section className="space-y-1.5">
            <span className="text-[12px] font-bold uppercase tracking-wide text-muted">Caption</span>
            <textarea value={caption} onChange={e => onCaption(e.target.value)} rows={2} maxLength={240} placeholder="What a guest sees under the photo" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <div className="flex items-center gap-1.5">
              <input value={steer} onChange={e => setSteer(e.target.value)} placeholder="Steer it (optional): mention the ocean view" className="flex-1 min-w-0 rounded-lg border border-line px-2 py-1 text-[11.5px]" />
              <button onClick={writeCaption} disabled={!!busy} className={btn}>{busy === 'caption' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI write</button>
            </div>
          </section>

          {/* PLACE */}
          <section className="space-y-1.5">
            <span className="text-[12px] font-bold uppercase tracking-wide text-muted">Place</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {position !== 1 && <button onClick={() => onMove(1)} className={btn}><Crown size={12} className="text-amber-500" /> Make cover</button>}
              <span className="inline-flex items-center gap-1 text-[12px]">Move to
                <input type="number" min={1} max={total} value={pos} onChange={e => setPos(e.target.value)} className="w-14 rounded-md border border-line px-1.5 py-1 text-[12px]" />
                <button onClick={() => { const n = Math.max(1, Math.min(total, Number(pos) || position)); onMove(n) }} className={btn}>Go</button>
              </span>
            </div>
          </section>

          {/* BRANDED COPY — a download, never staged for Guesty */}
          <section className="space-y-1.5">
            <div className="flex items-center gap-2"><Stamp size={13} className="text-brand-600" /><span className="text-[12px] font-bold uppercase tracking-wide text-muted">Branded copy</span></div>
            <WatermarkOptions value={wm} onChange={setWm} previewHref={brandHref} compact />
            {wm.on && (brandHref ? (
              <>
                <a href={withWatermark(brandHref, wm)} className={btn}><Download size={12} /> Download watermarked copy</a>
                <p className="text-[10.5px] text-muted leading-snug">Made from this photo as it is live now{current ? ' — the edit staged here is included once you Save it' : ''}. Save never sends a watermark to Guesty.</p>
              </>
            ) : <p className="text-[11px] text-muted">Save this photo to the listing first — the watermarked copy is made from the saved photo.</p>)}
          </section>

          {/* REPLACE / DELETE */}
          <section className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-line">
            <button onClick={() => setLibOpen(true)} className={btn}><LibraryBig size={12} /> Replace from library</button>
            <button onClick={onDelete} className={'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ' + (deleted ? 'border border-line bg-white text-ink' : 'bg-rose-50 text-rose-700 border border-rose-200')}>{deleted ? <><Undo2 size={12} /> Keep photo</> : <><Trash2 size={12} /> Delete</>}</button>
          </section>
          <p className="text-[11px] text-muted">Changes are staged — press <b>Save</b> on the photo grid to send them to Guesty.</p>
        </div>
      </div>
      <LibraryPicker open={libOpen} onClose={() => setLibOpen(false)} startListingId={listingId} title="Replace this photo" verb="Use"
        onPick={(picks: LibraryPick[]) => { const p = picks[0]; if (p) { onUse(p.url, 'Replaced'); if (p.caption && !caption) onCaption(p.caption) } setLibOpen(false) }} />
    </div>
  )
}
