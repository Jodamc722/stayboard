// GUESTY BOOKING ENGINE API — the direct-booking side of Guesty (Jon, 2026-10-13: "a webpage where
// people can book direct with us … optimized for speed, ease, and verification of ID and selfie, and
// have it book" · payments through Guesty).
//
// This is NOT the Open API Lighthouse already uses (lib/guesty.ts). The Booking Engine API is its own
// Guesty product with its own credentials (Guesty → Integrations → Booking Engine API → create an
// instance; copy the client id + secret into Vercel as GUESTY_BE_CLIENT_ID / GUESTY_BE_CLIENT_SECRET).
// Money goes through the listing's own payment provider (GuestyPay), exactly like Guesty's own
// booking site — Lighthouse never sees a card number: the card form is Guesty's iframe
// (pay.guesty.com tokenization SDK) and only a payment-method id reaches this server.
//
// Docs: https://booking-api-docs.guesty.com — endpoints used:
//   POST /oauth2/token                                   client_credentials, scope booking_engine:api
//   GET  /api/listings?checkIn&checkOut&minOccupancy…    search (allotment + nightlyRates with dates)
//   GET  /api/listings/{id}                              one listing
//   GET  /api/listings/{id}/calendar?from&to             availability
//   POST /api/reservations/quotes                        the price, with rate plans
//   GET  /api/listings/{id}/payment-provider             which GuestyPay account takes the money
//   POST /api/reservations/quotes/{quoteId}/instant-charge   book + charge (initialPaymentMethodId)
//   POST /api/reservations/{id}/verify-payment           finish a 3DS (PENDING_AUTH) payment
//
// THE TOKEN IS PRECIOUS: Guesty allows only a few token requests a day per instance. One token is
// kept in app_settings (shared by every server instance) and reused until an hour before it lapses.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const BASE = 'https://booking.guesty.com'
const TOKEN_KEY = 'guesty_be_token'

export function beConfigured(): boolean {
  return !!(process.env.GUESTY_BE_CLIENT_ID && process.env.GUESTY_BE_CLIENT_SECRET)
}

let mem: { token: string; exp: number } | null = null

async function readStored(): Promise<{ token: string; exp: number } | null> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', TOKEN_KEY).maybeSingle()
    const raw = (data as any)?.value
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && v.token && v.exp ? { token: String(v.token), exp: Number(v.exp) } : null
  } catch { return null }
}

async function token(force = false): Promise<string> {
  const now = Date.now()
  if (!force && mem && mem.exp - 3600_000 > now) return mem.token
  if (!force) { const s = await readStored(); if (s && s.exp - 3600_000 > now) { mem = s; return s.token } }
  if (!beConfigured()) throw new Error('Direct booking is not connected yet (Guesty Booking Engine API keys are missing).')
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'booking_engine:api', client_id: String(process.env.GUESTY_BE_CLIENT_ID), client_secret: String(process.env.GUESTY_BE_CLIENT_SECRET) })
  const r = await fetch(BASE + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error('Guesty Booking Engine sign-in failed' + (j?.error_description ? ': ' + j.error_description : ` (${r.status})`))
  mem = { token: String(j.access_token), exp: now + (Number(j.expires_in) || 86400) * 1000 }
  try { await supabaseAdmin().from('app_settings').upsert({ key: TOKEN_KEY, value: JSON.stringify(mem), updated_by: 'guesty-be', updated_at: new Date().toISOString() }, { onConflict: 'key' }) } catch { /* memory still has it */ }
  return mem.token
}

export class BeError extends Error { status: number; code: string; constructor(msg: string, status: number, code = '') { super(msg); this.status = status; this.code = code } }

async function be<T = any>(path: string, init: { method?: string; body?: any; query?: Record<string, any> } = {}, retried = false): Promise<T> {
  const qs = init.query ? '?' + new URLSearchParams(Object.entries(init.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
  const t = await token()
  const r = await fetch(BASE + path + qs, {
    method: init.method || 'GET',
    headers: { authorization: 'Bearer ' + t, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  if (r.status === 401 && !retried) { await token(true); return be<T>(path, init, true) }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || `Guesty answered ${r.status}`
    throw new BeError(String(msg).slice(0, 300), r.status, String(j?.error?.code || ''))
  }
  return j as T
}

// ── the reads ────────────────────────────────────────────────────────────────────────────────────

export type BeListing = {
  _id: string; title: string; propertyType?: string; accommodates?: number; bedrooms?: number; bathrooms?: number; beds?: number
  address?: { city?: string; state?: string; neighborhood?: string; full?: string; lat?: number; lng?: number }
  picture?: { large?: string; regular?: string; thumbnail?: string }
  pictures?: { original?: string; large?: string; regular?: string; thumbnail?: string; caption?: string }[]
  prices?: { basePrice?: number; currency?: string; cleaningFee?: number }
  reviews?: { avg?: number; total?: number }
  amenities?: string[]; publicDescription?: any; nightlyRates?: Record<string, number>; allotment?: number
}

const LIST_FIELDS = '_id title propertyType accommodates bedrooms bathrooms beds address picture pictures prices reviews amenities'

export async function searchListings(q: { checkIn?: string; checkOut?: string; guests?: number; city?: string; cursor?: string; limit?: number }): Promise<{ results: BeListing[]; next: string | null; total: number }> {
  const j: any = await be('/api/listings', { query: { checkIn: q.checkIn, checkOut: q.checkOut, minOccupancy: q.guests && q.guests > 1 ? q.guests : undefined, city: q.city, cursor: q.cursor, limit: Math.min(Math.max(q.limit || 40, 1), 100), fields: LIST_FIELDS } })
  return { results: Array.isArray(j?.results) ? j.results : [], next: j?.pagination?.cursor?.next || null, total: Number(j?.pagination?.total) || 0 }
}

export async function getListing(id: string): Promise<BeListing & Record<string, any>> {
  return be(`/api/listings/${encodeURIComponent(id)}`)
}

export async function getCalendar(id: string, from: string, to: string): Promise<{ date: string; status: string; minNights?: number; cta?: boolean; ctd?: boolean }[]> {
  const j: any = await be(`/api/listings/${encodeURIComponent(id)}/calendar`, { query: { from, to } })
  return Array.isArray(j) ? j : Array.isArray(j?.days) ? j.days : []
}

export type BeRatePlan = { id: string; name: string; currency: string; total: number; accommodation: number; cleaning: number; fees: number; taxes: number; items: { title: string; amount: number }[]; cancellation: string[] }
export type BeQuote = { quoteId: string; expiresAt: string | null; ratePlans: BeRatePlan[] }

export async function createQuote(q: { listingId: string; checkIn: string; checkOut: string; guests: number; coupon?: string }): Promise<BeQuote> {
  const j: any = await be('/api/reservations/quotes', { method: 'POST', body: { listingId: q.listingId, checkInDateLocalized: q.checkIn, checkOutDateLocalized: q.checkOut, guestsCount: Math.max(1, q.guests || 1), ...(q.coupon ? { coupons: q.coupon } : {}) } })
  const plans: any[] = Array.isArray(j?.rates?.ratePlans) ? j.rates.ratePlans : []
  return {
    quoteId: String(j?._id || ''), expiresAt: j?.expiresAt || null,
    ratePlans: plans.map((p: any) => {
      const rp = p?.ratePlan || {}, m = rp.money || {}
      return {
        id: String(rp._id || ''), name: String(rp.name || 'Standard rate'), currency: String(m.currency || 'USD'),
        // What the guest pays: the sub-total plus taxes. hostPayout is what we keep, not the price.
        total: Number(m.subTotalPrice || 0) + Number(m.totalTaxes || 0),
        accommodation: Number(m.fareAccommodationAdjusted ?? m.fareAccommodation ?? 0), cleaning: Number(m.fareCleaning || 0), fees: Number(m.totalFees || 0), taxes: Number(m.totalTaxes || 0),
        items: (Array.isArray(m.invoiceItems) ? m.invoiceItems : []).map((x: any) => ({ title: String(x?.title || ''), amount: Number(x?.amount || 0) })).filter((x: any) => x.title && x.amount),
        cancellation: Array.isArray(rp.cancellationPolicy) ? rp.cancellationPolicy.map(String) : [],
      }
    }).filter(p => p.id),
  }
}

export async function paymentProvider(listingId: string): Promise<{ id: string; type: string } | null> {
  try { const j: any = await be(`/api/listings/${encodeURIComponent(listingId)}/payment-provider`); return j?._id ? { id: String(j._id), type: String(j.providerType || '') } : null } catch { return null }
}

// ── the booking ──────────────────────────────────────────────────────────────────────────────────

export type BeGuest = { firstName: string; lastName: string; email: string; phone?: string }
export type BeBooked = { reservationId: string; confirmationCode: string; status: string; paymentId: string | null; paymentStatus: string; threeDSChallenge: any | null; checkIn: string | null; checkOut: string | null }

const toBooked = (j: any): BeBooked => ({
  reservationId: String(j?.reservation?._id || ''), confirmationCode: String(j?.reservation?.confirmationCode || ''), status: String(j?.reservation?.status || ''),
  paymentId: j?.payment?._id ? String(j.payment._id) : null, paymentStatus: String(j?.payment?.status || ''), threeDSChallenge: j?.threeDSChallenge || null,
  checkIn: j?.reservation?.checkInDateLocalized || null, checkOut: j?.reservation?.checkOutDateLocalized || null,
})

/** Book and charge in one step. A failed charge creates no reservation (Guesty's rule). */
export async function instantCharge(q: { quoteId: string; ratePlanId: string; paymentMethodId: string; guest: BeGuest; notes?: string }): Promise<BeBooked> {
  const now = new Date().toISOString()
  const j: any = await be(`/api/reservations/quotes/${encodeURIComponent(q.quoteId)}/instant-charge`, {
    method: 'POST',
    body: {
      ratePlanId: q.ratePlanId, initialPaymentMethodId: q.paymentMethodId, guest: q.guest,
      policy: { privacy: { version: 1, dateOfAcceptance: now, isAccepted: true }, termsAndConditions: { dateOfAcceptance: now, isAccepted: true }, marketing: { isAccepted: false } },
      ...(q.notes ? { notes: { other: q.notes.slice(0, 900) } } : {}),
    },
  })
  return toBooked(j)
}

/** The second half of a 3DS payment (status PENDING_AUTH after instant-charge). */
export async function verifyPayment(reservationId: string, paymentId: string, threeDSResult?: any): Promise<BeBooked> {
  const j: any = await be(`/api/reservations/${encodeURIComponent(reservationId)}/verify-payment`, { method: 'POST', body: { paymentId, ...(threeDSResult ? { threeDSResult } : {}) } })
  return toBooked(j)
}
