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
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf, marketOf } from './segments'
import { pageRows } from './db-page'
import { isLiveStay } from './stay-status'
import { getSetting } from './app-settings'
import { getToken } from './guesty'
import { writeCustomFields } from './guesty-custom-fields'
import { guestyFieldId, fieldIdHelp } from './guesty-field-id'

const TZ = 'America/New_York'
export const PARKING_BUCKET = 'parking-qr'
/** A QR opens a gate, so the read is short — long enough to render, not to pass around. */
export const QR_SIGNED_SECONDS = 300

// ── THE PERMIT'S OWN ADDRESS ────────────────────────────────────────────────────────────────────
// Jon, 2026-09-16: "Once the QR code is uploaded, we need to find a way to map that QR code to the
// reservation in Guesty."
//
// The thing written onto the booking is /permit/<token>, never the image and never a signed URL.
// A signed URL lives five minutes; a reservation lives weeks, so a field holding one would hold a
// dead link by the time anybody opened it. The token resolves to a fresh signed read on each open
// and stops resolving the moment the permit is voided — which is what makes a replaced code
// actually replaced rather than two live credentials for one gate.
//
// It is NOT the permit's uuid. That id is what the vendor's page passes around on a machine a
// garage office shares; a capability that ends up in a guest's confirmation should not be the same
// string that authorises the vendor UI.
const newToken = () => randomBytes(32).toString('hex')
const TOKEN_RE = /^[a-f0-9]{64}$/i

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
export const permitUrl = (token: string) => APP_URL + '/permit/' + token

/**
 * WHICH GUESTY FIELD THE LINK GOES IN. A name or the field's own 24-hex id — see guesty-field-id
 * for why the id is the escape hatch. Stored in app_settings so it is changed without a deploy,
 * and defaulted to the label somebody would naturally create in Guesty.
 */
export const PARKING_CFG_KEY = 'parking_cfg'
export type ParkingCfg = { customFieldName: string; writeToGuesty: boolean }
export const PARKING_CFG_DEFAULTS: ParkingCfg = { customFieldName: 'Parking QR', writeToGuesty: true }
/**
 * Read in the order somebody can actually change it: the stored setting, then the environment
 * variable, then the label a person would naturally create in Guesty.
 *
 * THE ENV VAR IS NOT DECORATION. There is no settings screen for this yet, so without it the only
 * way to point the feature at a different field would be hand-inserting a row into app_settings —
 * and the advice the failure message gives ("paste the field's own ID") would name a box that does
 * not exist in the product. PARKING_QR_FIELD is a box that does exist: Vercel, one value, no
 * deploy of ours required.
 */
export const PARKING_FIELD_ENV = 'PARKING_QR_FIELD'
export async function getParkingCfg(): Promise<ParkingCfg> {
  const s = await getSetting<any>(PARKING_CFG_KEY, null)
  const env = String(process.env[PARKING_FIELD_ENV] || '').trim()
  return {
    customFieldName: (typeof s?.customFieldName === 'string' && s.customFieldName.trim())
      || env || PARKING_CFG_DEFAULTS.customFieldName,
    writeToGuesty: s?.writeToGuesty === false ? false : true,
  }
}

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
  permit: {
    id: string; label: string | null; uploadedAt: string; uploadedBy: string | null; wasSpare: boolean
    /** Written onto the reservation in Guesty — the mapping Jon asked for, and whether it landed. */
    inGuesty: boolean
    guestyError: string | null
  } | null
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
  counts: { stays: number; withPermit: number; needPermit: number; parkingBooked: number; inGuesty: number }
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
        inGuesty: !!p.guesty_written_at,
        guestyError: p.guesty_error ? str(p.guesty_error) : null,
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
      inGuesty: rows.filter(r => !!r.permit?.inGuesty).length,
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
  const row: Record<string, any> = {
    building: inp.building,
    reservation_id: inp.stay ? inp.stay.reservationId : null,
    listing_id: inp.stay ? inp.stay.listingId : null,
    unit: inp.stay ? inp.stay.unit : null,
    check_in: inp.stay ? inp.stay.checkIn : null,
    check_out: inp.stay ? inp.stay.checkOut : null,
    storage_path: path,
    permit_token: newToken(),
    mime: inp.mime,
    bytes: inp.bytes.length,
    label: inp.label,
    status: inp.stay ? 'assigned' : 'spare',
    source_code: inp.link.code,
    uploaded_by: inp.who,
    uploaded_at: now,
    assigned_at: inp.stay ? now : null,
    assigned_by: inp.stay ? inp.who : null,
  }
  let { data, error } = await db.from('parking_permits').insert(row).select('id').limit(1)

  // MIGRATION 094 MAY NOT HAVE RUN YET. Migrations here are applied by hand, so a deploy can land
  // on a Friday and the SQL on a Monday — and `permit_token` is in the INSERT column list, not a
  // tolerant read, so PostgREST would reject every upload in between with an unactionable "Could
  // not save that code". The QR is the thing that matters; the token can be minted on the next
  // write. So one retry without it, and only for that one error.
  if (error && /permit_token/i.test(String(error.message || '') + String((error as any).details || ''))) {
    delete row.permit_token
    const again = await db.from('parking_permits').insert(row).select('id').limit(1)
    data = again.data; error = again.error
  }

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

// ── MAPPING THE CODE BACK ONTO THE RESERVATION IN GUESTY ────────────────────────────────────────
// Jon, 2026-09-16: "Once the QR code is uploaded, we need to find a way to map that QR code to the
// reservation in Guesty."
//
// Which makes the permit visible where the rest of the company already works. The guest's
// confirmation template can carry the merge tag; the reservation page shows the link; the
// send-on-payment rule, when it is built, has something to send.
//
// THREE THINGS THIS DELIBERATELY DOES:
//
// 1. IT NEVER FAILS THE UPLOAD. A Guesty outage, a rate limit, a field nobody created yet — none
//    of those should lose a QR the vendor has in their hand right now. The bytes are already
//    stored; the write is recorded as pending and retried.
// 2. IT LEAVES A TRACE EITHER WAY. `guesty_written_at` or `guesty_error`, always one of them. A
//    write that fails silently is a reservation missing its code, discovered by a guest at a gate.
// 3. IT GOES THROUGH writeCustomFields. Guesty's PUT REPLACES the whole custom-field array — that
//    is not a theory, it wiped an Elser confirmation number on 2026-07-31. Never write the field
//    array directly from here.

export type PermitWrite = { ok: boolean; note: string; url?: string }

/**
 * A HARD CEILING ON HOW LONG THE VENDOR WAITS FOR GUESTY.
 *
 * "The upload must never fail because of Guesty" was only true for guesty ERRORS. Slowness is the
 * common shape — a degraded or rate-limited API answers late, not never — and none of the fetches
 * on this path carry a timeout, so a stalled connection would sit there until the platform killed
 * the function at 60 seconds. The vendor then got a bare 504 with no JSON body, read it as "the
 * upload failed", and tapped again — which voids the permit they just made and mints a third
 * token, while the reservation may still point at the first.
 *
 * So the write gets a few seconds and then we stop waiting for it. The permit is already stored,
 * the row is still unstamped, and the hourly retry is exactly the thing that finishes the job. The
 * abandoned attempt is harmless if it lands late: the write is idempotent.
 */
export async function writePermitToGuestyWithin(permitId: string, budgetMs = 8000): Promise<PermitWrite> {
  let timer: any = null
  try {
    return await Promise.race([
      writePermitToGuesty(permitId),
      new Promise<PermitWrite>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, note: 'Guesty did not answer in time; it will be retried.' }), budgetMs)
      }),
    ])
  } catch (e: any) {
    return { ok: false, note: String(e?.message || e).slice(0, 140) }
  } finally { if (timer) clearTimeout(timer) }
}

/**
 * Write one assigned permit's stable URL onto its reservation. Idempotent: the same permit written
 * twice puts the same URL in the same field.
 */
export async function writePermitToGuesty(permitId: string): Promise<PermitWrite> {
  const db = supabaseAdmin()
  const { data } = await db.from('parking_permits')
    .select('id,reservation_id,permit_token,status,guesty_tries').eq('id', permitId).limit(1)
  const p = (data || [])[0] as any
  if (!p) return { ok: false, note: 'permit not found' }
  if (str(p.status) !== 'assigned' || !p.reservation_id) return { ok: false, note: 'not bound to a stay' }

  // A row from before migration 094, or a backfill that did not run. Mint one rather than refuse —
  // the mapping is the point of the exercise.
  let token = str(p.permit_token)
  if (!TOKEN_RE.test(token)) {
    token = newToken()
    const { error } = await db.from('parking_permits').update({ permit_token: token }).eq('id', p.id)
    if (error) return { ok: false, note: 'could not mint a permit token' }
  }
  const url = permitUrl(token)

  // EVERY EXIT LEAVES A MARK. An early return that stamps nothing is a row that stays pending
  // forever with no reason recorded — it keeps its place in the retry queue, and the board tells
  // the vendor "not on the reservation yet" while saying nothing about why.
  const tries = Number(p.guesty_tries) || 0
  const stamp = async (fields: Record<string, any>) => {
    try { await db.from('parking_permits').update(fields).eq('id', p.id) } catch { /* the caller already has the answer */ }
  }
  const fail = async (note: string, extra?: Record<string, any>): Promise<PermitWrite> => {
    await stamp({ guesty_error: note.slice(0, 400), guesty_written_at: null, guesty_tries: tries + 1, ...(extra || {}) })
    return { ok: false, note, url }
  }

  const cfg = await getParkingCfg()
  if (!cfg.writeToGuesty) return await fail('writing permits to Guesty is switched off in settings')

  const fieldId = await guestyFieldId(cfg.customFieldName)
  if (!fieldId) return await fail(fieldIdHelp(cfg.customFieldName, 'the ' + PARKING_FIELD_ENV + ' environment variable'))

  let token2 = ''
  try { token2 = await getToken() } catch (e: any) {
    return await fail('Guesty token: ' + String(e?.message || e).slice(0, 100))
  }

  const r = await writeCustomFields(str(p.reservation_id), token2, [{ fieldId, value: url }])
  if (!r.ok) return await fail(r.note || 'write failed', { guesty_field_id: fieldId })
  await stamp({ guesty_written_at: new Date().toISOString(), guesty_error: null, guesty_field_id: fieldId })
  // Mirror the merged array so the reservation drawer in Lighthouse shows it without waiting for
  // the next Guesty sync. Cosmetic — a failure here changes nothing that matters.
  try { await db.from('guesty_reservations').update({ custom_fields: r.fields }).eq('id', str(p.reservation_id)) } catch { /* cosmetic */ }
  return { ok: true, note: 'written to "' + cfg.customFieldName + '"', url }
}

// ── /permit/<token> — WHAT THE RESERVATION ACTUALLY POINTS AT ───────────────────────────────────
// No passcode: this is the link a GUEST follows out of their confirmation, and a guest has no
// credential to give. The token is the whole capability, which is why it is 64 hex characters and
// why it stops resolving the moment the permit is voided — a replaced code is replaced, not a
// second live credential for the same gate.

export type PermitView = {
  unit: string | null
  checkIn: string | null
  checkOut: string | null
  mime: string | null
  isPdf: boolean
}

/**
 * THE PASS STOPS WORKING THE DAY AFTER THEY LEAVE (Jon, 2026-09-16: "After guest checkouts, 1 day
 * post checkout make the link inactive").
 *
 * It is a gate credential sitting in a guest's inbox forever otherwise. Somebody who stayed in
 * March should not be able to open the garage in November, and the link is passwordless by design,
 * so nothing else is standing between that email and the door.
 *
 * It runs through the CHECKOUT DAY and goes dead the next morning — a guest loading the car at
 * 10am on their last day still has their pass; the same link tomorrow does not. Expiry is decided
 * here, at read time, rather than by a job that voids rows: there is no cron to fail, no clock to
 * drift, and the permit row survives intact for "which code did we send them" six months later.
 */
export const PERMIT_GRACE_DAYS = 0
export function permitExpired(checkOut: string | null, today?: string): boolean {
  const co = str(checkOut).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(co)) return false   // no checkout on file: never expire it
  return (today || ymdET(new Date())) > addDays(co, PERMIT_GRACE_DAYS)
}

export type PermitHit = {
  ok: true
  id: string
  storage_path: string
  mime: string | null
  sourceCode: string | null
  view: PermitView
}
/** `gone` covers unknown, malformed, voided-with-no-replacement and spare — all the same to a guest. */
export type PermitLookup = PermitHit | { ok: false; reason: 'gone' | 'expired'; view?: PermitView }

/** The permit behind a token. Unknown, malformed and voided all answer the same way. */
export async function permitByToken(token: string): Promise<PermitLookup> {
  const t = String(token || '')
  if (!TOKEN_RE.test(t)) return { ok: false, reason: 'gone' }
  const db = supabaseAdmin()
  const cols = 'id,storage_path,mime,status,unit,check_in,check_out,reservation_id,source_code'
  const { data } = await db.from('parking_permits').select(cols).eq('permit_token', t).limit(1)
  let p = (data || [])[0] as any
  if (!p) return { ok: false, reason: 'gone' }

  // A REPLACED CODE FOLLOWS THE STAY, NOT THE FILE.
  //
  // Replacing a permit voids the old row and mints a new token, and the new URL only reaches the
  // reservation once the Guesty write lands — which can be an hour later, or never if Guesty is
  // refusing us. In that window the guest's confirmation still points at the old token, and a flat
  // "voided means gone" would answer them with "this pass is no longer available" while a perfectly
  // good code sat on their stay. So a retired token resolves to whatever is live for the SAME
  // reservation: the person holding it was given it for that stay, and that stay is what they get.
  // With nothing live it still says nothing — a stay with no permit has no pass to show.
  const replaced = str(p.status) !== 'assigned' && !!p.reservation_id
  if (replaced) {
    const { data: live } = await db.from('parking_permits').select(cols)
      .eq('reservation_id', str(p.reservation_id)).eq('status', 'assigned').limit(1)
    // Keep the retired row if there is no live one, purely so the dates below can tell an EXPIRED
    // stay from a missing one. A guest whose stay is over should hear that, not "no pass here".
    p = ((live || [])[0] as any) || p
  }
  const mime = p.mime ? str(p.mime) : null
  const view: PermitView = {
    unit: p.unit ? str(p.unit) : null,
    checkIn: p.check_in ? str(p.check_in).slice(0, 10) : null,
    checkOut: p.check_out ? str(p.check_out).slice(0, 10) : null,
    mime,
    isPdf: mime === 'application/pdf',
  }

  // CHECKED BEFORE STATUS, because an old token from a finished stay is the common case and
  // "your stay has ended" is the true answer to it — not "this pass is no longer available",
  // which sounds like something went wrong and invites a call to the front desk.
  if (permitExpired(view.checkOut)) return { ok: false, reason: 'expired', view }
  // A spare has an image but no stay, so its token addresses nothing anyone should be sent to.
  if (str(p.status) !== 'assigned') return { ok: false, reason: 'gone' }

  return {
    ok: true,
    id: str(p.id),
    storage_path: str(p.storage_path),
    mime,
    sourceCode: p.source_code ? str(p.source_code) : null,
    view,
  }
}

/** A fresh short-lived read for a token that has already been resolved. */
export async function signedForPath(storagePath: string): Promise<string | null> {
  const signed = await supabaseAdmin().storage.from(PARKING_BUCKET)
    .createSignedUrl(storagePath, QR_SIGNED_SECONDS)
  return signed.data?.signedUrl || null
}

/**
 * RETRY THE WRITES THAT DID NOT LAND.
 *
 * The upload route is forbidden from failing over Guesty — the vendor has the code in their hand
 * and losing it to a rate limit would be the worst trade on that page. The price of that choice is
 * that something has to come back for the ones that did not land, otherwise "we will retry" is a
 * sentence the page has no right to say.
 *
 * Only stays that have not ended yet: a permit for last Tuesday is history, and retrying it burns
 * Guesty calls the arrivals need. Small batch on purpose — each write is a GET and a PUT against an
 * API that has answered 429 before.
 */
export const GUESTY_MAX_TRIES = 8
export async function retryPendingGuestyWrites(limit = 20): Promise<{ tried: number; ok: number; errors: string[] }> {
  const out = { tried: 0, ok: 0, errors: [] as string[] }
  // Switched off in settings means switched off here too — otherwise the batch spends every slot
  // on rows it is going to refuse, hour after hour.
  const cfg = await getParkingCfg()
  if (!cfg.writeToGuesty) return out
  const today = ymdET(new Date())
  const { data } = await supabaseAdmin().from('parking_permits')
    .select('id,unit,check_in')
    .eq('status', 'assigned').not('reservation_id', 'is', null).is('guesty_written_at', null)
    .gte('check_out', today)
    // GIVE UP EVENTUALLY. A reservation cancelled in Guesty can never be written to; without this
    // it holds a slot in every batch until its check-out passes, and the permits behind it in
    // check_in order are never retried at all.
    .lt('guesty_tries', GUESTY_MAX_TRIES)
    .order('check_in').limit(Math.max(1, Math.min(50, limit)))
  for (const p of ((data || []) as any[])) {
    out.tried++
    try {
      const r = await writePermitToGuesty(str(p.id))
      if (r.ok) out.ok++
      else if (out.errors.length < 5) out.errors.push(str(p.unit) + ': ' + r.note)
    } catch (e: any) {
      if (out.errors.length < 5) out.errors.push(str(p.unit) + ': ' + String(e?.message || e).slice(0, 120))
    }
  }
  return out
}
