// The public side of a booking link (lib/booking). No sign-in: the link is the invitation.
//   GET  ?o=<owner code>                              → the type, who is booking (owner links), and every open time
//   POST { day, time, name, email, phone?, note?, o?, website } → books it: a calendar event, the guest invited
import { NextRequest, NextResponse } from 'next/server'
import { readBooking, openSlots, createBookingEvent, rateCheck, publicType, BOOKING_KEY } from '@/lib/booking'
import { setSetting } from '@/lib/app-settings'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { sendGmail } from '@/lib/gmail-send'
import { bookedSubject, bookedHtml } from '@/lib/booking-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const CODE = /^[a-f0-9]{10,40}$/i

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const st = await readBooking()
  const t = st.types.find(x => x.slug === params.slug && x.on)
  if (!t) return NextResponse.json({ ok: false, error: 'This booking link is not open.' }, { status: 404 })
  const code = String(req.nextUrl.searchParams.get('o') || '')
  const r = CODE.test(code) ? await readRecord(code).catch(() => null) : null
  const owner = r && !r.archived ? { name: String(r.custom.ownerName || ''), hasEmail: /@/.test(String(r.custom.ownerEmail || '')), booked: params.slug === 'onboarding-call' && r.call?.at ? r.call.at : '' } : null
  const s = await openSlots(t)
  return NextResponse.json({ ok: true, type: publicType(t), owner, days: s.days, ...(s.ok ? {} : { calendarDown: true }) })
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const st = await readBooking()
  const t = st.types.find(x => x.slug === params.slug && x.on)
  if (!t) return NextResponse.json({ ok: false, error: 'This booking link is not open.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  if (String(b?.website || '')) return NextResponse.json({ ok: true })                  // the trap field: a person never fills it
  const day = String(b?.day || ''), time = String(b?.time || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ ok: false, error: 'Pick a day and a time.' }, { status: 400 })
  const code = String(b?.o || '')
  const r = CODE.test(code) ? await readRecord(code).catch(() => null) : null
  const owner = r && !r.archived ? r : null
  // what they typed, else what the onboarding has on file
  const onFile = owner && /@/.test(String(owner.custom.ownerEmail || '')) ? String(owner.custom.ownerEmail).trim().toLowerCase() : ''
  const name = (String(b?.name || '').trim() || (owner ? String(owner.custom.ownerName || '') : '')).trim().slice(0, 80)
  const email = (String(b?.email || '').trim().toLowerCase() || onFile).slice(0, 120)
  if (!name) return NextResponse.json({ ok: false, error: 'Add your name.' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Add an email we can send the invitation to.' }, { status: 400 })
  const ip = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const why = rateCheck(st, ip)
  if (why) return NextResponse.json({ ok: false, error: why }, { status: 429 })
  // the time must still be open: someone else, or the host's own calendar, may have taken it since the page loaded
  const s = await openSlots(t, day)
  if (!s.ok) return NextResponse.json({ ok: false, error: 'The calendar is not answering right now. Please try again in a minute.' }, { status: 503 })
  if (!s.days[0]?.times.some(x => x.time === time)) return NextResponse.json({ ok: false, error: 'That time was just taken. Please pick another.', taken: true }, { status: 409 })
  const isCall = t.slug === 'onboarding-call'
  const place = owner ? [owner.home?.address, owner.home?.unit ? 'Unit ' + owner.home.unit : ''].filter(Boolean).join(', ') : ''
  const ev = await createBookingEvent(t, { day, time, name, email, phone: String(b?.phone || '').slice(0, 40), note: String(b?.note || '').slice(0, 500), place, ref: (owner?.code || 'pub') + '-' + t.slug,
    also: owner ? [onFile, ...(owner.owners || []).map((x: any) => String(x?.email || ''))] : [], moveEventId: owner && isCall ? owner.call?.eventId : undefined })
  if (!ev.ok) return NextResponse.json({ ok: false, error: ev.error }, { status: 502 })
  // THE HOST IS TOLD (Jon, 2026-11-24: "please make sure I get email of confirmation of a time booked").
  // Google emails the guest the invitation but tells the organizer nothing, so a booking used to arrive
  // silently on the calendar. One email to the host, from their own mailbox. Never fails the booking.
  const phone = String(b?.phone || '').slice(0, 40), note = String(b?.note || '').slice(0, 500)
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const mail = { title: t.title, guest: name, email, phone, note, day, time, minutes: t.minutes, where: t.where, link: ev.link, place, eventUrl: ev.eventUrl, moved: !!(owner && isCall && owner.call?.eventId), ownerUrl: owner ? base + '/owner-onboarding/' + owner.code : '' }
  await sendGmail({ fromEmail: t.host, to: [t.host], subject: bookedSubject(mail), html: bookedHtml(mail), source: 'booking-link' }).catch(() => null)
  if (owner) {
    // on the owner's onboarding: the call record the desk and their timeline already read
    if (isCall) {
      owner.call = { at: day + 'T' + time, link: ev.link || owner.call?.link || '', note: String(b?.note || owner.call?.note || '').slice(0, 500), minutes: t.minutes, eventId: ev.eventId, eventUrl: ev.eventUrl, host: t.host }
      const stp = owner.steps.find(x => x.key === 'call'); if (stp && stp.status === 'todo') { stp.status = 'doing'; stp.date = day }
    }
    ;(owner as any).bookings = [{ at: new Date().toISOString(), slug: t.slug, title: t.title, when: day + 'T' + time, eventUrl: ev.eventUrl || '' }, ...(((owner as any).bookings || []) as any[])].slice(0, 20)
    await saveRecord(owner, 'booking link').catch(() => {})
  }
  st.log = [{ at: new Date().toISOString(), slug: t.slug, day, time, name, email, ...(owner ? { code: owner.code } : {}), eventUrl: ev.eventUrl }, ...st.log].slice(0, 200)
  await setSetting(BOOKING_KEY, st, 'booking link').catch(() => {})
  return NextResponse.json({ ok: true, booked: { day, time, minutes: t.minutes, link: t.where === 'meet' ? ev.link || '' : '', email } })
}
