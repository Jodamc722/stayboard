// Read-only availability monitor. For every ACTIVE listing, reads its Guesty calendar over the next
// ~600 days and computes the "bookable horizon" = how many days out a guest can still place a booking
// (the furthest date still inside the listing's booking window; Guesty marks dates beyond the window
// with a `bw` block). Flags any active listing whose horizon is under THRESHOLD days (target TARGET).
// Powers the Command Center alert. Does NOT change anything in Guesty. Gentle on Guesty's rate limit:
// pre-warms one token, low concurrency + jittered pacing, and a single retry pass for any failures.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getListingCalendar, dayIsAvailable, getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TARGET = 600     // days we want every active listing bookable out to
const THRESHOLD = 400  // alert if bookable horizon is under this
const CONCURRENCY = 3

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + 'T00:00:00Z').getTime()
  const b = new Date(toYmd + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

type Lst = { id: string; nickname: string | null; title: string | null; building: string | null }
type Flagged = { id: string; name: string; building: string | null; horizonDays: number; furthestDate: string | null }

// Returns horizon days, or null on failure (so the caller can retry).
async function horizonFor(l: Lst, startStr: string, endStr: string): Promise<number | null> {
  const days = await getListingCalendar(l.id, startStr, endStr)
  if (days.length === 0) return null
  let furthest: string | null = null
  for (const d of days) {
    if (d?.date && dayIsAvailable(d) && (!furthest || d.date > furthest)) furthest = d.date
  }
  return furthest ? daysBetween(startStr, furthest) : 0
}

async function runScan() {
  const sb = supabaseAdmin()
  const { data: listings, error } = await sb
    .from('guesty_listings')
    .select('id, nickname, title, building, status')
    .eq('status', 'active')
  if (error) throw new Error(error.message)
  const active = (listings ?? []) as Lst[]

  // Pre-warm a single shared token so the workers don't each trigger an auth refresh.
  try { await getToken() } catch { /* ignore */ }

  const today = new Date()
  const startStr = ymd(today)
  const endStr = ymd(new Date(today.getTime() + (TARGET + 5) * 86400000))

  const horizons = new Map<string, number>()
  const failed: Lst[] = []

  const queue = [...active]
  async function worker() {
    while (queue.length) {
      const l = queue.shift()
      if (!l) break
      try {
        const h = await horizonFor(l, startStr, endStr)
        if (h == null) failed.push(l); else horizons.set(l.id, h)
      } catch { failed.push(l) }
      await sleep(80 + Math.floor(Math.random() * 120))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, active.length || 1) }, worker))

  // One gentle retry pass (sequential, slower) for anything that rate-limited.
  const errors: string[] = []
  if (failed.length) {
    await sleep(3000)
    for (const l of failed) {
      const name = l.nickname || l.title || l.id
      try {
        const h = await horizonFor(l, startStr, endStr)
        if (h == null) errors.push(`${name}: empty calendar`); else horizons.set(l.id, h)
      } catch (e: any) {
        errors.push(`${name}: ${String(e?.message || e).slice(0, 100)}`)
      }
      await sleep(300)
    }
  }

  const flagged: Flagged[] = []
  for (const l of active) {
    const h = horizons.get(l.id)
    if (h == null) continue
    if (h < THRESHOLD) flagged.push({ id: l.id, name: l.nickname || l.title || l.id, building: l.building, horizonDays: h, furthestDate: null })
  }
  flagged.sort((a, b) => a.horizonDays - b.horizonDays)

  return {
    ok: true,
    target: TARGET,
    threshold: THRESHOLD,
    generatedAt: new Date().toISOString(),
    totalActive: active.length,
    scanned: horizons.size,
    flaggedCount: flagged.length,
    flagged,
    errorsCount: errors.length,
    errors: errors.slice(0, 10),
  }
}

const cachedScan = unstable_cache(
  async (_dayKey: string) => runScan(),
  ['availability-scan'],
  { revalidate: 21600 }
)

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  try {
    const dayKey = ymd(new Date())
    const result = refresh ? await runScan() : await cachedScan(dayKey)
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
