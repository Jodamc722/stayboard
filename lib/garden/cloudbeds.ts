// CLOUDBEDS — the Garden Hotel's property system, read through its REST API.
//
// Jon, 2026-09-28: "We're going to connect to different systems' API and connect to Cloudbeds. Use
// their system to track and manage operations and cleans." This file is the only place that knows
// how Cloudbeds talks; everything above it (sync, pages, reports) sees the plain shapes at the
// bottom (CbRoom, CbReservation, CbHousekeeping) and never a Cloudbeds field name.
//
// AUTH — two ways in, checked in this order:
//   1. CLOUDBEDS_API_KEY        a property-level API key from Cloudbeds → Settings → API Credentials.
//                               Sent as `x-api-key`. Simplest; no token refresh. Use this first.
//   2. CLOUDBEDS_CLIENT_ID + CLOUDBEDS_CLIENT_SECRET + CLOUDBEDS_REFRESH_TOKEN
//                               the OAuth app route (Cloudbeds partner app). The refresh token is
//                               exchanged for a short-lived access token, cached per instance.
// Plus CLOUDBEDS_PROPERTY_ID (the hotel's propertyID; needed when the key/app spans properties).
//
// Every call is GET https://api.cloudbeds.com/api/v1.2/<endpoint>?… → { success, data, … }.
// A failed call throws with Cloudbeds' own message so the sync ledger can show it verbatim.
// Cloudbeds limits to ~5 requests/second; the sync paginates and never fans out in parallel.
import 'server-only'

const API_BASE = process.env.CLOUDBEDS_API_BASE || 'https://api.cloudbeds.com/api/v1.2'
const TOKEN_URL = 'https://hotels.cloudbeds.com/api/v1.2/access_token'

export type CbConfig = { mode: 'api_key' | 'oauth' | 'none'; propertyId: string | null }
export function cloudbedsConfig(): CbConfig {
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID || '').trim() || null
  if ((process.env.CLOUDBEDS_API_KEY || '').trim()) return { mode: 'api_key', propertyId }
  if (process.env.CLOUDBEDS_CLIENT_ID && process.env.CLOUDBEDS_CLIENT_SECRET && process.env.CLOUDBEDS_REFRESH_TOKEN) return { mode: 'oauth', propertyId }
  return { mode: 'none', propertyId }
}
export function cloudbedsConfigured(): boolean { return cloudbedsConfig().mode !== 'none' }

let _token: { value: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  if (_token && Date.now() < _token.exp - 60_000) return _token.value
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: String(process.env.CLOUDBEDS_CLIENT_ID),
    client_secret: String(process.env.CLOUDBEDS_CLIENT_SECRET),
    refresh_token: String(process.env.CLOUDBEDS_REFRESH_TOKEN),
  })
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`Cloudbeds token refresh failed: ${j.error_description || j.error || r.status}`)
  _token = { value: String(j.access_token), exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  return _token.value
}

async function authHeaders(): Promise<Record<string, string>> {
  const cfg = cloudbedsConfig()
  if (cfg.mode === 'api_key') return { 'x-api-key': String(process.env.CLOUDBEDS_API_KEY).trim() }
  if (cfg.mode === 'oauth') return { authorization: `Bearer ${await accessToken()}` }
  throw new Error('Cloudbeds is not connected (set CLOUDBEDS_API_KEY or the OAuth trio in Vercel)')
}

/** One GET against the Cloudbeds API. Returns the `data` payload or throws Cloudbeds' message. */
export async function cbGet<T = any>(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<{ data: T; count?: number; total?: number }> {
  const cfg = cloudbedsConfig()
  const qs = new URLSearchParams()
  if (cfg.propertyId && params.propertyID == null) qs.set('propertyID', cfg.propertyId)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v))
  const url = `${API_BASE}/${endpoint.replace(/^\//, '')}${qs.toString() ? '?' + qs.toString() : ''}`
  const r = await fetch(url, { headers: { accept: 'application/json', ...(await authHeaders()) }, cache: 'no-store' })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(`Cloudbeds ${endpoint}: ${j.message || j.error || `HTTP ${r.status}`}`)
  return { data: j.data as T, count: j.count, total: j.total }
}

/** One POST (form-encoded, as Cloudbeds expects). Used for housekeeping status write-back. */
export async function cbPost<T = any>(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const cfg = cloudbedsConfig()
  const body = new URLSearchParams()
  if (cfg.propertyId && params.propertyID == null) body.set('propertyID', cfg.propertyId)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') body.set(k, String(v))
  const r = await fetch(`${API_BASE}/${endpoint.replace(/^\//, '')}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...(await authHeaders()) }, body, cache: 'no-store' })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(`Cloudbeds ${endpoint}: ${j.message || j.error || `HTTP ${r.status}`}`)
  return j as T
}

// ---- Plain shapes the rest of the app sees ---------------------------------------------------
export type CbRoom = { id: string; name: string; roomTypeId: string | null; roomType: string | null; floor: string | null; maxGuests: number | null; status: string; raw: any }
export type CbReservation = {
  id: string; status: string; guestName: string; guestEmail: string | null; guestPhone: string | null
  checkIn: string | null; checkOut: string | null; adults: number; children: number
  roomIds: string[]; roomNames: string[]; source: string | null; total: number | null; balance: number | null
  bookedAt: string | null; modifiedAt: string | null; raw: any
}
export type CbHousekeeping = { roomId: string; roomName: string; condition: string | null; occupied: boolean | null; frontdeskStatus: string | null; raw: any }

const s = (v: any): string => (v == null ? '' : String(v))
const n = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
const d = (v: any): string | null => { const t = s(v).trim(); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null }

/** Hotel identity — used by the Setup tab to prove the key works. */
export async function getHotel(): Promise<{ id: string; name: string; city: string | null; rooms: number | null }> {
  const { data } = await cbGet<any>('getHotelDetails')
  const h = Array.isArray(data) ? data[0] : data
  return { id: s(h?.propertyID), name: s(h?.propertyName), city: h?.propertyAddress?.propertyCity || null, rooms: n(h?.propertyRoomsCount ?? h?.roomsCount) }
}

/** Every room, flattened out of Cloudbeds' room-type → rooms tree. */
export async function getRooms(): Promise<CbRoom[]> {
  const { data } = await cbGet<any>('getRooms')
  const props = Array.isArray(data) ? data : [data]
  const out: CbRoom[] = []
  for (const p of props) {
    for (const t of (p?.rooms || p?.roomTypes || [])) {
      // getRooms returns [{propertyID, rooms:[{roomTypeID, roomTypeName, rooms:[{roomID, roomName, …}]}]}]
      const list = Array.isArray(t?.rooms) ? t.rooms : [t]
      for (const r of list) {
        if (!r?.roomID) continue
        out.push({
          id: s(r.roomID), name: s(r.roomName || r.roomID), roomTypeId: s(t.roomTypeID || r.roomTypeID) || null,
          roomType: s(t.roomTypeName || r.roomTypeName) || null, floor: s(r.floor || r.roomFloor) || null,
          maxGuests: n(t.maxGuests ?? r.maxGuests), status: r.roomBlocked ? 'blocked' : 'active', raw: r,
        })
      }
    }
  }
  return out
}

function normReservation(r: any): CbReservation {
  const rooms: any[] = Array.isArray(r?.rooms) ? r.rooms : (Array.isArray(r?.assigned) ? r.assigned : [])
  const roomIds = rooms.map(x => s(x.roomID)).filter(Boolean)
  const roomNames = rooms.map(x => s(x.roomName)).filter(Boolean)
  const name = s(r?.guestName) || [s(r?.guestFirstName), s(r?.guestLastName)].filter(Boolean).join(' ')
  return {
    id: s(r?.reservationID), status: s(r?.status).toLowerCase() || 'unknown', guestName: name,
    guestEmail: s(r?.guestEmail) || null, guestPhone: s(r?.guestPhone || r?.guestCellPhone) || null,
    checkIn: d(r?.startDate), checkOut: d(r?.endDate), adults: Number(r?.adults) || 0, children: Number(r?.children) || 0,
    roomIds, roomNames, source: s(r?.sourceName || r?.source) || null, total: n(r?.total), balance: n(r?.balance),
    bookedAt: s(r?.dateCreated) || null, modifiedAt: s(r?.dateModified) || null, raw: r,
  }
}

/**
 * Reservations touching a date window (checking in or out, or in house). Cloudbeds filters on one
 * axis per call, so this asks twice (check-in window, check-out window) and de-dupes — a stay that
 * spans the whole window is caught by either edge or by `modifiedSince` on the incremental run.
 */
export async function getReservations(opts: { from: string; to: string; modifiedSince?: string; pageSize?: number }): Promise<CbReservation[]> {
  const size = Math.min(100, opts.pageSize || 100)
  const seen = new Map<string, CbReservation>()
  const pull = async (params: Record<string, string | number | undefined>) => {
    for (let page = 1; page <= 30; page++) {
      const { data } = await cbGet<any[]>('getReservations', { ...params, includeGuestsDetails: 'true', pageNumber: page, pageSize: size })
      const rows = Array.isArray(data) ? data : []
      for (const r of rows) { const x = normReservation(r); if (x.id) seen.set(x.id, x) }
      if (rows.length < size) break
    }
  }
  if (opts.modifiedSince) await pull({ modifiedSince: opts.modifiedSince })
  else {
    await pull({ checkInFrom: opts.from, checkInTo: opts.to })
    await pull({ checkOutFrom: opts.from, checkOutTo: opts.to })
  }
  return Array.from(seen.values())
}

/** Room condition as the front desk sees it (clean / dirty / inspected + occupied). */
export async function getHousekeeping(): Promise<CbHousekeeping[]> {
  const { data } = await cbGet<any>('getHousekeepingStatus')
  const props = Array.isArray(data) ? data : [data]
  const out: CbHousekeeping[] = []
  for (const p of props) for (const r of (p?.rooms || [])) {
    if (!r?.roomID) continue
    out.push({ roomId: s(r.roomID), roomName: s(r.roomName), condition: s(r.roomCondition).toLowerCase() || null, occupied: r.roomOccupied == null ? null : !!r.roomOccupied, frontdeskStatus: s(r.frontdeskStatus) || null, raw: r })
  }
  return out
}

/** Write a room's condition back to Cloudbeds when a clean is finished here. */
export async function setHousekeeping(roomId: string, condition: 'clean' | 'dirty' | 'inspected'): Promise<void> {
  await cbPost('postHousekeepingStatus', { roomID: roomId, roomCondition: condition })
}
