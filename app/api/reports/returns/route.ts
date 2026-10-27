// REAL RETURNS BY BUILDING — the number Nick is asked for on every call.
// GET /api/reports/returns?months=12&buildings=District%20225,Nomad
//
// Nick Carline's brief, 2026-10-27: "Real returns by building. Annual gross, occupancy and nightly
// rate for the buildings we run (District 225, NoMad, Elser, Arya, the Amrit). District 225 is
// urgent: I have a realtor whose owner there is unhappy with their current manager."
//
// One row per building, twelve months, from the reservation mirror: units, gross revenue,
// occupancy, ADR, RevPAR, nights, and gross per unit. Revenue only — there is no expense figure
// anywhere in reach of this route, which is what makes it something a broker can forward.
//
// WHY NOT THE STATEMENTS HERE. The statement is the right source for what an OWNER banked (see
// lib/sales-proof's ownerRevenueRows, which the proof slide uses). It cannot answer occupancy,
// because the ledger carries no availability denominator — and occupancy is half of what Nick is
// asked for. So this route answers the performance question from the bookings, and the proof slide
// answers the earnings question from the statements, and each says which it is.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pullReservations, metricsFor, fmtK, etToday } from '@/lib/owner-report'
import { basisTriple } from '@/lib/basis'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketLabel, marketOf } from '@/lib/segments'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function monthsBack(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'view')
  if (!gate.ok) return gate.res

  const sp = new URL(req.url).searchParams
  const months = Math.max(1, Math.min(36, Number(sp.get('months')) || 12))
  const only = str(sp.get('buildings')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('to'))) ? str(sp.get('to')) : etToday()
  const from = monthsBack(to, months)

  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status').limit(1000)
  const live = ((data || []) as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    // A combined "Full" listing is one apartment sold twice — it would double the building.
    return !/\bfull\b/i.test(str(l.nickname || l.title || l.id))
  })

  const byBuilding: Record<string, any[]> = {}
  for (const l of live) {
    const b = rollupBuilding(str(l.building))
    if (!b) continue
    if (only.length && only.indexOf(b.toLowerCase()) < 0) continue
    ;(byBuilding[b] = byBuilding[b] || []).push(l)
  }
  const names = Object.keys(byBuilding)
  if (!names.length) return NextResponse.json({ error: 'No buildings matched.' }, { status: 400 })

  // One pull for every listing in scope, then split by building — a query per building would be
  // twenty round trips to say the same thing.
  const allIds = live.filter(l => names.indexOf(rollupBuilding(str(l.building))) >= 0).map(l => String(l.id))
  const resv = await pullReservations(allIds, from, to)
  const byListing: Record<string, any[]> = {}
  for (const r of resv) { (byListing[r.listing_id] = byListing[r.listing_id] || []).push(r) }

  const rows = names.map(b => {
    const ls = byBuilding[b]
    const ids = ls.map(l => String(l.id))
    const mine: any[] = []
    for (const id of ids) for (const r of (byListing[id] || [])) mine.push(r)
    const m = metricsFor(mine, ls.length, from, to)
    const raw = {
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
    }
    const g = basisTriple(raw, 'gross'), n = basisTriple(raw, 'net')
    const brs = Array.from(new Set(ls.map(l => (l.bedrooms == null ? null : Number(l.bedrooms))).filter(x => x != null))).sort() as number[]
    return {
      building: b,
      market: marketLabel(String(marketOf(b))),
      units: ls.length,
      bedrooms: brs.map(x => (x === 0 ? 'Studio' : x + 'BR')).join(' · '),
      gross: fmtK(g.revenue),
      net: fmtK(n.revenue),
      perUnit: fmtK(Math.round(g.revenue / Math.max(1, ls.length))),
      occ: m.occupancyPct + '%',
      adr: '$' + g.adr,
      revpar: '$' + g.revpar,
      nights: String(m.occupiedNights),
      reservations: m.reservations,
      _g: g.revenue,
    }
  }).filter(r => r._g > 0).sort((a, b) => b._g - a._g)

  return NextResponse.json({
    ok: true,
    window: from + ' → ' + to,
    months,
    buildings: rows.map(({ _g, ...r }) => r),
    basis: {
      gross: 'Accommodation + cleaning, as the guest paid it',
      net: 'Accommodation after the channel takes its commission',
      note: 'Revenue only. No expense of any kind is included, and no owner is named.',
    },
  })
}
