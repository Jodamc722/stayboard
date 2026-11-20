// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// WHICH PHOTOGRAPHS A PIECE MAY USE. Jon's rules, applied before any model sees a picture:
//   · only our units in the area the piece is about (lib/ad-places: Fort Lauderdale event → Fort Lauderdale units)
//   · the studio's own scorer decides what is good enough (lib/ad-photo-pick: signage, people, collages, blur and
//     detail shots are out; what the photo IS beats what a caption mentions; quality leads)
//   · a collage is never offered (lib/collage looks at the image itself)
//   · the REAL pixel size is measured (Guesty's picture objects carry none), so the composer can keep every
//     photograph at or under 100% and the audit can hold it to that
// The result is a small table of candidates (ids p1…): the composer may use only these, each at most once.
import 'server-only'
import sharp from 'sharp'
import { searchPhotos, type PhotoHit } from '@/lib/photo-library'
import { adPhotoScore, photoText } from '@/lib/ad-photo-pick'
import { buildingsIn, inBuildings, type AreaKey } from '@/lib/ad-places'
import { isCollagePhoto } from '@/lib/collage'
import { photoSrcAllowed, type PhotoAsset } from './composition'
import { IDENTITIES } from './identities'

const SUBJECT: Record<string, { word: string; any: RegExp }> = {
  'dining table': { word: 'dining', any: /dining|table for|breakfast/i },
  kitchen: { word: 'kitchen', any: /kitchen|cook|chef/i },
  'living room': { word: 'living', any: /living|lounge|sofa|couch/i },
  pool: { word: 'pool', any: /pool|swim/i },
  'ocean view': { word: 'ocean', any: /ocean|beach|sea\b|sand|waterfront|oceanfront|shore|bay\b/i },
  'balcony view': { word: 'balcony', any: /balcon|terrace|patio/i },
  exterior: { word: 'exterior', any: /building|exterior|facade|tower|aerial/i },
  'skyline night': { word: 'view', any: /skyline|city|downtown|night|lights/i },
  'city view': { word: 'view', any: /view|skyline|bay\b|vista|panoram|city|downtown/i },
  rooftop: { word: 'rooftop', any: /roof ?top|rooftop/i },
  bedroom: { word: 'bedroom', any: /bed(room)?\b|suite|king|queen/i },
}
const CLOUD = /^https:\/\/(assets\.guesty\.com|res\.cloudinary\.com)\/(.*\/)?image\/upload\//i
const core = (c: string) => String(c || '').toLowerCase().replace(/\b(the|a|an|with|and|of|in|at|view|photo|image)\b/g, '').replace(/[^a-z ]/g, '').trim().split(/\s+/).slice(0, 3).join(' ')

/** The stored size of a photograph: Cloudinary says for Guesty's; anything else is read from the file. */
async function measure(url: string): Promise<{ w: number; h: number } | null> {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000)
    if (CLOUD.test(url)) {
      const r = await fetch(url.replace('/image/upload/', '/image/upload/fl_getinfo/'), { signal: ctl.signal }); clearTimeout(tm)
      const j: any = r.ok ? await r.json().catch(() => null) : null
      const w = Number(j?.input?.width), h = Number(j?.input?.height)
      return w > 0 && h > 0 ? { w, h } : null
    }
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm)
    if (!r.ok) return null
    const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata()
    return m.width && m.height ? { w: m.width, h: m.height } : null
  } catch { return null }
}

/** A small image address for showing a photograph to a person or a model (never used for the finished piece). */
export function thumbUrl(src: string, w = 640): string {
  return CLOUD.test(src) ? src.replace('/image/upload/', `/image/upload/c_limit,w_${w},q_70,f_jpg/`) : src
}

/** Up to `limit` photographs of our units in `area`, the best for the event's subjects, measured, none a collage. */
export async function candidatePhotos(moment: string, area: string, limit = 10, opts: { perSubject?: number; subjects?: string[] } = {}): Promise<Record<string, PhotoAsset>> {
  const id = IDENTITIES[moment]
  const set = buildingsIn([area as AreaKey])
  // EDITOR (Jon, 2026-11-20: "add photos, swap photo"): the picker asks for more per subject, or for one subject.
  const subjects = opts.subjects && opts.subjects.length ? opts.subjects : id ? id.subjects : []
  const per = Math.max(1, opts.perSubject || 2)
  if (!subjects.length || !set.length) return {}
  type Cand = { h: PhotoHit; s: number; subject: string }
  const picked: Cand[] = [], seenUrl = new Set<string>(), seenCore = new Set<string>()
  for (const subject of subjects) {
    const subj = SUBJECT[subject] || null
    let hits: PhotoHit[] = []
    try { hits = (await searchPhotos(subject, 600)).hits } catch { hits = [] }
    const scored = hits
      .filter(h => h.active !== false && inBuildings(String(h.building || ''), set) && photoSrcAllowed(h.url))
      .map(h => ({ h, s: adPhotoScore(h, subj, { hero: !picked.length, landscape: true }) + (subj && subj.any.test(photoText(h)) ? 0 : -400), subject }))
      .filter(x => Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s)
    let took = 0
    for (const c of scored) {
      if (took >= per) break
      const k = core(String(c.h.caption || c.h.an?.subject || ''))
      if (seenUrl.has(c.h.url) || (k && seenCore.has(c.h.building + '|' + k))) continue
      seenUrl.add(c.h.url); if (k) seenCore.add(c.h.building + '|' + k)
      picked.push(c); took++
    }
  }
  // one home, one story: the building that can tell the most of it comes first
  const count = new Map<string, number>()
  for (const c of picked) count.set(c.h.building, (count.get(c.h.building) || 0) + 1)
  picked.sort((a, b) => (count.get(b.h.building)! - count.get(a.h.building)!) || b.s - a.s)
  const out: Record<string, PhotoAsset> = {}
  const top = picked.slice(0, limit + 4)
  const checked = await Promise.all(top.map(async c => ({ c, dims: await measure(c.h.url), collage: await isCollagePhoto(c.h.view || c.h.url).catch(() => false) })))
  let n = 0
  for (const x of checked) {
    if (n >= limit || !x.dims || x.collage || x.dims.w < 1000) continue
    n++
    out['p' + n] = { src: x.c.h.url, w: x.dims.w, h: x.dims.h, source: 'ours', building: String(x.c.h.building || ''), unit: String(x.c.h.unit || ''), area, shows: String(x.c.h.an?.subject || x.c.h.caption || x.c.subject).slice(0, 240) }
  }
  return out
}
