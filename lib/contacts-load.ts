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
  // The channel rule is baked into every contact's `mail` state, so changing it makes every cached
  // snapshot wrong. Drop it here rather than waiting out the TTL — the whole point of the setting is
  // that the effect is visible immediately.
  invalidateContacts()
  return setSetting(RESTRICTED_KEY, clean, actor)
}

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type ContactSnapshot = { contacts: Contact[]; today: string; truncated: boolean; shortReads: string[]; restrictedChannels: string[] }

// ── WHY THIS IS CACHED ──────────────────────────────────────────────────────────────────────────
//
// readContacts() below is about twenty SEQUENTIAL PostgREST pages: two years of reservations is
// fourteen pages on its own, and PostgREST caps every page at a thousand rows, so there is no way
// to ask for it in one go. That read is fine once. The problem is that it was happening on every
// keystroke-debounced search, every segment chip, every channel filter and every Mailchimp push —
// clicking "Repeat guests" re-read 13,414 reservations to answer a question about rows already in
// memory a second earlier.
//
// So: one snapshot, five minutes, shared by every caller in the instance. Marketing contacts are
// not a live number — a guest who checked in during those five minutes is not someone you were
// about to email — and anything that genuinely needs the newest read passes { fresh: true }.
//
// A SHORT READ IS NOT CACHED FOR LONG. If pageRows reported truncated, something was wrong (a
// statement timeout, an expired key, a renamed column), and pinning that result for five minutes
// would turn a blip into a quarter-hour of wrong numbers. Those are held for thirty seconds — long
// enough to stop a retry storm, short enough to heal on its own.
const TTL_OK_MS = 5 * 60_000
const TTL_SHORT_MS = 30_000

let cached: { at: number; days: number; snap: ContactSnapshot } | null = null
let inflight: { days: number; p: Promise<ContactSnapshot> } | null = null

/** Forget the snapshot. Called when a setting that changes what a contact IS has been written. */
export function invalidateContacts() { cached = null }

/** Two years of stays, the reviews to match against them, and the profile layer. */
export async function loadContacts(days = 730, opts?: { fresh?: boolean }): Promise<ContactSnapshot> {
  const now = Date.now()
  if (!opts?.fresh && cached && cached.days === days) {
    const ttl = cached.snap.truncated ? TTL_SHORT_MS : TTL_OK_MS
    if (now - cached.at < ttl) return cached.snap
  }
  // Two people opening /contacts at once should cost one read, not two. Only the cached path shares
  // the in-flight promise — an explicit { fresh: true } always goes and gets its own.
  if (!opts?.fresh && inflight && inflight.days === days) return inflight.p

  const p = readContacts(days).then(
    snap => { cached = { at: Date.now(), days, snap }; if (inflight?.p === p) inflight = null; return snap },
    e => { if (inflight?.p === p) inflight = null; throw e },
  )
  if (!opts?.fresh) inflight = { days, p }
  return p
}

async function readContacts(days: number): Promise<ContactSnapshot> {
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
