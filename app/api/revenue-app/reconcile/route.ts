// Reconcile — the Revenue App's numbers against Lighthouse's own Guesty math, per unit, per month.
//
// This is the page that earns the cutover. Our numbers tie to owner statements to the penny
// (/api/debug/money), so the DELTA column here is a statement about HIS feed: a unit that
// disagrees is either a basis difference (his net vs our net), a straddling-stay posting
// difference, a status filter difference, or a genuine bug — and each gets named, never averaged.
//
// GET ?month=YYYY-MM  (Revenue view)
//   rows[]  per unit: his gross/net accom, nights, occupancy · ours (netota = his gross, net = his net) · deltas
//   buildings[] rolled up through buildingOf() — HIS building label is kept beside ours so a mapping
//   miss is visible, not hidden by the rollup.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { unitRevenue } from '@/lib/unit-revenue'
import { buildingOf } from '@/lib/segments'
import { revenueAppUnitMonth } from '@/lib/revenue-source'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function monthRange(month: string): { from: string; to: string } {
  const y = +month.slice(0, 4), m = +month.slice(5, 7)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from: month + '-01', to: last }
}
const r0 = (n: number | null | undefined) => n == null ? null : Math.round(n)
const pct = (a: number | null, b: number | null) => (a == null || b == null || !b) ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10

export async function GET(req: NextRequest) {
  const g = await requireLevel('revenue', 'view'); if (!g.ok) return g.res
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const month = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get('month') || '') ? req.nextUrl.searchParams.get('month')! : todayET.slice(0, 7)
  const { from, to } = monthRange(month)

  const [his, oursNetota, oursNet, { data: listings }, { data: budget }] = await Promise.all([
    revenueAppUnitMonth(month),
    unitRevenue(from, to, 'netota'),
    unitRevenue(from, to, 'net'),
    supabaseAdmin().from('guesty_listings').select('id,nickname,title,building').limit(2000),
    supabaseAdmin().from('rev_budget_month').select('*').eq('month', month),
  ])
  const byId = new Map<string, any>((listings || []).map((l: any) => [l.id, l]))

  const ids = new Set<string>([...Object.keys(his.rows), ...Object.keys(oursNetota)])
  const rows = Array.from(ids).map(id => {
    const h = his.rows[id], a = oursNetota[id], n = oursNet[id]
    const l = byId.get(id)
    const ourBuilding = buildingOf(l?.building, l?.nickname || l?.title) || l?.building || null
    const hisBuilding = h?.building || null
    const hisNetota = h?.gross_accom ?? null, hisNet = h?.net_accom ?? null
    const oursNetotaRev = a ? a.revenue : null, oursNetRev = n ? n.revenue : null
    return {
      id, unit: h?.unit_name || l?.nickname || l?.title || id,
      building: ourBuilding, hisBuilding,
      buildingMismatch: !!(hisBuilding && ourBuilding && buildingOf(hisBuilding, null) !== ourBuilding),
      inHis: !!h, inOurs: !!a,
      his: h ? { netota: r0(hisNetota), net: r0(hisNet), nights: r0(h.nights_sold), available: r0(h.nights_available), occupancy: h.occupancy, cleaning: r0(h.net_cleaning), mgmtFee: r0(h.mgmt_fee), asOf: h.as_of, kind: h.kind } : null,
      ours: a ? { netota: r0(oursNetotaRev), net: r0(oursNetRev), nights: a.nights, available: a.available, occupancy: a.occupancy } : null,
      delta: {
        netota: hisNetota != null && oursNetotaRev != null ? r0(hisNetota - oursNetotaRev) : null,
        netotaPct: pct(hisNetota, oursNetotaRev),
        net: hisNet != null && oursNetRev != null ? r0(hisNet - oursNetRev) : null,
        netPct: pct(hisNet, oursNetRev),
        nights: h?.nights_sold != null && a ? r0(h.nights_sold - a.nights) : null,
      },
    }
  }).sort((x, y) => Math.abs(y.delta.netota ?? 0) - Math.abs(x.delta.netota ?? 0))

  // Building rollup on OUR canonical label; his label shown when it differs.
  const b = new Map<string, any>()
  for (const r of rows) {
    const k = r.building || '—'
    const o = b.get(k) || { building: k, units: 0, onlyHis: 0, onlyOurs: 0, his: { netota: 0, net: 0, nights: 0 }, ours: { netota: 0, net: 0, nights: 0 }, hisLabels: new Set<string>() }
    o.units++
    if (r.inHis && !r.inOurs) o.onlyHis++
    if (r.inOurs && !r.inHis) o.onlyOurs++
    if (r.his) { o.his.netota += r.his.netota || 0; o.his.net += r.his.net || 0; o.his.nights += r.his.nights || 0 }
    if (r.ours) { o.ours.netota += r.ours.netota || 0; o.ours.net += r.ours.net || 0; o.ours.nights += r.ours.nights || 0 }
    if (r.hisBuilding) o.hisLabels.add(r.hisBuilding)
    b.set(k, o)
  }
  const buildings = Array.from(b.values()).map(o => ({ ...o, hisLabels: Array.from(o.hisLabels as Set<string>), delta: { netota: o.his.netota - o.ours.netota, net: o.his.net - o.ours.net, nights: o.his.nights - o.ours.nights, netotaPct: pct(o.his.netota, o.ours.netota) } }))
    .sort((x, y) => Math.abs(y.delta.netota) - Math.abs(x.delta.netota))

  const tot = (k: 'his' | 'ours', f: 'netota' | 'net' | 'nights') => buildings.reduce((s, o) => s + (o[k][f] || 0), 0)
  const totals = {
    his: { netota: tot('his', 'netota'), net: tot('his', 'net'), nights: tot('his', 'nights') },
    ours: { netota: tot('ours', 'netota'), net: tot('ours', 'net'), nights: tot('ours', 'nights') },
  }

  return NextResponse.json({
    month, from, to,
    hisKind: his.kind, hisSyncedAt: his.syncedAt, hisUnits: Object.keys(his.rows).length, ourUnits: Object.keys(oursNetota).length,
    totals, delta: { netota: totals.his.netota - totals.ours.netota, net: totals.his.net - totals.ours.net, nights: totals.his.nights - totals.ours.nights },
    budget: budget || [],
    buildings, rows,
    legend: {
      netota: 'his Gross Accommodation (before OTA commission) vs our Net + channel fees (fareAccommodationAdjusted)',
      net: 'his Net Accommodation (after OTA commission) vs our Net (fareAccommodationAdjusted − hostServiceFee)',
      nights: 'his nights sold vs our occupied nights (live statuses only, straddling stays prorated)',
    },
  })
}
