// GUEST PHONES THE MIRROR IS MISSING — asked for by the Calls desk AFTER it has drawn.
//
// Some Airbnb reservations embed only a STUB guest (id + name, no phone) even though Guesty has the
// number on the guest record. The Calls page used to look those up from Guesty INSIDE its own
// render: one cache entry keyed on the whole list of guest ids, so a single new arrival threw the
// entry away and every missing phone was fetched again, three at a time, before any of the page was
// sent (2026-11-09 audit: the 3.3–5.4s loads). Now the page draws at once and asks here.
//
// POST { reservationIds: string[] }  →  { ok, phones: { [reservationId]: phone } }
//
// It takes RESERVATION ids, not guest ids, and only ever answers for reservations whose mirrored
// phone is blank — so it cannot be used to look up an arbitrary guest. Each guest is cached on its
// own for 30 minutes (a blank answer too); a failed Guesty call is not cached.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireVrUser } from '@/lib/vr-gate'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const guestPhone = unstable_cache(async (guestId: string): Promise<string> => {
  const tok = await getToken()
  const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
  const r = await fetch(`${BASE}/guests/${encodeURIComponent(guestId)}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
  if (r.status === 404) return ''
  if (!r.ok) throw new Error('guesty ' + r.status)
  const g: any = await r.json()
  const ph = g?.phone || (Array.isArray(g?.phones) && g.phones.length ? (typeof g.phones[0] === 'string' ? g.phones[0] : (g.phones[0]?.number || g.phones[0]?.phone)) : '')
  return ph ? String(ph) : ''
}, ['calls-guest-phone-v1'], { revalidate: 1800 })

export async function POST(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const b = await req.json().catch(() => ({} as any))
    const ids: string[] = Array.from(new Set<string>((Array.isArray(b?.reservationIds) ? b.reservationIds : []).map((x: any) => String(x || '')).filter(Boolean))).slice(0, 200)
    if (!ids.length) return NextResponse.json({ ok: true, phones: {} })
    const { data, error } = await supabaseAdmin().from('guesty_reservations')
      .select('id,guest_phone,guestId:raw->guest->>_id').in('id', ids)
    if (error) return NextResponse.json({ ok: false, error: error.message.slice(0, 200) }, { status: 500 })
    const want = ((data || []) as any[])
      .filter(r => !String(r.guest_phone || '').trim() && String(r.guestId || '').trim())
      .map(r => ({ id: String(r.id), guestId: String(r.guestId) }))
    const byGuest: Record<string, string> = {}
    const queue = Array.from(new Set(want.map(w => w.guestId)))
    // Gentle on Guesty's rate limit: three at a time, a short pause after each call that actually
    // went out (an answer in a few milliseconds came from the cache and needs no pause). Stops
    // starting new lookups after 20s so the answer always comes back.
    const stopAt = Date.now() + 20_000
    const worker = async () => {
      while (queue.length && Date.now() < stopAt) {
        const gid = queue.shift()
        if (!gid) break
        const t0 = Date.now()
        try { byGuest[gid] = await guestPhone(gid) } catch { /* not cached; the next open asks again */ }
        if (Date.now() - t0 > 25) await new Promise(res => setTimeout(res, 120))
      }
    }
    await Promise.all([worker(), worker(), worker()])
    const phones: Record<string, string> = {}
    for (const w of want) if (byGuest[w.guestId]) phones[w.id] = byGuest[w.guestId]
    return NextResponse.json({ ok: true, phones })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
