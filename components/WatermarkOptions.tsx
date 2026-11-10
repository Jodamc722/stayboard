'use client'
// THE STAY WATERMARK — the options, wherever a photo can be downloaded (Jon, 2026-11-09: "have
// watermark feature that see through with Stay logo as a option").
//
// OFF by default. Switch it on and every download next to it — one photo, the picked set, the unit,
// the property — comes down as a watermarked COPY (lib/photo-watermark-server renders it; the
// original in Guesty is never changed and the copy is never stored). The channel rule is printed
// under the switch from one constant, WATERMARK_CHANNEL_NOTE.
//
// The preview is the real thing: the same renderer at a small size, so position, size, opacity and
// the white-or-dark pick are exactly what the download will carry.
import { useCallback, useEffect, useState } from 'react'
import { Stamp, Loader2 } from 'lucide-react'
import {
  type WatermarkOptions as Options, type WatermarkPosition, type WatermarkSize, type WatermarkTone,
  WATERMARK_DEFAULTS, WATERMARK_OPACITY, WATERMARK_SIZE_LABEL, WATERMARK_SIZE_PCT, WATERMARK_POSITION_LABEL,
  WATERMARK_CHANNEL_NOTE, WATERMARK_CHANNEL_WHY, cleanWatermark, watermarkQuery,
  WATERMARK_ENABLED,
} from '@/lib/photo-watermark'

const KEY = 'lh.photo.watermark.v1'
const TONE_LABEL: Record<WatermarkTone, string> = { auto: 'Auto', light: 'White', dark: 'Dark' }

/**
 * The options, remembered on this device — except the switch itself, which always starts OFF so a
 * plain download is never watermarked by surprise.
 */
export function useWatermark(): [Options, (next: Partial<Options>) => void] {
  const [wm, setWm] = useState<Options>(WATERMARK_DEFAULTS)
  useEffect(() => {
    try { const raw = window.localStorage.getItem(KEY); if (raw) setWm({ ...cleanWatermark(JSON.parse(raw)), on: false }) } catch { /* private window: defaults */ }
  }, [])
  const update = useCallback((next: Partial<Options>) => {
    setWm(prev => {
      const merged = cleanWatermark({ ...prev, ...next })
      try { window.localStorage.setItem(KEY, JSON.stringify({ ...merged, on: false })) } catch { /* fine */ }
      return merged
    })
  }, [])
  return [wm, update]
}

/** Add the watermark query to a download link (nothing is added while the switch is off). */
export function withWatermark(href: string, wm: Options): string {
  const q = watermarkQuery(wm)
  return q ? href + (href.indexOf('?') >= 0 ? '&' : '?') + q : href
}

const seg = (on: boolean) => 'rounded-md border px-2 py-1 text-[12px] font-semibold min-h-[30px] ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')

export function WatermarkOptions(props: Parameters<typeof WatermarkOptionsInner>[0]) {
  if (!WATERMARK_ENABLED) return null
  return <WatermarkOptionsInner {...props} />
}

function WatermarkOptionsInner({ value, onChange, previewHref, compact }: {
  value: Options
  onChange: (next: Partial<Options>) => void
  /** A single-photo download link (/api/photos/file?listing=…&pic=…) to preview on. Optional. */
  previewHref?: string | null
  /** Inside a narrow column (the photo editor): stack everything. */
  compact?: boolean
}) {
  // The opacity slider moves freely; the preview follows when the hand lifts.
  const [opacity, setOpacity] = useState(value.opacity)
  useEffect(() => { setOpacity(value.opacity) }, [value.opacity])
  const [settled, setSettled] = useState('')   // the preview address that has finished loading (or failed)
  const src = value.on && previewHref ? withWatermark(previewHref, value) + '&preview=1' : ''
  const loading = !!src && settled !== src

  return (
    <div className={'rounded-2xl border bg-white ' + (value.on ? 'border-ink/30' : 'border-line')}>
      <label className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={value.on} onChange={e => onChange({ on: e.target.checked })} className="h-4 w-4 accent-ink shrink-0" />
        <Stamp size={14} className="text-muted shrink-0" />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ink">Add the Stay watermark to downloads</span>
          <span className="block text-[11.5px] text-muted leading-snug">{WATERMARK_CHANNEL_NOTE}</span>
        </span>
      </label>
      {value.on && (
        <div className={'border-t border-line px-3 py-3 flex gap-4 ' + (compact ? 'flex-col' : 'flex-col md:flex-row md:items-start')}>
          <div className="space-y-2.5 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted w-[68px] shrink-0">Position</span>
              {(Object.keys(WATERMARK_POSITION_LABEL) as WatermarkPosition[]).map(k => (
                <button key={k} type="button" onClick={() => onChange({ position: k })} aria-pressed={value.position === k} className={seg(value.position === k)}>{WATERMARK_POSITION_LABEL[k]}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted w-[68px] shrink-0">Size</span>
              {(Object.keys(WATERMARK_SIZE_LABEL) as WatermarkSize[]).map(k => (
                <button key={k} type="button" onClick={() => onChange({ size: k })} aria-pressed={value.size === k} className={seg(value.size === k)} title={WATERMARK_SIZE_PCT[k] + '% of the photo’s width'}>{WATERMARK_SIZE_LABEL[k]}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted w-[68px] shrink-0">Logo</span>
              {(Object.keys(TONE_LABEL) as WatermarkTone[]).map(k => (
                <button key={k} type="button" onClick={() => onChange({ tone: k })} aria-pressed={value.tone === k} className={seg(value.tone === k)} title={k === 'auto' ? 'White on a dark part of the photo, dark on a light part — measured under the logo, photo by photo' : k === 'light' ? 'Always the white logo' : 'Always the dark logo'}>{TONE_LABEL[k]}</button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted w-[68px] shrink-0">See-through</span>
              <input type="range" min={WATERMARK_OPACITY.min} max={WATERMARK_OPACITY.max} step={WATERMARK_OPACITY.step} value={opacity}
                onChange={e => setOpacity(Number(e.target.value))}
                onMouseUp={() => onChange({ opacity })} onTouchEnd={() => onChange({ opacity })} onKeyUp={() => onChange({ opacity })} onBlur={() => onChange({ opacity })}
                className="flex-1 min-w-0 accent-ink" aria-label="Watermark opacity" />
              <span className="text-[12px] tabular-nums text-muted w-9 text-right">{opacity}%</span>
            </label>
            <p className="text-[11px] text-muted leading-snug">
              A copy is made for the download — the original photo is not changed. {WATERMARK_CHANNEL_WHY}
            </p>
          </div>
          {src && (
            <div className={'relative shrink-0 rounded-xl overflow-hidden border border-line bg-slate-100 ' + (compact ? 'w-full' : 'w-full md:w-[300px]')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Watermark preview" onLoad={() => setSettled(src)} onError={() => setSettled(src)} className="block w-full h-auto" />
              {loading && <span className="absolute inset-0 grid place-items-center bg-white/50"><Loader2 size={18} className="animate-spin text-ink" /></span>}
              <span className="absolute top-1.5 left-1.5 rounded bg-ink/70 text-white text-[10px] font-bold px-1.5 py-0.5">Preview</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
