// PARKING PERMITS — the 17 West garage link, and the QR codes that come back through it.
//
// Jon, 2026-09-16: "a shareable link that's password protected for all reservations at 17 West…
// send this to a parking vendor that needs to generate QR codes. We should have them upload a QR
// code into the system for that reservation."
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────────────────────────────
// It is NOT a new share-link system. A parking link is a row in `share_links` with the `parking`
// section ticked — same table, same builder, same passcode, same revoke, same hub as every other
// link in the app. Exactly how the field board was added to that table in August. What lives here
// is the part that is genuinely new: resolving the link to a building's upcoming stays, and the
// permit the vendor hands back.
//
// ── EVERY UPCOMING STAY, NOT JUST THE PAID ONES (Jon's call) ────────────────────────────────────
// "it's better to have the QR codes generated versus waiting for the vendor, in case the guest
// books last minute or something like that, and the vendor doesn't work weekends."
//
// So the list is every stay in the window, and whether the guest has PAID for parking is a flag on
// the row rather than a filter on the query. The vendor works ahead; the payment signal is for us,
// and it is what a send-on-payment rule will read when it exists. Same flag, two readers, one
// definition — `parkingCharge()` below, which is the rule the welcome-call desk already uses.
//
// ── THE SPARE POOL ──────────────────────────────────────────────────────────────────────────────
// "They're going to provide a couple of extra codes just in case for the weekends." A permit does
// not have to be born attached to a stay: an unassigned one sits in the pool until somebody binds
// it. Claiming is a conditional UPDATE, so two people cannot take the same code — see claimSpare.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf, marketOf } from './segments'
import { pageRows } from './db-page'

const TZ = 'America/New_York'
export const PARKING_BUCKET = 'parking-qr'
/** A QR opens a gate, so the read is short — long enough to render, not to pass around. */
export const QR_SIGNED_SECONDS = 300

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdET(d) }

/** The one section key that turns a share_links row into a parking board. */
export const PARKING_SECTION = 'parking'
export const isParkingLink = (sections: any): boolean => !!sections && sections[PARKING_SECTION] === true

export type ParkingLink = {
  id: string; code: string; label: string
  scope_type: string; scope_ids: string[]
  sections: Record<string, boolean>
  passcode: string | null
  guest_names: boolean
  window_days: number
}

export async function getParkingLink(code: string): Promise<ParkingLink | null> {
  if (!/^[0-9a-f]{12,32}$/i.test(String(code || ''))) return null
  const db = supabaseAdmin()
  const { data } = await db.from('share_links').select('*').eq('code', code).is('revoked_at', null).limit(1)
  const row = (data || [])[0] as any
  if (!row || !isParkingLink(row.sections)) return null
  return {
    id: str(row.id), code: str(row.code), label: str(row.label) || 'Parking',
    scope_type: str(row.scope_type) || 'portfolio',
    scope_ids: Array.isArray(row.scope_ids) ? row.scope_ids.map(str) : [],
    sections: (row.sections || {}) as Record<string, boolean>,
    passcode: row.passcode ? str(row.passcode) : null,
    guest_names: row.guest_names === true,
    // The builder clamps this 7..120. A parking vendor works ahead, so the default leans long.
    window_days: Math.min(Math.max(Number(row.window_days) || 45, 7), 120),
  }
}

/**
 * WHICH UNITS THIS LINK IS ABOUT.
 *
 * Buildings resolve through the canonical `buildingOf()` registry, never the raw Guesty column.
 * The generic /share route matches that raw column and is the known-bad path: it holds many
 * spellings per building, so a building-scoped link silently misses units. A garage link that
 * misses units means a guest with no permit, which is the failure the vendor gets blamed for.
 */
async function scopeUnits(link: ParkingLink): Promise<{ ids: Set<string> | null; units: Record<string, { name: string; building: string }>; label: string }> {
  const db = supabaseAdmin()
  const { rows } = await pageRows<any>((a, b) => db
    .from('guesty_listings').select('id,nickname,title,building,address_city,status').order('id').range(a, b), 6)
  const units: Record<string, { name: string; building: string }> = {}
  for (const l of rows) {
    const nm = l.nickname || l.title || 'Unit'
    units[str(l.id)] = { name: nm, building: str(buildingOf(str(l.building), nm) || 'Other') }
  }
  if (link.scope_type === 'portfolio') return { ids: null, units, label: 'Whole portfolio' }

  const ids = new Set<string>()
  if (link.scope_type === 'listing') {
    for (const id of link.scope_ids) ids.add(str(id))
    return { ids, units, label: `${ids.size} unit${ids.size === 1 ? '' : 's'}` }
  }
  if (link.scope_type === 'owner') {
    const { data: owners } = await db.from('guesty_owners').select('id, listing_ids').in('id', link.scope_ids).limit(200)
    for (const o of ((owners || []) as any[])) for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) ids.add(str(id))
    return { ids, units, label: 'Owner units' }
  }
  const want = link.scope_ids.map(s => str(s).toLowerCase())
  for (const l of rows) {
    const nm = l.nickname || l.title || ''
    const hit = link.scope_type === 'market'
      ? want.includes(str(marketOf(l.building, l.address_city, nm)).toLowerCase())
      : want.includes(str(buildingOf(str(l.building), nm) || '').toLowerCase())
    if (hit) ids.add(str(l.id))
  }
  return { ids, units, label: link.scope_ids.join(' · ') }
}

/** The building a permit is filed under — the first one this link actually covers. */
function buildingOfLink(link: ParkingLink, units: Record<string, { name: string; building: string }>, ids: Set<string> | null): string {
  if (link.scope_type === 'building' && link.scope_ids.length) return str(link.scope_ids[0]).toUpperCase()
  if (ids) for (const id of Array.from(ids)) { const u = units[id]; if (u) return u.building }
  return 'PORTFOLIO'
}

// ── HAS THIS STAY PAID FOR PARKING? ─────────────────────────────────────────────────────────────
// ONE DEFINITION, TWO READERS. The welcome-call desk already reads exactly this off the Guesty
// folio (lib/call-desk moneyStatus). Parking is not a catalog item in this app — guests buy it as
// a Guesty invoice line — so the folio IS the source of truth, and a send-on-payment rule must
// read the same thing this board shows or the two will disagree about who owes a guest a QR.
const PARK_RE = /park/i
const NOT_PARK_RE = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay/i

/** The parking charge on a reservation's folio, or null. Amount in the reservation's currency. */
export function parkingCharge(money: any): number | null {
  const items = money && Array.isArray(money.invoiceItems) ? money.invoiceItems : []
  for (const it of items) {
    const t = str(it && (it.title || it.name)).trim()
    if (!t || !PARK_RE.test(t) || NOT_PARK_RE.test(t)) continue
    const amt = Number(it && it.amount)
    return Number.isFinite(amt) ? amt : 0
  }
  return null
}

/** "Maria Gonzalez" -> "Maria G." — the same rule the generic share link uses. */
function shortName(n: string): string {
  const parts = str(n).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Guest'
  if (parts.length === 1) return parts[0]
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.'
}

const DEAD_STAY = /cancel|declin|expire|denied|inquir|unavailable/i

export type ParkingRow = {
  reservationId: string
  unit: string
  listingId: string
  guest: string
  confirmation: string
  checkIn: string
  checkOut: string
  nights: number
  arrivingIn: number          // days from today; negative = already in house
  inHouse: boolean
  paidParking: number | null  // the folio charge, or null if none
  permit: { id: string; label: string | null; uploadedAt: string; uploadedBy: string | null; wasSpare: boolean } | null
}

export type ParkingBoard = {
  ok: true
  label: string
  building: string
  scopeLabel: string
  today: string
  windowDays: number
  guestNames: boolean
  rows: ParkingRow[]
  counts: { stays: number; withPermit: number; needPermit: number; paidParking: number }
  pool: { spare: number; items: { id: string; label: string | null; uploadedAt: string }[] }
}

/**
 * The vendor's page. Every stay in the window whose unit is inside the link's scope, each carrying
 * whatever permit is already on file, plus the spare pool.
 */
export async function buildParkingBoard(link: ParkingLink): Promise<ParkingBoard> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const until = addDays(today, link.window_days)
  const { ids, units, label: scopeLabel } = await scopeUnits(link)
  const building = buildingOfLink(link, units, ids)

  // Stays that overlap the window: anyone still in house, and everyone arriving before it closes.
  // `check_out >= today` keeps the guest who is here now — they need a permit today, not tomorrow.
  const { rows: resRows } = await pageRows<any>((a, b) => {
    let q = db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,status,confirmation_code,money:raw->money')
      .gte('check_out', today).lte('check_in', until)
      .order('check_in').order('id').range(a, b)
    // A building is a few dozen units; `.in()` keeps the scan off the whole portfolio.
    if (ids && ids.size && ids.size <= 400) q = q.in('listing_id', Array.from(ids))
    return q
  }, 8)

  const inScope = (lid: string) => !ids || ids.has(lid)
  const stays = resRows
    .filter(r => !DEAD_STAY.test(str(r.status)))
    .filter(r => inScope(str(r.listing_id)))

  // Permits already on file for these stays, plus the pool for this building.
  const resIds = stays.map(r => str(r.id))
  const byRes: Record<string, any> = {}
  for (let i = 0; i < resIds.length; i += 200) {
    const { data } = await db.from('parking_permits').select('*')
      .in('reservation_id', resIds.slice(i, i + 200)).eq('status', 'assigned')
    for (const p of ((data || []) as any[])) byRes[str(p.reservation_id)] = p
  }
  const { data: spareRows } = await db.from('parking_permits').select('id,label,uploaded_at')
    .eq('building', building).eq('status', 'spare').order('uploaded_at').limit(200)

  const rows: ParkingRow[] = stays.map(r => {
    const lid = str(r.listing_id)
    const p = byRes[str(r.id)]
    const ci = str(r.check_in).slice(0, 10)
    const co = str(r.check_out).slice(0, 10)
    return {
      reservationId: str(r.id),
      listingId: lid,
      unit: (units[lid] || {}).name || str(r.listing_name) || 'Unit',
      // PII stays behind the same toggle the rest of the app uses. A garage can match "Maria G."
      // to a permit; it does not need a full legal name unless the link was minted to give one.
      guest: link.guest_names ? (str(r.guest_name) || 'Guest') : shortName(str(r.guest_name)),
      confirmation: str(r.confirmation_code),
      checkIn: ci,
      checkOut: co,
      nights: Number(r.nights) || 0,
      arrivingIn: Math.round((new Date(ci + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000),
      inHouse: ci <= today && co > today,
      paidParking: parkingCharge(r.money),
      permit: p ? {
        id: str(p.id), label: p.label ? str(p.label) : null,
        uploadedAt: str(p.uploaded_at), uploadedBy: p.uploaded_by ? str(p.uploaded_by) : null,
        wasSpare: !!p.assigned_at && str(p.assigned_at) !== str(p.uploaded_at),
      } : null,
    }
  })

  return {
    ok: true,
    label: link.label,
    building,
    scopeLabel,
    today,
    windowDays: link.window_days,
    guestNames: link.guest_names,
    rows,
    counts: {
      stays: rows.length,
      withPermit: rows.filter(r => !!r.permit).length,
      needPermit: rows.filter(r => !r.permit).length,
      paidParking: rows.filter(r => r.paidParking != null).length,
    },
    pool: {
      spare: (spareRows || []).length,
      items: ((spareRows || []) as any[]).map(s => ({ id: str(s.id), label: s.label ? str(s.label) : null, uploadedAt: str(s.uploaded_at) })),
    },
  }
}

// ── WRITES ──────────────────────────────────────────────────────────────────────────────────────

export type AttachInput = {
  link: ParkingLink
  building: string
  bytes: Buffer
  mime: string
  label: string | null
  who: string
  /** Omit for a spare — a code that goes in the drawer instead of onto a stay. */
  stay?: { reservationId: string; listingId: string; unit: string; checkIn: string; checkOut: string }
}

/**
 * Store the file, then the row. In that order, and the object is removed if the row fails — an
 * orphaned QR in a bucket is a credential nobody can account for.
 */
export async function attachPermit(inp: AttachInput): Promise<{ ok: true; id: string; replaced: boolean } | { ok: false; error: string }> {
  const db = supabaseAdmin()
  try { await db.storage.createBucket(PARKING_BUCKET, { public: false }) } catch { /* already there */ }

  const ext = inp.mime === 'image/png' ? 'png' : inp.mime === 'application/pdf' ? 'pdf' : 'jpg'
  const folder = inp.stay ? inp.stay.reservationId : 'pool'
  const path = `${inp.building}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await db.storage.from(PARKING_BUCKET).upload(path, inp.bytes, { contentType: inp.mime, upsert: false })
  if (up.error) return { ok: false, error: up.error.message }

  // A stay can hold one live permit. Re-uploading voids the old one rather than racing the unique
  // index — and voiding keeps the history, because "which code did we send them" is a question
  // somebody asks after a guest is turned away at the gate.
  let replaced = false
  if (inp.stay) {
    const { data: old } = await db.from('parking_permits').select('id')
      .eq('reservation_id', inp.stay.reservationId).eq('status', 'assigned').limit(5)
    for (const o of ((old || []) as any[])) {
      await db.from('parking_permits').update({
        status: 'void', voided_at: new Date().toISOString(), voided_by: inp.who, void_reason: 'replaced by a newer upload',
      }).eq('id', o.id)
      replaced = true
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await db.from('parking_permits').insert({
    building: inp.building,
    reservation_id: inp.stay ? inp.stay.reservationId : null,
    listing_id: inp.stay ? inp.stay.listingId : null,
    unit: inp.stay ? inp.stay.unit : null,
    check_in: inp.stay ? inp.stay.checkIn : null,
    check_out: inp.stay ? inp.stay.checkOut : null,
    storage_path: path,
    mime: inp.mime,
    bytes: inp.bytes.length,
    label: inp.label,
    status: inp.stay ? 'assigned' : 'spare',
    source_code: inp.link.code,
    uploaded_by: inp.who,
    uploaded_at: now,
    assigned_at: inp.stay ? now : null,
    assigned_by: inp.stay ? inp.who : null,
  }).select('id').limit(1)

  if (error) {
    // No orphans. If the row did not land, the bytes do not stay.
    await db.storage.from(PARKING_BUCKET).remove([path]).catch(() => null)
    return { ok: false, error: error.message }
  }
  return { ok: true, id: str((data || [])[0]?.id), replaced }
}

/**
 * BIND A SPARE TO A STAY — the weekend case, and the reason the pool exists.
 *
 * The claim is a CONDITIONAL update (`.eq('status','spare')`) and the row count decides the
 * winner, so two people reaching for the last code cannot both get it. A `select()` then `update()`
 * would hand it to both of them.
 */
export async function claimSpare(opts: {
  permitId: string; building: string; who: string
  stay: { reservationId: string; listingId: string; unit: string; checkIn: string; checkOut: string }
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = supabaseAdmin()
  const { data: already } = await db.from('parking_permits').select('id')
    .eq('reservation_id', opts.stay.reservationId).eq('status', 'assigned').limit(1)
  if ((already || []).length) return { ok: false, error: 'That stay already has a permit.' }

  const now = new Date().toISOString()
  const { data, error } = await db.from('parking_permits').update({
    status: 'assigned',
    reservation_id: opts.stay.reservationId,
    listing_id: opts.stay.listingId,
    unit: opts.stay.unit,
    check_in: opts.stay.checkIn,
    check_out: opts.stay.checkOut,
    assigned_at: now,
    assigned_by: opts.who,
  }).eq('id', opts.permitId).eq('building', opts.building).eq('status', 'spare').select('id')

  if (error) return { ok: false, error: error.message }
  if (!(data || []).length) return { ok: false, error: 'That spare was already taken — pick another.' }
  return { ok: true, id: str((data as any[])[0].id) }
}

/** A short-lived read. The path never reaches the browser; only this URL does, and not for long. */
export async function signedQrUrl(permitId: string, scope: { building: string; reservationIds?: Set<string> }): Promise<string | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('parking_permits').select('id,storage_path,building,reservation_id,status').eq('id', permitId).limit(1)
  const p = (data || [])[0] as any
  if (!p || p.status === 'void') return null
  // THE SCOPE GUARD, AGAIN. A permit id is a uuid, but the link asking for it must be a link that
  // covers that permit — otherwise one garage vendor's code reads another building's permits.
  if (str(p.building) !== scope.building) return null
  if (p.reservation_id && scope.reservationIds && !scope.reservationIds.has(str(p.reservation_id))) return null
  const signed = await db.storage.from(PARKING_BUCKET).createSignedUrl(str(p.storage_path), QR_SIGNED_SECONDS)
  return signed.data?.signedUrl || null
}

// ── THE LOG, AND THE LOCKOUT ────────────────────────────────────────────────────────────────────

export async function logParking(row: { code: string; action: string; detail?: string | null; ip?: string | null }): Promise<void> {
  try {
    await supabaseAdmin().from('parking_access_log').insert({
      code: row.code, action: row.action,
      detail: row.detail ? str(row.detail).slice(0, 300) : null,
      ip: row.ip ? str(row.ip).slice(0, 60) : null,
    })
  } catch { /* the log never blocks the work */ }
}

const WRONG_LIMIT = 8
const WRONG_WINDOW_MIN = 15

/**
 * Too many wrong passcodes from one place → stop answering for a while.
 *
 * Counted from the log, so the limit survives a redeploy — a counter in module memory resets on
 * every cold start, which on serverless is most requests. This is the same shape the vault code
 * uses. It is NOT a substitute for hashing the passcode, which the whole share-link family still
 * does not do; see the note in the route.
 */
export async function tooManyWrong(code: string, ip: string | null): Promise<boolean> {
  if (!ip) return false
  try {
    const since = new Date(Date.now() - WRONG_WINDOW_MIN * 60000).toISOString()
    const { count } = await supabaseAdmin().from('parking_access_log').select('id', { count: 'exact', head: true })
      .eq('code', code).eq('action', 'denied').eq('ip', ip).gte('created_at', since)
    return (count || 0) >= WRONG_LIMIT
  } catch { return false }  // counting failures never block a correct passcode
}

export const LOCKOUT_MINUTES = WRONG_WINDOW_MIN
