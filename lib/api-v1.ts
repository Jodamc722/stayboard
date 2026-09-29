// /api/v1 — THE READ API (Jon, 2026-09-25: "a read API key only, for user, on app").
//
// One gate for every v1 handler: a personal key (lib/api-keys.ts) OR a signed-in session, then
// the same per-feature level the sidebar uses. Every handler here is a GET that returns JSON and
// never writes; a key cannot reach anything else because nothing else looks for one.
import 'server-only'
import { NextResponse } from 'next/server'
import { getAccess, canSeeMoney, type Access } from './access'
import { isVrLogin, hotelOnlyRes } from './vr-gate'
import { atLeast } from './features'
import { keyFromRequest, accessForApiKey } from './api-keys'

// `canMoney`: may this caller read dollar amounts (lib/access canSeeMoney — the owner, or someone Jon
// switched on at /users → Dollar amounts). Every handler drops money fields when it is false.
export type V1Gate = { ok: true; access: Access; viaKey: boolean; canMoney: boolean } | { ok: false; res: NextResponse }

export async function v1Gate(req: Request, feature: string): Promise<V1Gate> {
  let access: Access | null = null, viaKey = false
  const key = keyFromRequest(req)
  if (key) {
    const r = await accessForApiKey(key)
    if (!r) return { ok: false, res: NextResponse.json({ error: 'invalid or revoked API key' }, { status: 401 }) }
    access = r.access; viaKey = true
  } else {
    const a = await getAccess()
    if (!a.user) return { ok: false, res: NextResponse.json({ error: 'unauthorized', hint: 'send Authorization: Bearer lh_… or sign in' }, { status: 401 }) }
    if (!a.allowed) return { ok: false, res: NextResponse.json({ error: 'no-access' }, { status: 403 }) }
    access = a
  }
  // Every v1 feed is the vacation-rental side's. A hotel-only login's KEY would skip the level check
  // below ("reads everything"), so its business decides here (lib/vr-gate); 'me' stays answerable.
  if (feature !== 'me' && !isVrLogin(access)) return { ok: false, res: hotelOnlyRes() }
  // An approved key reads everything (Jon, 2026-09-25: "they can read whatever they want"); a
  // browser session still answers by its own role.
  if (!viaKey && feature !== 'me' && !atLeast(access.levels[feature], 'view')) {
    return { ok: false, res: NextResponse.json({ error: 'forbidden', message: `This key's owner has no access to ${feature}.` }, { status: 403 }) }
  }
  // DOLLARS FOLLOW THE PERSON (2026-09-28 audit, B-12). "An approved key reads everything" is about
  // features; it never reads more money than its owner could see in the app.
  return { ok: true, access, viaKey, canMoney: canSeeMoney(access) }
}

export const V1_ENDPOINTS: { path: string; feature: string; what: string; params?: string }[] = [
  { path: '/api/v1/me', feature: 'me', what: 'Who this key acts as, and the features it can read.' },
  { path: '/api/v1/listings', feature: 'listings', what: 'Active listings: id, name, building, city, bedrooms, status.' },
  { path: '/api/v1/reservations', feature: 'reservations', what: 'Reservations by check-in date. Total / paid / balance only when the key’s owner has dollar access.', params: 'from=YYYY-MM-DD&to=YYYY-MM-DD (default: today → +14d), building=' },
  { path: '/api/v1/arrivals', feature: 'reservations', what: 'Arrivals on one day.', params: 'date=YYYY-MM-DD (default today)' },
  { path: '/api/v1/departures', feature: 'reservations', what: 'Departures on one day.', params: 'date=YYYY-MM-DD (default today)' },
  { path: '/api/v1/glitches', feature: 'glitches', what: 'Guest issues.', params: 'status=open|closed|all (default open), since=YYYY-MM-DD' },
  { path: '/api/v1/tasks', feature: 'schedule', what: 'Breezeway tasks on one day.', params: 'date=YYYY-MM-DD (default today)' },
  { path: '/api/v1/calls', feature: 'welcome-calls', what: 'The calls desk for one day: welcome and follow-up calls with status.', params: 'date=YYYY-MM-DD (default today)' },
  { path: '/api/v1/reviews', feature: 'reviews', what: 'Guest reviews.', params: 'since=YYYY-MM-DD (default 30d), min=, max= (stars)' },
  { path: '/api/v1/projects', feature: 'projects', what: 'Project boards the key owner can see, with open task counts.' },
]

export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
export const ymd = (v: any, d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : d)
export const shift = (ymdStr: string, n: number) => { const d = new Date(ymdStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const json = (data: any, extra: Record<string, any> = {}) => NextResponse.json({ ok: true, ...extra, data }, { headers: { 'Cache-Control': 'private, no-store' } })

// One reservation, the way every v1 handler returns it. A factory rather than a plain mapper so it
// can never be handed to .map() without the money decision (.map would pass the index as arg 2).
// Without `canMoney` the dollar fields are absent, not zero.
import { buildingOf } from './segments'
export const RES_SEL = 'id,listing_id,listing_name,guest_name,check_in,check_out,nights,status,source,confirmation_code,money_total,money_paid,money_balance,money_currency'
export const reservationShaper = (canMoney: boolean) => (r: any) => {
  const out: Record<string, any> = { id: r.id, listingId: r.listing_id, listing: r.listing_name, building: buildingOf(null, r.listing_name), guest: r.guest_name, checkIn: r.check_in, checkOut: r.check_out, nights: r.nights, status: r.status, source: r.source, confirmation: r.confirmation_code }
  if (canMoney) { out.total = r.money_total; out.paid = r.money_paid; out.balance = r.money_balance; out.currency = r.money_currency }
  return out
}
