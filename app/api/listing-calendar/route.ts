// WHAT IS HAPPENING AT THIS UNIT, DAY BY DAY — so nobody schedules a walk into an occupied unit.
//
// Picking a date for field work from a bare calendar is guesswork: the person choosing cannot see
// that Thursday has a guest in it and Friday is a checkout with nothing behind it. This returns the
// next N days annotated with what the booking calendar says, which is the difference between
// "someone knocks on a guest's door" and "the crew walks an empty unit".
//
// STATUS PER DAY, in the order that matters to whoever is scheduling:
//   turn     checkout AND checkin the same day — tight, the clean owns it, do not add work
//   checkout guest leaves in the morning, nobody arrives — the best day for a walk
//   vacant   nobody in it at all — also good, and no deadline
//   checkin  guest arrives this afternoon — fine before their arrival time, tight after
//   occupied someone is in the unit all day — do not send anyone without calling first
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isLiveStay } from '@/lib/stay-status'

export const dynamic = 'force-dynamic'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const listingId = str(req.nextUrl.searchParams.get('listingId')).trim()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 21, 1), 60)

  const today = ymd(new Date())
  const end = addDays(today, days)
  const db = supabaseAdmin()

  // Anything overlapping the window: starts before the end AND ends on/after today.
  const { data, error } = await db.from('guesty_reservations')
    .select('check_in,check_out,status,guest_name,nights')
    .eq('listing_id', listingId)
    .lte('check_in', end)
    .gte('check_out', today)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stays = ((data || []) as any[]).filter(s => isLiveStay(s.status))

  const out: any[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i)
    const outgoing = stays.find(s => str(s.check_out).slice(0, 10) === d)
    const incoming = stays.find(s => str(s.check_in).slice(0, 10) === d)
    // Strictly BETWEEN check-in and check-out: a checkout morning is not "occupied all day".
    const through = stays.find(s => str(s.check_in).slice(0, 10) < d && str(s.check_out).slice(0, 10) > d)

    let status = 'vacant'
    if (through) status = 'occupied'
    else if (outgoing && incoming) status = 'turn'
    else if (outgoing) status = 'checkout'
    else if (incoming) status = 'checkin'

    out.push({
      date: d,
      status,
      // Good = the unit is genuinely free for a walk. A turn is technically free but the clean owns
      // that window, so it is not offered as a recommendation.
      good: status === 'checkout' || status === 'vacant',
      guest: str((through || outgoing || incoming || {}).guest_name) || null,
      nights: Number((outgoing || through || {}).nights) || null,
    })
  }

  const firstGood = out.find(d => d.good) || null
  return NextResponse.json({ ok: true, listingId, days: out, suggested: firstGood ? firstGood.date : today })
}
