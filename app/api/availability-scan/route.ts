// Read-only availability monitor for the Command Center. For each ACTIVE listing we only need to know
// whether a guest could still book ~400 days out, so PASS 1 fetches a single calendar day at today+400
// (tiny payload) and checks for a `bw` (booking-window) block. Only the listings that fail get PASS 2,
// a full ~600-day read to compute their exact bookable horizon. An internal deadline guarantees the
// route always returns JSON (never a platform timeout). Does NOT change anything in Guesty.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getListingCalendar, dayIsAvailable, getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TARGET = 600
const THRESHOLD = 400
const PASS1_CONCURRENCY = 4
const PASS2_CONCURRENCY = 2
const DEADLINE_MS = 40000

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
const nameOf = (l: Lst) => l.nickname || l.title || l.id

async function pool<T>(items: T[], n: number, deadline: number, fn: (it: T) => Promise<void>) {
  const queue = [...items]
  async function worker() {
    while (queue.length && Date.now() < deadline) {
      const it = queue.shift()
      if (it === undefined) break
      await fn(it)
      await sleep(60 + Math.floor(Math.random() * 90))
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, worker))
  return queue.length // leftover (not reached before deadline)
}

async function runScan() {
  const sb = supabaseAdmin()
  const { data: listings, error } = await sb
    .from('guesty_listings')
    .select('id, nickname, title, building, status')
    .eq('status', 'active')
  if (error) throw new Error(error.message)
  const active = (listings ?? []) as Lst[]

  try { await getToken() } catch { /* prewarm */ }

  const today = new Date()
  const startStr = ymd(today)
  const probeStr = ymd(new Date(today.getTime() + THRESHOLD * 86400000))   // the +400d day
  const fullEndStr = ymd(new Date(today.getTime() + (TARGET + 5) * 86400000))
  const deadline = Date.now() + DEADLINE_MS

  // PASS 1 — single-day probe at +400d.
  const candidates: Lst[] = []
  const errors: string[] = []
  let checked = 0
  const leftover1 = await pool(active, PASS1_CONCURRENCY, deadline, async (l) => {
    try {
      const days = await getListingCalendar(l.id, probeStr, probeStr)
      checked++
      const d = days[0]
      if (!d || !dayIsAvailable(d)) candidates.push(l) // no day or beyond booking window
    } catch (e: any) {
      errors.push(`${nameOf(l)}: ${String(e?.message || e).slice(0, 90)}`)
    }
  })

  // PASS 2 — exact horizon only for flagged candidates.
  const flagged: Flagged[] = []
  await pool(candidates, PASS2_CONCURRENCY, deadline + 8000, async (l) => {
    try {
      const days = await getListingCalendar(l.id, startStr, fullEndStr)
      let furthest: string | null = null
      for (const d of days) if (d?.date && dayIsAvailable(d) && (!furthest || d.date > furthest)) furthest = d.date
      const h = furthest ? daysBetween(startStr, furthest) : 0
      flagged.push({ id: l.id, name: nameOf(l), building: l.building, horizonDays: h, furthestDate: furthest })
    } catch {
      flagged.push({ id: l.id, name: nameOf(l), building: l.building, horizonDays: -1, furthestDate: null })
    }
  })
  flagged.sort((a, b) => a.horizonDays - b.horizonDays)

  return {
    ok: true,
    target: TARGET,
    threshold: THRESHOLD,
    generatedAt: new Date().toISOString(),
    totalActive: active.length,
    checked,
    notReached: leftover1,
    flaggedCount: flagged.length,
    flagged,
    errorsCount: errors.length,
    errors: errors.slice(0, 8),
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

  const resguest = new URL(req.url).searchParams.get('resguest')
  if (resguest) {
    const sb = supabaseAdmin()
    const { data } = await sb.from('guesty_reservations').select('id, guest_name, guest_phone, source, raw').ilike('guest_name', `%${resguest}%`).limit(4)
    const out = (data || []).map((r: any) => {
      const g = (r.raw && typeof r.raw === 'object') ? (r.raw.guest || {}) : {}
      return {
        id: r.id, name: r.guest_name, source: r.source, mapped_phone: r.guest_phone,
        guestKeys: Object.keys(g),
        g_phone: g.phone ?? null, g_phones: g.phones ?? null, g_contactPhone: g.contactPhone ?? null,
        g_phoneNumbers: g.phoneNumbers ?? null, g_hometown: g.hometown ?? null, guestId: g._id ?? g.id ?? null,
        raw_top_phone: (r.raw || {}).phone ?? (r.raw || {}).guestPhone ?? null,
      }
    })
    return NextResponse.json({ count: out.length, out })
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
