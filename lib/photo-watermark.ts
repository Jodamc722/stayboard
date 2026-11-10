// THE STAY WATERMARK — options, wording and geometry (Jon, 2026-11-09: "have watermark feature that
// see through with Stay logo as a option").
//
// A branded copy is a DERIVED file: the photo resized, converted to sRGB, with the Stay logo blended
// in at low opacity. The original in Guesty is never touched, and a branded copy is never stored at
// a URL — it only exists in the download stream (/api/photos/file, /api/photos/zip), so there is
// nothing for the "Save to Guesty" path to pick up.
//
// THE CHANNEL RULE lives in ONE constant below. Airbnb, Vrbo and Booking.com photo rules generally do
// not allow logos, watermarks, text overlays or contact details on listing photos (lib/photo-order
// already scores a watermark as a fault for the same reason), so the feature is labelled for the
// direct site, social, email and print only, and both write paths to Guesty refuse a branded copy
// (app/api/photo-upload by the marker in the file, app/api/photo-order by the file name).
//
// PURE: no sharp, no I/O — the client imports this. The pixels are in lib/photo-watermark-server.ts.

export type WatermarkPosition = 'br' | 'bl' | 'c'
export type WatermarkSize = 's' | 'm' | 'l'
export type WatermarkTone = 'auto' | 'light' | 'dark'
export type WatermarkOptions = {
  on: boolean
  position: WatermarkPosition
  size: WatermarkSize
  /** Percent, 10–70 (the logo is thin line art, so it needs more than a solid mark would). */
  opacity: number
  /** 'auto' = white on a dark area, dark on a light one, measured under the logo. */
  tone: WatermarkTone
}

/** THE ONE PLACE THE CHANNEL RULE IS WORDED. Correct it here and every screen follows. */
export const WATERMARK_CHANNEL_NOTE = 'For your direct site, social posts, email and print — not for Airbnb / Vrbo / Booking.com / Google listing photos.'
/** Why the booking sites are excluded — shown under the note, and returned when a push is refused. */
export const WATERMARK_CHANNEL_WHY = 'Vrbo and Booking.com reject watermarks by name, Airbnb bans superimposed company logos, and Google says "don\'t add graphics" — a rejected photo can also drop a Vrbo listing under its 6-photo minimum. So a watermarked copy is never sent to Guesty or the channels.'
/** What the Guesty write paths answer when someone tries to put a branded copy on a listing. */
export const WATERMARK_PUSH_BLOCK = 'This is a Stay-watermarked copy. ' + WATERMARK_CHANNEL_WHY + ' Use the original photo for the listing.'

// SWITCHED OFF (Jon, 2026-11-10: "no watermark option then" — the booking sites do not allow it, so
// the option is not offered anywhere). Flip to true to bring the switch, the editor section and the
// watermarked downloads back; the upload/Guesty guards stay on either way.
export const WATERMARK_ENABLED: boolean = false

export const WATERMARK_DEFAULTS: WatermarkOptions = { on: false, position: 'br', size: 'm', opacity: 30, tone: 'auto' }
export const WATERMARK_OPACITY = { min: 10, max: 70, step: 1 }
/** Logo width as a share of the image width. */
export const WATERMARK_SIZE_PCT: Record<WatermarkSize, number> = { s: 14, m: 22, l: 34 }
export const WATERMARK_SIZE_LABEL: Record<WatermarkSize, string> = { s: 'Small', m: 'Medium', l: 'Large' }
export const WATERMARK_POSITION_LABEL: Record<WatermarkPosition, string> = { br: 'Bottom right', bl: 'Bottom left', c: 'Centre' }
/** Distance from the edges, as a share of the image width. */
export const WATERMARK_MARGIN_PCT = 3
/** Long edge of a branded copy. Web, social and A4 print at 220 dpi are all inside this. */
export const BRANDED_LONG_EDGE = 2560
export const BRANDED_JPEG_QUALITY = 90
/** Most photos one watermarked ZIP will render (each is decoded, blended and re-encoded). */
export const WATERMARK_ZIP_MAX = 500
/** Written into the file's EXIF description, so an upload to a listing can recognise and refuse it. ASCII only. */
export const WATERMARK_MARKER = 'STAY-BRANDED-COPY'
/** In every branded file and ZIP name. */
export const WATERMARK_FILE_TAG = 'stay-branded'

const POS: WatermarkPosition[] = ['br', 'bl', 'c']
const SIZE: WatermarkSize[] = ['s', 'm', 'l']
const TONE: WatermarkTone[] = ['auto', 'light', 'dark']

/** Anything (a saved value, a query, a body) → valid options. Unknown values fall back to the defaults. */
export function cleanWatermark(o: any): WatermarkOptions {
  const v = (o && typeof o === 'object') ? o : {}
  const op = Number(v.opacity)
  return {
    on: WATERMARK_ENABLED && v.on === true,
    position: POS.indexOf(v.position) >= 0 ? v.position : WATERMARK_DEFAULTS.position,
    size: SIZE.indexOf(v.size) >= 0 ? v.size : WATERMARK_DEFAULTS.size,
    opacity: Number.isFinite(op) ? Math.max(WATERMARK_OPACITY.min, Math.min(WATERMARK_OPACITY.max, Math.round(op))) : WATERMARK_DEFAULTS.opacity,
    tone: TONE.indexOf(v.tone) >= 0 ? v.tone : WATERMARK_DEFAULTS.tone,
  }
}

/** The query a download link carries. Empty when the watermark is off, so plain links stay plain. */
export function watermarkQuery(o: WatermarkOptions): string {
  if (!o.on) return ''
  const c = cleanWatermark(o)
  return 'wm=1&wmpos=' + c.position + '&wmsize=' + c.size + '&wmop=' + c.opacity + '&wmtone=' + c.tone
}

/** Read the options back off a request. null = no watermark asked for (the default). */
export function watermarkFromParams(sp: { get(name: string): string | null }): WatermarkOptions | null {
  if (sp.get('wm') !== '1') return null
  return cleanWatermark({ on: true, position: sp.get('wmpos'), size: sp.get('wmsize'), opacity: sp.get('wmop') == null ? undefined : Number(sp.get('wmop')), tone: sp.get('wmtone') })
}

/** Where the logo sits, in pixels. `logoAspect` = logo height ÷ width. Always inside the image. */
export function watermarkBox(imgW: number, imgH: number, logoAspect: number, o: WatermarkOptions): { left: number; top: number; width: number; height: number } {
  const W = Math.max(1, Math.round(imgW)), H = Math.max(1, Math.round(imgH))
  const aspect = logoAspect > 0 ? logoAspect : 0.42
  const margin = Math.round(W * WATERMARK_MARGIN_PCT / 100)
  let width = Math.round(W * WATERMARK_SIZE_PCT[o.size] / 100)
  // A tall phone shot: never wider than the image less its margins, never taller than a quarter of it.
  width = Math.max(8, Math.min(width, W - 2 * margin, Math.round((H * 0.25) / aspect)))
  const height = Math.max(4, Math.round(width * aspect))
  const left = o.position === 'c' ? Math.round((W - width) / 2) : o.position === 'bl' ? margin : W - margin - width
  const top = o.position === 'c' ? Math.round((H - height) / 2) : H - margin - height
  return { left: Math.max(0, Math.min(W - width, left)), top: Math.max(0, Math.min(H - height, top)), width, height }
}

/** White logo on a dark area, dark logo on a light one. `meanLuma` is 0–255 under the logo. */
export function pickTone(meanLuma: number): 'light' | 'dark' {
  return meanLuma >= 150 ? 'dark' : 'light'
}

/** "03 - king bedroom.jpg" → "03 - king bedroom - stay-branded.jpg" (a branded copy is always a JPEG). */
export function brandedFileName(name: string): string {
  const slash = name.lastIndexOf('/')
  const dir = slash >= 0 ? name.slice(0, slash + 1) : ''
  const base = (slash >= 0 ? name.slice(slash + 1) : name).replace(/\.[a-z0-9]{2,5}$/i, '')
  return dir + (base || 'photo') + ' - ' + WATERMARK_FILE_TAG + '.jpg'
}

/** Does this file name or URL say it is a branded copy? (The Guesty write paths refuse those.) */
export function looksWatermarked(nameOrUrl: string): boolean {
  let s = String(nameOrUrl || '')
  try { s = decodeURIComponent(s) } catch { /* keep as given */ }
  return s.toLowerCase().indexOf(WATERMARK_FILE_TAG) >= 0
}
