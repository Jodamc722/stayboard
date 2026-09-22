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

/**
 * Takes the whole owner_reports ROW, not its content.
 *
 * The first cut read content.byListing and shipped with zero photos on every existing review,
 * because byListing is optional and none of the live reports carry it — the per-unit table is
 * written only when the report is generated with it. `listing_ids` is a column on the report
 * itself and is populated on all of them, which is the difference between a feature that works on
 * the six reports that exist and one that only works on reports generated from now on.
 */
export async function reportGallery(report: any, limit = 8): Promise<string[]> {
  const fromRow: any[] = Array.isArray(report?.listing_ids) ? report.listing_ids : []
  const byListing: any[] = Array.isArray(report?.content?.byListing) ? report.content.byListing : []
  const ids = (fromRow.length ? fromRow.map((x: any) => String(x || '')) : byListing.map(l => String(l?.id || '')))
    .filter(Boolean)
  if (!ids.length) return []
  // In the report's own order — revenue-ordered when it came from byListing, scope order otherwise.
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
