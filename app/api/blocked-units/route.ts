// BLOCKED UNITS — every unit that cannot be sold, and why (Jon, 2026-08-10: "we need to show all
// blocked units, that way we can identify what needs to be done and stay on top. That would be
// urgent. Need to pull that data from Guesty multi cal").
//
// WHY THIS MATTERS OPERATIONALLY. A blocked night is revenue that is already gone, and unlike a
// bad review nobody gets notified about it. Units go out of service for a repair, an owner stay,
// a deep clean or a photo shoot, and then the block quietly outlives the reason — the tech
// finished on Tuesday and the calendar is still shut through the end of the month. This endpoint
// exists so that a block has to be justified every morning instead of never.
//
// WHAT COUNTS AS BLOCKED. Guesty puts reservations and manual blocks on the same "unavailable"
// day status, so the reservation markers are excluded explicitly (lib/guesty isOpsBlock) — what
// is left is somebody at this company having taken the unit off the market. Booking-window and
// advance-notice flags are excluded too: those are pricing policy, not units out of service.
//
// ?days=N       how far ahead to look (default 30, max 120)
// ?raw=1        admins only: the first raw calendar days, for checking the Guesty shape by eye
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMultiCalendar, isOpsBlock } from '@/lib/guesty'
import { marketOf, buildingOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const str = (v: any) => (v == null ? '' : String(v))
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export type BlockedRun = {
  listingId: string
  unit: string
  building: string
  market: string
  from: string
  to: string
  nights: number
  startsInDays: number   // negative/0 = live right now
  live: boolean          // the unit is out of service TODAY
  reason: string         // best guess at why, from the block flags and any note
  note: string | null
  keys: string[]         // the raw Guesty block flags, so nothing is hidden behind our labels
}

// Human labels for Guesty's block flags. Anything unrecognised is passed through verbatim rather
// than being swallowed — an unknown reason the team can see beats a tidy one that is wrong.
const REASON: Record<string, string> = {
  m: 'Manual block', o: 'Owner stay', ow: 'Owner stay', b: 'Blocked',
  bd: 'Blocked by another listing', sr: 'Same-unit reservation', mt: 'Maintenance',
  cl: 'Cleaning hold', bw: 'Beyond booking window', a: 'Advance notice',
}
function reasonOf(keys: string[], note: string | null): string {
  const named = keys.map(k => REASON[k]).filter(Boolean)
  const base = named.length ? Array.from(new Set(named)).join(' + ')
    : (keys.length ? 'Blocked (' + keys.join(', ') + ')' : 'Blocked')
  const n = (note || '').trim()
  return n ? base + ' — ' + n : base
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const days = Math.min(Math.max(Number(sp.get('days')) || 30, 1), 120)
  const today = ymd(new Date())
  const end = addDays(today, days)

  try {
    const db = supabaseAdmin()
    const { data: rows } = await db.from('guesty_listings')
      .select('id,nickname,title,building,address_city,status').limit(2000)
    const listings = ((rows || []) as any[]).filter(l => !DEAD.includes(str(l.status).toLowerCase()))
    const meta: Record<string, { unit: string; building: string; market: string }> = {}
    for (const l of listings) {
      const nm = l.nickname || l.title || String(l.id)
      meta[String(l.id)] = {
        unit: nm,
        building: buildingOf(str(l.building), nm) || 'Other',
        market: String(marketOf(l.building, l.address_city, nm) || 'Miami'),
      }
    }

    const cal = await getMultiCalendar(Object.keys(meta), today, end)
    if (sp.get('raw')) {
      if (!gate.access || gate.access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
      return NextResponse.json({ ok: true, sampled: cal.length, sample: cal.slice(0, 40).map(d => d.raw) })
    }

    // One row per unit per unbroken run of blocked nights. A unit blocked the 4th to the 9th is
    // one problem to solve, not six — the brief has to read like a worklist, not a log.
    const blocked = cal.filter(isOpsBlock)
    const byUnit: Record<string, typeof blocked> = {}
    for (const d of blocked) (byUnit[d.listingId] = byUnit[d.listingId] || []).push(d)

    const runs: BlockedRun[] = []
    for (const lid of Object.keys(byUnit)) {
      const m = meta[lid]
      if (!m) continue
      const daysSorted = byUnit[lid].slice().sort((a, b) => a.date.localeCompare(b.date))
      let cur: { from: string; to: string; keys: Set<string>; note: string | null } | null = null
      const flush = () => {
        if (!cur) return
        const nights = Math.round((new Date(cur.to + 'T12:00:00').getTime() - new Date(cur.from + 'T12:00:00').getTime()) / 86400000) + 1
        const startsInDays = Math.round((new Date(cur.from + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000)
        const keys = Array.from(cur.keys)
        runs.push({
          listingId: lid, unit: m.unit, building: m.building, market: m.market,
          from: cur.from, to: cur.to, nights, startsInDays,
          live: cur.from <= today && cur.to >= today,
          reason: reasonOf(keys, cur.note), note: cur.note, keys,
        })
        cur = null
      }
      for (const d of daysSorted) {
        const on = Object.keys(d.blocks || {}).filter(k => {
          const v = (d.blocks as any)[k]; return v === true || (v && typeof v === 'object')
        })
        if (cur && addDays(cur.to, 1) === d.date) {
          cur.to = d.date
          on.forEach(k => cur!.keys.add(k))
          if (!cur.note && d.note) cur.note = d.note
        } else {
          flush()
          cur = { from: d.date, to: d.date, keys: new Set(on), note: d.note }
        }
      }
      flush()
    }
    // Live blocks first, then the longest — the unit that has been shut the longest is the one
    // most likely to be a block nobody remembers creating.
    runs.sort((a, b) => Number(b.live) - Number(a.live) || b.nights - a.nights || a.from.localeCompare(b.from))

    const byMarket: Record<string, { units: number; nights: number }> = {}
    for (const r of runs) {
      const e = byMarket[r.market] = byMarket[r.market] || { units: 0, nights: 0 }
      e.units += 1; e.nights += r.nights
    }
    return NextResponse.json({
      ok: true, from: today, to: end, days,
      listingsChecked: Object.keys(meta).length,
      calendarDays: cal.length,
      liveNow: runs.filter(r => r.live).length,
      upcoming: runs.filter(r => !r.live).length,
      nightsBlocked: runs.reduce((a, r) => a + r.nights, 0),
      byMarket,
      runs,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
