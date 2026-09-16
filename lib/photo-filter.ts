// NO COLLAGES IN AN OWNER DECK (Jon, 2026-09-16: "make it standard so you don't use collage
// photos in any of the presentation photos").
//
// Guesty's picture array mixes two things that look identical to code: photographs of the
// property, and marketing collages the manager uploaded — a 2×2 grid of rooms with white
// gutters and caption pills like "City Views · 1 Parking Included". A collage is fine on a
// listing thumbnail and ruinous on a slide, where it lands as a four-up contact sheet under
// the owner's name.
//
// WHAT DOES NOT WORK, measured against 16 real images from this account:
//   · The URL path. Collages live on the account-media path (/upload/v123.../production/...)
//     rather than the property-photos path — but so do 3,718 pictures across 181 listings,
//     most of them ordinary room photographs. Filtering by path would throw away a third of
//     the photo library.
//   · Aspect ratio. The collages here are 2000×1600; so are plenty of real photos.
//   · Seam contrast. A doorway edge scores as high as a panel boundary (4.72 vs 3.49 — the
//     real photo scored HIGHER than the collage).
//
// WHAT WORKS: a collage is a layout, and layouts have gutters. A gutter is a line of paper-
// white pixels running the full height or width of the frame. A photograph of a room never
// contains one — even a blown-out window stops at the wall. Two details matter:
//   · Sample with nearest-neighbour at 320px. Downscaling smoothly averages a 6px gutter in a
//     2000px image out of existence, which is why the first version missed one of the two.
//   · Count paper-white pixels rather than measuring standard deviation. A gutter picks up a
//     few dark pixels where a caption pill clips it, and those outliers move sd a long way —
//     sd ≤ 7 missed a gutter whose mean was 253. Counting pixels ≥ 245 does not care.
// Verified: both known collages caught, all 14 photographs passed, including a white-tiled
// bathroom that a brightness-only test flagged.
import 'server-only'
import sharp from 'sharp'

const N = 320
const WHITE = 245        // paper, not "bright"
const RUN = 0.95         // ~the whole line
const MEAN = 246

/** Verdicts are memoised per warm lambda — the same building's photos recur across owners. */
const cache = new Map<string, boolean>()

async function looksLikeCollage(url: string): Promise<boolean> {
  const hit = cache.get(url)
  if (hit !== undefined) return hit
  let verdict = false
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) throw new Error('fetch ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    const g = await sharp(buf).resize(N, N, { fit: 'fill', kernel: 'nearest' }).greyscale().raw().toBuffer()
    const at = (x: number, y: number) => g[y * N + x]
    const flat = (get: (i: number) => number) => {
      let sum = 0, white = 0
      for (let i = 0; i < N; i++) { const v = get(i); sum += v; if (v >= WHITE) white++ }
      return white / N >= RUN && sum / N >= MEAN
    }
    // Edges are skipped: a white border is a border, not a gutter, and cropping fixes it.
    for (let x = 4; x < N - 4 && !verdict; x++) if (flat(y => at(x, y))) verdict = true
    for (let y = 4; y < N - 4 && !verdict; y++) if (flat(x => at(x, y))) verdict = true
  } catch {
    // Unreachable or undecodable: keep the photo. A deck missing a picture is worse than a
    // deck with one we could not check, and this runs on every generate.
    verdict = false
  }
  cache.set(url, verdict)
  return verdict
}

/**
 * Drops collages, preserving order. Checks at most `limit` images so a 40-photo listing does
 * not turn a report generate into a minute of image fetches; anything past the limit is kept
 * unchecked, because by then we already have far more photographs than the deck can use.
 */
export async function withoutCollages(urls: string[], limit = 10): Promise<string[]> {
  const head = urls.slice(0, limit)
  const tail = urls.slice(limit)
  const verdicts = await Promise.all(head.map(u => looksLikeCollage(u)))
  return head.filter((_u, i) => !verdicts[i]).concat(tail)
}
