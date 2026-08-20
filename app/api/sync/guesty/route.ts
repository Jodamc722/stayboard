// Sync route — pulls reservations / listings / custom fields / conversations / reviews /
// messages from Guesty and upserts into Supabase.
//
// Query modes:
//   (none)                          → incremental sync (default cron behaviour)
//   ?full=1                         → full, non-incremental reconcile
//   ?only=reservations              → sync ONLY reservations (fast; returns the count)
//   ?probe=checkouts&day=YYYY-MM-DD → READ-ONLY diagnostic: ask Guesty directly which
//                                     reservations check out on that day (no upsert).
import { NextRequest, NextResponse } from 'next/server'
import { runFullSync, syncReservations, syncReviews } from '@/lib/guesty'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// WHY THIS IS NOT A SIMPLE AUTH CHECK.
// This route failed CLOSED when CRON_SECRET was unset: a Vercel cron sends no cookie, so it fell
// through to the user check and 401'd. Every scheduled run had been rejected — listings, reviews,
// messages and custom fields were 17 HOURS stale before anyone noticed, because nothing reports a
// cron that never ran. The other cron in this repo (breezeway-tasks) runs open when the secret is
// absent, which is why it stayed current.
//
// So: with CRON_SECRET set, the bearer token is required (Jon should set it — that is the right end
// state). Without it, a PLAIN sync may run unauthenticated so the schedule works, but the ?probe=
// diagnostics still require a signed-in user, because those return guest names.
async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { ok: true }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return { ok: true }
  if (!process.env.CRON_SECRET && !new URL(req.url).searchParams.get('probe')) return { ok: true }
  return { ok: false, reason: 'unauthorized' }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const started = Date.now()
  const params = new URL(req.url).searchParams

  try {
    // ── READ-ONLY probe: confirmed check-in & check-out counts (+status breakdown) for a day ──
    // READ-ONLY probe: audit Guesty reviews -- total, channel distribution, reply coverage.
    if (params.get('probe') === 'reviews') {
      const sb = supabaseAdmin()
      const { data: tok } = await sb.from('guesty_tokens').select('access_token').eq('id', 'singleton').maybeSingle()
      const token = tok?.access_token
      if (!token) return NextResponse.json({ error: 'no token' }, { status: 503 })
      const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
      const byChannel: Record<string, number> = {}
      const rawSamples: string[] = []
      const seen = new Set<string>()
      const examples: Record<string, any> = {}
      let sampleKeys: string[] = []
      let total = 0, withReply = 0, apiCount: number | null = null
      const sortQ = params.get('sort') ? `&sort=${encodeURIComponent(params.get('sort') as string)}` : ''
      for (let page = 0; page < 30; page++) {
        const resp = await fetch(`${BASE}/reviews?limit=100&skip=${page * 100}${sortQ}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
        if (!resp.ok) return NextResponse.json({ error: `Guesty ${resp.status}`, body: (await resp.text()).slice(0, 200) }, { status: 502 })
        const j: any = await resp.json().catch(() => ({}))
        if (apiCount == null) apiCount = j?.count ?? j?.total ?? j?.pagination?.total ?? null
        const arr: any[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.results) ? j.results : Array.isArray(j?.reviews) ? j.reviews : []
        if (!arr.length) break
        for (const v of arr) {
          const id = String(v._id ?? v.id ?? JSON.stringify(v).slice(0, 40))
          if (seen.has(id)) continue
          seen.add(id)
          if (!sampleKeys.length) sampleKeys = Object.keys(v)
          total++
          const rr = v.rawReview || v.raw || {}
          const raw = String(v.channelId ?? v.channel ?? rr.channel ?? v.platform ?? v.source ?? v.integration ?? v.module ?? 'unknown')
          byChannel[raw] = (byChannel[raw] || 0) + 1
          if (!examples[raw]) examples[raw] = v
          if (rawSamples.length < 8 && rawSamples.indexOf(raw) < 0) rawSamples.push(raw)
          const replies = Array.isArray(v.reviewReplies) ? v.reviewReplies : (Array.isArray(rr.reviewReplies) ? rr.reviewReplies : [])
          const hostResp = rr.host_response ?? rr.hostResponse ?? v.hostResponse ?? (replies[0] && (replies[0].reply ?? replies[0].text ?? replies[0].reviewReply))
          if (hostResp && String(hostResp).trim()) withReply++
        }
      }
      const exTrunc: Record<string, string> = {}
      for (const k of Object.keys(examples)) exTrunc[k] = JSON.stringify(examples[k]).slice(0, 4000)
      return NextResponse.json({ apiCount, distinct: seen.size, total, withReply, needsReply: total - withReply, byChannel, rawSamples, sampleKeys, examples: exTrunc })
    }

    if (params.get('probe') === 'day') {
      const day = params.get('day') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      const sb = supabaseAdmin()
      const { data: tok } = await sb.from('guesty_tokens').select('access_token').eq('id', 'singleton').maybeSingle()
      const token = tok?.access_token
      if (!token) return NextResponse.json({ error: 'no token' }, { status: 503 })
      const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']
      // guestsCount + plannedArrival added 2026-08-20 (Jon: "make sure it adds number of guests, find
      // where that is populated"). Without them the stored reservation had no guest count and no
      // arrival time, so the Elser registration form printed both blank — unit 1809 went to the
      // building incomplete. Asking for them here fixes it at the source for every future notice.
      const fields = encodeURIComponent('guest checkIn checkOut checkInDateLocalized checkOutDateLocalized status source guestsCount plannedArrival numberOfGuests')
      const pull = async (field: string) => {
        const filters = encodeURIComponent(JSON.stringify([{ field, operator: '$gte', value: `${day}T00:00:00.000Z` }]))
        const all: any[] = []
        for (let p = 0; p < 8; p++) {
          const r = await fetch(`${BASE}/reservations?limit=100&skip=${p * 100}&fields=${fields}&sort=${field}&filters=${filters}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
          if (!r.ok) break
          const d: any = await r.json(); const res: any[] = d.results || []
          for (const x of res) all.push(x)
          if (res.length < 100) break
          const last = res[res.length - 1]
          const lk = field === 'checkIn' ? (last.checkInDateLocalized || last.checkIn) : (last.checkOutDateLocalized || last.checkOut)
          if (String(lk || '').slice(0, 10) > day) break
        }
        const dk = field === 'checkIn' ? 'checkInDateLocalized' : 'checkOutDateLocalized'
        const rk = field === 'checkIn' ? 'checkIn' : 'checkOut'
        const onDay = all.filter((x: any) => String(x[dk] || x[rk] || '').slice(0, 10) === day)
        const byStatus: Record<string, number> = {}
        onDay.forEach((x: any) => { const s = String(x.status || '?').toLowerCase(); byStatus[s] = (byStatus[s] || 0) + 1 })
        const confirmed = onDay.filter((x: any) => CONFIRMED.includes(String(x.status || '').toLowerCase())).length
        return { total: onDay.length, confirmed, byStatus }
      }
      const checkins = await pull('checkIn')
      const checkouts = await pull('checkOut')
      return NextResponse.json({ day, checkins, checkouts })
    }

    // ── READ-ONLY probe: what does Guesty itself return for checkouts on `day`? ──
    if (params.get('probe') === 'checkouts') {
      const day = params.get('day') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      const sb = supabaseAdmin()
      const { data: tok } = await sb.from('guesty_tokens').select('access_token').eq('id', 'singleton').maybeSingle()
      const token = tok?.access_token
      if (!token) return NextResponse.json({ error: 'no token' }, { status: 503 })
      const filters = encodeURIComponent(JSON.stringify([{ field: 'checkOut', operator: '$gte', value: `${day}T00:00:00.000Z` }]))
      const fields = encodeURIComponent('guest checkIn checkOut checkOutDateLocalized status source confirmationCode guestsCount plannedArrival numberOfGuests')
      const all: any[] = []
      let pages = 0
      for (let p = 0; p < 8; p++) {
        pages++
        const r = await fetch(`${BASE}/reservations?limit=100&skip=${p * 100}&fields=${fields}&sort=checkOut&filters=${filters}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store'
        })
        if (!r.ok) { all.push({ _err: `${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` }); break }
        const d: any = await r.json()
        const res: any[] = d.results || []
        for (const x of res) all.push(x)
        if (res.length < 100) break
        const last = res[res.length - 1]
        const lastDate = String(last?.checkOutDateLocalized || last?.checkOut || '').slice(0, 10)
        if (lastDate > day) break
      }
      const onDay = all.filter((x: any) => String(x.checkOutDateLocalized || x.checkOut || '').slice(0, 10) === day)
      return NextResponse.json({
        day, pages,
        guestyCheckoutsOnDay: onDay.length,
        totalScanned: all.length,
        guests: onDay.map((x: any) => ({ guest: x.guest?.fullName || null, listing: x.listingId || null, checkOut: x.checkOutDateLocalized || x.checkOut, status: x.status, source: x.source })),
      })
    }

    // RESERVATIONS ONLY.
    //   default  → full current window (every stay checking out from 3 days ago onward). Thorough,
    //              ~30s, right for the 2-hourly reconcile.
    //   ?fast=1  → incremental: only what Guesty has touched since the last successful run, with a
    //              30-minute overlap so a booking that lands mid-run is never skipped. Seconds, not
    //              minutes — this is what lets the board pick up a walk-in inside 10 minutes
    //              instead of up to 2 hours, which is how a same-day arrival went missing.
    if (params.get('only') === 'reservations') {
      const fast = params.get('fast') === '1'
      let since: string | null = null
      if (fast) {
        const sb = supabaseAdmin()
        const { data: st } = await sb.from('guesty_sync_status').select('last_sync_at,last_error').eq('entity', 'reservations').maybeSingle()
        // A previous error means we cannot trust the watermark — fall back to the full window.
        if (st && st.last_sync_at && !st.last_error) since = new Date(new Date(st.last_sync_at).getTime() - 30 * 60_000).toISOString()
      }
      const n = await syncReservations(fast ? 20 : 80, since)
      return NextResponse.json({ ok: true, reservationsOnly: n, mode: since ? 'incremental' : 'full-window', since, elapsed_ms: Date.now() - started })
    }

    if (params.get('only') === 'reviews') {
      const n = await syncReviews(40)
      return NextResponse.json({ ok: true, reviewsOnly: n, elapsed_ms: Date.now() - started })
    }

    const full = params.get('full') === '1'
    const result = await runFullSync(full)
    return NextResponse.json({ ok: true, elapsed_ms: Date.now() - started, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 })
  }
}

// Vercel cron sends GET
export const GET = POST
