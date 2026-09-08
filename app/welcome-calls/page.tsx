// THE CALLS DESK — every guest call the team owes today, in one place.
//
// Was "Welcome calls" (pre-arrival only) until 2026-09-08. Now three lists and a scoreboard:
//
//   WELCOME       arrivals in the next 14 days. Standard calls are due inside 48 hours; LUXURY
//                 (Arya, Nomad, District 225), BIG ($1,200+ or 10+ nights) and RECOVERY calls are
//                 mandatory from the moment the booking exists.
//   RECOVERY      the mandatory welcome calls at units still waiting for a good review, grouped by
//                 arrival day. A section of its own because it is the one that decides the next review.
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
import { CallsDesk } from '@/components/CallsDesk'
import { getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'
import { ymdET } from '@/lib/team-schedule'
import { loadCallsDesk } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'

// Some Airbnb reservations embed only a STUB guest (id + name, no phone) even though Guesty has the
// number on the guest record. For any displayed reservation missing a phone we fetch /guests/{id} and
// fill it in. Cached 30 min, gentle concurrency to respect Guesty's rate limit.
const guestPhones = unstable_cache(async (ids: string[]) => {
  const map: Record<string, string> = {}
  if (!ids.length) return map
  let tok = ''
  try { tok = await getToken() } catch { return map }
  const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
  const queue = [...ids]
  async function worker() {
    while (queue.length) {
      const id = queue.shift()
      if (!id) break
      try {
        const r = await fetch(`${BASE}/guests/${id}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
        if (r.ok) {
          const g: any = await r.json()
          const ph = g?.phone || (Array.isArray(g?.phones) && g.phones.length ? (typeof g.phones[0] === 'string' ? g.phones[0] : (g.phones[0]?.number || g.phones[0]?.phone)) : '')
          if (ph) map[id] = String(ph)
        }
      } catch { /* skip */ }
      await new Promise(res => setTimeout(res, 120))
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return map
}, ['welcome-guest-phones'], { revalidate: 1800 })

export default async function CallsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const d = await loadCallsDesk(supabaseAdmin(), ymdET(new Date()))

  // Backfill phones for displayed reservations whose embedded guest is just a stub.
  const missing = d.rows.filter(r => !r.phone && r.guestId)
  if (missing.length) {
    const pmap = await guestPhones(Array.from(new Set(missing.map(r => r.guestId))))
    for (const r of missing) if (pmap[r.guestId]) r.phone = pmap[r.guestId]
  }

  return (
    <Shell>
      <CallsDesk rows={d.rows} outRows={d.outRows} kpis={d.kpis as any} today={d.today} me={String(user.email || '')} />
    </Shell>
  )
}
