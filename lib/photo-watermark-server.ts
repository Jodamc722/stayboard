// THE STAY WATERMARK — the pixels (server only; the options and the channel rule are in
// lib/photo-watermark.ts).
//
// Same library as the enhance mode (sharp). One branded copy:
//   1. the photo is auto-oriented, sized to a long edge of 2560 px at most (never enlarged, aspect
//      ratio kept), flattened on white and converted to sRGB;
//   2. the Stay logo (public/stay-logo.png — a black mark on transparent, so its alpha IS the shape)
//      is scaled to the chosen share of the image width;
//   3. the photo's brightness is measured UNDER the logo's own shape, and the logo is drawn white on
//      a dark area or near-black on a light one (or as asked);
//   4. the logo is blended in at the chosen opacity — see-through, the photo shows through it;
//   5. out as an sRGB-tagged JPEG, quality 90, with a marker in the EXIF description so an upload to
//      a listing can recognise the file and refuse it.
// The input buffer is never modified and nothing is written anywhere: the caller streams the result.
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { stayLogoPng } from '@/lib/brand-logo'
import { type WatermarkOptions, cleanWatermark, watermarkBox, pickTone, BRANDED_LONG_EDGE, BRANDED_JPEG_QUALITY, WATERMARK_MARKER } from '@/lib/photo-watermark'

let logoMemo: Promise<Buffer> | null = null
/** The full-size logo from public/, or the 420 px copy that travels with the code when the file is not on disk. */
export function loadStayLogo(): Promise<Buffer> {
  if (!logoMemo) {
    logoMemo = readFile(path.join(process.cwd(), 'public', 'stay-logo.png'))
      .then(b => (b.length > 500 ? b : stayLogoPng()))
      .catch(() => stayLogoPng())
  }
  return logoMemo
}

export type BrandedCopy = { data: Buffer; width: number; height: number; tone: 'light' | 'dark' }

/**
 * A watermarked copy of one photo. `logoPng` is injectable for tests; production reads the Stay logo.
 * Throws when the input is not an image — the caller decides whether to skip or fail.
 */
export async function brandedCopy(input: Buffer, options: WatermarkOptions, opts: { longEdge?: number; quality?: number; logoPng?: Buffer } = {}): Promise<BrandedCopy> {
  const o = cleanWatermark({ ...options, on: true })
  const longEdge = Math.max(320, Math.min(4096, Math.round(opts.longEdge || BRANDED_LONG_EDGE)))
  const quality = Math.max(60, Math.min(95, Math.round(opts.quality || BRANDED_JPEG_QUALITY)))

  // withIccProfile('srgb') on this stage is what makes sharp convert a Display-P3 phone shot INTO
  // sRGB using its embedded profile; without it the raw pixels would still be P3 and read dull.
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .withIccProfile('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  const colour = Math.min(3, ch)

  const logoPng = opts.logoPng || await loadStayLogo()
  const meta = await sharp(logoPng).metadata()
  const aspect = meta.width && meta.height ? meta.height / meta.width : 0.42
  const box = watermarkBox(W, H, aspect, o)
  const logo = await sharp(logoPng).resize({ width: box.width, height: box.height, fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const lw = logo.info.width, lh = logo.info.height, la = logo.data

  // How bright is the photo where the logo's strokes will actually land?
  let sum = 0, weight = 0
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const a = la[(y * lw + x) * 4 + 3]
      if (!a) continue
      const i = ((box.top + y) * W + box.left + x) * ch
      const lum = colour >= 3 ? 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] : data[i]
      sum += lum * a; weight += a
    }
  }
  const tone: 'light' | 'dark' = o.tone === 'auto' ? pickTone(weight ? sum / weight : 128) : o.tone
  const ink = tone === 'light' ? 255 : 17
  const k = o.opacity / 100 / 255

  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const a = la[(y * lw + x) * 4 + 3] * k
      if (!a) continue
      const i = ((box.top + y) * W + box.left + x) * ch
      for (let c = 0; c < colour; c++) data[i + c] = Math.round(data[i + c] * (1 - a) + ink * a)
    }
  }

  const out = await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .withIccProfile('srgb')
    .withExif({ IFD0: { Copyright: 'Stay Hospitality', ImageDescription: WATERMARK_MARKER + ' - watermarked copy for direct site, social, email and print; not for booking-site listing photos' } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()
  return { data: out, width: W, height: H, tone }
}

/** Was this file made by brandedCopy()? Reads the marker from the head of the file (EXIF sits first). */
export function hasWatermarkMarker(file: Buffer | Uint8Array): boolean {
  const head = Buffer.from(file.buffer, file.byteOffset, Math.min(file.byteLength, 262144))
  return head.includes(WATERMARK_MARKER)
}
