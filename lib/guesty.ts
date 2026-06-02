import {
  Reservation,
  Listing,
  CustomFieldDefinition,
  CustomFieldValue,
  Conversation,
  Message
} from '@/types/guesty'

const MOCK = process.env.NEXT_PUBLIC_GUESTY_MOCK_MODE === 'true'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const CID  = process.env.GUESTY_CLIENT_ID
const CSEC = process.env.GUESTY_CLIENT_SECRET

let cachedToken: { token: string; expiresAt: number } | null = null

async function token(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  if (!CID || !CSEC) throw new Error('Guesty credentials not set')
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: CID,
      client_secret: CSEC
    })
  })
  if (!r.ok) throw new Error(`Guesty auth failed: ${r.status}`)
  const d = await r.json() as { access_token: string; expires_in: number }
  cachedToken = { token: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 }
  return cachedToken.token
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    cache: 'no-store'
  })
  if (!r.ok) throw new Error(`Guesty ${path} → ${r.status}`)
  return r.json() as Promise<T>
}

// ─────────────────────────────────────────────────────────────────
// Custom Field Definitions
// (Guesty: GET /custom-fields — system + account-defined fields)
// ─────────────────────────────────────────────────────────────────
export async function listCustomFieldDefinitions(target: 'reservation' | 'listing' | 'guest' = 'reservation'): Promise<CustomFieldDefinition[]> {
  if (MOCK) return mockCustomFieldDefs().filter(d => d.target === target)
  const data = await api<{ results: any[] } | any[]>(`/custom-fields?target=${target}`)
  const arr = Array.isArray(data) ? data : (data.results || [])
  return arr.map(toCustomFieldDef).filter(d => d.target === target)
}

// ─────────────────────────────────────────────────────────────────
// Reservations (with custom field values inlined when requested)
// ─────────────────────────────────────────────────────────────────
export async function listReservations(limit = 30): Promise<Reservation[]> {
  if (MOCK) return mockReservations(limit)
  // `fields` param tells Guesty to expand customFields into the response
  const data = await api<{ results: any[] }>(
    `/reservations?limit=${limit}&fields=${encodeURIComponent('status guest listing checkIn checkOut nights money source customFields confirmationCode createdAt note')}`
  )
  return data.results.map(toReservation)
}

export async function getReservation(id: string): Promise<Reservation | null> {
  if (MOCK) {
    const all = mockReservations(40)
    return all.find(r => r.id === id) ?? null
  }
  try {
    const r = await api<any>(`/reservations/${encodeURIComponent(id)}`)
    return toReservation(r)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────
// Listings
// ─────────────────────────────────────────────────────────────────
export async function listListings(): Promise<Listing[]> {
  if (MOCK) return mockListings()
  const data = await api<{ results: any[] }>('/listings?limit=200')
  return data.results.map(toListing)
}

// ─────────────────────────────────────────────────────────────────
// Conversations + messages (for AI message-review)
// (Guesty: GET /communication/conversations, GET /communication/conversations/:id/posts)
// ─────────────────────────────────────────────────────────────────
export async function listConversations(limit = 50): Promise<Conversation[]> {
  if (MOCK) return mockConversations(limit)
  const data = await api<{ results: any[] }>(`/communication/conversations?limit=${limit}`)
  return data.results.map(toConversation)
}

export async function listMessages(conversationId: string, limit = 200): Promise<Message[]> {
  if (MOCK) return mockMessages(conversationId)
  const data = await api<{ results: any[] }>(
    `/communication/conversations/${encodeURIComponent(conversationId)}/posts?limit=${limit}`
  )
  return data.results.map((m: any) => toMessage(conversationId, m))
}

// ─────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────
function toCustomFieldDef(d: any): CustomFieldDefinition {
  return {
    id: d._id || d.id,
    name: d.fieldName || d.name || '',
    type: (d.type || 'text').toLowerCase(),
    target: (d.objectType || d.target || 'reservation').toLowerCase().replace(/s$/, ''),
    options: d.options || d.values,
    required: !!d.required
  }
}

function toCustomFieldValue(v: any): CustomFieldValue {
  return {
    fieldId: v.fieldId || v._id || v.id || '',
    fieldName: v.fieldName || v.name || v.label || '',
    type: (v.type || 'text').toLowerCase(),
    value: v.value === undefined ? null : v.value
  }
}

function toReservation(r: any): Reservation {
  return {
    id: r._id || r.id,
    listingId: r.listingId || r.listing?._id || r.listing?.id || '',
    listingName: r.listing?.nickname || r.listing?.title || r.listingName || '',
    guest: {
      id: r.guest?._id || r.guest?.id,
      name: r.guest?.fullName || r.guest?.firstName || 'Unknown',
      email: r.guest?.email,
      phone: r.guest?.phone
    },
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    status: (r.status || 'confirmed').toLowerCase(),
    nights: r.nightsCount || r.nights || 0,
    money: {
      totalPaid: r.money?.totalPaid || 0,
      balanceDue: r.money?.balanceDue || 0,
      currency: r.money?.currency || 'USD'
    },
    source: (r.source || 'direct').toLowerCase(),
    confirmationCode: r.confirmationCode,
    notes: r.note || r.notes,
    createdAt: r.createdAt,
    customFields: Array.isArray(r.customFields) ? r.customFields.map(toCustomFieldValue) : [],
    conversationId: r.conversation?._id || r.conversationId
  }
}

function toListing(l: any): Listing {
  return {
    id: l._id || l.id,
    title: l.title,
    nickname: l.nickname,
    address: { full: l.address?.full || '', city: l.address?.city || '', state: l.address?.state || '' },
    bedrooms: l.bedrooms || 0,
    bathrooms: l.bathrooms || 0,
    beds: l.beds || 0,
    maxOccupancy: l.accommodates || 0,
    status: l.active ? 'active' : 'inactive',
    pictures: (l.pictures || []).map((p: any) => p.original || p.regular || p),
    amenities: l.amenities || []
  }
}

function toConversation(c: any): Conversation {
  return {
    id: c._id || c.id,
    reservationId: c.reservationId || c.reservation?._id,
    listingId: c.listingId || c.listing?._id,
    guestName: c.guest?.fullName || c.lastMessage?.from?.fullName || 'Guest',
    channel: (c.channel || c.lastMessage?.module || 'other').toLowerCase(),
    lastMessageAt: c.lastMessageAt || c.updatedAt || c.createdAt,
    lastMessagePreview: c.lastMessage?.body?.slice(0, 140) || '',
    unreadCount: c.unreadCount || 0
  }
}

function toMessage(conversationId: string, m: any): Message {
  return {
    id: m._id || m.id,
    conversationId,
    sender: (m.module === 'system' ? 'system' : m.from?.type === 'guest' ? 'guest' : 'host'),
    senderName: m.from?.fullName || m.from?.firstName || (m.module === 'system' ? 'System' : 'Host'),
    body: m.body || m.text || '',
    sentAt: m.createdAt || m.sentAt,
    attachments: (m.attachments || []).map((a: any) => ({ url: a.url, kind: a.kind || 'file' }))
  }
}

// ─────────────────────────────────────────────────────────────────
// Mocks (delete or ignore once GUESTY_CLIENT_ID is live)
// ─────────────────────────────────────────────────────────────────
function mockCustomFieldDefs(): CustomFieldDefinition[] {
  return [
    { id: 'cf_welcome',    name: 'Welcome Call',     type: 'boolean', target: 'reservation' },
    { id: 'cf_verified',   name: 'Guest Verified',   type: 'boolean', target: 'reservation' },
    { id: 'cf_sensitive',  name: 'Sensitive Guest',  type: 'boolean', target: 'reservation' },
    { id: 'cf_idsubmitted',name: 'ID Submitted',     type: 'boolean', target: 'reservation' },
    { id: 'cf_signed',     name: 'Rental Agreement Signed', type: 'boolean', target: 'reservation' },
    { id: 'cf_arrival',    name: 'Estimated Arrival',type: 'text',    target: 'reservation' },
    { id: 'cf_riskscore',  name: 'AI Risk Score',    type: 'select',  target: 'reservation', options: ['low', 'medium', 'high'] }
  ]
}

function mockListings(): Listing[] {
  return [
    { id: 'L1', title: '17 West – Penthouse', nickname: '17West', address: { full: '1700 W Ave, Miami', city: 'Miami', state: 'FL' }, bedrooms: 3, bathrooms: 2, beds: 4, maxOccupancy: 8, status: 'active', pictures: [], amenities: ['Pool', 'WiFi'] },
    { id: 'L2', title: 'Rustic 10 – Beachfront', nickname: 'Rustic10', address: { full: '10 Rustic Rd, Fort Lauderdale', city: 'Fort Lauderdale', state: 'FL' }, bedrooms: 4, bathrooms: 3, beds: 5, maxOccupancy: 10, status: 'active', pictures: [], amenities: ['Pool', 'Hot tub', 'WiFi'] },
    { id: 'L3', title: 'Eden – Pool House', nickname: 'Eden', address: { full: '42 Eden Way, Miami', city: 'Miami', state: 'FL' }, bedrooms: 2, bathrooms: 2, beds: 3, maxOccupancy: 6, status: 'active', pictures: [], amenities: ['Pool', 'BBQ', 'WiFi'] },
    { id: 'L4', title: 'Lucerne 4 – Studio', nickname: 'Lucerne4', address: { full: '4 Lucerne Ave, Miami', city: 'Miami', state: 'FL' }, bedrooms: 1, bathrooms: 1, beds: 1, maxOccupancy: 2, status: 'active', pictures: [], amenities: ['WiFi'] }
  ]
}

function mockReservations(n: number): Reservation[] {
  const listings = mockListings()
  const guests = ['Sarah Chen', 'Marcus Williams', 'Priya Patel', 'James OConnor', 'Sofia Lopez', 'Aiden Park', 'Lena Bauer', 'Carlos Vega']
  const sources: Reservation['source'][] = ['airbnb', 'vrbo', 'booking', 'direct']
  const today = new Date()
  return Array.from({ length: n }).map((_, i) => {
    const list = listings[i % listings.length]
    const days = (i % 14) - 7
    const ci = new Date(today); ci.setDate(today.getDate() + days)
    const co = new Date(ci);   co.setDate(ci.getDate() + 2 + (i % 5))
    const status: Reservation['status'] =
      days < 0 ? 'checked_out' : days === 0 ? 'checked_in' : 'confirmed'
    return {
      id: `R${i + 1}`,
      listingId: list.id,
      listingName: list.nickname,
      guest: {
        id: `G${i + 1}`,
        name: guests[i % guests.length],
        email: `${guests[i % guests.length].toLowerCase().replace(' ', '.')}@example.com`,
        phone: `+1305555${String(1000 + i).slice(-4)}`
      },
      checkIn: ci.toISOString(),
      checkOut: co.toISOString(),
      status,
      nights: Math.round((co.getTime() - ci.getTime()) / 86400000),
      money: { totalPaid: 200 + (i * 37) % 800, balanceDue: 0, currency: 'USD' },
      source: sources[i % sources.length],
      confirmationCode: `HM${String(100000 + i).slice(-6)}`,
      createdAt: new Date(today.getTime() - i * 3600000).toISOString(),
      customFields: [
        { fieldId: 'cf_welcome',    fieldName: 'Welcome Call',     type: 'boolean', value: i % 3 !== 0 },
        { fieldId: 'cf_verified',   fieldName: 'Guest Verified',   type: 'boolean', value: i % 4 !== 0 },
        { fieldId: 'cf_sensitive',  fieldName: 'Sensitive Guest',  type: 'boolean', value: i % 7 === 0 },
        { fieldId: 'cf_idsubmitted',fieldName: 'ID Submitted',     type: 'boolean', value: i % 5 !== 0 },
        { fieldId: 'cf_signed',     fieldName: 'Rental Agreement Signed', type: 'boolean', value: i % 3 === 0 },
        { fieldId: 'cf_arrival',    fieldName: 'Estimated Arrival',type: 'text',    value: i % 2 === 0 ? '3:00 PM' : '6:30 PM' },
        { fieldId: 'cf_riskscore',  fieldName: 'AI Risk Score',    type: 'select',  value: i % 8 === 0 ? 'high' : i % 3 === 0 ? 'medium' : 'low' }
      ],
      conversationId: `C${i + 1}`
    }
  })
}

function mockConversations(limit: number): Conversation[] {
  const res = mockReservations(Math.min(limit, 30))
  const channels: Conversation['channel'][] = ['airbnb', 'vrbo', 'booking', 'sms', 'email']
  const previews = [
    'Hi! Just checking in — what time can we arrive?',
    'Could we get an extra towel set sent up?',
    'The AC stopped working in the master bedroom.',
    'Thanks again, the place was amazing!',
    'Quick question about parking — is it included?',
    'We have a small dog, is that OK?',
    'Running late, will be there around 11 PM.',
    'Code for the front door doesn\'t work.'
  ]
  return res.map((r, i) => ({
    id: r.conversationId || `C${i + 1}`,
    reservationId: r.id,
    listingId: r.listingId,
    guestName: r.guest.name,
    channel: channels[i % channels.length],
    lastMessageAt: new Date(Date.now() - i * 3.6e6).toISOString(),
    lastMessagePreview: previews[i % previews.length],
    unreadCount: i % 4 === 0 ? (i % 3) + 1 : 0
  }))
}

function mockMessages(conversationId: string): Message[] {
  const guestName = 'Guest'
  const base = Date.now() - 6 * 3600_000
  return [
    { id: 'm1', conversationId, sender: 'guest', senderName: guestName, body: 'Hi! Looking forward to the stay. What time can we check in?', sentAt: new Date(base).toISOString() },
    { id: 'm2', conversationId, sender: 'host',  senderName: 'Stay Hospitality', body: 'Hi there! Standard check-in is 4 PM. We can try for 3 PM if the unit is ready.', sentAt: new Date(base + 600_000).toISOString() },
    { id: 'm3', conversationId, sender: 'guest', senderName: guestName, body: 'Perfect. Also, we have a small dog — is that OK?', sentAt: new Date(base + 1200_000).toISOString() },
    { id: 'm4', conversationId, sender: 'host',  senderName: 'Stay Hospitality', body: 'Pet fee is $75. I can add it to the reservation if that works.', sentAt: new Date(base + 1700_000).toISOString() },
    { id: 'm5', conversationId, sender: 'guest', senderName: guestName, body: 'Sounds good, please add it. See you soon!', sentAt: new Date(base + 2200_000).toISOString() }
  ]
}
