// THE PHOTOGRAPHS THAT INTRODUCE EACH SECTION.
//
// Jon, 2026-09-22, asked for the owner review to borrow the onboarding deck's visual language, and
// the single biggest difference between the two is photography: the onboarding deck carries 32
// images across its length and the review carried exactly one, the hero. Six screens of data cards
// with no picture of the thing being discussed is a spreadsheet with a cover.
//
// RESOLVED AT RENDER, NOT STORED. The photos are looked up from the listings the report already
// names (content.byListing) rather than written into the report when it is generated. That is what
// lets the six reviews that already exist gain section photography the moment this deploys, which
// was the condition of rebuilding in place. It costs one indexed query per page load.
//
// ONE UNIT PER SECTION, WHERE THERE ARE ENOUGH UNITS. Taking the first six photos of the portfolio
// would show the same apartment six times — 17WEST alone has 26 listings and its first listing has
// dozens of pictures. Round-robin across listings first, THEN depth, so a six-section review of a
// 26-unit building shows six different apartments and a single-unit review shows six rooms.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** A photo is skipped when it is obviously not a room — floor plans and collages read as clip art. */
const BAD = /(floor\s*-?plan|floorplan|collage|logo|watermark|map)/i

export async function reportGallery(content: any, limit = 8): Promise<string[]> {
  const byListing: any[] = Array.isArray(content?.byListing) ? content.byListing : []
  const ids = byListing.map(l => String(l?.id || '')).filter(Boolean)
  if (!ids.length) return []
  // Biggest earners first: byListing is revenue-ordered, so the units an owner cares about lead.
  const wanted = ids.slice(0, 40)
  let rows: any[] = []
  try {
    const { data } = await supabaseAdmin()
      .from('guesty_listings').select('id,pictures').in('id', wanted).limit(40)
    rows = (data as any[]) || []
  } catch { return [] }

  const byId = new Map<string, string[]>()
  for (const r of rows) {
    const pics: string[] = (Array.isArray(r.pictures) ? r.pictures : [])
      .map((p: any) => String(typeof p === 'string' ? p : (p?.original || p?.regular || p?.thumbnail || '')))
      .filter((u: string) => !!u && /^https?:\/\//i.test(u) && !BAD.test(u))
    if (pics.length) byId.set(String(r.id), pics)
  }

  // Round-robin: one photo from each listing, in the report's own order, then a second from each.
  const order = wanted.filter(id => byId.has(id))
  const out: string[] = []
  const seen = new Set<string>()
  for (let depth = 0; depth < 6 && out.length < limit; depth++) {
    for (const id of order) {
      if (out.length >= limit) break
      const url = (byId.get(id) || [])[depth]
      if (!url || seen.has(url)) continue
      seen.add(url); out.push(url)
    }
  }
  return out
}
