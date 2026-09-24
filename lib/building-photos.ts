// A PICTURE FOR EACH PROPERTY ON THE "OUR PROPERTIES" SLIDE.
//
// Boss (2026-09-24, via Jon): "make the whole slide our properties with a pic next to each one."
// The pictures already exist — every listing we run on Guesty carries its own photo set — so the
// slide takes the first picture of the first active listing in each building rather than waiting
// for somebody to upload eleven photos by hand. A building we do not list on Guesty (the Garden,
// the Monroe) comes back with nothing and the editor's Change chip is the answer there.
//
// Deterministic: listings sorted by nickname so the same building shows the same picture on every
// deck, and an upload in the editor always wins (the caller only fills BLANK pics).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildingOf } from '@/lib/segments'

export async function buildingPhotos(): Promise<Record<string, string>> {
  const pools = await buildingPhotoPools(1)
  const out: Record<string, string> = {}
  for (const b of Object.keys(pools)) if (pools[b][0]) out[b] = pools[b][0]
  return out
}

/**
 * Every building's pictures, up to `perBuilding` each, first listing first — the gallery the
 * editor chooses from (Jon, 2026-09-24: "add photo of the properties, let me select and be able
 * to save"). Spread across listings so the choice is not thirty shots of one studio.
 */
export type ListingPics = { id: string; name: string; pics: string[] }
/** Each building's listings with their own pictures — "select from the listing, for each" (Jon). */
export async function buildingListingPhotos(perListing = 12): Promise<Record<string, ListingPics[]>> {
  const out: Record<string, ListingPics[]> = {}
  try {
    const { data } = await supabaseAdmin().from('guesty_listings')
      .select('id,nickname,title,building,pictures,status')
      .not('pictures', 'is', null).limit(2000)
    const rows = ((data as any[]) || [])
      .filter(l => !/inactive|archived|deleted/i.test(String(l.status || '')))
      .sort((a, b) => String(a.nickname || a.title || '').localeCompare(String(b.nickname || b.title || '')))
    for (const l of rows) {
      const b = buildingOf(l.building, l.nickname || l.title)
      const pics = Array.isArray(l.pictures) ? l.pictures.filter((p: any) => typeof p === 'string' && /^https?:/.test(p)).slice(0, perListing) : []
      if (b && pics.length) (out[b] = out[b] || []).push({ id: String(l.id), name: String(l.nickname || l.title || ''), pics })
    }
  } catch { /* nothing to choose from; upload still works */ }
  return out
}

export async function buildingPhotoPools(perBuilding = 24): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  try {
    const { data } = await supabaseAdmin().from('guesty_listings')
      .select('nickname,title,building,pictures,status')
      .not('pictures', 'is', null).limit(2000)
    const rows = ((data as any[]) || [])
      .filter(l => !/inactive|archived|deleted/i.test(String(l.status || '')))
      .sort((a, b) => String(a.nickname || a.title || '').localeCompare(String(b.nickname || b.title || '')))
    const perListing: Record<string, string[][]> = {}
    for (const l of rows) {
      const b = buildingOf(l.building, l.nickname || l.title)
      const pics = Array.isArray(l.pictures) ? l.pictures.filter((p: any) => typeof p === 'string' && /^https?:/.test(p)).slice(0, 8) : []
      if (b && pics.length) (perListing[b] = perListing[b] || []).push(pics)
    }
    // Round-robin: the first picture of every listing, then the second of every listing, and so on.
    for (const b of Object.keys(perListing)) {
      const lists = perListing[b], seen = new Set<string>(), picks: string[] = []
      for (let i = 0; picks.length < perBuilding; i++) {
        let any = false
        for (const pics of lists) { const u = pics[i]; if (u) { any = true; if (!seen.has(u)) { seen.add(u); picks.push(u); if (picks.length >= perBuilding) break } } }
        if (!any) break
      }
      out[b] = picks
    }
  } catch { /* the slide renders with blank tiles; Change still works */ }
  return out
}

/** Fill only the blank `pic` fields of the properties list, by canonical building label. */
export function fillPropertyPics<T extends { b?: string; pic?: string | null }>(items: T[], photos: Record<string, string>): T[] {
  return items.map(it => (it.pic || !it.b || !photos[it.b]) ? it : { ...it, pic: photos[it.b] })
}
