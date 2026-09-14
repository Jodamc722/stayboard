// LOADING THE CONTACT LIST — the one read every contacts surface shares.
//
// Lives in lib, not in the route, because Next's App Router only allows GET/POST/etc. to be
// exported from a route.ts; a helper exported next to them fails the build with a type error.
// Both /api/contacts and the Mailchimp sync need exactly this read, and they must never drift
// into two different definitions of who a contact is.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { buildContacts, DEFAULT_RESTRICTED_CHANNELS, type Contact } from './guest-contacts'
import { getSetting, setSetting } from './app-settings'

/** Channels we may not market to. Editable in the app so a new OTA rule needs no deploy. */
export const RESTRICTED_KEY = 'marketing_restricted_channels'

export async function getRestrictedChannels(): Promise<string[]> {
  const v = await getSetting<any>(RESTRICTED_KEY, null)
  if (!Array.isArray(v)) return DEFAULT_RESTRICTED_CHANNELS
  return v.map(x => String(x || '').trim()).filter(Boolean)
}

export async function setRestrictedChannels(list: string[], actor: string) {
  const clean = Array.from(new Set((list || []).map(x => String(x || '').trim()).filter(Boolean))).slice(0, 20)
  return setSetting(RESTRICTED_KEY, clean, actor)
}

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

/** Two years of stays, the reviews to match against them, and the profile layer. */
export async function loadContacts(days = 730): Promise<{ contacts: Contact[]; today: string; truncated: boolean; shortReads: string[]; restrictedChannels: string[] }> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const since = ymdET(new Date(Date.now() - days * 86400000))

  const restrictedChannels = await getRestrictedChannels()

  const [resPage, revPage, profPage, listPage] = await Promise.all([
    pageRows<any>((a, b) => db.from('guesty_reservations')
      .select('listing_id, listing_name, guest_id, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, money_total')
      // 30 pages, not 12. Two years of a 230-unit portfolio is well past 12,000 reservations, and
      // a capped read here does not error — it just quietly drops the oldest guests off the list.
      .in('status', ['confirmed', 'checked_in', 'checked_out', 'completed'])
        .gte('check_in', since).order('check_in', { ascending: false }).range(a, b), 40),
    // Reviews carry no email and no reservation id, so they are matched on listing + name. Two
    // years back matches the reservation window; an older review has no stay here to attach to.
    pageRows<any>((a, b) => db.from('guesty_reviews')
      .select('listing_id, guest_name, rating, created_at')
      .gte('created_at', since).order('id').range(a, b), 30),
    // ORDER BY guest_key, NOT id. guest_profiles has no id column — its primary key IS guest_key
    // (migration 043). Ordering by a column that does not exist makes PostgREST return an error,
    // which supabase-js resolves rather than throws, so the read came back as zero profiles: no
    // VIP flag, no tags, and the VIP segment silently empty. Caught 2026-09-14 only because
    // pageRows reports an errored read as truncated and this route now names which one.
    pageRows<any>((a, b) => db.from('guest_profiles').select('*').order('guest_key').range(a, b), 10),
    pageRows<any>((a, b) => db.from('guesty_listings').select('id, nickname, title, building, address_city').order('id').range(a, b), 3),
  ])

  const contacts = buildContacts({
    reservations: resPage.rows || [],
    listings: listPage.rows || [],
    reviews: revPage.rows || [],
    profiles: profPage.rows || [],
    today,
    restrictedChannels,
  })
  // NAME THE READ THAT FELL SHORT. pageRows sets `truncated` for TWO different reasons — it hit its
  // page ceiling, or the query errored (a renamed column, a statement timeout, an expired key all
  // resolve as { data: null, error } rather than throwing). A single boolean cannot tell those
  // apart, and the fix is opposite in each case: raise the ceiling, or go find the broken query.
  // The first version of this file selected a column called `city`, which does not exist; the read
  // errored, every contact came back with no building, and the only signal was a bare "truncated".
  const shortReads = [
    resPage.truncated ? 'reservations' : '',
    revPage.truncated ? 'reviews' : '',
    profPage.truncated ? 'guest profiles' : '',
    listPage.truncated ? 'listings' : '',
  ].filter(Boolean)
  return { contacts, today, truncated: shortReads.length > 0, shortReads, restrictedChannels }
}
