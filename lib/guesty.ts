// Guesty Open API client — token persisted in Supabase + sync helpers.
//
// Architecture:
//   token()       → reads cached OAuth token from Supabase, refreshes if expired
//   api()         → authed fetch helper; surfaces 429/4xx as readable errors
//   sync*()       → pull paginated data from Guesty and upsert into Supabase
//   listings/reservations/etc helpers below are LOCAL reads from Supabase, not Guesty.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const BASE      = process.env.GUESTY_BASE_URL  || 'https://open-api.guesty.com/v1'
const TOKEN_URL = process.env.GUESTY_TOKEN_URL || 'https://open-api.guesty.com/oauth2/token'
const CID       = process.env.GUESTY_CLIENT_ID
const CSEC      = process.env.GUESTY_CLIENT_SECRET

// ─────────────────────────────────────────────────────────────────
// Token cache (Supabase-backed so all serverless instances share one)
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// Authed fetch with retry on 401 (token rotation) and pause on 429
// ─────────────────────────────────────────────────────────────────
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let attempt = 0
  while (true) {
    attempt++
    const token = await getToken(attempt > 1)
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })
    if (r.status === 401 && attempt === 1) continue                  // force refresh + retry once
    if (r.status === 429 && attempt < 4) {                            // backoff on rate limit
      const wait = Math.min(2000 * attempt, 8000)
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

// ─────────────────────────────────────────────────────────────────
// Field mappers (Guesty raw → Supabase schema)
// ─────────────────────────────────────────────────────────────────
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
    check_in:          r.checkIn  ? new Date(r.checkIn).toISOString().slice(0, 10)  : null,
    check_out:         r.checkOut ? new Date(r.checkOut).toISOString().slice(0, 10) : null,
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

function parseBuilding(nick?: string, title?: string): { building: string | null; unit: string | null; room_type: string | null } {
  const name = nick || title || ''
  // Examples: "17WEST - 406 - 3B LOFT", "Elser 3707 - Studio", "Oasis Bamboo - Stu"
  const parts = name.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean)
  if (parts.length >= 3) return { building: parts[0], unit: parts[1], room_type: parts.slice(2).join(' - ') }
  if (parts.length === 2) {
    // Could be "Elser 3707" + "Studio" — building+unit before the dash, room_type after
    const m = parts[0].match(/^(.+?)\s+(\d+\w*)$/)
    if (m) return { building: m[1].trim(), unit: m[2], room_type: parts[1] }
    return { building: parts[0], unit: null, room_type: parts[1] }
  }
  return { building: parts[0] || null, unit: null, room_type: null }
}

function mapListing(l: any) {
  const addr = l.address || {}
  const tags = Array.isArray(l.tags) ? l.tags : []
  const { building, unit, room_type } = parseBuilding(l.nickname, l.title)
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
  return {
    id:                   c._id || c.id,
    reservation_id:       c.reservationId || c.reservation?._id || null,
    listing_id:           c.listingId || c.listing?._id || null,
    guest_name:           c.guest?.fullName || c.lastMessage?.from?.fullName || null,
    channel:              (c.channel || c.lastMessage?.module || 'other').toLowerCase(),
    last_message_at:      c.lastMessageAt || c.updatedAt || c.createdAt || null,
    last_message_preview: (c.lastMessage?.body || '').slice(0, 200) || null,
    unread_count:         c.unreadCount ?? 0,
    raw:                  c
  }
}

function mapMessage(conversationId: string, m: any) {
  const sender = m.module === 'system' ? 'system' : (m.from?.type === 'guest' ? 'guest' : 'host')
  return {
    id:              m._id || m.id,
    conversation_id: conversationId,
    sender,
    sender_name:     m.from?.fullName || (sender === 'system' ? 'System' : null),
    body:            m.body || m.text || null,
    sent_at:         m.createdAt || m.sentAt || null,
    attachments:     Array.isArray(m.attachments) ? m.attachments : null,
    raw:             m
  }
}

function mapCustomField(c: any) {
  return {
    id:      c._id || c.id,
    name:    c.fieldName || c.name || '',
    type:    (c.type || 'text').toLowerCase(),
    target:  String(c.objectType || c.target || 'reservation').toLowerCase().replace(/s$/, ''),
    options: c.options || c.values || null
  }
}

// ─────────────────────────────────────────────────────────────────
// Sync — paginated pulls + upsert to Supabase
// ─────────────────────────────────────────────────────────────────
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

const FIELDS = encodeURIComponent('status guest listing checkIn checkOut nightsCount money source customFields confirmationCode createdAt note')

export async function syncReservations(maxPages = 40): Promise<number> {
  const sb = supabaseAdmin()
  let total = 0
  for (let page = 0; page < maxPages; page++) {
    const skip = page * 100
    const data = await api<{ results: any[]; count?: number }>(
      `/reservations?limit=100&skip=${skip}&fields=${FIELDS}`
    )
    const rows = (data.results || []).map(mapReservation)
    if (rows.length === 0) break
    const { error } = await sb.from('guesty_reservations').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert reservations: ${error.message}`)
    total += rows.length
    if (rows.length < 100) break
  }
  await recordSync('reservations', total)
  return total
}

export async function syncListings(maxPages = 20): Promise<number> {
  const sb = supabaseAdmin()
  let total = 0
  for (let page = 0; page < maxPages; page++) {
    const skip = page * 100
    const data = await api<{ results: any[] }>(`/listings?limit=100&skip=${skip}`)
    const rows = (data.results || []).map(mapListing)
    if (rows.length === 0) break
    const { error } = await sb.from('guesty_listings').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert listings: ${error.message}`)
    total += rows.length
    if (rows.length < 100) break
  }
  await recordSync('listings', total)
  return total
}

export async function syncCustomFields(): Promise<number> {
  const sb = supabaseAdmin()
  const data = await api<{ results?: any[] } | any[]>(`/custom-fields`)
  const arr = Array.isArray(data) ? data : (data.results || [])
  const rows = arr.map(mapCustomField).filter((r: any) => r.id && r.name)
  if (rows.length) {
    const { error } = await sb.from('guesty_custom_fields').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert custom_fields: ${error.message}`)
  }
  await recordSync('custom_fields', rows.length)
  return rows.length
}

export async function syncConversations(maxPages = 10): Promise<number> {
  const sb = supabaseAdmin()
  let total = 0
  for (let page = 0; page < maxPages; page++) {
    const skip = page * 100
    const data = await api<{ results: any[] }>(`/communication/conversations?limit=100&skip=${skip}&sort=-lastMessageAt`)
    const rows = (data.results || []).map(mapConversation)
    if (rows.length === 0) break
    const { error } = await sb.from('guesty_conversations').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert conversations: ${error.message}`)
    total += rows.length
    if (rows.length < 100) break
  }
  await recordSync('conversations', total)
  return total
}

export async function syncMessages(conversationId: string): Promise<number> {
  const sb = supabaseAdmin()
  const data = await api<{ results: any[] }>(
    `/communication/conversations/${encodeURIComponent(conversationId)}/posts?limit=200`
  )
  const rows = (data.results || []).map((m: any) => mapMessage(conversationId, m))
  if (rows.length) {
    const { error } = await sb.from('guesty_messages').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`upsert messages (${conversationId}): ${error.message}`)
  }
  return rows.length
}

export async function runFullSync(): Promise<{ reservations: number; listings: number; custom_fields: number; conversations: number; errors: string[] }> {
  const errors: string[] = []
  const result = { reservations: 0, listings: 0, custom_fields: 0, conversations: 0, errors }
  async function safe<T>(label: string, fn: () => Promise<T>, set: (v: T) => void) {
    try { set(await fn()) } catch (e: any) {
      const msg = `${label}: ${e.message || e}`
      errors.push(msg)
      await recordSync(label, 0, msg).catch(() => {})
    }
  }
  await safe('custom_fields', syncCustomFields,  v => result.custom_fields = v)
  await safe('listings',      syncListings,      v => result.listings      = v)
  await safe('reservations',  syncReservations,  v => result.reservations  = v)
  await safe('conversations', syncConversations, v => result.conversations = v)
  return result
}
