// WHO ARRIVES NEXT — the other clock on a damage claim.
//
// The channel's window says when they will stop accepting the paperwork. This says when the proof
// stops existing. Between those two, the second one usually comes first and is the one nobody
// writes down.
//
// COMPUTED ON READ, NOT STORED. That started as a way round a blocked migration and turned out to
// be the better design: bookings move. A guest cancels, an owner blocks the unit, a same-day
// booking appears the morning after checkout — a column written once at claim-creation would be
// quietly wrong by then, and wrong in the direction that costs money. Reading it fresh costs one
// indexed query per board load and is never stale.
import 'server-only'

type Row = { listing_id: string; check_in: string; status: string }

function usable(status: any): boolean {
  // Inquiries and cancellations are not people walking through the door.
  return !/cancel|inquiry|declined|expired/i.test(String(status || ''))
}

/**
 * The next arrival on this unit after the claimed stay's checkout.
 * Same-day turnovers count: a guest checking in on the checkout date means the room is being
 * cleaned that morning and the evidence is already going.
 */
export async function nextCheckInFor(db: any, listingId: string, checkOut: string): Promise<string | null> {
  const lid = String(listingId || '').trim()
  const co = String(checkOut || '').slice(0, 10)
  if (!lid || !/^\d{4}-\d{2}-\d{2}$/.test(co)) return null
  try {
    const { data } = await db.from('guesty_reservations')
      .select('check_in,status')
      .eq('listing_id', lid)
      .gte('check_in', co)
      .order('check_in', { ascending: true })
      .limit(8)
    for (const r of (data || []) as any[]) {
      if (!usable(r.status)) continue
      const ci = String(r.check_in || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(ci)) return ci
    }
  } catch { /* a missing next stay is a normal answer, not an error */ }
  return null
}

/**
 * The same answer for a whole board, in ONE query rather than one per claim.
 * Returns a map of claim id -> next arrival date.
 */
export async function nextCheckInMap(
  db: any,
  claims: { id: any; listing_id?: string | null; check_out?: string | null }[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const live = (claims || []).filter(c => c.listing_id && /^\d{4}-\d{2}-\d{2}$/.test(String(c.check_out || '').slice(0, 10)))
  if (!live.length) return out

  const listingIds: string[] = []
  let earliest = '9999-12-31'
  for (const c of live) {
    const lid = String(c.listing_id)
    if (listingIds.indexOf(lid) < 0) listingIds.push(lid)
    const co = String(c.check_out).slice(0, 10)
    if (co < earliest) earliest = co
  }

  let rows: Row[] = []
  try {
    // Narrow on purpose: three scalar columns, filtered by listing and date. Never widen this to
    // select('*') — the claims board would start dragging the whole reservation payload with it.
    const { data } = await db.from('guesty_reservations')
      .select('listing_id,check_in,status')
      .in('listing_id', listingIds)
      .gte('check_in', earliest)
      .order('check_in', { ascending: true })
      .limit(2000)
    rows = ((data || []) as any[]).filter(r => usable(r.status)) as Row[]
  } catch { return out }

  const byListing: Record<string, string[]> = {}
  for (const r of rows) {
    const lid = String(r.listing_id || '')
    const ci = String(r.check_in || '').slice(0, 10)
    if (!lid || !/^\d{4}-\d{2}-\d{2}$/.test(ci)) continue
    if (!byListing[lid]) byListing[lid] = []
    byListing[lid].push(ci)
  }

  for (const c of live) {
    const dates = byListing[String(c.listing_id)] || []
    const co = String(c.check_out).slice(0, 10)
    let hit: string | null = null
    for (let i = 0; i < dates.length; i++) { if (dates[i] >= co) { hit = dates[i]; break } }
    out[String(c.id)] = hit
  }
  return out
}
