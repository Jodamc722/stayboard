// GUESTY MONEY WRITES for guest orders — invoice items + charging the card on file.
//
// Two Open API calls, both against the reservation the guest actually booked:
//   POST /invoice-items/reservation/{id}   adds a line to the guest's folio (so the order shows
//                                          on the reservation and in the statement, with the
//                                          predefined fee code Guesty uses for tax math)
//   POST /reservations/{id}/payments       charges a saved payment method — or records an
//                                          external payment when no card is involved
//   GET  /guests/{guestId}/payment-methods the saved cards Guesty is allowed to charge
//
// WHAT WE NEVER DO: mark an order paid on anything other than a payment object Guesty handed back
// that is not FAILED. An OTA stay with no card on file (every Airbnb booking) returns an empty
// method list and the order goes to "awaiting payment" with that exact reason on the card —
// the team collects through the platform and marks it paid by hand.
import 'server-only'
import { getToken } from './guesty'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export type GuestyPaymentMethod = {
  id: string
  method: string
  last4: string | null
  brand: string | null
  status: string | null
  reuse: boolean
  raw: any
}

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const token = init.token || await getToken()
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await r.text().catch(() => '')
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { ok: r.ok, status: r.status, data, text }
}

function normMethod(m: any): GuestyPaymentMethod {
  const card = m?.card || m?.creditCard || {}
  return {
    id: String(m?._id || m?.id || ''),
    method: String(m?.method || m?.type || 'CREDIT_CARD'),
    last4: String(m?.last4 || card?.last4 || m?.cardLast4 || '') || null,
    brand: String(m?.brand || card?.brand || m?.cardBrand || '') || null,
    status: m?.status ? String(m.status) : null,
    reuse: m?.reuse !== false,
    raw: m,
  }
}

/** Saved payment methods for a guest, preferring ones linked to this reservation. */
export async function listPaymentMethods(guestId: string, reservationId?: string | null): Promise<{ ok: boolean; methods: GuestyPaymentMethod[]; error?: string }> {
  if (!guestId) return { ok: false, methods: [], error: 'reservation has no guest id' }
  const qs = new URLSearchParams()
  if (reservationId) qs.set('reservationId', reservationId)
  const r = await call('/guests/' + encodeURIComponent(guestId) + '/payment-methods' + (qs.toString() ? '?' + qs.toString() : ''))
  if (!r.ok) return { ok: false, methods: [], error: 'Guesty ' + r.status + ': ' + r.text.slice(0, 160) }
  const arr = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data?.paymentMethods) ? r.data.paymentMethods : []
  const methods = arr.map(normMethod).filter((m: GuestyPaymentMethod) => m.id)
  return { ok: true, methods }
}

/** Pick the card we are allowed to charge: valid/active first, then anything not failed. */
export function pickChargeable(methods: GuestyPaymentMethod[]): GuestyPaymentMethod | null {
  const bad = /fail|invalid|expired|removed|deleted|declin/i
  const good = methods.filter(m => !bad.test(String(m.status || '')))
  const preferred = good.find(m => /valid|active|succe|ok/i.test(String(m.status || ''))) || good[0] || null
  return preferred
}

export type InvoiceLine = { title: string; description?: string; amount: number; feeCode: string }

/**
 * One folio line per order item, in order, stopping at the first failure. `created` counts the
 * lines Guesty ACCEPTED (2xx) even when the response carried no id we could read — the caller
 * uses it as the resume point, so a retry never re-posts a line that already landed.
 */
export async function createInvoiceItems(reservationId: string, lines: InvoiceLine[]): Promise<{ ok: boolean; ids: string[]; created: number; error?: string }> {
  const token = await getToken()
  const ids: string[] = []
  let created = 0
  for (const line of lines) {
    const body = {
      normalType: 'AFE',
      title: line.title.slice(0, 120),
      description: (line.description || line.title).slice(0, 500),
      amount: Math.round(Number(line.amount) * 100) / 100,
      secondIdentifier: line.feeCode || 'GUEST_SERVICE',
    }
    const r = await call('/invoice-items/reservation/' + encodeURIComponent(reservationId), { method: 'POST', body: JSON.stringify(body), token })
    if (!r.ok) return { ok: false, ids, created, error: 'invoice item "' + line.title + '" — Guesty ' + r.status + ': ' + r.text.slice(0, 200) }
    created++
    const id = String(r.data?._id || r.data?.id || r.data?.invoiceItem?._id || r.data?.invoiceItemId || '')
    if (id) ids.push(id)
  }
  return { ok: true, ids, created }
}

/** Remove a folio line we created (declined / cancelled order). Best-effort: the caller flags leftovers. */
export async function deleteInvoiceItem(reservationId: string, invoiceItemId: string): Promise<{ ok: boolean; error?: string }> {
  if (!invoiceItemId) return { ok: false, error: 'no id' }
  const r = await call('/invoice-items/reservation/' + encodeURIComponent(reservationId) + '/' + encodeURIComponent(invoiceItemId), { method: 'DELETE' })
  if (r.ok || r.status === 404) return { ok: true }
  return { ok: false, error: 'Guesty ' + r.status + ': ' + r.text.slice(0, 160) }
}

export type ChargeResult = {
  ok: boolean
  paymentId?: string
  status?: string
  error?: string
  raw?: any
}

/** Charge a saved card. Only a returned payment that is not FAILED counts as money in. */
export async function chargeSavedCard(reservationId: string, paymentMethodId: string, amount: number, note: string): Promise<ChargeResult> {
  const body = {
    paymentMethod: { method: 'CREDIT_CARD', _id: paymentMethodId },
    amount: Math.round(Number(amount) * 100) / 100,
    note: note.slice(0, 500),
  }
  const r = await call('/reservations/' + encodeURIComponent(reservationId) + '/payments', { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) return { ok: false, error: 'Guesty ' + r.status + ': ' + r.text.slice(0, 240), raw: r.data || r.text.slice(0, 500) }
  const p = r.data?.payment || r.data || {}
  const status = String(p?.status || '').toUpperCase()
  const paymentId = String(p?._id || p?.id || p?.paymentId || '')
  if (/FAIL|DECLIN|CANCEL|ERROR/.test(status)) {
    return { ok: false, paymentId: paymentId || undefined, status, error: 'Guesty reported the charge as ' + status + (p?.failureReason ? ' — ' + String(p.failureReason).slice(0, 160) : ''), raw: r.data }
  }
  return { ok: true, paymentId: paymentId || undefined, status: status || 'UNKNOWN', raw: r.data }
}

/** Record money that came in outside Guesty (Airbnb resolution, cash, Zelle…). */
export async function recordExternalPayment(reservationId: string, amount: number, note: string, method = 'OTHER'): Promise<ChargeResult> {
  const body = {
    paymentMethod: { method },
    amount: Math.round(Number(amount) * 100) / 100,
    paidAt: new Date().toISOString(),
    note: note.slice(0, 500),
  }
  const r = await call('/reservations/' + encodeURIComponent(reservationId) + '/payments', { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) return { ok: false, error: 'Guesty ' + r.status + ': ' + r.text.slice(0, 240), raw: r.data || r.text.slice(0, 500) }
  const p = r.data?.payment || r.data || {}
  return { ok: true, paymentId: String(p?._id || p?.id || '') || undefined, status: String(p?.status || 'RECORDED'), raw: r.data }
}
