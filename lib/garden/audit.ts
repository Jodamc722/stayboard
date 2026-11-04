// CLOUDBEDS AUDIT (Jon, 2026-11-04: "audit the connection and start to understand how data imports,
// how we can understand rev, distributions, messages"). One live probe of every Cloudbeds read the
// hotel's pages could use: does the key reach it, how much is there, what the rows look like (field
// names only — no guest data is stored), and what Lighthouse already mirrors from it. Run from
// Garden → Users & admin → Cloudbeds & feeds; the last result is kept in app_settings so the page
// can show it without asking Cloudbeds again.
import 'server-only'
import { cbGetV, cloudbedsConfig } from './cloudbeds'
import { supabaseAdmin } from '../supabase-admin'
import { getSetting, setSetting } from '../app-settings'

export type Probe = {
  key: string; label: string; area: 'property' | 'reservations' | 'guests' | 'revenue' | 'distribution' | 'operations' | 'messages' | 'realtime'
  endpoint: string; ok: boolean; count: number | null; total: number | null; fields: string[]; error: string | null; ms: number
  mirrored: string | null   // the Lighthouse table it lands in, or null when nothing uses it yet
  note: string
}
export type Audit = { at: string; connected: boolean; mode: string; propertyId: string | null; probes: Probe[]; mirror: Record<string, number | null>; findings: string[] }

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const day = 86400000

type Def = { key: string; label: string; area: Probe['area']; v?: string; endpoint: string; params?: Record<string, any>; mirrored?: string | null; note: string }
function defs(): Def[] {
  const today = ymd(new Date()), past = ymd(new Date(Date.now() - 365 * day)), ahead = ymd(new Date(Date.now() + 365 * day))
  return [
    { key: 'hotel', label: 'Hotel details', area: 'property', endpoint: 'getHotelDetails', note: 'Proves the key; name, address, currency.' },
    { key: 'roomTypes', label: 'Room types', area: 'property', endpoint: 'getRoomTypes', mirrored: 'garden_calendar (by type)', note: 'Inventory by type — the unit for rates and availability.' },
    { key: 'rooms', label: 'Rooms', area: 'property', endpoint: 'getRooms', mirrored: 'garden_rooms', note: 'Every physical room.' },
    { key: 'resAll', label: 'Reservations — all time', area: 'reservations', endpoint: 'getReservations', params: { pageSize: 5 }, mirrored: 'garden_reservations', note: 'How many bookings the property has, ever.' },
    { key: 'resYear', label: 'Reservations — check-in past 12 mo → next 12 mo', area: 'reservations', endpoint: 'getReservations', params: { checkInFrom: past, checkInTo: ahead, pageSize: 5 }, mirrored: 'garden_reservations (14 d back → 60 d ahead today)', note: 'The window revenue history and pace can be built from.' },
    { key: 'resRates', label: 'Reservations with nightly rates', area: 'revenue', endpoint: 'getReservationsWithRateDetails', params: { reservationCheckOutFrom: past, reservationCheckOutTo: ahead, pageSize: 5 }, mirrored: null, note: 'Room revenue per night per booking — the basis of ADR and revenue by date.' },
    { key: 'guests', label: 'Guests', area: 'guests', endpoint: 'getGuestList', params: { pageSize: 5 }, mirrored: null, note: 'Guest profiles: email, phone, country, stays — repeat guests and contact for the inbox.' },
    { key: 'sources', label: 'Sources (channels)', area: 'distribution', endpoint: 'getSources', mirrored: 'garden_channels', note: 'Every booking channel: OTAs, direct, walk-in, website.' },
    { key: 'ratePlans', label: 'Rate plans & availability (30 days)', area: 'distribution', endpoint: 'getRatePlans', params: { startDate: today, endDate: ymd(new Date(Date.now() + 30 * day)), detailedRates: true }, mirrored: 'garden_calendar', note: 'Rates, availability and restrictions by type and date.' },
    { key: 'dashboard', label: 'Dashboard (today)', area: 'revenue', endpoint: 'getDashboard', mirrored: null, note: 'Cloudbeds’ own today numbers: occupancy, arrivals, departures, in-house.' },
    { key: 'transactions', label: 'Transactions (90 days)', area: 'revenue', endpoint: 'getTransactions', params: { resultsFrom: ymd(new Date(Date.now() - 90 * day)), resultsTo: today, pageSize: 5 }, mirrored: 'garden_payments', note: 'Payments, refunds and charges — the money actually collected.' },
    { key: 'payments', label: 'Payment methods', area: 'revenue', endpoint: 'getPaymentMethods', mirrored: null, note: 'Which payment types the property takes.' },
    { key: 'taxes', label: 'Taxes & fees', area: 'revenue', endpoint: 'getTaxesAndFees', mirrored: null, note: 'Separates room revenue from tax and fees.' },
    { key: 'housekeeping', label: 'Housekeeping status', area: 'operations', endpoint: 'getHousekeepingStatus', mirrored: 'garden_rooms.hk_status', note: 'Room condition — drives cleans.' },
    { key: 'housekeepers', label: 'Housekeepers', area: 'operations', endpoint: 'getHousekeepers', mirrored: null, note: 'The staff Cloudbeds assigns rooms to.' },
    { key: 'items', label: 'Items / add-ons', area: 'revenue', endpoint: 'getItems', mirrored: null, note: 'Extras sold: parking, early check-in, pets.' },
    { key: 'allotments', label: 'Allotment blocks', area: 'distribution', endpoint: 'getAllotmentBlocks', mirrored: null, note: 'Group and contract blocks.' },
    { key: 'webhooks', label: 'Webhook subscriptions', area: 'realtime', v: 'v1.3', endpoint: 'getWebhooks', mirrored: null, note: 'What Cloudbeds pushes to Lighthouse the moment it happens.' },
    { key: 'messages', label: 'Guest messaging', area: 'messages', endpoint: 'getMessages', mirrored: 'garden_threads', note: 'Cloudbeds documents no messaging endpoint; this confirms it for this key.' },
  ]
}

const fieldsOf = (data: any): string[] => {
  let x = data
  if (Array.isArray(x)) x = x[0]
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    // Many Cloudbeds payloads wrap rows one level down (rooms, roomTypes, rates…)
    const inner = Object.values(x).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object') as any[] | undefined
    const keys = Object.keys(x)
    return (inner ? [...keys, ...Object.keys(inner[0]).map(k => '› ' + k)] : keys).slice(0, 40)
  }
  return []
}
const countOf = (data: any): number | null => Array.isArray(data) ? data.length : data && typeof data === 'object' ? 1 : null

export async function runAudit(): Promise<Audit> {
  const cfg = cloudbedsConfig()
  const out: Audit = { at: new Date().toISOString(), connected: cfg.mode !== 'none', mode: cfg.mode, propertyId: cfg.propertyId, probes: [], mirror: {}, findings: [] }
  if (!out.connected) { out.findings.push('Cloudbeds is not connected — no API key found in Vercel.'); return out }
  const all = defs()
  // Six at a time — fast without tripping Cloudbeds' rate limit.
  for (let i = 0; i < all.length; i += 6) {
    out.probes.push(...await Promise.all(all.slice(i, i + 6).map(async (d): Promise<Probe> => {
      const t = Date.now()
      try {
        const r = await cbGetV<any>(d.v || 'v1.2', d.endpoint, d.params || {})
        return { key: d.key, label: d.label, area: d.area, endpoint: d.endpoint, ok: true, count: countOf(r.data), total: r.total ?? r.count ?? null, fields: fieldsOf(r.data), error: null, ms: Date.now() - t, mirrored: d.mirrored ?? null, note: d.note }
      } catch (e: any) {
        return { key: d.key, label: d.label, area: d.area, endpoint: d.endpoint, ok: false, count: null, total: null, fields: [], error: String(e?.message || e).replace(/^Cloudbeds \w+: /, '').slice(0, 200), ms: Date.now() - t, mirrored: d.mirrored ?? null, note: d.note }
      }
    })))
  }
  // What is already mirrored.
  const db = supabaseAdmin()
  for (const t of ['garden_rooms', 'garden_reservations', 'garden_calendar', 'garden_channels', 'garden_payments', 'garden_threads', 'garden_reviews', 'garden_phone_calls']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true })
    out.mirror[t] = count ?? null
  }
  // Plain-language findings.
  const P = Object.fromEntries(out.probes.map(p => [p.key, p]))
  const denied = out.probes.filter(p => !p.ok && /denied|scope|permission|unauthori|forbidden/i.test(p.error || ''))
  if (denied.length) out.findings.push(`The key is not allowed to read: ${denied.map(p => p.label).join(', ')}. Add those scopes to the API key in Cloudbeds → API Credentials.`)
  if (P.resAll?.ok) out.findings.push(P.resAll.total ? `${P.resAll.total} reservations in Cloudbeds.` : 'No reservations in Cloudbeds yet — revenue, pace and the guest inbox fill in as bookings arrive.')
  if (P.housekeeping?.ok && !P.housekeeping.count) out.findings.push('Housekeeping returns no rooms — room condition will stay blank until Cloudbeds tracks it.')
  if (P.messages && !P.messages.ok) out.findings.push('Cloudbeds has no guest-messaging API — the inbox merges email, phone, reviews and reservation notes instead.')
  if (P.webhooks?.ok && !P.webhooks.count) out.findings.push('No webhooks subscribed — Lighthouse polls every 20 minutes. Subscribing makes bookings, cancellations and payments arrive instantly.')
  if (P.resRates?.ok) out.findings.push('Nightly rate detail is readable — revenue by stay date and ADR can be computed exactly.')
  if (P.guests?.ok) out.findings.push('Guest profiles are readable — the inbox can match emails and phone numbers to bookings.')
  await setSetting('garden_cloudbeds_audit', out, 'audit').catch(() => {})
  return out
}
export const lastAudit = () => getSetting<Audit | null>('garden_cloudbeds_audit', null).catch(() => null)
