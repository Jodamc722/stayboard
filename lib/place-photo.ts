// Sourcing a photograph for a local spot — a restaurant, a beach, a coffee shop.
//
// This used to live inline in the guidebook generator and ran exactly once, at generation
// time. That was the whole problem: the free photo APIs sometimes return nothing for an
// obscure name, and a URL that worked in March can 404 in July. Either way the guest opens
// the book months later and finds a card with no picture, and nothing in the system ever
// tries again. Pulling the logic out here lets the generator and a small render-time
// backfill route share one implementation, so a book can repair itself.
//
// Order of preference: Pexels (better photographs, needs a key), then Openverse (keyless,
// commercially-licensed only). Nothing here is ever cached by Next's data cache — a stale
// hit would defeat the point of asking again.
import 'server-only'

// Section-appropriate scenes, used when a search for the actual place comes back empty.
// Several per section, picked by the spot's position, so a page that falls back twice does
// not print the same stock photograph in two cards.
//
// Every phrase here was checked against the keyless source for depth of results, because a
// thin query is what produces an embarrassing card. Evocative wording searches badly:
// "cocktail bar ambiance" matched twelve images and returned a stranger's hand, and
// "al fresco dining table" matched thirty-eight. Concrete nouns match hundreds and return
// the obvious thing, so every phrase below names a plain subject rather than a mood.
export const GEN: Record<string, string[]> = {
  restaurants: ['restaurant dining room', 'plate of food restaurant', 'sushi platter', 'grilled steak plate', 'pasta dish plate', 'wine glasses dinner table'],
  localPlaces: ['florida beach palm trees', 'miami beach ocean', 'sandy beach waves', 'tropical ocean pier', 'florida lighthouse coast', 'palm lined street florida'],
}

export function isPlaceSection(k: any): k is 'restaurants' | 'localPlaces' {
  return k === 'restaurants' || k === 'localPlaces'
}

/**
 * Search the free photo sources for one query. Returns a hotlinkable URL or null.
 *
 * `keyedOnly` restricts the search to Pexels. The two sources behave very differently on a
 * business name: Pexels is a stock library and answers "Maman Miami Beach" with a plausible
 * Miami scene, while Openverse indexes museum and archive collections and answers the same
 * query with Louise Bourgeois's spider sculpture, which is genuinely titled Maman. A wrong
 * subject presented as this café is worse than an honest stock photograph, so name searches
 * ask only the source that degrades gracefully.
 */
export async function imageFor(q: string, opts?: { keyedOnly?: boolean }): Promise<string | null> {
  const pex = process.env.PEXELS_API_KEY
  if (pex) {
    try {
      const r = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=1&orientation=landscape', { headers: { Authorization: pex }, cache: 'no-store' })
      const d: any = await r.json().catch(() => ({}))
      const src = d?.photos?.[0]?.src?.large
      if (src) return src
    } catch { /* fall through to Openverse */ }
  }
  if (opts?.keyedOnly) return null
  try {
    const r = await fetch('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) + '&license_type=commercial&per_page=1&mature=false', { headers: { 'User-Agent': 'StayBoardGuidebook/1.0' }, cache: 'no-store' })
    const d: any = await r.json().catch(() => ({}))
    const res = d?.results?.[0]
    // Prefer the Openverse-proxied thumbnail (reliably hotlinkable) over origin URLs.
    const u = res?.thumbnail || res?.url
    if (u) return u
  } catch { /* fall through */ }
  return null
}

/**
 * Does this URL still serve an image? A cheap HEAD, falling back to a ranged GET for hosts
 * that refuse HEAD. Worth the round trip: without it we hand the page a URL that renders as
 * a broken-image icon, which is worse than the honest fallback, and we would happily save
 * that URL for every future guest.
 */
export async function photoAlive(u?: string | null): Promise<boolean> {
  const url = String(u || '')
  if (!/^https:\/\//i.test(url)) return false
  const ok = (r: Response) => r.ok && /^image\//i.test(r.headers.get('content-type') || '')
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (ok(r)) return true
    if (r.status !== 405 && r.status !== 501 && r.status !== 403) return false
  } catch { /* try a ranged GET before giving up */ }
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal: AbortSignal.timeout(6000) })
    return ok(r)
  } catch { return false }
}

/**
 * Find a photo for one spot: the place itself first, then the place without the city, then a
 * scene that suits the section. `index` only varies which stock scene is chosen. Every
 * candidate is verified before it is returned, so callers can save the result knowing it
 * loaded at least once. Without a Pexels key the name steps are skipped entirely and every
 * card gets its section's scene — on-theme rather than wrong.
 */
export async function photoForPlace(opts: { name?: string; city?: string; section: string; index?: number }): Promise<string | null> {
  const name = String(opts.name || '').slice(0, 60).trim()
  const city = String(opts.city || '').trim()
  const gen = GEN[opts.section] || GEN.localPlaces
  // Neither source holds a photograph of the actual business, so a bare name search drifts:
  // "Maman" returns the Bourgeois sculpture, not the café. Naming the kind of place alongside it
  // pulls the result back towards something a guest would read as this restaurant.
  const kind = opts.section === 'restaurants' ? ' restaurant' : ''
  const scene = gen[Math.abs(Number(opts.index) || 0) % gen.length]
  // Name searches go to the keyed source only — see imageFor. The scene is safe to ask
  // everywhere, because it is a description of a subject rather than a proper noun.
  const named = [
    name ? name + kind + (city ? ' ' + city : ' florida') : '',
    name && city ? name + kind : '',
  ].filter(Boolean)
  for (const q of named) {
    const u = await imageFor(q, { keyedOnly: true })
    if (u && await photoAlive(u)) return u
  }
  const s = await imageFor(scene)
  if (s && await photoAlive(s)) return s
  // One retry on the scene. The keyless source throttles, and the difference between a
  // throttled request and a genuinely empty search is invisible from here — so rather than leave
  // a card blank over a moment's rate limiting, pause and ask once more for the query most
  // certain to have results.
  await new Promise(r => setTimeout(r, 700))
  const u = await imageFor(scene)
  return u && await photoAlive(u) ? u : null
}
