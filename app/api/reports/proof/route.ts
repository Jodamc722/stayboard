// WHAT PROPERTIES LIKE YOURS EARN — the proof slide's numbers.
// GET /api/reports/proof?owner=<ownerId>|listings=<id,id>|building=<key>&from=&to=&names=1
//
// Jon, 2026-10-27: "pull actuals from other property owner statements, and pull by owner or by
// listing of actual gross rev and net of fees, but not expense."
//
// REVENUE ONLY, ENFORCED HERE RATHER THAN ON THE SLIDE. This route reads the reservation mirror
// and nothing else: gross revenue, revenue net of the channel fee the booking site keeps,
// occupancy, ADR and nights. There is no commission line, no labour line and no owner-ledger
// expense anywhere in it, because the figures are being shown to someone who is not the owner of
// these properties. A rule that lives in the query cannot be switched off by editing a slide.
//
// WHY THE RESERVATION MIRROR AND NOT THE OWNER STATEMENTS. The statement is the right source for
// an owner's own report, and it is the wrong one here: its shape is rental income minus
// commission minus charges, so reading revenue off it means reading past the expense lines we
// have no business showing a third party. The mirror holds the bookings themselves — the same
// source the snapshot and per-listing slides of every owner report are built from — so it answers
// "what did this unit earn" without ever touching what it cost.
//
// NAMES ARE OFF BY DEFAULT. Rows label by unit and building; `names=1` adds the owner, for the
// case where the owner is the point (a developer looking at their own portfolio).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { etToday } from '@/lib/owner-report'
import { BASIS_NOTE } from '@/lib/basis'
import { proofListings, proofRows, monthLabel as mLabel, ownersForListings, completedMonths, ownerRevenueRows } from '@/lib/sales-proof'
import { rollupBuilding } from '@/lib/optimize-score'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function monthsBack(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok) return gate.res

  const sp = new URL(req.url).searchParams
  const ownerId = str(sp.get('owner'))
  const building = str(sp.get('building'))
  const listingIds = str(sp.get('listings')).split(',').map(s => s.trim()).filter(Boolean)
  const names = sp.get('names') === '1'
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('to'))) ? str(sp.get('to')) : etToday()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('from'))) ? str(sp.get('from')) : monthsBack(to, 12)
  if (from > to) return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 })

  const db = supabaseAdmin()

  // WITH NO SCOPE, SAY WHAT THE SCOPES ARE. The slide's pull panel needs the owners and buildings
  // it can choose from, and asking this route for them keeps the list and the numbers behind one
  // door — nobody who cannot read the figures can enumerate the owners either.
  if (!ownerId && !building && !listingIds.length) {
    const [{ data: ows }, { data: lsAll }] = await Promise.all([
      db.from('guesty_owners').select('id, full_name, listing_ids').limit(500),
      db.from('guesty_listings').select('building, status').limit(1000),
    ])
    const owners = ((ows || []) as any[])
      .map(o => ({ id: String(o.id), name: str(o.full_name), n: (Array.isArray(o.listing_ids) ? o.listing_ids.length : 0) }))
      .filter(o => o.name && o.n > 0)
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    const bset: string[] = []
    for (const l of ((lsAll || []) as any[])) {
      const st = str(l.status).toLowerCase()
      if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) continue
      const b = rollupBuilding(str(l.building))
      if (b && bset.indexOf(b) < 0) bset.push(b)
    }
    return NextResponse.json({ ok: true, scopes: true, owners, buildings: bset.sort() })
  }

  let ids: string[] = listingIds.slice(0, 80)
  let scopeName = ''

  if (ownerId) {
    const { data: ow } = await db.from('guesty_owners').select('id, full_name, listing_ids').eq('id', ownerId).limit(1)
    const o = (ow || [])[0] as any
    if (!o) return NextResponse.json({ error: 'owner not found' }, { status: 404 })
    ids = (Array.isArray(o.listing_ids) ? o.listing_ids : []).map(String).filter(Boolean).slice(0, 80)
    scopeName = str(o.full_name)
  }

  // ── REAL OWNER REVENUE (the default) ──────────────────────────────────────
  // Jon, 2026-10-27: the slide should read the completed owner statements, by owner, property or
  // listing, and carry gross owner revenue before our fee and the in-pocket figure after it —
  // never an expense. See lib/sales-proof for why `pocket` is rental minus commission and
  // deliberately not the statement's own net.
  if (str(sp.get('source') || 'statements') === 'statements') {
    const fromM = from.slice(0, 7), toM = to.slice(0, 7)
    const listingScope = ids.length ? ids : (await proofListings({ building })).map(l => String(l.id))
    const owners = ownerId ? [ownerId] : await ownersForListings(listingScope)
    if (!owners.length) {
      return NextResponse.json({ error: 'No owner on record for that scope — pick an owner, or switch the source to bookings.' }, { status: 400 })
    }
    const months = await completedMonths(owners, fromM, toM)
    if (!months.length) {
      return NextResponse.json({ error: 'No completed owner statements between ' + fromM + ' and ' + toM + '.' }, { status: 400 })
    }
    const { rows, totals, unattributed, feePct } = await ownerRevenueRows(owners, months, ownerId ? undefined : listingScope)
    if (!rows.length) {
      return NextResponse.json({ error: 'Those statements carry no rental revenue for that scope.' }, { status: 400 })
    }
    if (!scopeName) scopeName = building ? rollupBuilding(building) : rows.length + ' propert' + (rows.length === 1 ? 'y' : 'ies')
    return NextResponse.json({
      ok: true,
      source: 'statements',
      scope: (names && ownerId ? scopeName : (building ? rollupBuilding(building) : scopeName)),
      names,
      window: mLabel(months[0] + '-01') + ' \u2013 ' + mLabel(months[months.length - 1] + '-01'),
      statements: months.length,
      rows,
      totals,
      // What the effective fee works out at across the scope, and how much commission had to be
      // allocated because the ledger booked it above the unit. Both are here so a number that
      // looks wrong can be checked rather than argued about.
      feePct,
      unattributed,
      basis: {
        gross: 'Rental revenue recognised to the owner, before our management fee',
        net: 'After our management fee. No expenses of any kind are included.',
      },
    })
  }

  const picked = await proofListings(ids.length ? { listingIds: ids } : { building })
  if (!picked.length) return NextResponse.json({ error: 'Nothing to pull — pick an owner, a building or some listings.' }, { status: 400 })
  if (!scopeName) scopeName = building ? rollupBuilding(building) : (picked.length === 1 ? str(picked[0].nickname || picked[0].title) : picked.length + ' listings')

  const { rows, totals } = await proofRows(picked, from, to)

  return NextResponse.json({
    ok: true,
    scope: (names && ownerId ? scopeName : (building ? rollupBuilding(building) : scopeName)),
    names,
    window: mLabel(from) + ' – ' + mLabel(to),
    from, to,
    source: 'bookings',
    rows,
    totals,
    // So the slide can say which two bases it is printing, in the words the reports use.
    basis: { gross: BASIS_NOTE.gross, net: BASIS_NOTE.net },
  })
}
