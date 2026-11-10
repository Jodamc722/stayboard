// THE STAFF SIDE OF A LOT (Jon, 2026-10-26: "a link we can share with our staff to check / scan car
// plates and flag unregistered cars"). Public by design: the lot's share code is the only key and
// everything here is scoped to that one lot. Nothing on this route can list lots, read a folio or
// open a reservation; guests appear as a first name and a unit, which is what the person standing
// in the lot needs to knock on a door.
//
//   GET  (passcode in the x-lot-pass header; ?pass= still answers for a page loaded before the change)
//                                       today's lot: spots with the car expected in each, open flags, today's sweep
//   POST { pass, action, name, ... }    plate.judge · plate.read · sweep.start · sweep.check · sweep.finish ·
//                                       incident.open · incident.noticeText · incident.notify · incident.tow · incident.close
import { NextRequest, NextResponse } from 'next/server'
import {
  resolveStaffCode, lotToday, expectedAt, judgePlate, readPlateFromPhoto, storePhoto, startSweep, recordCheck, finishSweep, sweepById,
  openIncident, incidentById, checkNoticeText, checkGroup, updateIncidentCar, sendNotice, draftTowEmail, closeIncident, inHouseStays, signedPhotoUrl, ymdET,
  createBooking, updateBooking, bookingById,
  type SweepCheck,
} from '@/lib/parking-lots'
import { tidyPlate, normalizePlate } from '@/lib/plate'
import { logParking, lockoutReason, LOCKOUT_MINUTES } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
// Case-insensitive on purpose: phones capitalise the first letter, and "Eden!" typed as "EDEN!" is the same person.
const passOk = (lot: { passcode: string | null }, given: string) => !lot.passcode || String(given || '').trim().toLowerCase() === String(lot.passcode).trim().toLowerCase()
// WRONG PASSCODES ARE COUNTED (2026-11-09 audit: this door had no limit at all, so the passcode could
// be guessed at request speed). Same log and same window the garage link uses: eight misses from one
// address in fifteen minutes and that address waits. Only the address's own misses lock it — a
// stranger hammering the link cannot lock the team out. A counting failure never blocks anyone.
const ipOf = (req: NextRequest) => String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || null
const okLately = new Map<string, number>()
async function passProblem(req: NextRequest, code: string, lot: { passcode: string | null }, given: string): Promise<{ status: number; error: string | null } | null> {
  if (!lot.passcode) return null
  const key = 'lot:' + String(code).slice(0, 40)
  const ip = ipOf(req)
  // A phone that gave the right passcode a moment ago is not counted again on every tap of the walk.
  const seen = key + '|' + (ip || '')
  const right = passOk(lot, given)
  if (right && (okLately.get(seen) || 0) > Date.now()) return null
  if ((await lockoutReason(key, ip)) === 'ip') return { status: 429, error: `Too many wrong passcodes. Try again in ${LOCKOUT_MINUTES} minutes.` }
  if (right) {
    if (okLately.size > 500) okLately.clear()
    okLately.set(seen, Date.now() + 2 * 60 * 1000)
    return null
  }
  // An empty passcode is somebody arriving at the page, not a wrong guess.
  if (String(given || '').trim()) await logParking({ code: key, action: 'denied', detail: 'lot link · wrong passcode', ip })
  return { status: 403, error: String(given || '').trim() ? 'That passcode is not right.' : null }
}
// The staff name travels with every write, so the record says who stood in the lot.
const byOf = (name: any) => (String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'staff') + ' (lot link)'

// What the phone needs to know about a lot — never the tow email, never the passcode.
const lotInfo = (l: { id: string; name: string; building: string; rules: string | null; rateCents: number; currency: string; noticeMinutes: number; towEmail: string | null; towCompany: string | null; towPhone: string | null }) =>
  ({ id: l.id, name: l.name, building: l.building, rules: l.rules, rateCents: l.rateCents, currency: l.currency, noticeMinutes: l.noticeMinutes, hasTow: !!l.towEmail, towCompany: l.towCompany, towPhone: l.towPhone })

// ONE LINK, EVERY LOT (Jon, 2026-10-29: "same scan link, just drop down for property"). The all-lots
// code answers with the list of properties; `lot=` (GET) / `lotId` (POST) says which one the phone is
// working. A lot's own code still opens that lot alone.
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const r = await resolveStaffCode(params.code, req.nextUrl.searchParams.get('lot'))
  if (!r) return bad('This lot link is not valid.', 404)
  const label = r.kind === 'lot' ? r.lot.name : 'Parking'
  const given = String(req.headers.get('x-lot-pass') || req.nextUrl.searchParams.get('pass') || '')
  const denied = await passProblem(req, params.code, r, given)
  // 200 on purpose: the phone reads this as "show the passcode box", with the reason when there is one.
  if (denied) return NextResponse.json({ ok: false, needsPasscode: true, label, error: denied.error || undefined })
  const lots = r.kind === 'all' ? r.lots.map(lotInfo) : [lotInfo(r.lot)]
  if (!r.lot) return NextResponse.json({ ok: true, all: true, lots, lot: null })
  const t = await lotToday(r.lot, ymdET())
  return NextResponse.json({ ok: true, all: r.kind === 'all', lots, lot: lotInfo(r.lot), ...t })
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  const r = await resolveStaffCode(params.code, body?.lotId)
  if (!r) return bad('This lot link is not valid.', 404)
  const denied = await passProblem(req, params.code, r, String(body?.pass || ''))
  if (denied) return bad(denied.error || 'This lot link needs its passcode — reload the page.', denied.status)
  if (!r.lot) return bad('Pick a property first.')
  const lot = r.lot
  const by = byOf(body?.name)
  const action = String(body?.action || '')
  const today = ymdET()
  try {
    switch (action) {
      case 'plate.judge': {
        const v = await judgePlate(lot.id, String(body.plate || ''), body.spotId || null, today)
        return NextResponse.json({ ok: true, ...v })
      }
      case 'plate.read': {
        const r = await readPlateFromPhoto(String(body.photo || ''), String(body.photoMime || 'image/jpeg'))
        if (!r.ok) return NextResponse.json(r, { status: 400 })
        // Judge it in the same breath so the phone gets one answer.
        const v = r.read?.plate ? await judgePlate(lot.id, r.read.plate, body.spotId || null, today) : null
        return NextResponse.json({ ok: true, read: r.read, judged: v })
      }
      case 'sweep.start': {
        const open = body.sweepId ? await sweepById(String(body.sweepId)) : null
        if (open && !open.finishedAt && open.lotId === lot.id) return NextResponse.json({ ok: true, sweep: open })
        const sw = await startSweep(lot.id, String(body.name || ''))
        return sw ? NextResponse.json({ ok: true, sweep: sw }) : bad('Could not start the lot check.')
      }
      case 'sweep.check': {
        const sw = await sweepById(String(body.sweepId || ''))
        if (!sw || sw.lotId !== lot.id) return bad('That lot check is not on this lot.', 404)
        if (sw.finishedAt) return bad('That lot check is already finished — start a new one.')
        const result = String(body.result || '') as SweepCheck['result']
        if (['match', 'empty', 'other', 'extra'].indexOf(result) < 0) return bad('result?')
        const spotId = body.spotId ? String(body.spotId) : null
        const label = body.label ? String(body.label).slice(0, 12) : null
        let photoPath: string | null = null
        if (body.photo) { const p = await storePhoto(lot.id, String(body.photo), String(body.photoMime || 'image/jpeg')); if (p.ok) photoPath = p.path || null }
        let check: Omit<SweepCheck, 'at'>
        if (result === 'empty') {
          check = { spotId, label, result, plate: null, plateNorm: null, make: null, model: null, color: null, verdict: 'empty', bookingId: null, belongsIn: null, photoPath }
        } else if (result === 'match') {
          // "The car here is the one we expected": the expected booking's plate is the plate.
          // One small read. This used to rebuild the whole page's data (stays, flags, photos) on
          // every "As expected" tap, which is the tap the walk is made of.
          const exp = await expectedAt(lot.id, spotId, today)
          if (!exp) return bad('No car is expected in that spot any more — reload, or use the camera button and give the plate.')
          check = { spotId, label, result, plate: exp?.plate || null, plateNorm: exp?.plateNorm || null, make: exp?.make || null, model: exp?.model || null, color: exp?.color || null, verdict: exp && exp.endsOn === today ? 'leaving_today' : 'ok', bookingId: exp?.id || null, belongsIn: label, photoPath }
        } else {
          const plate = tidyPlate(body.plate)
          if (!normalizePlate(plate)) return bad('Type or scan the plate first.')
          const v = await judgePlate(lot.id, plate, spotId, today)
          check = { spotId, label, result, plate: v.plate, plateNorm: v.plateNorm, make: body.make ? String(body.make).slice(0, 60) : v.booking?.make || null, model: body.model ? String(body.model).slice(0, 60) : v.booking?.model || null, color: body.color ? String(body.color).slice(0, 40) : v.booking?.color || null, verdict: v.verdict, bookingId: v.booking?.id || null, belongsIn: v.belongsIn?.label || null, photoPath }
          const saved = await recordCheck(sw.id, check)
          return saved ? NextResponse.json({ ok: true, sweep: saved, check, judged: v }) : bad('Could not save that check.')
        }
        const saved = await recordCheck(sw.id, check)
        return saved ? NextResponse.json({ ok: true, sweep: saved, check }) : bad('Could not save that check.')
      }
      case 'sweep.finish': {
        const sw = await sweepById(String(body.sweepId || ''))
        if (!sw || sw.lotId !== lot.id) return bad('That lot check is not on this lot.', 404)
        const r = await finishSweep(sw.id, String(body.name || ''))
        if (!r) return bad('Could not finish the lot check.')
        const incidents = await Promise.all(r.incidents.map(async i => (i.photoPath ? { ...i, photoUrl: await signedPhotoUrl(i.photoPath, 900) } : i)))
        return NextResponse.json({ ok: true, sweep: r.sweep, incidents })
      }
      // THE FIELD TEAM MANAGES THE LOT FROM HERE (Jon, 2026-10-26: "show active parking reservations
      // so our field team can manage and scan licence plate numbers"). Register a car to a stay,
      // mark it parked / left / paid, fix a plate. Same engine and same rules as the office tab
      // (held spots never sold, one car per spot per night); the staff name travels with it.
      case 'booking.create': {
        const r = await createBooking({
          lotId: lot.id, spotId: body.spotId || null, kind: body.kind || 'guest',
          reservationId: body.reservationId || null, listingId: body.listingId || null, unit: body.unit || null, guestName: body.guestName || null,
          startsOn: String(body.startsOn || today), endsOn: String(body.endsOn || ''),
          plate: body.plate, plateState: body.plateState, make: body.make, model: body.model, color: body.color,
          amountCents: body.amountCents, paid: body.paid, paidVia: body.paidVia, notes: body.notes, status: body.status === 'parked' ? 'parked' : 'reserved',
        }, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.update': {
        const b = await bookingById(String(body.bookingId || ''))
        if (!b || b.lotId !== lot.id) return bad('That booking is not on this lot.', 404)
        // Only the fields a person in the lot has reason to change.
        const allowed = ['status', 'paid', 'paidVia', 'plate', 'plateState', 'make', 'model', 'color', 'spotId', 'startsOn', 'endsOn', 'notes']
        const patch: Record<string, any> = {}
        for (const k of allowed) if (body.patch && k in body.patch) patch[k] = body.patch[k]
        const r = await updateBooking(b.id, patch, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.open': {
        let photoPath: string | null = null
        let photoError: string | null = null
        if (body.photo) { const p = await storePhoto(lot.id, String(body.photo), String(body.photoMime || 'image/jpeg')); if (p.ok) photoPath = p.path || null; else photoError = p.error || 'The photo could not be saved.' }
        const inc = await openIncident({ lotId: lot.id, spotId: body.spotId || null, spotLabel: body.spotLabel || null, kind: ['unregistered', 'wrong_spot', 'staff_in_sell', 'blocking', 'other'].indexOf(body.kind) >= 0 ? body.kind : 'unregistered', bookingId: body.bookingId || null, plate: body.plate, plateState: body.plateState, make: body.make, model: body.model, color: body.color, photoPath, seenBy: by, notes: body.notes })
        return inc ? NextResponse.json({ ok: true, incident: inc, photoError }) : bad('Could not save the flag.')
      }
      case 'incident.car': {
        const inc = await incidentById(String(body.incidentId || ''))
        if (!inc || inc.lotId !== lot.id) return bad('That flag is not on this lot.', 404)
        if (![body.make, body.model, body.color].every(v => String(v || '').trim())) return bad('Colour, make and model are all needed.')
        const out = await updateIncidentCar(inc.id, { make: body.make, model: body.model, color: body.color, plateState: body.plateState })
        return out ? NextResponse.json({ ok: true, incident: out.photoPath ? { ...out, photoUrl: await signedPhotoUrl(out.photoPath, 900) } : out }) : bad('Could not save the car.')
      }
      case 'incident.noticeText': {
        const inc = await incidentById(String(body.incidentId || ''))
        if (!inc || inc.lotId !== lot.id) return bad('That flag is not on this lot.', 404)
        const stays = await inHouseStays(lot.building, today)
        // One notice for every car flagged in this check (lib/parking-lots checkGroup), deadline from now.
        const group = inc.noticeSentAt ? [inc] : await checkGroup(inc)
        const due = new Date(Date.now() + lot.noticeMinutes * 60000)
        const text = inc.noticeSentAt && inc.noticeText ? inc.noticeText : checkNoticeText(lot, group, due)
        return NextResponse.json({ ok: true, text, group: group.map(g => ({ id: g.id, plate: g.plate, car: [g.color, g.make, g.model].filter(Boolean).join(' ') || 'Vehicle', spot: g.spotLabel })), recipients: stays.filter(s => s.conversationId).length, inHouse: stays.length })
      }
      case 'incident.notify': {
        const inc = await incidentById(String(body.incidentId || ''))
        if (!inc || inc.lotId !== lot.id) return bad('That flag is not on this lot.', 404)
        const r = await sendNotice(inc.id, String(body.text || ''), by, Array.isArray(body.groupIds) ? body.groupIds.map(String) : [])
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.tow': {
        const inc = await incidentById(String(body.incidentId || ''))
        if (!inc || inc.lotId !== lot.id) return bad('That flag is not on this lot.', 404)
        const r = await draftTowEmail(inc.id, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.close': {
        const inc = await incidentById(String(body.incidentId || ''))
        if (!inc || inc.lotId !== lot.id) return bad('That flag is not on this lot.', 404)
        const how = String(body.how || '')
        if (['towed', 'resolved', 'dismissed'].indexOf(how) < 0) return bad('how?')
        const out = await closeIncident(inc.id, how as any, by, body.resolution)
        return out ? NextResponse.json({ ok: true, incident: out }) : bad('Could not update the flag.')
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
