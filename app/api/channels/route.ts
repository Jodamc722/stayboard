// CHANNEL CONNECTIONS — the data behind /channels (Jon, 2026-09-18).
//
// GET → the full health picture (every active listing × nine channels) plus when the trigger last
// compared it. Cached ten minutes under the 'channels' tag; POST /api/channels/check busts it, so a
// Refresh shows the new state immediately and a plain page load never walks 290 listings twice in
// ten minutes.
//
// GET ?slim=1 → the Today tile's read (SPEED, Jon 2026-11-20). The same cached picture, cut to what
// the tile prints: how many active listings there are, and the ones with a problem on a major
// channel, each with only its cells that are not live. The full answer is every listing × nine
// channels with URLs and booking dates (~600KB for 318 listings) — Today downloaded and parsed all
// of it on every open to print one count, and it was too big for the browser to remember, so the
// tile never painted from the device copy. The /channels page does not pass it and gets everything.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { buildChannelHealth, readSnapshot } from '@/lib/channel-health'
import { CHANNELS_CACHE_TAG } from '@/lib/channel-check'
import { isProblem } from '@/lib/channel-types'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const cachedHealth = unstable_cache(async () => buildChannelHealth(), ['channel-health-v1'], { tags: [CHANNELS_CACHE_TAG], revalidate: 600 })

export async function GET(req: NextRequest) {
  const g = await requireLevel('channels', 'view')
  if (!g.ok) return g.res
  try {
    if (req.nextUrl.searchParams.get('slim')) {
      const health = await cachedHealth()
      const listings = health.listings.filter(l => isProblem(l.verdict)).map(l => {
        const cells: Record<string, { verdict: string; status: string | null }> = {}
        for (const k of Object.keys(l.cells || {})) { const c = l.cells[k]; if (c && c.verdict !== 'live') cells[k] = { verdict: c.verdict, status: c.status } }
        return { id: l.id, name: l.name, building: l.building, verdict: l.verdict, missingMajor: l.missingMajor, cells }
      })
      return NextResponse.json({ ok: true, at: health.at, total: health.listings.length, listings })
    }
    const [health, snap] = await Promise.all([cachedHealth(), readSnapshot()])
    return NextResponse.json({ ok: true, ...health, snapshotAt: snap ? snap.at : null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
