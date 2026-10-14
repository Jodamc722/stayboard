// WRITING AND READING WHAT WE KNOW ABOUT A GUEST (Jon, 2026-10-14).
//
// Two writes, one order, every time: the understanding lands on the reservation first, then the
// profile is rebuilt from EVERY understanding we hold for that person. Rebuilt, not patched —
// a profile patched in place drifts from the rows under it, and then nobody can say where the
// "two cars" came from. Rebuild is cheap (a handful of rows) and always reconcilable.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { cleanUnderstanding, mergeUnderstanding, tagsFor, guestKey, type Understanding } from './guest-profile'

export type GuestProfile = {
  guest_key: string
  guesty_id: string | null
  name: string | null
  phone: string | null
  data: Understanding
  tags: string[]
  stays: number
  first_seen: string | null
  last_seen: string | null
  updated_at: string
}

// A booking that was never a stay is not a stay. Inquiries and cancellations must not make a
// first-time guest look like a regular — the repeat flag is read by people deciding how to treat
// someone, and being wrong in that direction is worse than being silent.
const DEAD_STATUS = /inquiry|cancel|declin|expire|denied|unavailable/i

const sb = () => supabaseAdmin()

/** Every reservation that is the same human being, newest first. */
export async function staysFor(key: string): Promise<{ id: string; check_in: string | null; status: string | null; listing_id: string | null }[]> {
  if (!key) return []
  const db = sb()
  const [kind, val] = [key.slice(0, 1), key.slice(2)]
  let rows: any[] = []
  if (kind === 'g') {
    const { data } = await db.from('guesty_reservations').select('id,check_in,status,listing_id').eq('guest_id', val).limit(200)
    rows = data || []
  } else if (kind === 'p') {
    // The phone is stored as Guesty formatted it, so the last nine digits are compared in JS
    // rather than in SQL. Candidates are narrowed by the trailing digits first so this is not a
    // table scan on a portfolio with five figures of reservations.
    const { data } = await db.from('guesty_reservations').select('id,check_in,status,listing_id,guest_phone')
      .ilike('guest_phone', `%${val.slice(-4)}%`).limit(500)
    rows = (data || []).filter(r => String(r.guest_phone || '').replace(/\D/g, '').slice(-9) === val)
  } else {
    const { data } = await db.from('guesty_reservations').select('id,check_in,status,listing_id,guest_name')
      .ilike('guest_name', val).limit(200)
    rows = data || []
  }
  return rows
    .filter(r => !DEAD_STATUS.test(String(r.status || '')))
    .sort((a, b) => String(b.check_in || '').localeCompare(String(a.check_in || '')))
}

/** How many stays this person has with us, counting the one in front of you. */
export async function stayCount(key: string): Promise<number> {
  return (await staysFor(key)).length
}

/**
 * Record what we learned on one reservation, then rebuild the person's profile.
 * `source` says where it came from; a call never overwrites what a person typed by hand, because
 * the person was on the call and the model was reading a transcript of it.
 */
export async function recordUnderstanding(opts: {
  reservationId: string
  guestKey: string
  listingId?: string | null
  checkIn?: string | null
  u: Understanding
  source: 'call' | 'manual'
  callId?: string | null
  byEmail?: string | null
}): Promise<{ ok: boolean; understanding: Understanding; error?: string }> {
  const db = sb()
  const next = cleanUnderstanding(opts.u)
  if (!opts.reservationId || !opts.guestKey) return { ok: false, understanding: next, error: 'No reservation or guest.' }

  const { data: existing } = await db.from('guest_understanding').select('data,source').eq('reservation_id', opts.reservationId).maybeSingle()
  const prev: Understanding = (existing?.data && typeof existing.data === 'object') ? existing.data : {}

  // A hand-typed field outranks a model reading of the same field. Merge order does the work:
  // from a call, what a person already said wins; from a person, the new answer wins.
  const merged = opts.source === 'call' && prev.heard
    ? mergeUnderstanding(next, keepSaid(prev))
    : mergeUnderstanding(prev, next)

  const source = existing?.source && existing.source !== opts.source ? 'mixed' : opts.source
  const { error } = await db.from('guest_understanding').upsert({
    reservation_id: opts.reservationId,
    guest_key: opts.guestKey,
    listing_id: opts.listingId || null,
    check_in: opts.checkIn || null,
    data: merged,
    source,
    call_id: opts.callId || null,
    by_email: opts.byEmail || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'reservation_id' })
  if (error) return { ok: false, understanding: merged, error: error.message }

  await rebuildProfile(opts.guestKey).catch(() => {})
  return { ok: true, understanding: merged }
}

/** The subset of a stored understanding that a person typed — what a call must not overwrite. */
function keepSaid(u: Understanding): Understanding {
  if (!u.heard) return {}
  const out: any = { heard: {} }
  for (const [k, how] of Object.entries(u.heard)) {
    if (how === 'said' && (u as any)[k] !== undefined) { out[k] = (u as any)[k]; out.heard[k] = 'said' }
  }
  return out
}

/** Rebuild one person's profile from every understanding row we hold, oldest first. */
export async function rebuildProfile(key: string): Promise<GuestProfile | null> {
  if (!key) return null
  const db = sb()
  const [{ data: rows }, stays] = await Promise.all([
    db.from('guest_understanding').select('data,check_in').eq('guest_key', key).order('check_in', { ascending: true }).limit(60),
    staysFor(key),
  ])
  let data: Understanding = {}
  for (const r of rows || []) data = mergeUnderstanding(data, cleanUnderstanding(r.data))

  const newest = stays[0]
  const oldest = stays[stays.length - 1]
  let name: string | null = null, phone: string | null = null, guestyId: string | null = null
  if (newest) {
    const { data: res } = await db.from('guesty_reservations').select('guest_id,guest_name,guest_phone').eq('id', newest.id).maybeSingle()
    name = res?.guest_name || null; phone = res?.guest_phone || null; guestyId = res?.guest_id || null
  }

  const row = {
    guest_key: key,
    guesty_id: guestyId,
    name, phone,
    data,
    tags: tagsFor(data, { stays: stays.length }),
    stays: stays.length,
    first_seen: oldest?.check_in || null,
    last_seen: newest?.check_in || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('guest_profiles').upsert(row, { onConflict: 'guest_key' })
  if (error) return null
  return row as GuestProfile
}

/** The profile as stored. Null when we have never learned anything about this person. */
export async function profileFor(key: string): Promise<GuestProfile | null> {
  if (!key) return null
  const { data } = await sb().from('guest_profiles').select('*').eq('guest_key', key).maybeSingle()
  if (!data) return null
  return {
    ...data,
    data: (data.data && typeof data.data === 'object') ? data.data : {},
    tags: Array.isArray(data.tags) ? data.tags : [],
  } as GuestProfile
}

/** This reservation's own log — what we learned on THIS stay, not the roll-up. */
export async function understandingFor(reservationId: string): Promise<{ data: Understanding; source: string; updated_at: string } | null> {
  const { data } = await sb().from('guest_understanding').select('data,source,updated_at').eq('reservation_id', reservationId).maybeSingle()
  if (!data) return null
  return { data: (data.data && typeof data.data === 'object') ? data.data : {}, source: data.source, updated_at: data.updated_at }
}

/** Everything the reservation page needs in one call. */
export async function guestViewFor(reservationId: string): Promise<{
  key: string; profile: GuestProfile | null; stay: Understanding; source: string | null; stays: number; repeat: boolean
} | null> {
  const db = sb()
  const { data: res } = await db.from('guesty_reservations').select('id,guest_id,guest_name,guest_phone').eq('id', reservationId).maybeSingle()
  if (!res) return null
  const key = guestKey(res)
  const [profile, own] = await Promise.all([profileFor(key), understandingFor(reservationId)])
  const stays = profile?.stays ?? (await stayCount(key))
  return { key, profile, stay: own?.data || {}, source: own?.source || null, stays, repeat: stays >= 2 }
}
