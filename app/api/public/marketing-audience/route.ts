// AUDIENCE, for the direct-booking report (Jon, 2026-09-14: "add the contact list to the direct
// booking / marketing link").
//
// SEPARATE FROM /api/public/marketing-report ON PURPOSE. That endpoint has already been tuned once
// around a Postgres statement timeout; bolting a two-year, portfolio-wide read onto it would put
// the whole report back at risk for a block that sits at the bottom of the page. Its own route
// means a slow audience costs the partner a spinner in one card, not the report.
//
// WHAT IT MAY RETURN. Counts and labels. Jon chose "counts and segments only, no contacts" for
// this link, and audienceSummary() is built so there is no shape in which a name, an email address
// or a phone number can come out of here — the contacts themselves never leave the server.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MKT_COOKIE, marketingCookieValid } from '@/lib/shareAuth'
import { pageRows } from '@/lib/db-page'
import { buildContacts, audienceSummary } from '@/lib/guest-contacts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function GET(_req: NextRequest) {
  // Same door as the report itself: a logged-in teammate, or the marketing password cookie.
  let internal = false
  try {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    internal = !!user
  } catch { internal = false }
  if (!internal) {
    const ok = await marketingCookieValid(cookies().get(MKT_COOKIE)?.value)
    if (!ok) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  }

  try {
    const db = supabaseAdmin()
    const today = ymdET(new Date())
    const since = ymdET(new Date(Date.now() - 730 * 86400000))

    const [resPage, listPage] = await Promise.all([
      pageRows<any>((a, b) => db.from('guesty_reservations')
        .select('listing_id, guest_id, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, money_total')
        .in('status', ['confirmed', 'checked_in', 'checked_out', 'completed'])
        .gte('check_in', since).order('check_in', { ascending: false }).range(a, b), 40),
      pageRows<any>((a, b) => db.from('guesty_listings').select('id, nickname, title, building, address_city').order('id').range(a, b), 3),
    ])

    const contacts = buildContacts({
      reservations: resPage.rows || [], listings: listPage.rows || [],
      reviews: [], profiles: [], today,
    })

    return NextResponse.json({
      ok: true,
      basis: 'everyone who has stayed in the last two years',
      truncated: !!resPage.truncated,
      ...audienceSummary(contacts),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
