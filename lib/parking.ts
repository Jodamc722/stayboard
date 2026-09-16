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
// definition — `parkingBooked()` below, which the welcome-call desk imports rather than copying.
//
// ── THE SPARE POOL ──────────────────────────────────────────────────────────────────────────────
// "They're going to provide a couple of extra codes just in case for the weekends." A permit does
// not have to be born attached to a stay: an unassigned one sits in the pool until somebody binds
// it. Claiming is a conditional UPDATE, so two people cannot take the same code — see claimSpare.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf, marketOf } from './segments'
import { pageRows } from './db-page'
import { isLiveStay } from './stay-status'

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
async function scopeUnits(link: ParkingLink): Promise<{ ids: Set<string> | null; units: Record<string, { name: string; building: string }>; label: string; truncated: boolean }> {
  const db = supabaseAdmin()
  const { rows, truncated } = await pageRows<any>((a, b) => db
    .from('guesty_listings').select('id,nickname,title,building,address_city,status').order('id').range(a, b), 6)
  const units: Record<string, { name: string; building: string }> = {}
  for (const l of rows) {
    const nm = l.nickname || l.title || 'Unit'
    units[str(l.id)] = { name: nm, building: str(buildingOf(str(l.building), nm) || 'Other') }
  }
  if (link.scope_type === 'portfolio') return { ids: null, units, label: 'Whole portfolio', truncated }

  const ids = new Set<string>()
  if (link.scope_type === 'listing') {
    for (const id of link.scope_ids) ids.add(str(id))
    return { ids, units, label: `${ids.size} unit${ids.size === 1 ? '' : 's'}`, truncated }
  }
  if (link.scope_type === 'owner') {
    const { data: owners } = await db.from('guesty_owners').select('id, listing_ids').in('id', link.scope_ids).limit(200)
    for (const o of ((owners || []) as any[])) for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) ids.add(str(id))
    return { ids, units, label: 'Owner units', truncated }
  }
  // BOTH SIDES THROUGH THE REGISTRY. The builder's building picker offers the RAW Guesty strings,
  // so a link for this building holds "17 West" while buildingOf() answers "17WEST" — comparing one
  // against the other matches nothing, and a parking board with no rows reads as "nothing to do"
  // while every guest arrives at a gate with no permit. Canonicalising the scope value too means
  // the link works whether it was minted from the raw picker or with a canonical label.
  const want = new Set(link.scope_ids.map(s => canonBuilding(str(s))))
  for (const l of rows) {
    const nm = l.nickname || l.title || ''
    const hit = link.scope_type === 'market'
      ? want.has(str(marketOf(l.building, l.address_city, nm)).toLowerCase())
      : want.has(canonBuilding(str(buildingOf(str(l.building), nm) || '')))
    if (hit) ids.add(str(l.id))
  }
  return { ids, units, label: link.scope_ids.join(' · '), truncated }
}

/** One spelling for a building, whichever end it came from. */
function canonBuilding(v: string): string {
  const raw = str(v).trim()
  if (!raw) return ''
  return str(buildingOf(raw, '') || raw).toLowerCase()
}

/**
 * The building a permit is filed under — always the CANONICAL label, never the raw Guesty text.
 *
 * This used to uppercase `scope_ids[0]`, which happens to be right for 17WEST and wrong for every
 * other building in the registry ('Botanica', 'Arya', 'Park Towers'…). The label ends up in the
 * storage path and in the row, so two links over the same units would have filed permits under two
 * different strings and neither could read the other's.
 */
function buildingOfLink(link: ParkingLink, units: Record<string, { name: string; building: string }>, ids: Set<string> | null): string {
  if (link.scope_type === 'building' && link.scope_ids.length) {
    const raw = str(link.scope_ids[0])
    return str(buildingOf(raw, '') || raw)
  }
  if (ids) for (const id of Array.from(ids)) { const u = units[id]; if (u) return u.building }
  return 'PORTFOLIO'
}

/** Storage keys are paths. A building string with a slash in it would nest silently. */
const pathSafe = (v: string) => str(v).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'building'

// ── HAS THIS STAY BOOKED PARKING? ───────────────────────────────────────────────────────────────
// BOOKED, NOT PAID, AND THE NAME SAYS SO. This reads a line item off the Guesty folio. A line item
// is a charge that EXISTS; whether the guest has settled it lives in `balanceDue` / `isFullyPaid`,
// which this does not look at. Calling it "paid" would have put a send-on-payment rule on a
// booking signal — the guest gets a gate code the moment they add parking to the cart.
//
// ONE DEFINITION, TWO READERS. The welcome-call desk reads the same folio for the same thing, so
// it imports this rather than keeping its own copy. They had already drifted apart by one clause
// (the desk excludes "resolution" lines, this did not), which is exactly the drift lib/stay-status
// exists to stop.
const PARK_RE = /park/i
const NOT_PARK_RE = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay|verify|resolution/i

/** The parking line on a reservation's folio, or null. Amount in the reservation's currency. */
export function parkingBooked(money: any): number | null {
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
  /** The folio line, or null. BOOKED — not a statement that the guest has settled it. */
  parkingBooked: number | null
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
  counts: { stays: number; withPermit: number; needPermit: number; parkingBooked: number }
  pool: { spare: number; items: { id: string; label: string | null; uploadedAt: string }[] }
  /**
   * A SHORT READ IS NOT AN EMPTY DAY. pageRows reports truncation AND treats a query error as
   * truncation, so dropping this flag would render a timed-out read as a finished board saying
   * "nothing to do" — which on this page means guests arriving at a gate with no permit.
   */
  truncated: boolean
}

/**
 * The vendor's page. Every stay in the window whose unit is inside the link's scope, each carrying
 * whatever permit is already on file, plus the spare pool.
 */
export async function buildParkingBoard(link: ParkingLink): Promise<ParkingBoard> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const until = addDays(today, link.window_days)
  const { ids, units, label: scopeLabel, truncated: unitsShort } = await scopeUnits(link)
  const building = buildingOfLink(link, units, ids)

  // Stays that overlap the window: anyone still in house, and everyone arriving before it closes.
  // `check_out >= today` keeps the guest who is here now — they need a permit today, not tomorrow.
  const { rows: resRows, truncated: staysShort } = await pageRows<any>((a, b) => {
    let q = db.from('guesty_reservations')
      // The INVOICE ITEMS, not the whole money blob. Selecting raw->money across thousands of rows
      // is the thing this codebase tells itself not to do in three separate files, and here it
      // would run unbounded whenever a link covers more units than `.in()` will carry.
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,status,confirmation_code,items:raw->money->invoiceItems')
      .gte('check_out', today).lte('check_in', until)
      .order('check_in').order('id').range(a, b)
    // A building is a few dozen units; `.in()` keeps the scan off the whole portfolio.
    if (ids && ids.size && ids.size <= 400) q = q.in('listing_id', Array.from(ids))
    return q
  }, 8)

  const inScope = (lid: string) => !ids || ids.has(lid)
  const stays = resRows
    // lib/stay-status, not a fourth copy of the same regex. It also treats a blank status as NOT
    // live, which the local copy did not — a status-less row was appearing on the vendor board.
    .filter(r => isLiveStay(r.status))
    .filter(r => inScope(str(r.listing_id)))

  // Permits already on file for these stays, plus the pool for this building.
  const resIds = stays.map(r => str(r.id))
  const byRes: Record<string, any> = {}
  for (let i = 0; i < resIds.length; i += 200) {
    const { data } = await db.from('parking_permits').select('*')
      .in('reservation_id', resIds.slice(i, i + 200)).eq('status', 'assigned')
    for (const p of ((data || []) as any[])) byRes[str(p.reservation_id)] = p
  }
  // THE POOL BELONGS TO THE LINK, NOT THE BUILDING. Scoping it by building meant a link covering
  // one unit could read — and hand out — the whole building's drawer of gate credentials, and two
  // links over the same units kept two pools that could not see each other.
  const { data: spareRows } = await db.from('parking_permits').select('id,label,uploaded_at')
    .eq('source_code', link.code).eq('status', 'spare').order('uploaded_at').limit(200)

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
      parkingBooked: parkingBooked({ invoiceItems: r.items }),
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
    truncated: unitsShort || staysShort,
    rows,
    counts: {
      stays: rows.length,
      withPermit: rows.filter(r => !!r.permit).length,
      needPermit: rows.filter(r => !r.permit).length,
      parkingBooked: rows.filter(r => r.parkingBooked != null).length,
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
  // supabase-js resolves {data,error} rather than throwing, so a try/catch here would never fire
  // and a real failure would surface later as a raw "Bucket not found" in front of the vendor.
  const mk = await db.storage.createBucket(PARKING_BUCKET, { public: false })
  if (mk.error && !/exist/i.test(String(mk.error.message || ''))) {
    return { ok: false, error: 'The code store is not reachable right now.' }
  }

  const ext = inp.mime === 'image/png' ? 'png' : inp.mime === 'application/pdf' ? 'pdf' : 'jpg'
  const folder = inp.stay ? pathSafe(inp.stay.reservationId) : 'pool'
  const path = `${pathSafe(inp.building)}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await db.storage.from(PARKING_BUCKET).upload(path, inp.bytes, { contentType: inp.mime, upsert: false })
  if (up.error) return { ok: false, error: 'Could not store that file. Try again.' }

  // A stay holds one live permit, so a re-upload voids the old one — and voiding keeps the history,
  // because "which code did we send them" is a question somebody asks after a guest is turned away
  // at the gate.
  //
  // THE VOID IS UNDONE IF THE INSERT FAILS. Voiding first and inserting second leaves a window
  // where a failure — a concurrent upload hitting the unique index, a transient 5xx — would take a
  // WORKING permit away and put nothing in its place: the stay would show as needing a code while
  // the guest held one that no longer existed. A transaction would be better and needs an RPC;
  // restoring the rows we touched is the honest version of this without one.
  let replaced = false
  const voided: string[] = []
  if (inp.stay) {
    const { data: old } = await db.from('parking_permits').select('id')
      .eq('reservation_id', inp.stay.reservationId).eq('status', 'assigned').limit(5)
    for (const o of ((old || []) as any[])) {
      const { error: vErr } = await db.from('parking_permits').update({
        status: 'void', voided_at: new Date().toISOString(), voided_by: inp.who, void_reason: 'replaced by a newer upload',
      }).eq('id', o.id).eq('status', 'assigned')
      if (vErr) {
        await db.storage.from(PARKING_BUCKET).remove([path]).catch(() => null)
        await restore(db, voided)
        return { ok: false, error: 'Could not replace the existing code. Try again.' }
      }
      voided.push(str(o.id))
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
    // No orphans, in either direction: the bytes go, and any permit we voted off the island comes
    // back. A raw Postgres string never reaches the vendor — "duplicate key value violates unique
    // constraint" is not a sentence anyone at a garage can act on.
    await db.storage.from(PARKING_BUCKET).remove([path]).catch(() => null)
    await restore(db, voided)
    const dup = /duplicate key|unique constraint/i.test(String(error.message || ''))
    return { ok: false, error: dup ? 'Somebody just saved a code for that stay. Reload and check it.' : 'Could not save that code. Try again.' }
  }
  return { ok: true, id: str((data || [])[0]?.id), replaced }
}

/** Put back permits this upload voided, after the upload failed to replace them. */
async function restore(db: ReturnType<typeof supabaseAdmin>, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await db.from('parking_permits')
        .update({ status: 'assigned', voided_at: null, voided_by: null, void_reason: null })
        .eq('id', id)
    } catch { /* best effort — the caller is already reporting a failure */ }
  }
}

// ── IS THIS ACTUALLY THE FILE IT SAYS IT IS? ────────────────────────────────────────────────────
// The filename decides nothing. Without this, "PNG, JPG or PDF only" means "named PNG, JPG or
// PDF", and the bucket is an arbitrary file drop for anybody holding the passcode. It is not an
// XSS route — the declared content type is pinned at upload and the bucket is a different origin —
// but a store that accepts anything is a store somebody will put anything in.
export function sniffMime(b: Buffer): string | null {
  if (b.length < 8) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  return null
}

/**
 * HOW MANY CODES HAVE COME THROUGH THIS LINK LATELY. Nothing counted uploads, so anyone with the
 * passcode could fill the bucket at request rate. A garage sends a handful a day.
 */
export async function uploadsInLastHour(code: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await supabaseAdmin().from('parking_access_log').select('id', { count: 'exact', head: true })
      .eq('code', code).eq('action', 'upload').gte('created_at', since)
    return count || 0
  } catch { return 0 }
}
export const UPLOADS_PER_HOUR = 120

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

  // The pre-check above is a read and a write apart, so the unique index is the real guard against
  // two people binding different spares to one stay. Its message is not one a person can act on.
  if (error) {
    const dup = /duplicate key|unique constraint/i.test(String(error.message || ''))
    return { ok: false, error: dup ? 'Somebody just gave that stay a code. Reload and check it.' : 'Could not assign that spare. Try again.' }
  }
  if (!(data || []).length) return { ok: false, error: 'That spare was already taken — pick another.' }
  return { ok: true, id: str((data as any[])[0].id) }
}

/** A short-lived read. The path never reaches the browser; only this URL does, and not for long. */
export async function signedQrUrl(permitId: string, scope: { code: string; building: string; reservationIds: Set<string> }): Promise<{ url: string; mime: string | null } | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('parking_permits').select('id,storage_path,building,reservation_id,status,mime,source_code').eq('id', permitId).limit(1)
  const p = (data || [])[0] as any
  if (!p || p.status === 'void') return null
  // THE SCOPE GUARD, AGAIN. A permit id is a uuid, but the link asking for it must be one that
  // covers that permit. Two different tests, because a permit is one of two things:
  //   • bound to a stay — the stay must be on THIS board
  //   • a spare         — it must have come through THIS link (a spare has no stay to check)
  if (str(p.building) !== scope.building) return null
  if (p.reservation_id) {
    if (!scope.reservationIds.has(str(p.reservation_id))) return null
  } else if (str(p.source_code) !== scope.code) return null
  const signed = await db.storage.from(PARKING_BUCKET).createSignedUrl(str(p.storage_path), QR_SIGNED_SECONDS)
  if (!signed.data?.signedUrl) return null
  return { url: signed.data.signedUrl, mime: p.mime ? str(p.mime) : null }
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
const WRONG_LIMIT_CODE = 40
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
  try {
    const since = new Date(Date.now() - WRONG_WINDOW_MIN * 60000).toISOString()
    const db = supabaseAdmin()
    const base = () => db.from('parking_access_log').select('id', { count: 'exact', head: true })
      .eq('code', code).eq('action', 'denied').gte('created_at', since)
    // PER ADDRESS, AND PER CODE. The per-IP count does nothing against somebody rotating addresses,
    // which is most of what an attacker would do; the per-code count is what notices that. It is set
    // far higher so a busy garage office behind one NAT cannot trip it by fumbling a passcode.
    const [{ count: mine }, { count: all }] = await Promise.all([
      ip ? base().eq('ip', ip) : Promise.resolve({ count: 0 } as any),
      base(),
    ])
    return (mine || 0) >= WRONG_LIMIT || (all || 0) >= WRONG_LIMIT_CODE
  } catch { return false }  // counting failures never block a correct passcode
}

export const LOCKOUT_MINUTES = WRONG_WINDOW_MIN
