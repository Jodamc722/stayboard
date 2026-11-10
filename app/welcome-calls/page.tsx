// THE CALLS DESK — every guest call the team owes today, in one place.
//
// Was "Welcome calls" (pre-arrival only) until 2026-09-08. Now two lists and a scoreboard:
//
//   WELCOME       today and the next 72 hours, by arrival day (Jon, 2026-09-09: "complete by the day
//                 of or 72 hours in advance"; "no 24 hours to complete"). LUXURY (Arya, Nomad,
//                 District 225), BIG ($1,200+ or 10+ nights) and RECOVERY calls are mandatory. The
//                 arrival day is the last day — the night's close-out marks the rest incomplete.
//                 (Recovery units and their further-out arrivals moved to /reviews the same day.)
//   POST-CHECKOUT the guest who just left a recovery unit — hear it on the phone before it's a review.
//   SCOREBOARD    who called, what got done, what closed incomplete — from guest_calls, the durable log.
//
// The engine is lib/call-desk.ts (loadCallsDesk). This file only authenticates, backfills phones
// the Guesty mirror is missing, and renders. The nightly close-out (api/cron/calls-closeout) runs the
// same loader, so "incomplete" means exactly one thing.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { CallsDeskPhones } from '@/components/CallsDeskPhones'
import { ymdET } from '@/lib/team-schedule'
import { loadCallsDesk } from '@/lib/call-desk'
import { signedInName } from '@/lib/caller-name'

export const dynamic = 'force-dynamic'

// PHONES THE MIRROR IS MISSING (2026-11-09). Some Airbnb reservations embed only a STUB guest (id +
// name, no phone) even though Guesty has the number. This page used to fetch those from Guesty
// before rendering — one cache entry for the whole list, thrown away by any new arrival — which is
// what made it take 3–5 seconds. The desk now draws at once and components/CallsDeskPhones asks
// /api/calls/guest-phones for the blanks (cached per guest, 30 minutes).

export default async function CallsPage({ searchParams }: { searchParams?: { date?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ?date=YYYY-MM-DD points the desk at another day (2026-09-25). Default: today.
  const today = ymdET(new Date())
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.date || '')) ? String(searchParams!.date) : today
  // The signed-in person's name does not depend on the desk — read alongside it.
  const [d, meName] = await Promise.all([
    loadCallsDesk(supabaseAdmin(), today, date),
    signedInName(supabaseAdmin(), String(user.email || '')),
  ])

  return (
    <Shell>
      <CallsDeskPhones meName={meName} rows={d.rows} outRows={d.outRows} kpis={d.kpis as any} today={d.today} date={date} me={String(user.email || '')} talkroute={d.talkroute} callers={d.callers} />
    </Shell>
  )
}
