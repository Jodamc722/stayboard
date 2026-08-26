// Guesty Open API client - token persisted in Supabase + sync helpers.
//
// Architecture:
//   token()       -> reads cached OAuth token from Supabase, refreshes if expired
//   api()         -> authed fetch helper; surfaces 429/4xx as readable errors
//   sync*()       -> pull paginated data from Guesty and upsert into Supabase
//   listings/reservations/etc helpers below are LOCAL reads from Supabase, not Guesty.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { parseListing } from './parse-listing'

const BASE      = process.env.GUESTY_BASE_URL  || 'https://open-api.guesty.com/v1'
const TOKEN_URL = process.env.GUESTY_TOKEN_URL || 'https://open-api.guesty.com/oauth2/token'
const CID       = process.env.GUESTY_CLIENT_ID
const CSEC      = process.env.GUESTY_CLIENT_SECRET
const ACCOUNT_ID = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'

// ------------------------------------------------------------
// Token cache (Supabase-backed so all serverless instances share one)
// ------------------------------------------------------------
type CachedToken = { access_token: string; expires_at: string }

async function readCachedToken(): Promise<CachedToken | null> {
  const sb = supabaseAdmin()
  const { data, error } = await sb
    .from('guesty_tokens')
    .select('access_token, expires_at')
    .eq('id', 'singleton')
    .maybeSingle()
  if (error) {
    console.error('[guesty] read token error', error.message)
    return null
  }
  return data as CachedToken | null
}

async function writeCachedToken(access_token: string, expires_in_sec: number) {
  const expires_at = new Date(Date.now() + expires_in_sec * 1000).toISOString()
  const sb = supabaseAdmin()
  const { error } = await sb
    .from('guesty_tokens')
    .upsert({ id: 'singleton', access_token, expires_at, updated_at: new Date().toISOString() })
  if (error) console.error('[guesty] write token error', error.message)
}

export async function getToken(force = false): Promise<string> {
  if (!CID || !CSEC) throw new Error('GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET not set')
  if (!force) {
    const cached = await readCachedToken()
    if (cached) {
      const expiresAt = new Date(cached.expires_at).getTime()
      // Refresh 5 minutes before expiry
      if (expiresAt > Date.now() + 5 * 60_000) return cached.access_token
    }
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: CID,
      client_secret: CSEC
    })
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`Guesty auth ${r.status}: ${body.slice(0, 300)}`)
  }
  const d = await r.json() as { access_token: string; expires_in: number }
  await writeCachedToken(d.access_token, d.expires_in)
  return d.access_token
}

// ------------------------------------------------------------
// Authed fetch with retry on 401 (token rotation) and pause on 429
// ------------------------------------------------------------
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let attempt = 0
  let forceRefresh = false
  while (true) {
    attempt++
    const token = await getToken(forceRefresh)
    forceRefresh = false
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })
    if (r.status === 401 && attempt === 1) { forceRefresh = true; continue } // refresh token once on real auth failure
    if (r.status === 429 && attempt < 6) {                            // back off + retry, REUSING the same token (don't hammer the token endpoint)
      const wait = Math.min(1000 * attempt, 8000)
      await new Promise(res => setTimeout(res, wait))
      continue
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(`Guesty ${path} ${r.status}: ${body.slice(0, 300)}`)
    }
    return r.json() as Promise<T>
  }
}

// ------------------------------------------------------------
// Availability calendar (read-only) — how far out a listing is bookable
// ------------------------------------------------------------
export type CalDay = { date?: string; status?: string; allotment?: number | null; blocks?: Record<string, any> | null }

// Retrieve the optimized/minified calendar for one listing over a date range. The Guesty minified
// response nests the day array at data.days.calendar; each day carries a `blocks` object (e.g. { b },
// and { bw } when the date is beyond the listing's BOOKING WINDOW). We read the path defensively.
export async function getListingCalendar(listingId: string, startDate: string, endDate: string): Promise<CalDay[]> {
  const payload = await api<any>(`/availability-pricing/api/calendar/listings/minified/${listingId}?startDate=${startDate}&endDate=${endDate}&includeAllotment=true&view=compact`)
  const days = payload?.data?.days?.calendar
    ?? payload?.data?.calendar
    ?? (Array.isArray(payload?.data) ? payload.data : null)
    ?? (Array.isArray(payload) ? payload : [])
  return Array.isArray(days) ? (days as CalDay[]) : []
}

// ── MULTI-CALENDAR (Jon, 2026-08-10: "pull that data from Guesty multi cal") ────────────────
// One call covers many listings, which is the only practical way to ask "what is blocked across
// the whole portfolio this month" — 233 single-listing calls would time out long before it
// finished. Guesty caps the listingIds per request, so this chunks and stitches.
//
// The response shape has moved around between Guesty API versions, so every path is read
// defensively and a day is normalised to { listingId, date, status, blocks, note }. A chunk that
// fails is skipped rather than taking the whole pull down — a partial blocked list still beats no
// blocked list on a morning brief.
export type MultiCalDay = {
  listingId: string
  date: string
  status: string
  blocks: Record<string, any>
  note: string | null
  reservationId: string | null
  raw?: any
}
const CAL_CHUNK = 20

export async function getMultiCalendar(listingIds: string[], startDate: string, endDate: string): Promise<MultiCalDay[]> {
  const ids = Array.from(new Set(listingIds.map(x => String(x || '')).filter(Boolean)))
  const out: MultiCalDay[] = []
  for (let i = 0; i < ids.length; i += CAL_CHUNK) {
    const chunk = ids.slice(i, i + CAL_CHUNK)
    try {
      const qs = new URLSearchParams({ listingIds: chunk.join(','), startDate, endDate })
      const payload = await api<any>(`/availability-pricing/api/calendar/listings?${qs.toString()}`)
      const rows: any[] =
        (Array.isArray(payload?.data?.days) ? payload.data.days : null)
        ?? (Array.isArray(payload?.data?.days?.calendar) ? payload.data.days.calendar : null)
        ?? (Array.isArray(payload?.data?.calendar) ? payload.data.calendar : null)
        ?? (Array.isArray(payload?.data) ? payload.data : null)
        ?? (Array.isArray(payload) ? payload : [])
      for (const d of rows) {
        const lid = String(d?.listingId || d?.listing?._id || d?.listing_id || '')
        const date = String(d?.date || d?.day || '').slice(0, 10)
        if (!lid || !date) continue
        const blocks = (d?.blocks && typeof d.blocks === 'object') ? d.blocks : {}
        out.push({
          listingId: lid,
          date,
          status: String(d?.status || '').toLowerCase(),
          blocks,
          note: d?.note ? String(d.note) : (d?.blockRef?.note ? String(d.blockRef.note) : null),
          reservationId: d?.reservationId || d?.reservation?._id || d?.blockRef?.reservationId || null,
          raw: d,
        })
      }
    } catch { /* this chunk is missing; the rest of the portfolio still reports */ }
    await new Promise(r => setTimeout(r, 120))
  }
  return out
}

// A day the OPS team needs to know about: the unit cannot be sold and it is not because a guest
// booked it. Guesty flags reservation days on the same `unavailable` status as an owner block or a
// maintenance hold, so the reservation markers have to be excluded explicitly or every occupied
// night reads as "blocked".
const RESERVATION_KEYS = ['r', 'reserved', 'reservation', 'booked', 'b']
// Blocks that are a pricing/policy artifact rather than someone taking the unit out of service.
const NON_OPS_KEYS = ['bw', 'bookingwindow', 'a', 'advancenotice', 'an', 'lm', 'lead']
export function isOpsBlock(d: MultiCalDay): boolean {
  const st = d.status
  const unavailable = st === 'unavailable' || st === 'blocked' || st === 'booked'
  if (!unavailable) return false
  if (d.reservationId) return false
  const on = Object.keys(d.blocks || {}).filter(k => {
    const v = (d.blocks as any)[k]
    return v === true || (v && typeof v === 'object')
  }).map(k => k.toLowerCase())
  if (on.some(k => RESERVATION_KEYS.includes(k))) return false
  // Nothing but booking-window / advance-notice flags is not an ops problem.
  const meaningful = on.filter(k => !NON_OPS_KEYS.includes(k))
  if (on.length && !meaningful.length) return false
  return true
}

// "Bookable" for our horizon = the date is within the listing's booking window. Guesty marks dates
// beyond the booking window with a `bw` block; other blocks (b/reservations/manual) still sit INSIDE
// the window, so we ignore them here - we only care how far ahead a guest could place a booking.
export function dayIsAvailable(d: CalDay): boolean {
  const bl = d.blocks || {}
  return !bl.bw
}

// ------------------------------------------------------------
// Field mappers (Guesty raw -> Supabase schema)
// ------------------------------------------------------------
function nightsBetween(ci?: string, co?: string): number | null {
  if (!ci || !co) return null
  const a = new Date(ci).getTime(); const b = new Date(co).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v); return isNaN(n) ? null : n
}

function mapReservation(r: any) {
  const m = r.money || {}
  return {
    id:                r._id || r.id,
    listing_id:        r.listingId || r.listing?._id || r.listing?.id || null,
    listing_name:      r.listing?.nickname || r.listing?.title || null,
    guest_id:          r.guest?._id || r.guest?.id || r.guestId || null,
    guest_name:        r.guest?.fullName || [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(' ') || null,
    guest_email:       r.guest?.email || null,
    guest_phone:       r.guest?.phone || null,
    // Use Guesty's authoritative LOCAL calendar dates (timezone-proof). Fall back to the
    // date prefix of the timestamp (no UTC conversion) only if the localized field is absent.
    check_in:          r.checkInDateLocalized  || (r.checkIn  ? String(r.checkIn).slice(0, 10)  : null),
    check_out:         r.checkOutDateLocalized || (r.checkOut ? String(r.checkOut).slice(0, 10) : null),
    nights:            r.nightsCount ?? r.nights ?? nightsBetween(r.checkIn, r.checkOut),
    status:            (r.status || '').toLowerCase() || null,
    source:            (r.source || r.channel || '').toLowerCase() || null,
    confirmation_code: r.confirmationCode || r.confirmation_code || null,
    money_total:       num(m.hostPayout ?? m.totalPaid ?? m.fareAccommodation ?? m.netIncome),
    money_paid:        num(m.totalPaid),
    money_balance:     num(m.balanceDue),
    money_currency:    m.currency || 'USD',
    notes:             r.note || r.notes || null,
    custom_fields:     Array.isArray(r.customFields) ? r.customFields : null,
    conversation_id:   r.conversation?._id || r.conversationId || null,
    created_at:        r.createdAt || null,
    raw:               r
  }
}

// (parseListing moved to lib/parse-listing.ts so the Listings page can re-parse client-side)

function mapListing(l: any) {
  const addr = l.address || {}
  const tags = Array.isArray(l.tags) ? l.tags : []
  const { building, unit, room_type } = parseListing(l.nickname, l.title)
  return {
    id:            l._id || l.id,
    title:         l.title || null,
    nickname:      l.nickname || null,
    building, unit, room_type,
    tags,
    address_full:  addr.full || null,
    address_city:  addr.city || null,
    address_state: addr.state || null,
    bedrooms:      l.bedrooms ?? null,
    bathrooms:     l.bathrooms ?? null,
    beds:          l.beds ?? null,
    max_occupancy: l.accommodates ?? l.personCapacity ?? null,
    status:        l.active === false ? 'inactive' : 'active',
    pictures:      Array.isArray(l.pictures) ? l.pictures.map((p: any) => p.original || p.regular || p.thumbnail || p).filter(Boolean) : [],
    amenities:     Array.isArray(l.amenities) ? l.amenities : [],
    raw:           l
  }
}

function mapConversation(c: any) {
  // Guesty embeds the guest + reservation(s) + listing under raw.meta (NOT at top level).
  const meta: any = c.meta || {}
  const res0: any = Array.isArray(meta.reservations) && meta.reservations.length ? meta.reservations[0] : null
  const lst: any = res0?.listing
  return {
    id:                   c._id || c.id,
    reservation_id:       res0?._id || c.reservationId || c.reservation?._id || null,
    listing_id:           (lst && (lst._id || lst.id)) || c.listingId || c.listing?._id || null,
    guest_name:           meta.guest?.fullName || c.guest?.fullName || c.lastMessage?.from?.fullName || null,
    channel:              (c.channel || c.lastMessage?.module || res0?.source || 'other').toLowerCase(),
    last_message_at:      c.lastMessageAt || c.lastMessageReceivedAt || c.updatedAt || c.createdAt || null,
    last_message_preview: (c.lastMessage?.body || '').slice(0, 200) || null,
    unread_count:         c.unreadCount ?? 0,
    raw:                  c
  }
}

// WHO IS "US" IN A GUESTY THREAD. Guesty types its own side of a conversation — an employee, a
// logged-in user, or the account itself. It does NOT type the guest: a guest message simply has no
// `from.type` at all.
const GUESTY_HOST_TYPES = new Set(['employee', 'user', 'account', 'agent', 'staff', 'admin'])
// Guesty's own activity entries, filed into the same thread. Never sent to anybody.
const GUESTY_LOG_KINDS = new Set(['log', 'note'])

function mapMessage(conversationId: string, m: any) {
  const fromType = (m.from?.type || m.author?.type || '').toLowerCase()
  const moduleObj: any = (m.module && typeof m.module === 'object') ? m.module : null
  const moduleStr = String(moduleObj ? (moduleObj.type ?? moduleObj.name ?? '') : (m.module ?? m.type ?? '')).toLowerCase() || null

  // 🔴 2026-08-26 — THIS WAS WRONG FOR THE LIFE OF THE APP, AND SILENTLY.
  // The old test was `fromType === 'guest' || m.isIncoming === true`. Guesty sends NEITHER: there
  // is no 'guest' type in the payload and `isIncoming` is absent from all 25,074 messages we hold.
  // So every single message — including "Thanks for the quick reply." — was filed as `host`.
  // Nothing crashed; the data just quietly said the guests had never spoken. That broke the
  // messages page's response KPIs, the sentiment scan's HOST/GUEST transcript, every
  // awaiting-reply count, and Eve reading a thread back as if we had talked to ourselves.
  //
  // The real signal is the reverse of what was being looked for: Guesty types OUR side
  // (employee | user | account) and leaves the guest's side untyped.
  const sender =
    (GUESTY_LOG_KINDS.has(moduleStr || '') || fromType === 'system') ? 'system'
    : (fromType && GUESTY_HOST_TYPES.has(fromType)) ? 'host'
    : 'guest'
  const body = m.body ?? m.text ?? m.message ?? m.content ?? m.rawMessage?.text ?? ''
  const sentAt = m.createdAt ?? m.sentAt ?? m.timestamp ?? m.date ?? null
  const id = m._id ?? m.id ?? `${conversationId}:${sentAt ?? ''}:${String(body || '').slice(0, 40)}`
  const authorName = m.from?.fullName ?? m.author?.fullName ?? null

  // WAS THIS A PERSON OR A TEMPLATE? (2026-08-26)
  // Guesty sends its automated messages AS the host, so for years a template firing at 3pm and
  // Karla typing a reply landed in this table identically. Every response-time number counted the
  // robot as us, and the sentiment scan read both as "HOST". The evidence is in the payload we
  // already store; nobody ever read it back out.
  //
  // THREE-VALUED ON PURPOSE. true = we can point at an automation marker. false = a named human
  // authored it. null = we genuinely cannot tell, which is the honest answer for a payload that
  // carries neither. Everything downstream treats null as unknown rather than as human, because a
  // flattering guess about response time is worse than a visible gap.
  const automationMarker = !!(
    m.automationId || m.autoMessageId || m.automationRuleId || m.ruleId || m.templateId ||
    (Array.isArray(moduleObj?.templateValues) && moduleObj.templateValues.length > 0) ||
    /auto/i.test(moduleStr || '') ||
    /auto/i.test(String(m.sentBy?.type ?? '')) ||
    /auto/i.test(String(m.from?.type ?? ''))
  )
  const isAutomated: boolean | null =
    sender !== 'host' ? null
    : automationMarker ? true
    : authorName ? false
    : null

  return {
    id,
    conversation_id: conversationId,
    sender,
    sender_name:     authorName ?? (sender === 'system' ? 'System' : null),
    body:            body || null,
    sent_at:         sentAt,
    attachments:     Array.isArray(m.attachments) ? m.attachments : null,
    module:          moduleStr,
    is_automated:    isAutomated,
    raw:             m
  }
}

function mapCustomField(c: any) {
  // THE SHAPE, CONFIRMED LIVE 2026-08-25 against the account endpoint:
  //   { fieldId, key, displayName, object, type, options, isPublic }
  //   e.g. { fieldId:'695af1454ebbdc00137c3f41', key:'Door code', displayName:'door_code',
  //          object:'listing', type:'text' }
  //
  // 🔴 THE ID IS `fieldId`. It is not `_id` and not `id` — both are absent. This mapper read
  // `c._id || c.id`, so EVERY row mapped to a null id and was dropped by the `r.id && r.name`
  // filter downstream. Guesty served 35 definitions and the table stayed empty, which is why
  // resolving the order-form field by name failed while the field existed the whole time.
  //
  // And `key`/`displayName` are the other way round from what the 2026-08-19 note claimed: `key`
  // is the HUMAN LABEL ("Door code") and `displayName` is the MERGE-TAG SLUG ("door_code", used in
  // Guesty templates as {{door_code}}). Both are stored so either resolves a field by name.
  return {
    id:      c.fieldId || c._id || c.id,
    name:    c.key || c.displayName || c.fieldName || c.name || '',
    slug:    c.displayName || c.key || c.slug || null,
    type:    (c.type || 'text').toLowerCase(),
    target:  String(c.object || c.objectType || c.target || 'reservation').toLowerCase().replace(/s$/, ''),
    options: c.options || c.values || null
  }
}

// ------------------------------------------------------------
// Sync - paginated pulls + upsert to Supabase
// ------------------------------------------------------------
async function recordSync(entity: string, items_synced: number, last_error: string | null = null) {
  const sb = supabaseAdmin()
  await sb.from('guesty_sync_status').upsert({
    entity,
    last_sync_at: new Date().toISOString(),
    last_error,
    items_synced,
    updated_at: new Date().toISOString()
  })
}

async function getSince(entity: string): Promise<string | null> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('guesty_sync_status').select('last_sync_at, last_error').eq('entity', entity).maybeSingle()
  if (error || !data || data.last_error || !data.last_sync_at) return null
  return new Date(new Date(data.last_sync_at).getTime() - 5 * 60_000).toISOString()
}
function sinceFilter(iso: string): string {
  const f = [{ field: 'lastUpdatedAt', operator: '$gte', value: iso }]
  return `&filters=${encodeURIComponent(JSON.stringify(f))}`
}

const FIELDS = encodeURIComponent('status guest listing checkIn checkOut checkInDateLocalized checkOutDateLocalized nightsCount money source customFields confirmationCode createdAt note tags')

/**
 * Targeted re-pull: refresh specific reservations from Guesty RIGHT NOW (folio edits, fee
 * breakouts, tag changes) instead of waiting for the incremental cron to notice them. Used
 * by the owner-audit Prep tab's "Re-check Guesty" so a folio edit maps straight back to
 * the app.
 */
export async function pullReservationsByIds(ids: string[]): Promise<number> {
  const clean = Array.from(new Set(ids.map(x => String(x || '')).filter(Boolean))).slice(0, 200)
  if (!clean.length) return 0
  const sb = supabaseAdmin()
  let total = 0
  for (let i = 0; i < clean.length; i += 50) {
    const chunk = clean.slice(i, i + 50)
    const filter = `&filters=${encodeURIComponent(JSON.stringify([{ field: '_id', operator: '$in', value: chunk }]))}`
    const data = await api<{ results: any[] }>(`/reservations?limit=100&skip=0&fields=${FIELDS}${filter}`)
    const rows = (data.results || []).map(mapReservation)
    if (rows.length) {
      const { error } = await sb.from('guesty_reservations').upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(`upsert reservations: ${error.message}`)
      total += rows.length
    }
  }
  return total
}

export async function syncReservations(maxPages = 40, since: string | null = null): Promise<number> {
  const sb = supabaseAdmin()
  let total = 0
  // FULL sync (since=null) pulls the complete CURRENT window — every reservation checking out
  // from 45 days ago onward — sorted by check-in, so current/upcoming bookings are ALWAYS captured
  // regardless of when they were last updated (a stale in-house booking would otherwise be pushed
  // past the page cap by more-recently-updated records). Incremental keeps using lastUpdatedAt.
  const windowIso = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const filter = since ? sinceFilter(since) : `&filters=${encodeURIComponent(JSON.stringify([{ field: 'checkOut', operator: '$gte', value: windowIso }]))}`
  const sort = since ? '-lastUpdatedAt' : 'checkOut'
  for (let page = 0; page < maxPages; page++) {
    const skip = page * 100
    const data = await api<{ results: any[]; count?: number }>(
      `/reservations?limit=100&skip=${skip}&fields=${FIELDS}&sort=${sort}${filter}`
    )
    const results = data.results || []
    const rows = results.map(mapReservation)
    if (rows.length === 0) break
    const { error } = await sb.from('guesty_reservations').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert reservations: ${error.message}`)
    total += rows.length
    if (since && results.some((r: any) => (r.lastUpdatedAt || r.updatedAt) && new Date(r.lastUpdatedAt || r.updatedAt).getTime() < new Date(since).getTime())) break
    if (rows.length < 100) break
  }
  await recordSync('reservations', total)
  return total
}

// ------------------------------------------------------------
// BACKFILL BY CREATION DATE
//
// The routine sync only ever pulls stays that have not finished yet (checkOut >= now-3d), so a
// booking MADE in March for a stay that ended in April was never imported. That is invisible for
// operations — the stay is over — but it silently truncates any report keyed on when a booking was
// created, which is exactly what the marketing board measures.
//
// This pulls straight by createdAt instead, so history can be filled in properly. It is paged by
// the CALLER (skip/pages) so one request never runs past the serverless ceiling.
export async function backfillReservationsByCreated(
  fromIso: string,
  toIso: string,
  skip = 0,
  pages = 20,
): Promise<{ fetched: number; nextSkip: number; done: boolean }> {
  const sb = supabaseAdmin()
  const filter = `&filters=${encodeURIComponent(JSON.stringify([
    { field: 'createdAt', operator: '$gte', value: fromIso },
    { field: 'createdAt', operator: '$lt', value: toIso },
  ]))}`
  let fetched = 0
  let cursor = skip
  let done = false
  for (let page = 0; page < pages; page++) {
    const data = await api<{ results: any[]; count?: number }>(
      `/reservations?limit=100&skip=${cursor}&fields=${FIELDS}&sort=createdAt${filter}`
    )
    const results = data.results || []
    if (results.length === 0) { done = true; break }
    const rows = results.map(mapReservation)
    // Backfilled rows must never clobber a live one that the routine sync keeps fresher, but an
    // upsert on id is safe here: mapReservation writes the same shape from the same source.
    const { error } = await sb.from('guesty_reservations').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`backfill upsert: ${error.message}`)
    fetched += rows.length
    cursor += results.length
    if (results.length < 100) { done = true; break }
  }
  return { fetched, nextSkip: cursor, done }
}

export async function syncListings(maxPages = 20, since: string | null = null): Promise<number> {
  const sb = supabaseAdmin()
  let total = 0
  const filter = since ? sinceFilter(since) : ''
  for (let page = 0; page < maxPages; page++) {
    const skip = page * 100
    const data = await api<{ results: any[] }>(`/listings?limit=100&skip=${skip}&sort=-lastUpdatedAt${filter}`)
    const results = data.results || []
    const rows = results.map(mapListing)
    if (rows.length === 0) break
    // Preserve StayBoard's locally-injected annotations (underscore-prefixed keys Guesty never returns,
    // e.g. _lastOptimized, _lastRecreated, _photoScore). Without this, every sync overwrites `raw` with
    // Guesty's copy and wipes them — which is why the "last optimized" date wasn't sticking.
    try {
      const ids = (rows as any[]).map(r => r.id).filter(Boolean)
      if (ids.length) {
        const { data: existing } = await sb.from('guesty_listings').select('id, raw, amenities, amenities_pushed_at').in('id', ids)
        const annoById: Record<string, Record<string, any>> = {}
        const protAmenById: Record<string, any[]> = {}
        const PROT_MS = 30 * 60 * 1000
        for (const e of (existing || []) as any[]) {
          const er = e.raw
          if (er && typeof er === 'object') {
            const anno: Record<string, any> = {}
            for (const k of Object.keys(er)) if (k.startsWith('_')) anno[k] = er[k]
            if (Object.keys(anno).length) annoById[e.id] = anno
          }
          const pAt = e.amenities_pushed_at
          if (pAt && (Date.now() - new Date(pAt).getTime()) < PROT_MS && Array.isArray(e.amenities)) protAmenById[e.id] = e.amenities
        }
        for (const r of rows as any[]) {
          const anno = annoById[r.id]
          if (anno && r.raw && typeof r.raw === 'object') r.raw = { ...r.raw, ...anno }
          // Just-pushed amenities: keep the local set so a stale Guesty pull can't revert it before it propagates.
          const pa = protAmenById[r.id]
          if (pa) { r.amenities = pa; if (r.raw && typeof r.raw === 'object') r.raw = { ...r.raw, amenities: pa } }
        }
      }
    } catch { /* best effort — if the merge fails, the sync still proceeds */ }
    const { error } = await sb.from('guesty_listings').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert listings: ${error.message}`)
    total += rows.length
    if (since && results.some((l: any) => (l.lastUpdatedAt || l.updatedAt) && new Date(l.lastUpdatedAt || l.updatedAt).getTime() < new Date(since).getTime())) break
    if (rows.length < 100) break
  }
  await recordSync('listings', total)
  return total
}

export async function syncCustomFields(): Promise<number> {
  const sb = supabaseAdmin()
  // Correct Open API path is account-scoped: /accounts/{id}/custom-fields (NOT /custom-fields).
  // The id-scoped path returns nothing parseable (likely because GUESTY_ACCOUNT_ID is unset or that
  // route behaves differently); the UN-scoped `accounts/custom-fields` demonstrably returns the
  // account object with all 28 definitions under `customFields`. Try the scoped path first for
  // accounts where it works, then fall back to the one that is proven.
  let data: any = null
  try { data = ACCOUNT_ID ? await api<any>(`/accounts/${ACCOUNT_ID}/custom-fields`) : null } catch { data = null }
  const looksEmpty = (d: any) => {
    if (!d) return true
    const a = Array.isArray(d) ? d : (d.customFields || d.results || d.data || d.fields || d?.account?.customFields)
    return !Array.isArray(a) || a.length === 0
  }
  if (looksEmpty(data)) {
    try { data = await api<any>(`/accounts/custom-fields`) } catch { /* keep whatever we had */ }
  }
  // 2026-08-19: this endpoint returns the ACCOUNT OBJECT with the definitions nested under
  // `customFields` — not a bare list. The extraction below only looked for results/data/fields, so
  // it silently found zero, skipped the write, and stamped the feed as a clean sync. The table sat
  // EMPTY for months while every caller that resolves a field BY NAME (door code, welcome_call,
  // sensitive) quietly fell back to id-matching or gave up. Guesty had 27 definitions the whole time.
  const arr: any[] = Array.isArray(data) ? data
    : ((data as any).customFields || (data as any).results || (data as any).data || (data as any).fields
      || (data as any)?.account?.customFields || [])
  const rows = arr.map(mapCustomField).filter((r: any) => r.id && r.name)
  if (rows.length) {
    const { error } = await sb.from('guesty_custom_fields').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert custom_fields: ${error.message}`)
  }
  // Finding NOTHING on an account that has custom fields is a bug, not a quiet success. Record it as
  // an error so the feed shows red instead of a reassuring timestamp.
  // 2026-08-25: every one of these endpoints answered 429 for an extended period, and the message
  // below claimed the SHAPE had changed — sending the next reader hunting through the payload for a
  // parser bug that was not there. Say which it is.
  await recordSync('custom_fields', rows.length,
    rows.length ? null
      : data === null
        ? 'Guesty returned nothing for the account custom-fields endpoints (rate limit or auth) — the mirror was left as it was'
        : 'parsed 0 field definitions from the account payload — shape may have changed again')
  return rows.length
}

export async function syncConversations(): Promise<number> {
  const sb = supabaseAdmin()
  // Guesty's inbox endpoint does NOT accept `skip`; pull the most-recently-active conversations.
  //
  // 2026-08-19: this was 500ing on EVERY sync at limit=100 while the same endpoint returns 200 at a
  // small limit — Guesty chokes on the wide page, not on the request. The feed recorded the error
  // and moved on, so conversations quietly stopped refreshing. Step down through smaller pages
  // rather than failing the whole entity.
  let data: any = null
  let lastErr: any = null
  const LIMITS = [100, 50, 25]
  for (const lim of LIMITS) {
    try { data = await api<any>(`/communication/conversations?limit=${lim}&sort=-lastMessageAt`); lastErr = null; break }
    catch (e: any) { lastErr = e }
  }
  if (lastErr) throw lastErr
  // Response shape varies; find the first array anywhere in the payload.
  const list: any[] =
    Array.isArray(data) ? data
    : Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.data?.conversations) ? data.data.conversations
    : Array.isArray(data?.conversations) ? data.conversations
    : Array.isArray(data?.data?.results) ? data.data.results
    : []
  const rows = list.map(mapConversation)
  if (rows.length) {
    const { error } = await sb.from('guesty_conversations').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert conversations: ${error.message}`)
  }
  await recordSync('conversations', rows.length)
  return rows.length
}

export async function syncMessages(conversationId: string): Promise<number> {
  const sb = supabaseAdmin()
  const data = await api<any>(
    `/communication/conversations/${encodeURIComponent(conversationId)}/posts?limit=200`
  )
  const dd = data?.data ?? data
  const arr: any[] = Array.isArray(dd) ? dd : (dd?.results ?? dd?.posts ?? data?.results ?? data?.posts ?? [])
  const rows = arr.map((m: any) => mapMessage(conversationId, m))
  if (rows.length) {
    const { error } = await sb.from('guesty_messages').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert messages (${conversationId}): ${error.message}`)
  }
  // Backfill the conversation preview from the newest actual message body (Guesty's inbox list omits it).
  const dated = rows.filter((r: any) => r.sent_at && r.body)
  if (dated.length) {
    const latest = dated.reduce((a: any, b: any) => (String(a.sent_at) >= String(b.sent_at) ? a : b))
    const preview = String(latest.body).replace(/\s+/g, ' ').trim().slice(0, 200)
    if (preview) await sb.from('guesty_conversations').update({ last_message_preview: preview }).eq('id', conversationId)
  }
  return rows.length
}

// Clean a raw Guesty channel id/name into a human-friendly label.
function cleanChannel(rawChannel: string): string {
  const c = String(rawChannel || '').toLowerCase()
  if (/airbnb/.test(c))            return 'Airbnb'
  if (/booking/.test(c))           return 'Booking.com'
  if (/vrbo|homeaway/.test(c))     return 'Vrbo'
  if (/expedia/.test(c))           return 'Expedia'
  if (/direct|manual|owner/.test(c)) return 'Direct'
  const trimmed = String(rawChannel || '').trim()
  if (!trimmed) return 'Other'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function mapReview(v: any) {
  const rr = v.rawReview || v.raw || {}
  const rating =
    v.rating ?? v.overallRating ??
    rr.overall_rating ?? rr.overallRating ?? rr.rating ?? rr.score ?? rr.average_score ??
    v.publicReview?.rating ?? null
  const content =
    rr.public_review ?? rr.publicReview ?? rr.comments ?? rr.review ?? rr.text ??
    rr.positive ?? rr.review_text ?? rr.content ??
    v.publicReview?.text ?? v.content ?? v.text ?? v.comments ?? ''
  // Host PUBLIC response ONLY — never the guest's private feedback or ambiguous guest fields.
  const replyText =
    rr.host_response ?? rr.hostResponse ?? rr.owner_response ?? rr.ownerResponse ?? rr.response ?? rr.management_response ??
    v.hostResponse ?? v.ownerResponse ?? null
  const listingId = v.listingId ?? v.listing?._id ?? rr.listing_id ?? v.listing?.id ?? null
  const guest = v.guest?.fullName ?? v.reviewer?.name ?? v.guestName ?? rr.reviewer_name ?? rr.reviewer?.name ?? v.from?.fullName ?? null
  const rawChannel = String(v.channelId ?? v.channel ?? rr.channel ?? v.platform ?? v.source ?? v.integration ?? v.module ?? '')
  const replies = Array.isArray(v.reviewReplies) ? v.reviewReplies : (Array.isArray(rr.reviewReplies) ? rr.reviewReplies : (Array.isArray(rr.review_replies) ? rr.review_replies : []))
  const replyFromArray = replies.length
    ? (replies[0]?.reply ?? replies[0]?.text ?? replies[0]?.reviewReply ?? replies[0]?.body ?? replies[0]?.response ?? null)
    : null
  const finalReply = (replyFromArray && String(replyFromArray).trim()) ? replyFromArray : replyText
  const hasReply = !!(finalReply && String(finalReply).trim())
  // Channel-specific extraction: Booking.com nests content under content.{headline,positive,negative}
  // and rating under scoring.review_score (1-10). Vrbo uses body.value + starRatingOverall (1-5).
  let contentStr: string = (typeof content === 'string' && content.trim()) ? content : ''
  if (!contentStr && rr.content && typeof rr.content === 'object') {
    contentStr = [rr.content.headline, rr.content.positive, rr.content.negative].filter((x: any) => x && String(x).trim()).join(' - ')
  }
  if (!contentStr) {
    const vBody = rr.body && typeof rr.body === 'object' ? rr.body.value : rr.body
    const vTitle = rr.title && typeof rr.title === 'object' ? rr.title.value : rr.title
    contentStr = [typeof vTitle === 'string' ? vTitle : '', typeof vBody === 'string' ? vBody : ''].filter((x: any) => x && String(x).trim()).join(': ')
  }
  let ratingNum: number | null = typeof rating === 'number' ? rating : (rating != null ? Number(rating) : null)
  if (ratingNum == null) {
    if (rr.scoring?.review_score != null) ratingNum = Number(rr.scoring.review_score) / 2
    else { const alt = rr.starRatingOverall ?? rr.starRating ?? rr.overallSatisfaction ?? null; ratingNum = alt != null ? Number(alt) : null }
  }
  if (ratingNum != null && Number.isNaN(ratingNum)) ratingNum = null
  // SAFETY NET: Booking publishes 0-10. The scoring.review_score/2 above normalizes the usual
  // shape, but if a raw 10-scale value slips through the primary field chain (score/average_score),
  // halve it here — the stored column is ALWAYS the 5-star scale (combined stats depend on it).
  if (ratingNum != null && ratingNum > 5 && /booking/i.test(String(rawChannel || ''))) ratingNum = ratingNum / 2
  if (ratingNum != null) ratingNum = Math.round(ratingNum * 10) / 10

  return {
    id:          v._id ?? v.id ?? v.externalReviewId ?? null,
    listing_id:  listingId,
    rating:      ratingNum,
    content:     String(contentStr || '').slice(0, 600),
    channel:     cleanChannel(rawChannel),
    channel_raw: rawChannel || null,
    guest_name:  guest,
    created_at:  v.createdAt ?? rr.created_at ?? v.date ?? v.submittedAt ?? null,
    has_reply:   hasReply,
    reply:       finalReply ? String(finalReply) : null,
    raw:         v
  }
}

// Reviews — paginate /reviews and upsert into the dedicated guesty_reviews table.
//
// DO NOT add a `sort` param here. Guesty's /reviews endpoint does not accept one and rejects the
// whole request with 400 VALIDATION_FAILED ('"sort" is not allowed'), which kills the entire review
// sync silently. (That regression shipped 2026-07-31 and stalled reviews for days.)
//
// ── WHY THIS PAGES TO EXHAUSTION (2026-08-26) ───────────────────────────────────────────────────
// The previous version capped at 60 pages / 6,000 reviews and justified it with a comment claiming
// "/reviews already returns results sorted DESCENDING BY LAST UPDATE TIME, so page 0 always carries
// the freshest reviews." Nothing verified that. It was written to replace the `sort=-createdAt`
// that had just been removed for being invalid — an assumption standing in for the thing it lost.
//
// If Guesty actually returns ASCENDING order, that cap does exactly the opposite of what the
// comment promises: once the account passes 6,000 reviews, every new review lives on a page the
// loop never reaches, and the feed goes quiet while the job reports success every two hours. Jon
// confirmed on 2026-08-26 that Airbnb reviews HAVE been arriving and are not in the app, which is
// that failure, not the upstream outage the code comments had concluded.
//
// So the fix does not depend on knowing the sort order: page until the API runs out. The ceiling is
// now a runaway guard rather than a policy, and an elapsed-time budget stops the caller being
// killed mid-loop with no record of why. Upsert is idempotent (onConflict id) and never deletes.
/** Are Guesty credentials present at all? Used by the health screen before it tries to call out. */
export function guestyConfigured(): boolean {
  return !!(process.env.GUESTY_CLIENT_ID && process.env.GUESTY_CLIENT_SECRET)
}

/**
 * The newest reviews AS GUESTY SEES THEM — read-only, never written to our tables.
 *
 * This exists so the health screen can answer the only question that matters when reviews go
 * missing: did the channel stop sending them, or did we stop storing them? Our own table cannot
 * tell those apart. One page of Guesty's feed can.
 */
export async function listRecentReviews(limit = 200): Promise<{ id: string; channel: string; createdAt: string | null; rating: number | null }[]> {
  const out: { id: string; channel: string; createdAt: string | null; rating: number | null }[] = []
  const per = Math.min(100, Math.max(1, limit))
  for (let page = 0; page * per < limit; page++) {
    const data = await api<any>(`/reviews?limit=${per}&skip=${page * per}`)
    const dd: any = data?.data ?? data
    const arr: any[] = Array.isArray(dd) ? dd
      : Array.isArray(dd?.results) ? dd.results
      : Array.isArray(dd?.reviews) ? dd.reviews
      : []
    if (!arr.length) break
    for (const v of arr) {
      const m: any = mapReview(v)
      out.push({ id: String(m.id || ''), channel: String(m.channel || 'Other'), createdAt: m.created_at || null, rating: m.rating ?? null })
    }
    if (arr.length < per) break
  }
  return out
}

export type ReviewSyncStats = {
  fetched: number      // rows Guesty returned
  kept: number         // rows written
  skipped: number      // rows dropped for having neither text nor a rating
  pages: number
  exhausted: boolean   // true = we reached the end of the feed; false = we ran out of budget
  newest: string | null
  oldest: string | null
}

export async function syncReviewsDetailed(opts?: { maxPages?: number; budgetMs?: number }): Promise<ReviewSyncStats> {
  const sb = supabaseAdmin()
  const maxPages = opts?.maxPages ?? 400          // 40,000 reviews — a runaway guard, not a policy
  const budgetMs = opts?.budgetMs ?? 240_000
  const startedAt = Date.now()
  const st: ReviewSyncStats = { fetched: 0, kept: 0, skipped: 0, pages: 0, exhausted: false, newest: null, oldest: null }

  for (let page = 0; page < maxPages; page++) {
    if (Date.now() - startedAt > budgetMs) break     // out of time, not out of data — say so below
    const data = await api<{ results?: any[]; data?: any[]; reviews?: any[] } | any[]>(
      `/reviews?limit=100&skip=${page * 100}`
    )
    const dd: any = (data as any)?.data ?? data
    const arr: any[] = Array.isArray(dd) ? dd
      : Array.isArray(dd?.results) ? dd.results
      : Array.isArray(dd?.reviews) ? dd.reviews
      : Array.isArray((data as any)?.results) ? (data as any).results
      : Array.isArray((data as any)?.reviews) ? (data as any).reviews
      : []
    st.pages++
    st.fetched += arr.length
    if (arr.length === 0) { st.exhausted = true; break }

    const mapped = arr.map(mapReview).filter((r: any) => !!r.id)
    // A review with neither text nor a rating carries nothing to show, so it is not written — but
    // it IS counted. Silently dropping rows is how a channel goes quiet without anyone noticing;
    // a number somebody can look at is the difference between a bug and a mystery.
    const rows = mapped.filter((r: any) => r.content || r.rating != null)
    st.skipped += mapped.length - rows.length

    for (const r of mapped) {
      const at = String(r.created_at || '')
      if (!at) continue
      if (!st.newest || at > st.newest) st.newest = at
      if (!st.oldest || at < st.oldest) st.oldest = at
    }

    if (rows.length) {
      const { error } = await sb.from('guesty_reviews').upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(`upsert reviews: ${error.message}`)
      st.kept += rows.length
    }
    if (arr.length < 100) { st.exhausted = true; break }
  }

  await recordSync('reviews', st.kept)
  return st
}

/** Back-compat wrapper: the old signature, still returning the number of rows written. */
export async function syncReviews(_maxPages = 400, _since: string | null = null): Promise<number> {
  return (await syncReviewsDetailed()).kept
}

export const GUEST_COMMS_WATERMARK = 'guest_comms_watermark'

/**
 * Fetch message bodies for conversations that have actually moved since we last looked.
 *
 * WHY THIS WAS REWRITTEN (2026-08-19). The old version pulled the 150 most-recent conversations and
 * synced every one, unconditionally, as the LAST step of runFullSync on a 60-second function. 150
 * sequential Guesty calls cannot finish in the seconds left after listings/reservations/reviews have
 * run, so the process was killed mid-loop every single time. Because it died rather than threw,
 * recordSync() never ran and no error was recorded either — the feed just showed "no error" and a
 * timestamp drifting further into the past. It had been stale for 2.5 days before anyone noticed,
 * while Eve was answering guest questions off it.
 *
 * Three changes make that impossible to repeat:
 *   1. INCREMENTAL — only conversations with activity since the last successful pass.
 *   2. OLDEST FIRST — so a partial run always moves the watermark forward instead of redoing the
 *      same newest conversations and never reaching the backlog.
 *   3. TIME-BOXED — stops cleanly inside its budget and records what it got, so a partial run is
 *      visible as a partial run rather than as silence.
 */
export async function syncRecentMessages(maxConversations = 150, opts?: { budgetMs?: number }): Promise<number> {
  const sb = supabaseAdmin()
  const startedAt = Date.now()
  const budgetMs = Math.max(5000, opts?.budgetMs ?? 30000)

  // Where did we get to last time? Fall back to a 3-day lookback on first run.
  let watermark: string | null = null
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', GUEST_COMMS_WATERMARK).maybeSingle()
    const raw = (data as any)?.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed && typeof parsed === 'object' && parsed.at) watermark = String(parsed.at)
  } catch { /* first run */ }
  if (!watermark) watermark = new Date(Date.now() - 3 * 86400000).toISOString()

  // A small overlap absorbs clock skew and messages that land during a run.
  const since = new Date(new Date(watermark).getTime() - 60 * 60 * 1000).toISOString()

  const { data, error } = await sb
    .from('guesty_conversations')
    .select('id, last_message_at')
    .gte('last_message_at', since)
    .order('last_message_at', { ascending: true, nullsFirst: false })
    .limit(maxConversations)
  if (error) throw new Error(`read conversations for messages: ${error.message}`)
  const convos = (data || []) as { id: string; last_message_at: string | null }[]

  let total = 0
  let done = 0
  let cursor: string | null = null
  let ranOut = false
  for (const c of convos) {
    if (!c.id) continue
    if (Date.now() - startedAt > budgetMs) { ranOut = true; break }
    try {
      total += await syncMessages(c.id)
      done++
      if (c.last_message_at) cursor = c.last_message_at
    } catch (e: any) {
      // One bad conversation must not cost us the whole batch — note it and keep going.
      if (!/rate|429/i.test(String(e?.message || e))) continue
      ranOut = true
      break
    }
  }

  // Advance the watermark to the last conversation we actually finished.
  if (cursor) {
    try {
      await sb.from('app_settings').upsert({
        key: GUEST_COMMS_WATERMARK,
        value: JSON.stringify({ at: cursor, done, total, partial: ranOut, ranAt: new Date().toISOString() }),
        updated_at: new Date().toISOString(), updated_by: 'guest-comms-sync',
      }, { onConflict: 'key' })
    } catch { /* watermark is an optimisation, not a correctness requirement */ }
  }

  await recordSync('messages', total, ranOut ? `partial: ${done}/${convos.length} conversations in budget — will resume from ${cursor || 'start'}` : null)
  return total
}


export async function runFullSync(full = false): Promise<{ reservations: number; listings: number; custom_fields: number; conversations: number; reviews: number; messages: number; errors: string[] }> {
  const errors: string[] = []
  const result = { reservations: 0, listings: 0, custom_fields: 0, conversations: 0, reviews: 0, messages: 0, errors }
  // Warm the shared token ONCE up front. If Guesty's auth endpoint is throttled (429),
  // abort the whole sync instead of letting each entity hammer the token endpoint.
  try {
    await getToken()
  } catch (e: any) {
    const msg = `auth: ${e.message || e}`
    errors.push(msg)
    await recordSync('auth', 0, msg).catch(() => {})
    return result
  }
  async function safe<T>(label: string, fn: () => Promise<T>, set: (v: T) => void) {
    try { set(await fn()) } catch (e: any) {
      const msg = `${label}: ${e.message || e}`
      errors.push(msg)
      await recordSync(label, 0, msg).catch(() => {})
    }
  }
  const resSince = full ? null : await getSince('reservations')
  const lstSince = full ? null : await getSince('listings')
  await safe('custom_fields', syncCustomFields,  v => result.custom_fields = v)
  await safe('listings',      () => syncListings(20, lstSince),      v => result.listings      = v)
  await safe('reservations',  () => syncReservations(40, resSince),  v => result.reservations  = v)
  await safe('conversations', syncConversations, v => result.conversations = v)
  await safe('reviews', syncReviews, v => result.reviews = v)
  // Messages get a deliberately SMALL slice here. The real work happens on the dedicated
  // /api/cron/guest-comms route, which has a 300s budget instead of this route's 60s.
  await safe('messages', () => syncRecentMessages(25, { budgetMs: 8000 }), v => result.messages = v)
  return result
}
