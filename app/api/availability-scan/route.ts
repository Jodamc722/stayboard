// Read-only availability monitor. For every ACTIVE listing, reads its Guesty calendar over the next
// ~600 days and computes the "bookable horizon" = how many days out a guest can still book (the
// furthest available date from today within the window). Flags any active listing whose horizon is
// under THRESHOLD days (target OPEN). Powers the Command Center alert. Does NOT change anything.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getListingCalendar, dayIsAvailable } from '@/lib/guesty'
import { getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TARGET = 600     // days we want every active listing bookable out to
const THRESHOLD = 400  // alert if bookable horizon is under this
const CONCURRENCY = 8

function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + 'T00:00:00Z').getTime()
  const b = new Date(toYmd + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

type Flagged = { id: string; name: string; building: string | null; horizonDays: number; furthestDate: string | null }

async function runScan() {
  const sb = supabaseAdmin()
  const { data: listings, error } = await sb
    .from('guesty_listings')
    .select('id, nickname, title, building, status')
    .eq('status', 'active')
  if (error) throw new Error(error.message)
  const active = listings ?? []

  const today = new Date()
  const startStr = ymd(today)
  const end = new Date(today.getTime() + (TARGET + 5) * 86400000)
  const endStr = ymd(end)

  const flagged: Flagged[] = []
  const errors: string[] = []
  let scanned = 0

  const queue = [...active]
  async function worker() {
    while (queue.length) {
      const l = queue.shift()
      if (!l) break
      const name = l.nickname || l.title || l.id
      try {
        const days = await getListingCalendar(l.id, startStr, endStr)
        let furthest: string | null = null
        for (const d of days) {
          if (d?.date && dayIsAvailable(d)) {
            if (!furthest || d.date > furthest) furthest = d.date
          }
        }
        const horizonDays = furthest ? daysBetween(startStr, furthest) : 0
        scanned++
        if (horizonDays < THRESHOLD) {
          flagged.push({ id: l.id, name, building: l.building ?? null, horizonDays, furthestDate: furthest })
        }
      } catch (e: any) {
        errors.push(`${name}: ${String(e?.message || e).slice(0, 120)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, active.length || 1) }, worker))

  flagged.sort((a, b) => a.horizonDays - b.horizonDays)
  return {
    ok: true,
    target: TARGET,
    threshold: THRESHOLD,
    generatedAt: new Date().toISOString(),
    totalActive: active.length,
    scanned,
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

  const probe = new URL(req.url).searchParams.get('probe')
  if (probe) {
    try {
      const t = new Date(); const sD = ymd(t); const eD = ymd(new Date(t.getTime() + 600 * 86400000))
      const tok = await getToken()
      const rr = await fetch(`https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings/minified/${probe}?startDate=${sD}&endDate=${eD}&includeAllotment=true&view=compact`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
      const j = JSON.parse(await rr.text())
      const cal: any[] = j?.data?.days?.calendar || j?.data?.calendar || []
      const tally: Record<string, number> = {}
      let furthestNoBw: string | null = null
      let furthestNoBlocks: string | null = null
      for (const d of cal) {
        const bl = d?.blocks || {}
        for (const k of Object.keys(bl)) { if (bl[k]) tally[k] = (tally[k] || 0) + 1 }
        if (!bl.bw && d?.date) furthestNoBw = d.date
        const anyBlock = Object.keys(bl).some(k => bl[k])
        if (!anyBlock && d?.date) furthestNoBlocks = d.date
      }
      return NextResponse.json({ status: rr.status, calLen: cal.length, firstDay: cal[0], lastDay: cal[cal.length - 1], blockKeyTally: tally, furthestNoBw, furthestNoBlocks })
    } catch (e: any) { return NextResponse.json({ probeError: String(e?.message || e).slice(0, 500) }, { status: 200 }) }
  }

  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  try {
    const dayKey = ymd(new Date())
    const result = refresh ? await runScan() : await cachedScan(dayKey)
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
