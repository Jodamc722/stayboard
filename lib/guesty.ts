import { Reservation, Listing } from '@/types/guesty'

const MOCK = process.env.NEXT_PUBLIC_GUESTY_MOCK_MODE === 'true'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const CID  = process.env.GUESTY_CLIENT_ID
const CSEC = process.env.GUESTY_CLIENT_SECRET

let cachedToken: { token: string; expiresAt: number } | null = null

async function token(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token
  if (!CID || !CSEC) throw new Error('Guesty credentials not set')
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'open-api', client_id: CID, client_secret: CSEC })
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

export async function listReservations(limit = 30): Promise<Reservation[]> {
  if (MOCK) return mockReservations(limit)
  const data = await api<{ results: any[] }>(`/reservations?limit=${limit}`)
  return data.results.map(toReservation)
}
export async function listListings(): Promise<Listing[]> {
  if (MOCK) return mockListings()
  const data = await api<{ results: any[] }>('/listings?limit=200')
  return data.results.map(toListing)
}

function toReservation(r: any): Reservation {
  return {
    id: r._id || r.id, listingId: r.listingId, listingName: r.listing?.nickname || r.listing?.title || '',
    guest: { name: r.guest?.fullName || 'Unknown', email: r.guest?.email, phone: r.guest?.phone },
    checkIn: r.checkIn, checkOut: r.checkOut, status: (r.status || 'confirmed').toLowerCase(),
    nights: r.nightsCount || 0,
    money: { totalPaid: r.money?.totalPaid || 0, balanceDue: r.money?.balanceDue || 0, currency: r.money?.currency || 'USD' },
    source: (r.source || 'direct').toLowerCase(), notes: r.note, createdAt: r.createdAt
  }
}
function toListing(l: any): Listing {
  return {
    id: l._id || l.id, title: l.title, nickname: l.nickname,
    address: { full: l.address?.full || '', city: l.address?.city || '', state: l.address?.state || '' },
    bedrooms: l.bedrooms || 0, bathrooms: l.bathrooms || 0, beds: l.beds || 0, maxOccupancy: l.accommodates || 0,
    status: l.active ? 'active' : 'inactive',
    pictures: (l.pictures || []).map((p: any) => p.original || p.regular || p),
    amenities: l.amenities || []
  }
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
    return {
      id: `R${i + 1}`, listingId: list.id, listingName: list.nickname,
      guest: { name: guests[i % guests.length], email: `${guests[i % guests.length].toLowerCase().replace(' ', '.')}@example.com` },
      checkIn: ci.toISOString(), checkOut: co.toISOString(),
      status: days < 0 ? 'checked_out' : days === 0 ? 'checked_in' : 'confirmed',
      nights: Math.round((co.getTime() - ci.getTime()) / 86400000),
      money: { totalPaid: 200 + (i * 37) % 800, balanceDue: 0, currency: 'USD' },
      source: sources[i % sources.length], createdAt: new Date(today.getTime() - i * 3600000).toISOString()
    }
  })
}
