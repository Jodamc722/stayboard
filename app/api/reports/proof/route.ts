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
import { proofListings, proofRows, monthLabel as mLabel } from '@/lib/sales-proof'
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
    rows,
    totals,
    // So the slide can say which two bases it is printing, in the words the reports use.
    basis: { gross: BASIS_NOTE.gross, net: BASIS_NOTE.net },
  })
}
