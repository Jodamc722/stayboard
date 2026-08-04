// WHO ARRIVES NEXT — the other clock on a damage claim.
//
// The channel's window says when they will stop accepting the paperwork. This says when the proof
// stops existing. Between those two, the second one usually comes first and is the one nobody
// writes down.
import 'server-only'

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
      .in('status', ['confirmed', 'closed'])
      .order('check_in', { ascending: true })
      .limit(5)
    for (const r of (data || []) as any[]) {
      // Inquiries and cancellations are not people walking through the door.
      if (/cancel|inquiry|declined|expired/i.test(String(r.status || ''))) continue
      const ci = String(r.check_in || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(ci)) return ci
    }
  } catch { /* a missing next stay is a normal answer, not an error */ }
  return null
}
