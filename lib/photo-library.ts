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

export const PHOTO_LIBRARY_CACHE_TAG = 'photo-library'
const str = (v: any) => (v == null ? '' : String(v)).trim()
const httpish = (u: any): string => { const s = str(u); return /^https:\/\//i.test(s) ? s : '' }

export type LibPhoto = {
  id: string
  /** The full-size file — what downloads. */
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

async function readAll(): Promise<any[]> {
  const sb = supabaseAdmin()
  const out: any[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb.from('guesty_listings')
      .select('id, nickname, title, building, status, address_city, pics:raw->pictures')
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

/** One unit's photos, in the listing's order. */
export async function unitPhotos(listingId: string): Promise<UnitPhotos | null> {
  const { data, error } = await supabaseAdmin().from('guesty_listings')
    .select('id, nickname, title, building, status, address_city, pics:raw->pictures').eq('id', listingId).maybeSingle()
  if (error) throw new Error('guesty_listings: ' + error.message)
  if (!data) return null
  const photos = picsOf((data as any).pics)
  return { unit: unitOf(data, photos), photos }
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
