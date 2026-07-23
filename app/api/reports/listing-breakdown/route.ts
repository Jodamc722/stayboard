// Per-listing performance breakdown for an existing owner report (P12).
// GET ?id=<reportId>[&from=YYYY-MM-DD&to=YYYY-MM-DD]  — defaults to the report's own period.
// Returns each listing's Revenue / Occupancy / ADR / RevPAR over the window, sorted by revenue,
// using the same engine as the main report (units = 1 per listing). The client stores the rows in
// content.byListing and saves. No writes here.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveScope, pullReservations, metricsFor, fmtK } from '@/lib/owner-report'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const id = str(sp.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('listing_ids, period_start, period_end').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  // Optionally drop blocked/off-market listings so occupancy & availability aren't inflated by them.
  const exclude = str(sp.get('exclude')).split(',').map(s => s.trim()).filter(Boolean)
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : []).map((x: any) => String(x)).filter(Boolean).filter((id: string) => exclude.indexOf(id) < 0).slice(0, 80)
  if (!ids.length) return NextResponse.json({ error: 'this report has no listings to break down' }, { status: 400 })

  const from = str(sp.get('from')) || str(rep.period_start)
  const to = str(sp.get('to')) || str(rep.period_end)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'valid from/to (YYYY-MM-DD) required' }, { status: 400 })
  }

  const scope = await resolveScope(ids, [])
  const toExcl = nextDay(to)
  const resv = await pullReservations(scope.listings.map(l => l.id), from, toExcl)
  const byId: Record<string, any[]> = {}
  for (const r of resv) { (byId[r.listing_id] = byId[r.listing_id] || []).push(r) }

  const rows = scope.listings.map(l => {
    const m = metricsFor(byId[l.id] || [], 1, from, toExcl)
    const name = l.unit ? ('Unit ' + l.unit) : l.name
    return {
      id: l.id,
      name,
      unit: l.unit || '',
      bedrooms: l.bedrooms,
      building: l.building || '',
      revenue: fmtK(m.accomRevenue),
      grossRevenue: fmtK(m.grossRevenue),
      occPct: m.occupancyPct,
      adr: '$' + m.adr,
      grossAdr: '$' + m.grossAdr,
      revpar: '$' + m.revpar,
      grossRevpar: '$' + m.grossRevpar,
      reservations: m.reservations,
      revNum: m.accomRevenue,
      // raw numbers so the client can re-aggregate any filtered slice in any basis
      accomNum: m.accomRevenue,
      grossNum: m.grossRevenue,
      accomGrossNum: m.accomGrossRevenue,
      cleaningNum: m.cleaningRevenue,
      occNights: m.occupiedNights,
      availNights: m.availableNights,
    }
  }).sort((a, b) => b.revNum - a.revNum)

  return NextResponse.json({ ok: true, from, to, count: rows.length, listings: rows })
}
