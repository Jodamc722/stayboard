// CHANNEL CONNECTIONS — the data behind /channels (Jon, 2026-09-18).
//
// GET → the full health picture (every active listing × nine channels) plus when the trigger last
// compared it. Cached ten minutes under the 'channels' tag; POST /api/channels/check busts it, so a
// Refresh shows the new state immediately and a plain page load never walks 290 listings twice in
// ten minutes.
import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { buildChannelHealth, readSnapshot } from '@/lib/channel-health'
import { CHANNELS_CACHE_TAG } from '@/lib/channel-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const cachedHealth = unstable_cache(async () => buildChannelHealth(), ['channel-health-v1'], { tags: [CHANNELS_CACHE_TAG], revalidate: 600 })

export async function GET() {
  const g = await requireLevel('channels', 'view')
  if (!g.ok) return g.res
  try {
    const [health, snap] = await Promise.all([cachedHealth(), readSnapshot()])
    return NextResponse.json({ ok: true, ...health, snapshotAt: snap ? snap.at : null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
