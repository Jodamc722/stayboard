// Ad-hoc snapshot for an arbitrary date range on an existing owner report (P11).
// GET ?id=<reportId>&from=YYYY-MM-DD&to=YYYY-MM-DD[&label=...]
// Computes Revenue / Occupancy / ADR / RevPAR for the report's OWN listings over [from, to]
// (inclusive), using the same engine as the main report. Returns one titled snapshot card.
// The client appends it to content.snaps and saves. No writes here.
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
function prettyDate(iso: string): string {
  const [y, m, dd] = iso.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m || 1) - 1]
  return mon + ' ' + dd + ', ' + y
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const id = str(sp.get('id'))
  const from = str(sp.get('from'))
  const to = str(sp.get('to'))
  const label = str(sp.get('label')).slice(0, 60)
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'id + from/to (YYYY-MM-DD, from ≤ to) required' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('listing_ids').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : []).map((x: any) => String(x)).filter(Boolean).slice(0, 40)
  if (!ids.length) return NextResponse.json({ error: 'this report has no listings to pull from' }, { status: 400 })

  const scope = await resolveScope(ids, [])
  const units = scope.listings.length
  const toExcl = nextDay(to)
  const resv = await pullReservations(ids, from, toExcl)
  const m = metricsFor(resv, units, from, toExcl)

  const snap = {
    key: 'sr_' + from + '_' + to + '_' + Math.round(m.accomRevenue),
    label: label || (prettyDate(from) + ' – ' + prettyDate(to)),
    from,
    to,
    revenue: fmtK(m.accomRevenue),
    grossRevenue: fmtK(m.grossRevenue),
    occPct: m.occupancyPct,
    adr: '$' + m.adr,
    grossAdr: '$' + m.grossAdr,
    revpar: '$' + m.revpar,
    reservations: m.reservations,
    units,
  }
  return NextResponse.json({ ok: true, snap })
}
