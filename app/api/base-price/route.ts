// BASE PRICE: what each unit's Guesty base price says against what its nights actually sell for.
//
// Jon, 2026-11-18, after the Yieldhouse deck ("Your site shows $500 for a $285 night"): the base
// price is a fallback under the PriceLabs calendar, but the booking site prints it, and across the
// portfolio it is a placeholder ($1,000 at Botanica, Capri and Park Towers against nights that sell
// near $80). The rule he first agreed was the median booked night; on 2026-11-18 he set it as the
// YEARLY AVERAGE ("base rate should reflect yearly averages"): what the unit took for its nights over
// the last 12 months, divided by the nights sold.
//
// PRICELABS DRIVES THE RATE, NOT THIS (Jon, same day: "the base rate does not drive rate, pricelabs
// does"). The base is the figure the booking site prints and the fallback for a day PriceLabs has not
// priced. Changing it does not move any night PriceLabs has priced.
//
// WHO MAY WRITE: Jon and Bernadette only (Jon, same day: "only Bernadette and I"), whatever a role allows.
//
//   GET  ?building=<name> | ?ids=a,b,c [&calendar=1]   the report: now, booked, proposed. Nothing is written.
//   GET  ?all=1                                         every active listing (the Admin desk's Base rates tab)
//   POST { changes: [{ id, basePrice, weekendBasePrice? }] }   writes ONLY those two price fields.
//
// WHY THE CALENDAR CHECK. A day PriceLabs has not priced falls back to the base price. A $1,000 base
// is, among other things, a guard: far-out dates nobody has priced cannot be booked cheap. Lowering
// it removes that guard, so the report can read each unit's calendar and count the bookable days
// that are sitting AT the base price today. Those are the days the new base would re-price.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAnyLevel } from '@/lib/access'
import { guestyFetch } from '@/lib/guesty-retry'

/** The proposed base: the yearly average night, plus this. */
const BASE_OVER_AVERAGE = 1.15
/** The only people who may write a base price to Guesty. */
const PUSHERS = ['jon@stay-hospitality.com', 'jodamc722@gmail.com', 'bernadette@stay-hospitality.com']
const mayPush = (email?: string | null) => PUSHERS.indexOf(String(email || '').trim().toLowerCase()) >= 0
/** The average night: everything taken for the nights, over the nights sold. Null with no nights. */
function averageNight(stays: { rate: number; nights: number }[]): number | null {
  let fare = 0, nights = 0
  for (const s of stays) { fare += s.rate * s.nights; nights += s.nights }
  return nights > 0 ? fare / nights : null
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const num = (v: any): number | null => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null }
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function token(sb: any): Promise<string | null> {
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  return valid ? tok.access_token : null
}

type Stay = { listing: string; rate: number; nights: number; weekend: 'all' | 'none' | 'mixed' }

/** Is every night of the stay a Friday or Saturday night, none of them, or a mix? */
function weekendShape(checkIn: string, nights: number): Stay['weekend'] {
  let we = 0
  const start = new Date(checkIn.slice(0, 10) + 'T12:00:00Z')
  for (let i = 0; i < nights; i++) { const d = new Date(start.getTime() + i * 86400000).getUTCDay(); if (d === 5 || d === 6) we++ }
  return we === nights ? 'all' : we === 0 ? 'none' : 'mixed'
}

export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['optimize', 'buildings', 'revenue', 'admin-desk'], 'view')
  if (!gate.ok) return gate.res
  // THE FULL LIST (Jon, 2026-11-18: "the base rates should show on admin page, by listing. Full list")
  const all = req.nextUrl.searchParams.get('all') === '1'
  const building = (req.nextUrl.searchParams.get('building') || '').trim()
  const withCalendar = req.nextUrl.searchParams.get('calendar') === '1' && req.nextUrl.searchParams.get('all') !== '1'   // a calendar read per unit is too slow for the whole portfolio
  const sb = supabaseAdmin()
  let q = sb.from('guesty_listings').select('id,nickname,title,building,bedrooms,prices:raw->prices,active:raw->>active').limit(1000)
  // The property page rolls several raw building names into one, so it sends the unit ids.
  const idList = (req.nextUrl.searchParams.get('ids') || '').split(',').map(x => x.trim()).filter(x => /^[a-f0-9]{24}$/i.test(x)).slice(0, 150)
  if (all) { /* every listing */ }
  else if (idList.length) q = q.in('id', idList)
  else if (building) q = q.eq('building', building)
  else return NextResponse.json({ ok: false, error: 'building or ids is required.' }, { status: 400 })
  const { data: ls, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false')
  if (!listings.length) return NextResponse.json({ ok: true, building, units: [], summary: null })

  // Booked nightly rates, last 12 months of stays.
  const since = ymd(new Date(Date.now() - 365 * 86400000))
  const ids = listings.map(l => String(l.id))
  const stays: Stay[] = []
  for (let i = 0; i < ids.length; i += 100) {
    for (let page = 0; page < 20; page++) {
      const { data } = await sb.from('guesty_reservations')
        .select('listing_id,check_in,nights,fare:raw->money->>fareAccommodation,status')
        .in('listing_id', ids.slice(i, i + 100)).in('status', ['confirmed', 'checked_in', 'checked_out'])
        .gte('check_in', since).gt('nights', 0).order('id').range(page * 1000, page * 1000 + 999)
      for (const r of (data || []) as any[]) {
        const fare = num(r.fare), n = num(r.nights)
        if (!fare || !n || fare <= 0) continue
        stays.push({ listing: String(r.listing_id), rate: fare / n, nights: n, weekend: weekendShape(String(r.check_in), n) })
      }
      if (!data || data.length < 1000) break
    }
  }
  const byListing = new Map<string, Stay[]>()
  for (const s of stays) { const a = byListing.get(s.listing) || []; a.push(s); byListing.set(s.listing, a) }
  // The weekend lift, from the stays that are purely one or the other. Building-wide: one unit
  // rarely has enough pure-weekend stays of its own.
  const wkEnd = averageNight(stays.filter(s => s.weekend === 'all')), wkDay = averageNight(stays.filter(s => s.weekend === 'none'))
  const lift = wkEnd && wkDay ? Math.min(2, Math.max(1, wkEnd / wkDay)) : 1.25
  // Fallback for a unit with too few nights of its own: the same bedroom count in the building.
  const byBeds = new Map<string, Stay[]>()
  const bedKey = (l: any) => String(l.building || '') + '|' + String(l.bedrooms ?? '')
  for (const l of listings) { const k = bedKey(l); const a = byBeds.get(k) || []; byBeds.set(k, a.concat(byListing.get(String(l.id)) || [])) }

  const tok = withCalendar ? await token(sb) : null
  const today = ymd(new Date()), end = ymd(new Date(Date.now() + 365 * 86400000))
  const units: any[] = []
  for (const l of listings.sort((a, b) => String(a.nickname || '').localeCompare(String(b.nickname || ''), undefined, { numeric: true }))) {
    const own = byListing.get(String(l.id)) || []
    const nights = own.reduce((s, r) => s + r.nights, 0)
    const ownMed = averageNight(own)
    const peers = byBeds.get(bedKey(l)) || []
    const peerMed = averageNight(peers)
    const basis = nights >= 20 && ownMed ? 'own' : peerMed ? 'building' : 'none'
    const med = basis === 'own' ? ownMed : basis === 'building' ? peerMed : null
    const base = num(l.prices?.basePrice), weekendBase = num(l.prices?.weekendBasePrice)
    // 15% OVER THE YEARLY AVERAGE (Jon, 2026-11-18: "make it 15% higher than what you think"): the base sits a
    // little above what the nights have sold for, so the figure the site prints and the fallback are not a discount.
    const proposed = med ? round5(med * BASE_OVER_AVERAGE) : null
    const row: any = {
      id: String(l.id), name: String(l.nickname || l.title || ''), building: String(l.building || ''), bedrooms: l.bedrooms ?? null,
      base, weekendBase, booked: med ? Math.round(med) : null, nights, basis,
      proposed, proposedWeekend: proposed ? round5(proposed * lift) : null,
    }
    if (withCalendar && tok) {
      // Bookable days in the next year whose price IS the base price: the days a new base re-prices.
      try {
        const r = await guestyFetch(`${BASE}/availability-pricing/api/calendar/listings/${encodeURIComponent(row.id)}?startDate=${today}&endDate=${end}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } })
        if (r.ok) {
          const j: any = await r.json().catch(() => ({}))
          const days: any[] = (Array.isArray(j?.data?.days) ? j.data.days : null) ?? (Array.isArray(j?.data?.days?.calendar) ? j.data.days.calendar : null) ?? (Array.isArray(j?.data?.calendar) ? j.data.calendar : null) ?? (Array.isArray(j?.data) ? j.data : null) ?? (Array.isArray(j) ? j : [])
          let atBase = 0, open = 0, first = ''
          for (const d of days) {
            const date = String(d?.date || d?.day || '').slice(0, 10)
            if (!date || String(d?.status || '').toLowerCase() !== 'available') continue
            open++
            const p = num(d?.price)
            const isWe = [5, 6].indexOf(new Date(date + 'T12:00:00Z').getUTCDay()) >= 0
            if (p != null && (p === base || (isWe && weekendBase != null && p === weekendBase))) { atBase++; if (!first || date < first) first = date }
          }
          row.calendar = { open, atBase, first: first || null }
        } else row.calendar = { error: 'Guesty ' + r.status }
      } catch (e: any) { row.calendar = { error: String(e?.message || e).slice(0, 80) } }
      await sleep(150)
    }
    units.push(row)
  }
  const withBoth = units.filter(u => u.base && u.booked)
  const summary = {
    units: units.length, weekendLift: Math.round(lift * 100) / 100,
    avgBase: withBoth.length ? Math.round(withBoth.reduce((s, u) => s + u.base, 0) / withBoth.length) : null,
    avgBooked: withBoth.length ? Math.round(withBoth.reduce((s, u) => s + u.booked, 0) / withBoth.length) : null,
    calendarRead: withCalendar && !!tok,
  }
  return NextResponse.json({ ok: true, building, units, summary, canPush: mayPush((gate as any).access?.email) })
}

export async function POST(req: NextRequest) {
  // the Admin desk's Base rates tab pushes from its full list (Jon, 2026-11-18: "can we push the base rates from here to guesty")
  const gate = await requireAnyLevel(['optimize', 'buildings', 'admin-desk'], 'edit')
  if (!gate.ok) return gate.res
  if (!mayPush((gate as any).access?.email)) return NextResponse.json({ ok: false, error: 'Only Jon and Bernadette can push base prices to Guesty.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const changes: { id: string; basePrice: number; weekendBasePrice: number | null }[] = (Array.isArray(body?.changes) ? body.changes : [])
    .map((c: any) => ({ id: String(c?.id || ''), basePrice: Number(c?.basePrice), weekendBasePrice: num(c?.weekendBasePrice) }))
    .filter((c: any) => c.id && Number.isFinite(c.basePrice) && c.basePrice >= 20 && c.basePrice <= 5000 && (c.weekendBasePrice == null || (c.weekendBasePrice >= 20 && c.weekendBasePrice <= 8000)))
  if (!changes.length) return NextResponse.json({ ok: false, error: 'No valid changes. A base price is between $20 and $5,000.' }, { status: 400 })
  if (changes.length > 120) return NextResponse.json({ ok: false, error: 'Too many units in one batch (max 120).' }, { status: 400 })
  const sb = supabaseAdmin()
  const tok = await token(sb)
  if (!tok) return NextResponse.json({ ok: false, error: 'Guesty token unavailable — run a sync, then retry.' }, { status: 503 })
  const { data: rows } = await sb.from('guesty_listings').select('id,nickname,title,raw').in('id', changes.map(c => c.id))
  const byId = new Map<string, any>(); for (const r of (rows || []) as any[]) byId.set(String(r.id), r)
  const results: any[] = []
  const started = Date.now()
  for (const c of changes) {
    const row = byId.get(c.id)
    const name = String(row?.nickname || row?.title || c.id)
    if (!row) { results.push({ id: c.id, name, ok: false, error: 'Not a listing Lighthouse knows.' }); continue }
    if (Date.now() - started > 240_000) { results.push({ id: c.id, name, ok: false, error: 'Ran out of time — run this unit again.' }); continue }
    // Prices are read FRESH so every other price field goes back exactly as it is now.
    let prices: any = null
    try {
      const g = await guestyFetch(`${BASE}/listings/${encodeURIComponent(c.id)}?fields=prices`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } })
      if (g.ok) { const j: any = await g.json().catch(() => ({})); if (j?.prices && typeof j.prices === 'object') prices = j.prices }
    } catch { /* reported below */ }
    if (!prices) { results.push({ id: c.id, name, ok: false, error: 'Could not read the current prices from Guesty — nothing changed.' }); continue }
    const from = num(prices.basePrice), fromWeekend = num(prices.weekendBasePrice)
    const next = { ...prices, basePrice: Math.round(c.basePrice), ...(c.weekendBasePrice != null ? { weekendBasePrice: Math.round(c.weekendBasePrice) } : {}) }
    try {
      const r = await guestyFetch(`${BASE}/listings/${encodeURIComponent(c.id)}`, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ prices: next }) })
      const text = await r.text().catch(() => '')
      if (!r.ok) { results.push({ id: c.id, name, ok: false, error: r.status === 429 ? 'Guesty asked us to slow down — run this unit again in a minute.' : `Guesty ${r.status}: ${text.slice(0, 120)}` }); continue }
      try { await sb.from('guesty_listings').update({ raw: { ...(row.raw || {}), prices: next } }).eq('id', c.id) } catch { /* the next sync mirrors it */ }
      results.push({ id: c.id, name, ok: true, from, to: next.basePrice, fromWeekend, toWeekend: next.weekendBasePrice ?? null })
    } catch (e: any) { results.push({ id: c.id, name, ok: false, error: String(e?.message || e).slice(0, 120) }) }
    await sleep(300)
  }
  // A record of what each unit's base price was, so a change can be put back.
  try {
    const { getSetting, setSetting } = await import('@/lib/app-settings')
    const log: any[] = (await getSetting<any[]>('base_price_log', [])) || []
    const at = new Date().toISOString(), by = String((gate as any).access?.email || '')
    for (const r of results) if (r.ok) log.push({ at, by, id: r.id, name: r.name, from: r.from, to: r.to, fromWeekend: r.fromWeekend, toWeekend: r.toWeekend })
    await setSetting('base_price_log', log.slice(-600), by || null)
  } catch { /* the change itself is done */ }
  return NextResponse.json({ ok: true, done: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results })
}
