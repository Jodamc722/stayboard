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
  const out: Record<string, string> = {}
  try {
    const { data } = await supabaseAdmin().from('guesty_listings')
      .select('nickname,title,building,pictures,status')
      .not('pictures', 'is', null).limit(2000)
    const rows = ((data as any[]) || [])
      .filter(l => !/inactive|archived|deleted/i.test(String(l.status || '')))
      .sort((a, b) => String(a.nickname || a.title || '').localeCompare(String(b.nickname || b.title || '')))
    for (const l of rows) {
      const b = buildingOf(l.building, l.nickname || l.title)
      const pic = Array.isArray(l.pictures) ? l.pictures.find((p: any) => typeof p === 'string' && /^https?:/.test(p)) : null
      if (b && pic && !out[b]) out[b] = pic
    }
  } catch { /* the slide renders with blank tiles; Change still works */ }
  return out
}

/** Fill only the blank `pic` fields of the properties list, by canonical building label. */
export function fillPropertyPics<T extends { b?: string; pic?: string | null }>(items: T[], photos: Record<string, string>): T[] {
  return items.map(it => (it.pic || !it.b || !photos[it.b]) ? it : { ...it, pic: photos[it.b] })
}
