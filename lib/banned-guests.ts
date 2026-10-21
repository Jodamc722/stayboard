// BANNED GUESTS (Jon, 2026-10-21: "add a flag system if we mark a guest (Banned) it should notify us
// via app if making a booking").
//
// THE FLAG. A guest is banned when their profile on the Guests tab (guest_profiles) carries the tag
// "Banned". A tag, not a new column, so it works the moment it ships — no hand-run migration — and the
// reason lives in the profile's notes, where the team already writes what they know about a person.
//
// THE MATCH. A banned person rarely books again under the same key: a new email on Booking.com, a
// relay address on Airbnb. So a booking is checked against every banned profile on four things, in
// order of how sure they are:
//     Guesty guest id · email · phone (last nine digits, the lib/same-guest rule) — a MATCH
//     the same real name and nothing else                                       — a POSSIBLE match
// A name alone is never called a match ("Jose Garcia" is a lot of people); it is surfaced so a person
// can look, which is the whole job here.
//
// THE ALERT. After every booking sync (app/api/cron/reservations, every 5 minutes) each live booking
// that has not checked out yet is checked. A hit drops a bell notification to the ops team (admins,
// GM, ops workspace — lib/ops-behind opsRecipients) linking to the booking. Once per booking: the
// booking ids already raised are kept in app_settings `banned_watch_state`. Marking someone banned
// also runs the check straight away, so a stay they ALREADY have on the books is raised too.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isLiveStay } from '@/lib/stay-status'
import { realGuestName, samePhoneNumber } from '@/lib/same-guest'

export const BANNED_TAG = 'Banned'
const STATE_KEY = 'banned_watch_state'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export const hasBannedTag = (tags: any): boolean => Array.isArray(tags) && tags.some(t => /^\s*banned\s*$/i.test(str(t)))

export type BannedProfile = { key: string; name: string; email: string; phone: string; guestyId: string; reason: string }
export type BanHit = { profile: BannedProfile; how: 'guest id' | 'email' | 'phone' | 'name'; strong: boolean }

export async function loadBanned(db = supabaseAdmin()): Promise<BannedProfile[]> {
  const { data, error } = await db.from('guest_profiles').select('guest_key,name,email,phone,notes,tags')
    .overlaps('tags', ['Banned', 'banned', 'BANNED']).limit(1000) // deliberate cap: hand-marked banned guests
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).filter(p => hasBannedTag(p.tags)).map(p => {
    const k = str(p.guest_key)
    return {
      key: k,
      name: str(p.name) || (k.startsWith('n:') ? k.slice(2) : ''),
      email: (str(p.email) || (k.startsWith('e:') ? k.slice(2) : '')).trim().toLowerCase(),
      phone: str(p.phone),
      guestyId: k.startsWith('g:') ? k.slice(2) : '',
      reason: str(p.notes).slice(0, 300),
    }
  })
}

/** Is this booking's guest on the banned list? Strongest evidence first. */
export function matchBanned(r: { guest_id?: any; guest_email?: any; guest_phone?: any; guest_name?: any }, list: BannedProfile[]): BanHit | null {
  const gid = str(r.guest_id).trim(), em = str(r.guest_email).trim().toLowerCase(), nm = realGuestName(r.guest_name)
  for (const p of list) if (p.guestyId && gid && p.guestyId === gid) return { profile: p, how: 'guest id', strong: true }
  for (const p of list) if (p.email && em && p.email === em) return { profile: p, how: 'email', strong: true }
  for (const p of list) if (p.phone && samePhoneNumber(p.phone, r.guest_phone)) return { profile: p, how: 'phone', strong: true }
  for (const p of list) if (nm && realGuestName(p.name) === nm) return { profile: p, how: 'name', strong: false }
  return null
}

type State = Record<string, { at: string; key: string; strong: boolean; out: string }>

async function readState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', STATE_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object') return o
  } catch { /* first run */ }
  return {}
}

const day = (iso: string) => { if (!iso) return '?'; const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }

export type BannedWatchResult = { ok: boolean; banned: number; checked: number; hits: number; notified: number; items?: string[]; skipped?: string; error?: string }

export async function runBannedWatch(opts: { preview?: boolean } = {}): Promise<BannedWatchResult> {
  const db = supabaseAdmin()
  const banned = await loadBanned(db)
  if (!banned.length) return { ok: true, banned: 0, checked: 0, hits: 0, notified: 0, skipped: 'nobody is marked Banned' }
  const today = etToday()
  const { rows } = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select('id,listing_id,listing_name,guest_id,guest_name,guest_email,guest_phone,check_in,check_out,nights,status,source,confirmation_code')
    .gte('check_out', today).order('id').range(a, b), 15)
  const live = rows.filter(r => isLiveStay(r.status))
  const hits = live.map(r => ({ r, hit: matchBanned(r, banned) })).filter(x => x.hit) as { r: any; hit: BanHit }[]

  const state = await readState()
  // A booking already raised for the same person is not raised again; a name-only "possible" that
  // later firms up (the email arrives) is raised again, because that is new information.
  const fresh = hits.filter(({ r, hit }) => { const s = state[str(r.id)]; return !s || s.key !== hit.profile.key || (!s.strong && hit.strong) })
  const items = fresh.map(({ r, hit }) => `${hit.strong ? 'BANNED' : 'POSSIBLE'} ${str(r.guest_name)} · ${str(r.listing_name)} · ${str(r.check_in).slice(0, 10)} (${hit.how})`)
  if (opts.preview) return { ok: true, banned: banned.length, checked: live.length, hits: hits.length, notified: 0, items }

  let notified = 0
  if (fresh.length) {
    const { opsRecipients } = await import('@/lib/ops-behind')
    const { notify } = await import('@/lib/notify')
    const to = await opsRecipients()
    for (const { r, hit } of fresh.slice(0, 25)) {
      const unit = str(r.listing_name) || str(r.listing_id)
      const who = str(r.guest_name) || 'Guest'
      const title = hit.strong
        ? `⛔ Banned guest booked: ${who} · ${unit}`
        : `⚠️ Possible banned guest booked: ${who} · ${unit}`
      const body = [
        `${day(str(r.check_in).slice(0, 10))} → ${day(str(r.check_out).slice(0, 10))}${r.source ? ' · ' + str(r.source) : ''}${r.confirmation_code ? ' · ' + str(r.confirmation_code) : ''}.`,
        hit.strong ? `Matches banned profile "${hit.profile.name || hit.profile.key}" by ${hit.how}.` : `Same name as banned profile "${hit.profile.name}" — name only, so check it is the same person.`,
        hit.profile.reason ? `Reason: ${hit.profile.reason}` : '',
      ].filter(Boolean).join(' ')
      const res = await notify(to, { kind: 'banned_guest', title, body, link: '/reservations/' + encodeURIComponent(str(r.id)), entity: { type: 'banned_guest', id: str(r.id) } })
      if (res.ok) {
        notified++
        state[str(r.id)] = { at: new Date().toISOString(), key: hit.profile.key, strong: hit.strong, out: str(r.check_out).slice(0, 10) }
      }
    }
  }
  // Keep the memory small: forget bookings that have checked out.
  for (const [id, s] of Object.entries(state)) if (s && s.out && s.out < today) delete state[id]
  if (notified || fresh.length === 0) {
    try { await db.from('app_settings').upsert({ key: STATE_KEY, value: JSON.stringify(state), updated_by: 'banned-watch', updated_at: new Date().toISOString() }) } catch { /* next run retries */ }
  }
  return { ok: true, banned: banned.length, checked: live.length, hits: hits.length, notified, items }
}
