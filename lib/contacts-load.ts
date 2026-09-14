// LOADING THE CONTACT LIST — the one read every contacts surface shares.
//
// Lives in lib, not in the route, because Next's App Router only allows GET/POST/etc. to be
// exported from a route.ts; a helper exported next to them fails the build with a type error.
// Both /api/contacts and the Mailchimp sync need exactly this read, and they must never drift
// into two different definitions of who a contact is.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { buildContacts, type Contact } from './guest-contacts'

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

/** Two years of stays, the reviews to match against them, and the profile layer. */
export async function loadContacts(days = 730): Promise<{ contacts: Contact[]; today: string; truncated: boolean }> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const since = ymdET(new Date(Date.now() - days * 86400000))

  const [resPage, revPage, profPage, listPage] = await Promise.all([
    pageRows<any>((a, b) => db.from('guesty_reservations')
      .select('listing_id, listing_name, guest_id, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, money_total')
      // 30 pages, not 12. Two years of a 230-unit portfolio is well past 12,000 reservations, and
      // a capped read here does not error — it just quietly drops the oldest guests off the list.
      .gte('check_in', since).order('check_in', { ascending: false }).range(a, b), 30),
    // Reviews carry no email and no reservation id, so they are matched on listing + name. Two
    // years back matches the reservation window; an older review has no stay here to attach to.
    pageRows<any>((a, b) => db.from('guesty_reviews')
      .select('listing_id, guest_name, rating, created_at')
      .gte('created_at', since).order('id').range(a, b), 12),
    pageRows<any>((a, b) => db.from('guest_profiles').select('*').order('id').range(a, b), 10),
    pageRows<any>((a, b) => db.from('guesty_listings').select('id, nickname, title, building, city').order('id').range(a, b), 3),
  ])

  const contacts = buildContacts({
    reservations: resPage.rows || [],
    listings: listPage.rows || [],
    reviews: revPage.rows || [],
    profiles: profPage.rows || [],
    today,
  })
  // Honest about a ceiling we actually hit, rather than showing a short list as if it were whole.
  const truncated = !!(resPage.truncated || revPage.truncated || profPage.truncated || listPage.truncated)
  return { contacts, today, truncated }
}
