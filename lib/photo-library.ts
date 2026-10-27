// THE PHOTO LIBRARY (Jon, 2026-10-27: "a library of photos with links that allow you to download the
// photos … like a drive: property, unit number … view and download them if needed … in zip files,
// high quality").
//
// The photos are the listing photos Guesty holds — the same pictures the OTAs show, at the size
// Guesty keeps them (`original`, the full upload; `large` / `regular` / `thumbnail` are its derived
// renditions). Nothing is copied anywhere: the library reads `guesty_listings.raw.pictures`, shows
// the thumbnails, and streams the originals when someone downloads — one photo, a picked set, a
// unit, or a whole building as a ZIP (lib/zip-stream, stored not re-compressed, so the files inside
// are byte-for-byte what Guesty serves).
//
// Shape: Property (building) → Unit (listing) → Photos, in the listing's own order, captions as the
// team wrote them (camera names and blanks read as no caption).
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'
import { marketOf } from './segments'
import { unitLabel } from './unit-label'
import { isJunkCaption } from './photo-order'
import { safeName } from './zip-stream'
import { haystack, matchQuery, queryWords, analysisWords, type Haystack } from './photo-search'

export const PHOTO_LIBRARY_CACHE_TAG = 'photo-library'
const str = (v: any) => (v == null ? '' : String(v)).trim()
const httpish = (u: any): string => { const s = str(u); return /^https:\/\//i.test(s) ? s : '' }

export type LibPhoto = {
  id: string
  /** The full-size file — what downloads: Guesty's "original", the upload as it was. */
  url: string
  thumb: string
  /** A comfortable viewing size for the lightbox. */
  view: string
  caption: string
  width: number | null
  height: number | null
}
export type LibUnit = { id: string; name: string; title: string | null; building: string; market: string; active: boolean; photos: number; cover: string | null }
export type LibBuilding = { name: string; market: string; units: LibUnit[]; photos: number }
export type LibraryIndex = { at: string; buildings: LibBuilding[]; units: number; photos: number }
export type UnitPhotos = { unit: LibUnit; photos: LibPhoto[] }

export function photoOf(p: any, i: number): LibPhoto | null {
  if (!p || typeof p !== 'object') return null
  const url = httpish(p.original) || httpish(p.large) || httpish(p.regular) || httpish(p.url)
  if (!url) return null
  const cap = str(p.caption)
  return {
    id: str(p._id) || 'p' + i,
    url,
    thumb: httpish(p.thumbnail) || httpish(p.regular) || httpish(p.large) || url,
    view: httpish(p.large) || httpish(p.regular) || url,
    caption: isJunkCaption(cap) ? '' : cap,
    width: Number.isFinite(Number(p.width)) && Number(p.width) > 0 ? Number(p.width) : null,
    height: Number.isFinite(Number(p.height)) && Number(p.height) > 0 ? Number(p.height) : null,
  }
}
function unitOf(l: any, photos: LibPhoto[]): LibUnit {
  const name = unitLabel(l)
  const building = rollupBuilding(l.building, name)
  return {
    id: str(l.id), name, title: str(l.title) && str(l.title) !== name ? str(l.title) : null,
    building, market: marketOf(l.building, l.address_city, name),
    active: str(l.status).toLowerCase() === 'active',
    photos: photos.length, cover: photos[0] ? photos[0].thumb : null,
  }
}
const picsOf = (raw: any): LibPhoto[] => (Array.isArray(raw) ? raw : []).map(photoOf).filter(Boolean) as LibPhoto[]

async function readAll(withIndex = false): Promise<any[]> {
  const sb = supabaseAdmin()
  const out: any[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb.from('guesty_listings')
      .select('id, nickname, title, building, status, address_city, pics:raw->pictures' + (withIndex ? ', pidx:raw->_photoIndex' : ''))
      .order('id').range(from, from + 999)
    if (error) throw new Error('guesty_listings: ' + error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function buildIndex(): Promise<LibraryIndex> {
  const listings = await readAll()
  const byB = new Map<string, LibBuilding>()
  let photos = 0, units = 0
  for (const l of listings) {
    const pics = picsOf(l.pics)
    const u = unitOf(l, pics)
    const b = byB.get(u.building) || { name: u.building, market: u.market, units: [], photos: 0 }
    b.units.push(u); b.photos += pics.length
    byB.set(u.building, b)
    photos += pics.length; units++
  }
  const buildings = Array.from(byB.values())
  for (const b of buildings) b.units.sort((a, c) => (a.active === c.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(c.name, undefined, { numeric: true }))
  buildings.sort((a, c) => a.name.localeCompare(c.name, undefined, { numeric: true }))
  return { at: new Date().toISOString(), buildings, units, photos }
}
/** Property → unit → counts and covers. Ten minutes; a listing sync changes it slowly. */
export const libraryIndex = unstable_cache(buildIndex, ['photo-library-index-v1'], { tags: [PHOTO_LIBRARY_CACHE_TAG], revalidate: 600 })

// ── HOW BIG IS THE FILE, REALLY (Jon: "high quality"). Guesty's picture objects carry no
// dimensions, and its "original" is whatever was uploaded — 1200×800 on some units, 4000+ on
// others. Cloudinary (which serves assets.guesty.com) answers `fl_getinfo` with the stored size,
// so the library can say "1200×800 · 290 KB" on every photo and the team knows when the best
// Guesty has is only web size. Read once per listing a day; a miss leaves the photo unmeasured.
export type PhotoDims = Record<string, { width: number; height: number; bytes: number | null }>
const INFO_HOST = /(^|\.)(guesty\.com|cloudinary\.com)$/i
async function readDims(photos: { id: string; url: string }[]): Promise<PhotoDims> {
  const out: PhotoDims = {}
  const todo = photos.filter(p => { try { const h = new URL(p.url).hostname; return INFO_HOST.test(h) && p.url.indexOf('/image/upload/') >= 0 } catch { return false } })
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const p = todo[i++]
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000)
        const r = await fetch(p.url.replace('/image/upload/', '/image/upload/fl_getinfo/'), { signal: ctl.signal })
        clearTimeout(t)
        if (!r.ok) continue
        const j: any = await r.json().catch(() => null)
        const w = Number(j?.input?.width || j?.output?.width), h = Number(j?.input?.height || j?.output?.height)
        if (w > 0 && h > 0) out[p.id] = { width: w, height: h, bytes: Number(j?.input?.bytes) > 0 ? Number(j.input.bytes) : null }
      } catch { /* unmeasured */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker))
  return out
}
const cachedDims = unstable_cache(async (_listingId: string, photos: { id: string; url: string }[]) => readDims(photos), ['photo-library-dims-v1'], { revalidate: 86400 })

/** One unit's photos, in the listing's order, measured where Cloudinary will say. */
export async function unitPhotos(listingId: string, opts?: { measure?: boolean }): Promise<UnitPhotos | null> {
  const { data, error } = await supabaseAdmin().from('guesty_listings')
    .select('id, nickname, title, building, status, address_city, pics:raw->pictures').eq('id', listingId).maybeSingle()
  if (error) throw new Error('guesty_listings: ' + error.message)
  if (!data) return null
  let photos = picsOf((data as any).pics)
  if (opts?.measure !== false && photos.some(p => !p.width)) {
    try {
      const dims = await cachedDims(listingId, photos.map(p => ({ id: p.id, url: p.url })))
      photos = photos.map(p => p.width ? p : (dims[p.id] ? { ...p, width: dims[p.id].width, height: dims[p.id].height } : p))
    } catch { /* unmeasured is fine */ }
  }
  return { unit: unitOf(data, photos), photos }
}

/** What the long side says about the file: at least 2000 px is print/OTA grade; 1200–1999 is web size; under that is low. */
export function resolutionGrade(w: number | null, h: number | null): 'high' | 'web' | 'low' | null {
  if (!w || !h) return null
  const long = Math.max(w, h)
  return long >= 2000 ? 'high' : long >= 1200 ? 'web' : 'low'
}

/** Every unit of a building with its photos — for the building ZIP. */
export async function buildingPhotos(building: string): Promise<UnitPhotos[]> {
  const listings = await readAll()
  const out: UnitPhotos[] = []
  for (const l of listings) {
    const photos = picsOf(l.pics)
    const u = unitOf(l, photos)
    if (u.building === building && photos.length) out.push({ unit: u, photos })
  }
  out.sort((a, c) => a.unit.name.localeCompare(c.unit.name, undefined, { numeric: true }))
  return out
}

/** The file name a photo gets inside a ZIP or on disk: "03 - king bedroom with balcony.jpg". */
export function photoFileName(p: LibPhoto, index: number, taken: Set<string>): string {
  const m = /\.(jpe?g|png|webp|heic|gif|avif)(?:[?#]|$)/i.exec(p.url)
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
  const base = String(index + 1).padStart(2, '0') + ' - ' + safeName(p.caption || 'photo', 'photo')
  let name = base + '.' + ext, n = 2
  while (taken.has(name.toLowerCase())) name = base + ' (' + (n++) + ').' + ext
  taken.add(name.toLowerCase())
  return name
}
export const zipFileName = (label: string) => safeName(label, 'photos') + ' photos.zip'

// ── SMART SEARCH (Jon, 2026-10-27: "smart search like 17west pool or elser pool"). Every word of
// the query has to land on the photo — the unit and property names, the caption as the team wrote
// it, or what the photo analysis saw (room, category, subject, selling points). "pool" also finds
// swimming and jacuzzi; "view" finds skyline and ocean (lib/photo-search has the rules and tests).
// So "elser pool" is Elser's pool shots across every Elser unit, in one grid, ready to pick.
export type PhotoHit = LibPhoto & { listingId: string; unit: string; building: string; market: string; active: boolean; why: string[] }
type CorpusRow = { p: LibPhoto; unit: LibUnit; h: Haystack }
type Corpus = { at: number; rows: CorpusRow[] }
// Module-level memo, not unstable_cache: the corpus (every photo with its words) is a few MB, well
// over the 2 MB a cache entry may hold, and it is only ever read in one place.
let corpus: Corpus | null = null
let corpusLoading: Promise<Corpus> | null = null
const CORPUS_TTL = 10 * 60 * 1000
async function loadCorpus(): Promise<Corpus> {
  if (corpus && Date.now() - corpus.at < CORPUS_TTL) return corpus
  if (corpusLoading) return corpusLoading
  corpusLoading = (async () => {
    try {
      const rows: CorpusRow[] = []
      for (const l of await readAll(true)) {
        const photos = picsOf(l.pics)
        const u = unitOf(l, photos)
        const idx = l.pidx && typeof l.pidx === 'object' ? l.pidx : {}
        for (const p of photos) rows.push({ p, unit: u, h: haystack([u.name, u.building], [p.caption].concat(analysisWords(idx[p.id]))) })
      }
      corpus = { at: Date.now(), rows }
      return corpus
    } finally { corpusLoading = null }
  })()
  return corpusLoading
}
/** Drop the memo (after a listing sync, with ?refresh=1). */
export function forgetSearchCorpus() { corpus = null }
export type PhotoSearch = { hits: PhotoHit[]; total: number; units: number; words: string[] }
export async function searchPhotos(q: string, limit = 160): Promise<PhotoSearch> {
  const ws = queryWords(q)
  if (!ws.length) return { hits: [], total: 0, units: 0, words: [] }
  const c = await loadCorpus()
  const all: PhotoHit[] = []
  for (const r of c.rows) {
    const why = matchQuery(r.h, ws)
    if (why) all.push({ ...r.p, listingId: r.unit.id, unit: r.unit.name, building: r.unit.building, market: r.unit.market, active: r.unit.active, why })
  }
  // Active units first, then by property and unit; a unit's own photo order is kept (stable sort).
  all.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.building.localeCompare(b.building, undefined, { numeric: true }) || a.unit.localeCompare(b.unit, undefined, { numeric: true }))
  // The same file on several listings (a copied listing) is one result.
  const seen = new Set<string>()
  const hits: PhotoHit[] = []
  for (const h of all) { if (seen.has(h.url)) continue; seen.add(h.url); hits.push(h) }
  const units = new Set(hits.map(h => h.listingId)).size
  return { hits: hits.slice(0, limit), total: hits.length, units, words: ws }
}
/** The search results as download sets — one folder per unit when they span more than one. */
export async function searchPhotoSets(q: string): Promise<UnitPhotos[]> {
  const r = await searchPhotos(q, 5000)
  const byUnit = new Map<string, UnitPhotos>()
  for (const h of r.hits) {
    const set = byUnit.get(h.listingId) || { unit: { id: h.listingId, name: h.unit, title: null, building: h.building, market: h.market, active: h.active, photos: 0, cover: h.thumb }, photos: [] }
    set.photos.push({ id: h.id, url: h.url, thumb: h.thumb, view: h.view, caption: h.caption, width: h.width, height: h.height })
    set.unit.photos = set.photos.length
    byUnit.set(h.listingId, set)
  }
  return Array.from(byUnit.values())
}
