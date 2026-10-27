// BOTANICA BOOKINGS — EVERY RESERVATION IN THE CLOUDBEDS IMPORT LAYOUT (Jon, 2026-10-27).
//
// The hotel is moving its property system to Cloudbeds, and Cloudbeds' reservation-import team
// asks for one row per booking under three headings: Guest Data · Reservation Info · Payment Info.
// Jon: "Need a live link with export of all this data for all botanica bookings." This route is
// the data behind that link: every booking on a Botanica listing, read live from the Guesty mirror
// (synced every 15 minutes), mapped onto the template's 22 columns IN ITS ORDER, downloadable as
// a real .xlsx or a .csv. The page is /report/botanica-bookings.
//
// ITS OWN LINK ROW, ITS OWN PASSCODE. The Margaux report link ('botanica-report') deliberately
// carries no guest names; this one carries names, emails, phones and addresses, because that is
// what an import is. So it is share_links row 'botanica-bookings' (kind 'botanica-bookings'),
// created here on Jon's first signed-in visit with NO passcode (the hub shows it as "unset" until
// he mints one). A signed-in Lighthouse user with dollar access opens it on their login; anyone
// else needs this link's passcode. Nothing on this page opens without one or the other.
//
// GET ?scope=all|current|past      all bookings (default) · in house + upcoming · checked out
//     &status=live|all             confirmed / in house / checked out (default) · also cancelled
//     &from=YYYY-MM-DD&to=…        optional check-in window
//     &format=json|csv|xlsx        json for the page; csv / xlsx are the download
//     &cols=template|extended      the 22 template columns, or those plus Guesty reference columns
//
// THE SAME listing filter as /api/public/botanica-report and /api/public/botanica-occupancy
// (building or name says Botanica), the same duplicate-mirror-row rule (listing + confirmation +
// dates), so a count here ties to the report. Money: Room Total is Guesty's guest-facing total
// (totalPrice = accommodation + cleaning + fees + taxes), which is what Cloudbeds spreads over the
// nights. The rest of the column rules are in COLUMN_RULES below — the page prints them, so the
// Cloudbeds coach reads exactly what each cell means.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { linkGate, signedInUser } from '@/lib/passcode-gate'
import { getLink } from '@/lib/share-links-server'
import { customFieldNameMap, filledCustomFields } from '@/lib/custom-fields'
import { guestSplit } from '@/lib/reservation-pull'
import { pullReservationsByIds } from '@/lib/guesty'
import { makeXlsx, type XCell } from '@/lib/xlsx-lite'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LINK_CODE = 'botanica-bookings'
const LIVE = ['confirmed', 'checked_in', 'checked_out']

// The template, column for column. Three headings, 22 columns, this order.
const GROUPS: { label: string; cols: string[] }[] = [
  { label: 'Guest Data', cols: ['First Name', 'Last Name', 'Email', 'Phone Number', 'Address (Street, City, State, ZIP Code)', 'Country', 'Notes'] },
  { label: 'Reservation Info', cols: ['Check-in date', 'Check-out date', 'Booking date', 'Room Type', 'Room Number / Room Name', 'Number of Adults', 'Number of Children', 'Reservation Source', 'Reservation Status', 'Third-Party ID', 'Rate Plan'] },
  { label: 'Payment Info', cols: ['Room Total', 'Amount Paid', 'Payment Type', 'Payment Date'] },
]
const HEADER: string[] = GROUPS.reduce((a, g) => a.concat(g.cols), [] as string[])
// Guesty reference columns, appended on ?cols=extended (reconciliation, never part of the import).
const EXTENDED: string[] = ['Guesty reservation ID', 'Guesty listing', 'Guesty source', 'Guesty status', 'Nights', 'Currency', 'Accommodation', 'Cleaning fee', 'Other fees', 'Taxes', 'Channel fee', 'Host payout', 'Paid in Guesty', 'Balance due in Guesty', 'Cancelled on', 'Last updated in Guesty', 'Duplicate mirror row']

// What each column is filled from — printed on the page.
const COLUMN_RULES: { col: string; rule: string }[] = [
  { col: 'First / Last Name', rule: 'The Guesty guest record; a single full name is split at the first space.' },
  { col: 'Email · Phone', rule: 'The guest’s email and phone in Guesty. Airbnb gives a relay email, and some channels give no phone — the cell is blank rather than guessed.' },
  { col: 'Address · Country', rule: 'The guest’s address in Guesty when the channel sent one (street, city, state, ZIP). Most OTA guests have none — blank. Country falls back to the guest’s nationality.' },
  { col: 'Notes', rule: 'The Guesty reservation note plus the “Reservation notes” custom field. Door codes are never exported.' },
  { col: 'Check-in · Check-out · Booking date', rule: 'Guesty’s local stay dates and the date the booking was created (Eastern time), as YYYY-MM-DD.' },
  { col: 'Room Type · Room Number', rule: 'From the Guesty listing name, e.g. “Botanica 1109 - King w/ Kitchenette” → room 1109, type “King w/ Kitchenette”. A combined listing (1104/1106) keeps both numbers.' },
  { col: 'Adults · Children', rule: 'Guesty’s split when the channel sent one; a bare guest count lands as adults with children blank.' },
  { col: 'Reservation Source', rule: 'The channel: Airbnb (Channel Collect), Booking.com, Expedia, Hotels.com, Vrbo, Direct…' },
  { col: 'Reservation Status', rule: 'Confirmed, Checked In (in house today), Checked Out (stay ended), Canceled, Not Confirmed — from Guesty’s status and the dates.' },
  { col: 'Third-Party ID', rule: 'The channel’s confirmation code (Airbnb HM…, Booking.com number, Expedia itinerary) — the ID Cloudbeds matches later OTA changes against.' },
  { col: 'Rate Plan', rule: 'Guesty has no rate plans; blank unless the reservation carries one.' },
  { col: 'Room Total', rule: 'Guesty’s guest-facing total: accommodation + cleaning + fees + taxes (money.totalPrice).' },
  { col: 'Amount Paid', rule: 'Airbnb collects at booking, so Airbnb = Room Total. Otherwise what Guesty shows paid, and Room Total once the stay is checked out or Guesty marks it fully paid. Cancelled bookings show what was actually collected.' },
  { col: 'Payment Type · Payment Date', rule: 'Channel Collect (Airbnb) on the booking date; otherwise the last successful Guesty payment’s method and date, or “Imported from previous system” on the booking date when Guesty recorded no payment.' },
]

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const has = (v: any): boolean => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
const r2 = (n: number) => Math.round(n * 100) / 100
const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const ymdNY = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
/** A Guesty timestamp → YYYY-MM-DD in Eastern time; a bare date stays as it is. */
function dateOf(v: any): string {
  const s = str(v).trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? s.slice(0, 10) : ymdNY(d)
}
function daysBetween(a: string, b: string) { return Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000) }
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s

/** "Botanica 1109 - King w/ Kitchenette" -> { room: '1109', type: 'King w/ Kitchenette' } (same as the occupancy export). */
function roomOf(name: string): { room: string; type: string } {
  const m = name.match(/(\d{3,4}(?:\s*\/\s*\d{3,4})?)/)
  const room = m ? m[1].replace(/\s+/g, '') : name
  const dash = name.indexOf(' - ')
  let type = dash >= 0 ? name.slice(dash + 3).trim() : ''
  if (!type) { const after = m ? name.slice((m.index || 0) + m[0].length).replace(/^[\s\-–—:]+/, '').trim() : ''; type = after }
  return { room, type }
}

/** Guesty `source` / integration platform -> the channel name Cloudbeds will see. */
function channelOf(src: string): string {
  const s = src.toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo') || s.includes('homeaway')) return 'Vrbo'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('hotels.com') || s.includes('hotelscom')) return 'Hotels.com'
  if (s.includes('expedia')) return 'Expedia'
  if (s.includes('travelocity')) return 'Travelocity'
  if (s.includes('marriott')) return 'Marriott Homes & Villas'
  if (s.includes('blueground')) return 'Blueground'
  if (s.includes('google')) return 'Google'
  if (s.includes('orbitz')) return 'Expedia' // Orbitz books through the Expedia group
  // be-api = Guesty's own booking-engine API — our direct booking page.
  if (s.includes('direct') || s.includes('website') || s.includes('manual') || s.includes('owner') || s.includes('homerunner') || s.includes('engine') || s === 'be-api' || s === 'be_api') return 'Direct'
  return cap(src)
}
// Airbnb always charges the guest at booking and pays us after check-in: the guest owes the hotel
// nothing. No other channel is asserted — Booking.com and Expedia can be either, so those rows
// trust what Guesty recorded.
const CHANNEL_COLLECT = ['Airbnb']

/** Guesty status + dates -> the Cloudbeds status word. */
function statusOf(st: string, ci: string, co: string, today: string): string {
  const s = st.toLowerCase()
  if (/cancel/.test(s)) return 'Canceled'
  if (LIVE.indexOf(s) < 0) return 'Not Confirmed'
  if (s === 'checked_out' || (co && co <= today)) return 'Checked Out'
  if (s === 'checked_in' || (ci && ci <= today && co > today)) return 'Checked In'
  return 'Confirmed'
}

/** The guest's address, from whatever shape Guesty sent it in. */
function addressOf(g: any): { line: string; country: string } {
  const a = g && typeof g.address === 'object' && g.address ? g.address : null
  const pick = (...keys: string[]) => { for (const k of keys) { const v = a ? a[k] : undefined; if (typeof v === 'string' && v.trim()) return v.trim() } return '' }
  const street = pick('street', 'line1', 'address1', 'streetAddress', 'addressLine1')
  const line2 = pick('line2', 'address2', 'apt', 'unit')
  const city = pick('city', 'locality')
  const state = pick('state', 'region', 'province')
  const zip = pick('zipcode', 'zip', 'postalCode', 'postcode', 'postal_code')
  const country = pick('country', 'countryName') || (g ? str(g.country || g.nationality || g.countryCode).trim() : '')
  const parts = [[street, line2].filter(Boolean).join(' '), city, [state, zip].filter(Boolean).join(' ')].filter(Boolean)
  let line = parts.join(', ')
  if (!line) line = pick('full', 'formatted', 'formattedAddress')
  if (!line && typeof g?.address === 'string') line = g.address.trim()
  if (!line) line = str(g?.hometown).trim()
  // The country is often repeated at the end of a full address; keep the column for it.
  if (line && country && line.toLowerCase().endsWith(country.toLowerCase())) line = line.slice(0, line.length - country.length).replace(/[\s,]+$/, '')
  return { line, country }
}

/** Payment method words Cloudbeds recognises, from Guesty's payment-method codes. */
function methodWord(m: any): string {
  const s = str(typeof m === 'object' && m ? (m.method || m.type || m.name) : m).toLowerCase()
  if (!s) return ''
  if (/card|stripe|visa|master|amex|discover|credit/.test(s)) return 'Credit Card'
  if (/cash/.test(s)) return 'Cash'
  if (/bank|wire|ach|transfer/.test(s)) return 'Bank Transfer'
  if (/check|cheque/.test(s)) return 'Check'
  if (/paypal/.test(s)) return 'PayPal'
  return 'Other'
}
/** The last successful payment Guesty recorded on the reservation, if any. */
function lastPayment(money: any): { amount: number; method: string; date: string } | null {
  const list: any[] = Array.isArray(money?.payments) ? money.payments : []
  const ok = list.filter(p => p && (!p.status || /succe|paid|complete|captured/i.test(str(p.status))) && num(p.amount) > 0)
  if (!ok.length) return null
  ok.sort((a, b) => str(a.paidAt || a.createdAt || a.date).localeCompare(str(b.paidAt || b.createdAt || b.date)))
  const p = ok[ok.length - 1]
  return { amount: num(p.amount), method: methodWord(p.paymentMethod || p.method || p.type), date: dateOf(p.paidAt || p.createdAt || p.date) }
}

function csvCell(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The link row, made on the first signed-in visit so the hub can show it and Jon can mint its passcode. */
async function ensureLinkRow(who: string | null): Promise<void> {
  try {
    if (await getLink(LINK_CODE)) return
    const db = supabaseAdmin()
    const probe = await db.from('share_links').select('passcode_hash').limit(1)
    if (probe.error) return // migration 101 not run yet — nothing to create
    const title = 'Botanica bookings — Cloudbeds import'
    await db.from('share_links').insert({
      code: LINK_CODE, kind: 'botanica-bookings', title, label: title, audience: 'partner', scope: {},
      passcode_hash: null, passcode_hint: null, open: false, expires_at: null,
      notes: 'Every Botanica booking in the Cloudbeds reservation-import layout, with guest contact details. Mint a passcode before sharing it outside the office.',
      created_by: who, updated_at: new Date().toISOString(),
    })
  } catch { /* the hub will show nothing until the next signed-in visit; the gate still fails closed */ }
}

/** Every Botanica listing id in the mirror (building or name says Botanica). */
async function botanicaListingIds(db: ReturnType<typeof supabaseAdmin>): Promise<string[]> {
  const { data, error } = await db.from('guesty_listings').select('id,nickname,title,building')
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).filter(l => /botanica/i.test(str(l.building)) || /botanica/i.test(str(l.nickname || l.title))).map(l => String(l.id))
}

async function backfillGuestCounts(): Promise<NextResponse> {
  const started = Date.now()
  try {
    const db = supabaseAdmin()
    const ids = await botanicaListingIds(db)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No Botanica listings found' }, { status: 500 })
    // Rows that have neither count yet. A row Guesty genuinely holds no count for comes back the
    // same way and is asked again next time — a bounded cost (one re-pull per run), never a loop here.
    let missing: string[] = []
    for (let i = 0; i < 30; i++) {
      const { data, error } = await db.from('guesty_reservations').select('id').in('listing_id', ids)
        .is('raw->guestsCount', null).is('raw->numberOfGuests', null).order('check_in', { ascending: false }).range(i * 1000, i * 1000 + 999)
      if (error) throw new Error(error.message)
      if (!data || !data.length) break
      missing = missing.concat((data as any[]).map(r => String(r.id)))
      if (data.length < 1000) break
    }
    let pulled = 0, offset = 0
    while (offset < missing.length && Date.now() - started < 40_000) {
      pulled += await pullReservationsByIds(missing.slice(offset, offset + 200))
      offset += 200
    }
    return NextResponse.json({ ok: true, missingBefore: missing.length, asked: Math.min(offset, missing.length), pulled, remaining: Math.max(0, missing.length - offset), seconds: Math.round((Date.now() - started) / 1000) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const me = await signedInUser()
  if (me.signedIn) await ensureLinkRow(me.who)
  // Dollars on every row, guest contacts on every row: a signed-in teammate without dollar access
  // is asked for the link's passcode like anyone else (2026-09-28, B-5).
  const gate = await linkGate(LINK_CODE, { kinds: ['botanica-bookings'], money: true })
  if (!gate.ok) return gate.res

  const sp = req.nextUrl.searchParams
  const today = ymdNY(new Date())
  const scope = ['all', 'current', 'past'].indexOf(str(sp.get('scope'))) >= 0 ? str(sp.get('scope')) : 'all'
  const withCancelled = str(sp.get('status')).toLowerCase() === 'all'
  const from = isoOk(str(sp.get('from')).trim()) ? str(sp.get('from')).trim() : ''
  const to = isoOk(str(sp.get('to')).trim()) ? str(sp.get('to')).trim() : ''
  const format = str(sp.get('format') || 'json').toLowerCase()
  const extended = str(sp.get('cols')).toLowerCase() === 'extended'

  // ?backfill=1 (signed-in only): re-pull from Guesty every Botanica reservation whose mirror row
  // predates guestsCount / numberOfGuests being part of the pull, so adults and children fill in.
  // Chunks of 200 ids (the re-pull's own cap), inside a time budget; answers how many are left, so
  // the caller repeats until remaining is 0. Each chunk is four Guesty calls.
  if (str(sp.get('backfill')) === '1') {
    if (!gate.signedIn) return NextResponse.json({ ok: false, error: 'Sign in to Lighthouse to backfill.' }, { status: 403 })
    return backfillGuestCounts()
  }

  try {
    const db = supabaseAdmin()
    const { data: listings, error: lErr } = await db.from('guesty_listings').select('id,nickname,title,building,status,active:raw->>active')
    if (lErr) throw new Error(lErr.message)
    type Room = { listingId: string; name: string; room: string; type: string; listed: boolean }
    const byId: Record<string, Room> = {}
    const ids: string[] = []
    for (const l of (listings || []) as any[]) {
      const name = str(l.nickname || l.title)
      if (!/botanica/i.test(str(l.building)) && !/botanica/i.test(name)) continue
      const retired = /inactive|disabled|archived|deleted/i.test(str(l.status)) || str(l.active) === 'false'
      const r = roomOf(name)
      byId[String(l.id)] = { listingId: String(l.id), name, room: r.room, type: r.type, listed: !retired }
      ids.push(String(l.id))
    }
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No Botanica listings found in the Guesty mirror' }, { status: 500 })

    // Every reservation on those listings — the sub-objects the columns need, never the whole raw
    // payload (a Guesty reservation is tens of KB; a few thousand of them is not a page load).
    let resv: any[] = []
    for (let i = 0; i < 30; i++) {
      let q = db.from('guesty_reservations')
        .select('id,listing_id,guest_name,guest_email,guest_phone,check_in,check_out,nights,status,source,confirmation_code,notes,custom_fields,created_at,money_paid,money_balance,money_currency,guest:raw->guest,money:raw->money,gc:raw->guestsCount,nog:raw->numberOfGuests,guests:raw->guests,platform:raw->integration->>platform,canceledAt:raw->>canceledAt,confirmedAt:raw->>confirmedAt,updatedAt:raw->>lastUpdatedAt,rawNote:raw->note,ratePlan:raw->ratePlan,ratePlanName:raw->>ratePlanName')
        .in('listing_id', ids)
        .order('check_in', { ascending: true })
        .range(i * 1000, i * 1000 + 999)
      if (from) q = q.gte('check_in', from)
      if (to) q = q.lte('check_in', to)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      resv = resv.concat(data)
      if (data.length < 1000) break
    }
    const nameMap = await customFieldNameMap().catch(() => ({} as Record<string, string>))

    const counts = { all: 0, inHouse: 0, upcoming: 0, past: 0, cancelled: 0, duplicatesDropped: 0, withEmail: 0, withPhone: 0, withAddress: 0, withAdults: 0 }
    const seen: Record<string, boolean> = {}
    type Row = { cells: (string | number)[]; extra: (string | number)[]; key: string; sortCi: string; room: string; cloudStatus: string; channel: string }
    const rows: Row[] = []
    for (const r of resv) {
      const st = str(r.status).toLowerCase()
      const ci = dateOf(r.check_in), co = dateOf(r.check_out)
      const rm = byId[String(r.listing_id)]
      if (!rm) continue
      const cancelled = /cancel|declined|expired|closed/.test(st) || (!LIVE.includes(st) && !!str(r.canceledAt))
      const isLive = LIVE.includes(st)
      // Inquiries never became bookings: not a cancellation, not a stay — out, whatever the switch.
      if (!isLive && !cancelled) continue
      if (!isLive && !withCancelled) { counts.cancelled++; continue }
      const dk = rm.listingId + '|' + (str(r.confirmation_code) || String(r.id)) + '|' + ci + '|' + co
      const dup = !!seen[dk]; seen[dk] = true
      if (dup) { counts.duplicatesDropped++; continue }

      const cloudStatus = statusOf(st, ci, co, today)
      if (cloudStatus === 'Canceled' || cloudStatus === 'Not Confirmed') counts.cancelled++
      else if (cloudStatus === 'Checked Out') counts.past++
      else if (cloudStatus === 'Checked In') counts.inHouse++
      else counts.upcoming++
      if (scope === 'current' && (cloudStatus === 'Checked Out')) continue
      if (scope === 'past' && cloudStatus !== 'Checked Out') continue
      counts.all++

      // ── Guest ──
      const g: any = r.guest && typeof r.guest === 'object' ? r.guest : {}
      let first = str(g.firstName).trim(), last = str(g.lastName).trim()
      if (!first && !last) { const parts = str(g.fullName || r.guest_name).trim().split(/\s+/).filter(Boolean); first = parts.shift() || ''; last = parts.join(' ') }
      const email = str(r.guest_email || g.email || (Array.isArray(g.emails) ? (typeof g.emails[0] === 'object' ? g.emails[0]?.address : g.emails[0]) : '')).trim()
      const phone = str(r.guest_phone || g.phone || (Array.isArray(g.phones) ? (typeof g.phones[0] === 'object' ? g.phones[0]?.number : g.phones[0]) : '')).trim()
      const addr = addressOf(g)
      if (email) counts.withEmail++
      if (phone) counts.withPhone++
      if (addr.line) counts.withAddress++
      const noteParts: string[] = []
      const rawNote: any = r.rawNote
      const noteText = typeof rawNote === 'string' ? rawNote : (rawNote && typeof rawNote === 'object' ? Object.values(rawNote).filter(v => typeof v === 'string').join(' ') : str(r.notes))
      if (str(noteText).trim()) noteParts.push(str(noteText).trim())
      for (const f of filledCustomFields(r.custom_fields, nameMap)) {
        if (/^reservation notes?$/i.test(f.name) && f.value && noteParts.indexOf(f.value) < 0) noteParts.push(f.value)
      }
      const notes = noteParts.join(' | ').replace(/\s+/g, ' ').slice(0, 1000)

      // ── Reservation ──
      const split = guestSplit({ guestsCount: r.gc, numberOfGuests: r.nog, guests: r.guests })
      if (split.adults != null) counts.withAdults++
      const channel = channelOf(str(r.source) || str(r.platform))
      const source = CHANNEL_COLLECT.indexOf(channel) >= 0 ? channel + ' (Channel Collect)' : channel
      const booked = dateOf(r.created_at || r.confirmedAt)
      const rp: any = r.ratePlan
      const ratePlan = str(typeof rp === 'object' && rp ? (rp.name || rp.title) : rp) || str(r.ratePlanName)

      // ── Payment ──
      const m: any = r.money && typeof r.money === 'object' ? r.money : {}
      const currency = str(m.currency || r.money_currency || 'USD')
      const accommodation = num(m.fareAccommodationAdjusted ?? m.fareAccommodation)
      const cleaning = num(m.fareCleaning), fees = num(m.totalFees), taxes = num(m.totalTaxes)
      const roomTotal = r2(has(m.totalPrice) ? num(m.totalPrice) : (has(m.subTotalPrice) ? num(m.subTotalPrice) + taxes : accommodation + cleaning + fees + taxes))
      const paidGuesty = r2(has(m.totalPaid) ? num(m.totalPaid) : num(r.money_paid))
      const fullyPaid = m.isFullyPaid === true || (has(m.balanceDue) && num(m.balanceDue) <= 0.009 && paidGuesty > 0)
      const pay = lastPayment(m)
      let amountPaid: number, payType: string, payDate: string
      if (cloudStatus === 'Canceled' || cloudStatus === 'Not Confirmed') {
        amountPaid = r2(Math.min(paidGuesty, roomTotal > 0 ? roomTotal : paidGuesty))
        payType = amountPaid > 0 ? (CHANNEL_COLLECT.indexOf(channel) >= 0 ? 'Channel Collect (' + channel + ')' : (pay?.method || 'Imported from previous system')) : ''
        payDate = amountPaid > 0 ? (pay?.date || booked) : ''
      } else if (CHANNEL_COLLECT.indexOf(channel) >= 0) {
        amountPaid = roomTotal; payType = 'Channel Collect (' + channel + ')'; payDate = booked
      } else {
        amountPaid = r2(fullyPaid || cloudStatus === 'Checked Out' ? roomTotal : Math.min(paidGuesty, roomTotal))
        payType = amountPaid > 0 ? (pay?.method || 'Imported from previous system') : ''
        payDate = amountPaid > 0 ? (pay?.date || booked) : ''
      }

      const cells: (string | number)[] = [
        first, last, email, phone, addr.line, addr.country, notes,
        ci, co, booked, rm.type, rm.room, split.adults == null ? '' : split.adults, split.children == null ? '' : split.children, source, cloudStatus, str(r.confirmation_code), ratePlan,
        roomTotal, amountPaid, payType, payDate,
      ]
      const extra: (string | number)[] = [
        String(r.id), rm.name, str(r.source) || str(r.platform), cap(st.replace(/_/g, ' ')), num(r.nights) || (ci && co ? daysBetween(ci, co) : ''), currency,
        r2(accommodation), r2(cleaning), r2(fees), r2(taxes), r2(num(m.hostServiceFee)), r2(num(m.hostPayout)), paidGuesty, has(m.balanceDue) ? r2(num(m.balanceDue)) : '',
        dateOf(r.canceledAt), dateOf(r.updatedAt), '',
      ]
      rows.push({ cells, extra, key: String(r.id), sortCi: ci, room: rm.room, cloudStatus, channel })
    }
    rows.sort((a, b) => a.sortCi.localeCompare(b.sortCi) || a.room.localeCompare(b.room, 'en', { numeric: true }))

    const { data: syncSt } = await db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
    const lastSync = syncSt && (syncSt as any).last_sync_at ? String((syncSt as any).last_sync_at) : null
    const header = extended ? HEADER.concat(EXTENDED) : HEADER
    const outRows = rows.map(r => extended ? r.cells.concat(r.extra) : r.cells)
    const stamp = today.replace(/-/g, '')
    const fname = 'botanica-bookings-' + (scope === 'all' ? 'all' : scope) + (from || to ? '-checkin-' + (from || 'start') + '-to-' + (to || 'end') : '') + (withCancelled ? '-incl-cancelled' : '') + (extended ? '-extended' : '') + '-' + stamp

    if (format === 'csv') {
      const csv = [header.map(csvCell).join(',')].concat(outRows.map(r => r.map(csvCell).join(','))).join('\r\n')
      return new NextResponse('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + fname + '.csv"', 'Cache-Control': 'no-store' } })
    }
    if (format === 'xlsx') {
      // Row 1 = the three blue headings over their columns, row 2 = the column names, like the template.
      const groupRow: XCell[] = []
      for (const gr of GROUPS) { groupRow.push({ v: gr.label, s: 10 }); for (let i = 1; i < gr.cols.length; i++) groupRow.push({ v: '', s: 10 }) }
      if (extended) { groupRow.push({ v: 'Guesty reference (not for import)', s: 3 }); for (let i = 1; i < EXTENDED.length; i++) groupRow.push({ v: '', s: 3 }) }
      const headRow: XCell[] = header.map(h => ({ v: h, s: 1 }))
      const moneyCols = [18, 19].concat(extended ? [28, 29, 30, 31, 32, 33, 34, 35] : [])
      const body: XCell[][] = outRows.map(r => r.map((v, i) => typeof v === 'number' ? { v, num: true, s: moneyCols.indexOf(i) >= 0 ? 4 : undefined } : { v: String(v) }))
      const widths = header.map(h => Math.min(44, Math.max(12, h.length + 2)))
      widths[4] = 40; widths[6] = 44; widths[2] = 30
      const buf = makeXlsx([{ name: 'Botanica bookings', widths, rows: [groupRow, headRow].concat(body) }])
      return new NextResponse(buf as any, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="' + fname + '.xlsx"', 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({
      ok: true, property: 'Botanica (The Garden Hotel & Resort)', today, generatedAt: new Date().toISOString(), lastSync,
      scope, withCancelled, from, to, extended, signedIn: gate.signedIn, label: gate.link?.title || null,
      rooms: ids.length, counts, groups: GROUPS.map(g => ({ label: g.label, span: g.cols.length })), header, extendedHeader: EXTENDED, rules: COLUMN_RULES,
      rows: rows.map(r => ({ id: r.key, status: r.cloudStatus, channel: r.channel, cells: r.cells, extra: r.extra })),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
