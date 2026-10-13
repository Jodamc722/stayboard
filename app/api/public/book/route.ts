// DIRECT BOOKING API — public, for /book (Jon, 2026-10-13). Everything a guest's browser needs and
// nothing more: search, one listing, a price, their details, the ID + selfie check, the booking.
// Inventory, price and money are Guesty's (lib/guesty-be — the Booking Engine API, GuestyPay); the
// ID and selfie are ours (lib/direct-booking) and must pass BEFORE the booking call is allowed.
//
//   GET  ?a=search&checkIn&checkOut&guests&city&cursor   → { listings, next }
//   GET  ?a=listing&id&from&to                           → { listing, blocked: [dates] }
//   POST { a:'quote', listingId, checkIn, checkOut, guests, coupon?, draftId? } → { draftId, quote, providerId }
//   POST { a:'guest', draftId, firstName, lastName, email, phone }              → { ok }
//   POST { a:'verify', draftId, idPhoto, selfie }                               → { check }
//   POST { a:'book', draftId, ratePlanId, paymentMethodId, agree }              → { booked } | { threeDSChallenge }
//   POST { a:'confirm3ds', draftId, threeDSResult }                             → { booked }
//
// No card data ever reaches this route: the browser sends a GuestyPay payment-method id made by
// Guesty's own card iframe. Abuse limits: per-address counters for quotes and ID checks.
import { NextRequest, NextResponse } from 'next/server'
import { beConfigured, searchListings, getListing, getCalendar, createQuote, paymentProvider, instantCharge, verifyPayment, BeError } from '@/lib/guesty-be'
import { newDraft, loadDraft, saveDraft, decodeImage, storePhotos, checkId, attachToReservation } from '@/lib/direct-booking'
import { logParking, lockoutReason, LOCKOUT_MINUTES } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ipOf = (req: NextRequest) => String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || null
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'))
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400_000)
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const LOCK = 'direct-book'

// A tiny per-instance cache so a guest flicking between results does not re-ask Guesty.
const cache = new Map<string, { at: number; v: any }>()
const cached = async <T,>(k: string, ms: number, f: () => Promise<T>): Promise<T> => { const c = cache.get(k); if (c && Date.now() - c.at < ms) return c.v as T; const v = await f(); cache.set(k, { at: Date.now(), v }); if (cache.size > 300) cache.delete(cache.keys().next().value as string); return v }

function datesOk(checkIn: string, checkOut: string): string | null {
  if (!isYmd(checkIn) || !isYmd(checkOut)) return 'Pick your check-in and check-out dates.'
  if (checkIn < todayET()) return 'Check-in can\'t be in the past.'
  const n = nightsBetween(checkIn, checkOut)
  if (n < 1) return 'Check-out must be after check-in.'
  if (n > 90) return 'For stays over 90 nights, message us and we\'ll set it up.'
  return null
}
const beMessage = (e: any) => e instanceof BeError ? (e.status === 429 ? 'Lots of people are booking right now — try again in a moment.' : /available|availability|blocked|occupied|min.*night|minimum/i.test(e.message) ? 'Those dates are not available for this home (or below its minimum stay). Try other dates.' : e.message) : String(e?.message || e)

export async function GET(req: NextRequest) {
  if (!beConfigured()) return bad('Direct booking is not switched on yet.', 503)
  const sp = req.nextUrl.searchParams
  const a = sp.get('a')
  try {
    if (a === 'search') {
      const checkIn = str(sp.get('checkIn')), checkOut = str(sp.get('checkOut'))
      const withDates = !!(checkIn && checkOut)
      if (withDates) { const e = datesOk(checkIn, checkOut); if (e) return bad(e) }
      const guests = Math.min(Math.max(Number(sp.get('guests')) || 1, 1), 16)
      const q = { checkIn: withDates ? checkIn : undefined, checkOut: withDates ? checkOut : undefined, guests, city: str(sp.get('city')).slice(0, 60) || undefined, cursor: str(sp.get('cursor')) || undefined, limit: 40 }
      const r = await cached('s:' + JSON.stringify(q), 3 * 60_000, () => searchListings(q))
      const nights = withDates ? nightsBetween(checkIn, checkOut) : 0
      const listings = r.results
        // With dates, Guesty returns allotment 0 for a home that cannot take the stay.
        .filter(l => !withDates || l.allotment === undefined || Number(l.allotment) > 0)
        .map(l => {
          const rates = l.nightlyRates && typeof l.nightlyRates === 'object' ? Object.values(l.nightlyRates).map(Number).filter(n => n > 0) : []
          const stay = rates.length ? rates.reduce((s, n) => s + n, 0) : null
          return {
            id: l._id, title: l.title, type: l.propertyType || '', city: l.address?.city || '', area: l.address?.neighborhood || '',
            guests: l.accommodates || null, bedrooms: l.bedrooms ?? null, bathrooms: l.bathrooms ?? null, beds: l.beds ?? null,
            photo: l.picture?.large || l.picture?.regular || l.pictures?.[0]?.large || l.pictures?.[0]?.regular || null,
            perNight: stay && nights ? Math.round(stay / nights) : (l.prices?.basePrice ?? null), stayFrom: stay ? Math.round(stay) : null,
            currency: l.prices?.currency || 'USD', rating: l.reviews?.avg ? Math.round(l.reviews.avg * 10) / 10 : null, reviews: l.reviews?.total || 0,
          }
        })
      return NextResponse.json({ ok: true, listings, next: r.next, total: r.total }, { headers: { 'cache-control': 'private, max-age=60' } })
    }
    if (a === 'listing') {
      const id = str(sp.get('id')).slice(0, 40)
      if (!/^[a-f0-9]{24}$/i.test(id)) return bad('Not found.', 404)
      const from = isYmd(str(sp.get('from'))) ? str(sp.get('from')) : todayET()
      const toD = new Date(from + 'T12:00:00Z'); toD.setUTCDate(toD.getUTCDate() + 180)
      const to = isYmd(str(sp.get('to'))) ? str(sp.get('to')) : toD.toISOString().slice(0, 10)
      const [l, cal] = await Promise.all([cached('l:' + id, 10 * 60_000, () => getListing(id)), cached(`c:${id}:${from}:${to}`, 2 * 60_000, () => getCalendar(id, from, to).catch(() => []))])
      const desc: any = (l as any).publicDescription || {}
      return NextResponse.json({ ok: true, listing: {
        id: l._id, title: l.title, type: l.propertyType || '', city: l.address?.city || '', area: l.address?.neighborhood || '',
        guests: l.accommodates || null, bedrooms: l.bedrooms ?? null, bathrooms: l.bathrooms ?? null, beds: l.beds ?? null,
        photos: (l.pictures || []).slice(0, 14).map(p => ({ src: p.large || p.regular || p.original || '', thumb: p.thumbnail || p.regular || '', caption: p.caption || '' })).filter(p => p.src),
        summary: str(desc.summary || '').slice(0, 1600), space: str(desc.space || '').slice(0, 1600), access: str(desc.access || '').slice(0, 600), neighborhood: str(desc.neighborhood || '').slice(0, 800), houseRules: str(desc.houseRules || '').slice(0, 1200),
        amenities: (l.amenities || []).slice(0, 40), rating: l.reviews?.avg || null, reviews: l.reviews?.total || 0, basePrice: l.prices?.basePrice ?? null, currency: l.prices?.currency || 'USD',
        checkInTime: (l as any).defaultCheckInTime || null, checkOutTime: (l as any).defaultCheckOutTime || null,
      }, calendar: cal.map(d => ({ date: d.date, open: d.status === 'available', minNights: d.minNights || 1, cta: !!d.cta, ctd: !!d.ctd })) })
    }
    return bad('Unknown request.')
  } catch (e: any) { return bad(beMessage(e), e instanceof BeError && e.status === 404 ? 404 : 502) }
}

export async function POST(req: NextRequest) {
  if (!beConfigured()) return bad('Direct booking is not switched on yet.', 503)
  const b: any = await req.json().catch(() => ({}))
  const a = str(b?.a)
  const ip = ipOf(req)
  try {
    if (a === 'quote') {
      if ((await lockoutReason(LOCK + ':quote', ip, 60)) === 'ip') return bad(`Too many price checks — try again in ${LOCKOUT_MINUTES} minutes.`, 429)
      const listingId = str(b.listingId).slice(0, 40), checkIn = str(b.checkIn), checkOut = str(b.checkOut)
      const guests = Math.min(Math.max(Number(b.guests) || 1, 1), 16)
      if (!/^[a-f0-9]{24}$/i.test(listingId)) return bad('Pick a home first.')
      const e = datesOk(checkIn, checkOut); if (e) return bad(e)
      await logParking({ code: LOCK + ':quote', action: 'denied', detail: listingId, ip })   // counts toward the per-address limit
      const [quote, provider, l] = await Promise.all([createQuote({ listingId, checkIn, checkOut, guests, coupon: str(b.coupon).slice(0, 40) || undefined }), paymentProvider(listingId), cached('l:' + listingId, 10 * 60_000, () => getListing(listingId)).catch(() => null)])
      if (!quote.quoteId || !quote.ratePlans.length) return bad('Those dates are not available for this home. Try other dates.')
      let draft = b.draftId ? await loadDraft(str(b.draftId)) : null
      if (draft && !draft.booked) { Object.assign(draft, { listingId, listingTitle: l?.title || draft.listingTitle, checkIn, checkOut, guests, quoteId: quote.quoteId, ratePlanId: quote.ratePlans[0].id, total: quote.ratePlans[0].total, currency: quote.ratePlans[0].currency }); await saveDraft(draft) }
      else draft = await newDraft({ ip, listingId, listingTitle: l?.title || '', checkIn, checkOut, guests, quoteId: quote.quoteId, ratePlanId: quote.ratePlans[0].id, total: quote.ratePlans[0].total, currency: quote.ratePlans[0].currency })
      return NextResponse.json({ ok: true, draftId: draft.id, quote, providerId: provider?.id || null, verified: draft.check?.verdict === 'pass' || draft.check?.verdict === 'review' })
    }

    const draft = await loadDraft(str(b.draftId))
    if (!draft) return bad('This booking session expired — start again from the dates.', 410)
    if (draft.booked && a !== 'confirm3ds') return NextResponse.json({ ok: true, booked: draft.booked })

    if (a === 'guest') {
      const firstName = str(b.firstName).trim().slice(0, 60), lastName = str(b.lastName).trim().slice(0, 60)
      const email = str(b.email).trim().toLowerCase().slice(0, 120), phone = str(b.phone).trim().slice(0, 30)
      if (!firstName || !lastName) return bad('Your first and last name, as on your ID.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('A valid email — your confirmation goes there.')
      if (phone.replace(/\D/g, '').length < 7) return bad('A mobile number we can reach you on.')
      const changedName = draft.guest && (draft.guest.firstName !== firstName || draft.guest.lastName !== lastName)
      draft.guest = { firstName, lastName, email, phone }
      // A new name after a check means the check no longer holds.
      if (changedName && draft.check) draft.check = null
      await saveDraft(draft)
      return NextResponse.json({ ok: true, needsVerify: !draft.check || draft.check.verdict === 'retake' })
    }

    if (a === 'verify') {
      if (!draft.guest) return bad('Add your details first.')
      if ((await lockoutReason(LOCK, ip, 8)) === 'ip') return bad(`Too many tries — try again in ${LOCKOUT_MINUTES} minutes.`, 429)
      const idImg = decodeImage(str(b.idPhoto)), selfie = decodeImage(str(b.selfie))
      if (!idImg) return bad('Add a clear photo of your ID.')
      if (!selfie) return bad('Take a selfie.')
      const paths = await storePhotos(draft.id, idImg, selfie)
      const check = await checkId(idImg, selfie, draft.guest.firstName, draft.guest.lastName)
      draft.idPath = paths.idPath; draft.selfiePath = paths.selfiePath; draft.check = check
      await saveDraft(draft)
      if (check.verdict === 'retake') await logParking({ code: LOCK, action: 'denied', detail: 'id retake: ' + check.reasons.join(' | ').slice(0, 200), ip })
      return NextResponse.json({ ok: true, check: { verdict: check.verdict, reasons: check.verdict === 'retake' ? check.reasons : [] } })
    }

    if (a === 'book') {
      if (!draft.guest) return bad('Add your details first.')
      if (!draft.check || draft.check.verdict === 'retake') return bad('Verify your ID and selfie first.')
      if (b.agree !== true) return bad('Please accept the house rules and cancellation policy.')
      const pm = str(b.paymentMethodId).slice(0, 80)
      if (!pm) return bad('Add a card.')
      const ratePlanId = str(b.ratePlanId) || str(draft.ratePlanId)
      if (!draft.quoteId || !ratePlanId) return bad('The price expired — pick your dates again.', 410)
      const booked = await instantCharge({ quoteId: draft.quoteId, ratePlanId, paymentMethodId: pm, guest: { firstName: draft.guest.firstName, lastName: draft.guest.lastName, email: draft.guest.email, phone: draft.guest.phone }, notes: `Booked direct on the Stay website. ID + selfie taken before booking (Lighthouse${draft.check.verdict === 'review' ? ' — flagged for desk review' : ''}).` })
      if (booked.threeDSChallenge && booked.paymentId && booked.reservationId) {
        draft.pending3ds = { reservationId: booked.reservationId, paymentId: booked.paymentId }
        await saveDraft(draft)
        return NextResponse.json({ ok: true, threeDSChallenge: booked.threeDSChallenge })
      }
      if (/PENDING_AUTH/i.test(booked.paymentStatus) && booked.paymentId && booked.reservationId) {
        // No challenge to show (e.g. EU/UK GuestyPay): finish the payment straight away.
        const v = await verifyPayment(booked.reservationId, booked.paymentId)
        return await finish(draft, v)
      }
      return await finish(draft, booked)
    }

    if (a === 'confirm3ds') {
      if (draft.booked) return NextResponse.json({ ok: true, booked: draft.booked })
      if (!draft.pending3ds) return bad('Nothing is waiting on card authentication.')
      const v = await verifyPayment(draft.pending3ds.reservationId, draft.pending3ds.paymentId, b.threeDSResult || undefined)
      return await finish(draft, v)
    }
    return bad('Unknown request.')
  } catch (e: any) { return bad(beMessage(e), 502) }
}

async function finish(draft: any, r: { reservationId: string; confirmationCode: string; status: string; paymentStatus: string }) {
  if (!r.reservationId || !/confirm/i.test(r.status)) return bad(`The card was not accepted${r.paymentStatus ? ' (' + r.paymentStatus.toLowerCase().replace(/_/g, ' ') + ')' : ''}. No booking was made — try another card.`, 402)
  draft.booked = { reservationId: r.reservationId, confirmationCode: r.confirmationCode, at: new Date().toISOString(), paymentStatus: r.paymentStatus }
  draft.pending3ds = null
  await saveDraft(draft)
  await attachToReservation(draft, r.reservationId)
  return NextResponse.json({ ok: true, booked: draft.booked })
}
