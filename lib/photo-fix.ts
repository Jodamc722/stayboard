// PRODUCT PHOTOS, MADE TO LOOK LIKE PRODUCT PHOTOS.
//
// Jon, 2026-09-10: "need to be able to customize or edit the photos, look too zoomed in, use AI to
// enhance from the selection. Should have smart feature, make it look nice." Then, pointing at one:
// "look at fiji water one, looks so bad from guest side."
//
// He was looking at a real bug, and it was structural rather than one bad upload. The guest card
// draws the photo in an 84×84 SQUARE with object-cover. The Fiji shot is 330×700 — a tall bottle —
// so the square crop kept the middle 330×330 and threw away the cap and the base. Every portrait
// bottle shot lands the same way: a slab of label, no product. Cropping harder was never the fix.
//
// So the pipeline makes photos square BEFORE they are ever displayed:
//
//   1. TRIM the flat background a product shot always has, down to the product itself.
//   2. PAD back out to a square in that same background colour, with a margin so it breathes.
//   3. LEVEL and SHARPEN gently.
//
// Now object-cover has nothing left to cut, and the whole bottle survives. Everything here is
// deterministic image processing — no model is asked to redraw a product, because a "cleaned up"
// bottle that no longer matches what we hand the guest is a worse outcome than a plain photo.
import sharp from 'sharp'

export type PhotoOps = {
  /** Trim the flat background and re-square it. The default for a new upload. */
  smart?: boolean
  /** Quarter turns only — enough for a sideways phone photo, and never a lossy free rotation. */
  rotate?: 0 | 90 | 180 | 270
  /** 1 = the whole square. Above that, crops in. */
  zoom?: number
  /** −1…1 from centre, applied inside whatever the zoom left visible. */
  offsetX?: number
  offsetY?: number
  /** Auto-levels, a touch of saturation, and a light sharpen. */
  enhance?: boolean
}

export const PHOTO_SIDE = 1000
const MARGIN = 0.07                 // breathing room each side once it is squared

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The flat colour a product shot sits on, read from the corners rather than assumed to be white. */
async function backgroundOf(buf: Buffer): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(buf).metadata()
  const w = meta.width || 0, h = meta.height || 0
  if (w < 8 || h < 8) return { r: 255, g: 255, b: 255 }
  const s = Math.max(2, Math.floor(Math.min(w, h) * 0.03))
  const corners = [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]
  const reads = await Promise.all(corners.map(async ([left, top]) => {
    // .stats() reads the INPUT image and ignores pipeline operations, so the extract has to be
    // rendered to a buffer first. Chaining them silently returned the whole-image average for all
    // four corners — every photo looked like it sat on the average of its own contents.
    const px = await sharp(buf).extract({ left, top, width: s, height: s }).toBuffer()
    const st = await sharp(px).stats()
    return st.channels.slice(0, 3).map(c => c.mean)
  }))
  // The MEDIAN corner, not the mean: one corner holding a shadow or a stray object should not drag
  // the padding colour away from the background the other three agree on.
  const med = (i: number) => { const v = reads.map(r => r[i]).sort((a, b) => a - b); return Math.round((v[1] + v[2]) / 2) }
  return { r: med(0), g: med(1), b: med(2) }
}

/** Trim the background away, then pad back to a square in that colour. */
async function squareUp(buf: Buffer): Promise<Buffer> {
  const bg = await backgroundOf(buf)
  let body: Buffer
  try {
    // A generous threshold: product shots are shot on flat white/grey, and being too timid here
    // leaves a band of background that defeats the whole point.
    body = await sharp(buf).trim({ background: { r: bg.r, g: bg.g, b: bg.b }, threshold: 18 }).toBuffer()
  } catch { body = buf }
  const m = await sharp(body).metadata()
  const w = m.width || 1, h = m.height || 1
  // Nothing to trim (a full-bleed photo) — leave it alone rather than padding a scene into a frame.
  if (w < 8 || h < 8) return buf
  const side = Math.round(Math.max(w, h) * (1 + MARGIN * 2))
  const x = Math.round((side - w) / 2), y = Math.round((side - h) / 2)
  return sharp({ create: { width: side, height: side, channels: 3, background: bg } })
    .composite([{ input: body, left: x, top: y }])
    .jpeg({ quality: 90, mozjpeg: true }).toBuffer()
}

/**
 * Render a stored photo with a set of edits. Always returns a square JPEG, because square is what
 * every surface asks for and the only shape that cannot be cropped badly.
 */
export async function renderPhoto(input: Buffer, ops: PhotoOps = {}): Promise<Buffer> {
  let buf = input
  // Honour EXIF first so a sideways phone photo is upright before anything measures it.
  buf = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer()
  if (ops.rotate) buf = await sharp(buf).rotate(ops.rotate).toBuffer()
  if (ops.smart !== false) buf = await squareUp(buf)

  // Square base, then the zoom/pan window inside it.
  buf = await sharp(buf).resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: 'cover', position: 'centre' }).toBuffer()
  const zoom = clamp(Number(ops.zoom) || 1, 1, 4)
  if (zoom > 1.001) {
    const win = Math.round(PHOTO_SIDE / zoom)
    const room = PHOTO_SIDE - win
    const left = Math.round(room / 2 * (1 + clamp(Number(ops.offsetX) || 0, -1, 1)))
    const top = Math.round(room / 2 * (1 + clamp(Number(ops.offsetY) || 0, -1, 1)))
    buf = await sharp(buf).extract({ left: clamp(left, 0, room), top: clamp(top, 0, room), width: win, height: win })
      .resize(PHOTO_SIDE, PHOTO_SIDE).toBuffer()
  }

  let pipe = sharp(buf)
  if (ops.enhance !== false) {
    // Deliberately gentle. A product photo that has been pushed looks fake, and a guest comparing
    // it to what arrives is the one person guaranteed to notice.
    pipe = pipe.normalise({ lower: 1, upper: 99 }).modulate({ saturation: 1.06 }).sharpen({ sigma: 0.7 })
  }
  return pipe.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
}
