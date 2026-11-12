// WHICH PHOTO GOES IN AN AD (Jon, 2026-11-12: "wrong photos … our ad generation should be world class").
// Captions alone picked badly: "ocean view" found bedrooms with a window, "sunset" found a bedroom, and a
// lobby shot with another company's sign on the wall could open an ad. The photo analysis (lib/photo-order:
// the vision pass behind Optimize photos) already knows each photo's room, category, shot type, quality,
// faults and selling points, so the ad picker reads it:
//   · out, always: signage, text, watermark, people, collage, blur, dark, clutter, a near-duplicate, a stock image
//   · out unless asked for: details and close-ups, bathrooms, closets, hallways
//   · the subject must be what the photo IS (its category, room, subject, selling points), not a word in a caption
//   · then quality (0–100) leads, a hero-worthy wide shot wins the opener and full-screen layouts
// Server and client safe (no imports).

export type AdPhotoAnalysis = { quality: number | null; faults: string[]; heroWorthy: boolean; shotType: string; category: string; room: string; subject: string; sellingPoints: string[]; duplicate: boolean; stock: boolean }

export function slimAnalysis(e: any): AdPhotoAnalysis | undefined {
  if (!e || typeof e !== 'object') return undefined
  const s = (x: any) => (typeof x === 'string' ? x : '')
  const q = Number(e.quality)
  return {
    quality: Number.isFinite(q) ? q : null,
    faults: Array.isArray(e.faults) ? e.faults.filter((f: any) => typeof f === 'string') : [],
    heroWorthy: !!e.heroWorthy, shotType: s(e.shotType), category: s(e.category), room: s(e.room), subject: s(e.subject),
    sellingPoints: Array.isArray(e.sellingPoints) ? e.sellingPoints.filter((f: any) => typeof f === 'string') : [],
    duplicate: !!e.duplicateOf, stock: e.kind === 'stock',
  }
}

/** Faults that keep a photo out of every ad. */
export const AD_KILL = new Set(['signage', 'text', 'watermark', 'people', 'collage', 'blurry', 'dark', 'clutter', 'mirror-selfie'])
/** What a subject should BE, by the analysis's category. */
const SUBJECT_CATS: Record<string, string[]> = {
  ocean: ['view', 'exterior', 'outdoor'], view: ['view', 'exterior', 'outdoor'], sunset: ['view', 'exterior', 'outdoor'], marina: ['view', 'exterior', 'outdoor'],
  pool: ['amenity', 'outdoor', 'exterior'], rooftop: ['amenity', 'outdoor', 'view', 'exterior'], garden: ['outdoor', 'exterior', 'amenity'],
  balcony: ['outdoor', 'view'], bedroom: ['bedroom'], kitchen: ['kitchen', 'dining'], living: ['living', 'dining'], dining: ['dining', 'kitchen', 'living'],
  bathroom: ['bathroom'], lobby: ['amenity', 'other', 'exterior'], gym: ['amenity'], exterior: ['exterior', 'view'],
}

/** Everything the photo is known to show, as one string for a subject test. */
export function photoText(h: { caption?: string; an?: AdPhotoAnalysis }): string {
  const a = h.an
  return [h.caption || '', a ? [a.category, a.room, a.subject, a.sellingPoints.join(' ').replace(/-/g, ' ')].join(' ') : ''].join(' ')
}

/** -Infinity when the photo must never be in an ad; else points (higher is better). */
export function adPhotoScore(h: { caption?: string; an?: AdPhotoAnalysis; width?: number | null; height?: number | null }, subj: { word: string; any: RegExp } | null, o: { hero?: boolean; portrait?: boolean; landscape?: boolean; askedWeak?: boolean } = {}): number {
  const a = h.an
  // another company's name or a sign on the wall never appears in our ads
  if (/\b(sonder|airbnb|vrbo|marriott|hilton|hyatt|kasa|vacasa|evolve|logo|signage|sign on|branded)\b/i.test(photoText(h))) return -Infinity
  if (a) {
    if (a.faults.some(f => AD_KILL.has(f)) || a.duplicate || a.stock) return -Infinity
    if (!o.askedWeak && (a.shotType === 'detail' || /bath|closet|hall|laundry|stair|garage|parking/.test(a.category + ' ' + a.room))) return -Infinity
  }
  let s = 0
  if (subj) {
    const cats = SUBJECT_CATS[subj.word] || []
    const isCat = a && cats.indexOf(a.category) >= 0
    const says = subj.any.test(photoText(h))
    // what the photo IS beats what a caption mentions: a bedroom "with a view" is not a view shot
    s += isCat && says ? 1400 : isCat ? 900 : says ? (a ? 350 : 700) : 0
  }
  if (a && a.quality != null) s += a.quality * 9; else s -= 250    // unanalyzed photos only when nothing better
  if (a && a.heroWorthy) s += o.hero ? 450 : 120
  if (a && a.shotType === 'wide') s += 120
  if (o.hero && a && /view|exterior|outdoor|amenity/.test(a.category)) s += 160
  const w = h.width || 0, ht = h.height || 0
  if (w && ht) { const r = ht / w; if (o.portrait) s += r >= 1 ? 200 : r >= 0.75 ? 90 : 0; else if (o.landscape) s += r <= 0.8 ? 150 : r <= 1 ? 60 : -120 }
  if (w && w < 1000) s -= 300
  return s
}
