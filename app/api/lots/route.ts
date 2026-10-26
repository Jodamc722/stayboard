// PARKING — the tab's API (Jon, 2026-10-26). Feature key `parking`: view reads the calendar, edit
// books / moves / pays / flags / notifies, full changes the lot (price, spots, tow company, link).
//
//   GET  ?lot=<id>&from=&to=            the bundle for one lot (or, with no lot, the list of lots)
//   GET  ?lot=<id>&stays=<q>&from=&to=  stays at the building to attach a booking to
//   GET  ?lot=<id>&plate=<p>&spot=<id>  judge a plate (the "check a plate" box)
//   POST { action, ... }                see the switch below
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { isYmd, addDays } from '@/lib/plate'
import {
  listLots, lotBundle, lotById, createLot, updateLot, updateSpot, addSpot, buildingsWithoutLot,
  staysForBuilding, inHouseStays, createBooking, updateBooking, deleteBooking, suggestSpot, judgePlate,
  openIncident, incidentById, noticeTextFor, sendNotice, draftTowEmail, closeIncident, noteIncident,
  storePhoto, readPlateFromPhoto, ymdET,
} from '@/lib/parking-lots'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const lvl = (g: any) => String(g.access.levels['parking'] || (g.access.role === 'admin' ? 'full' : 'off'))
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })

export async function GET(req: NextRequest) {
  const gate = await requireLevel('parking', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const lotId = String(sp.get('lot') || '')
  const level = lvl(gate)
  const can = { edit: level === 'edit' || level === 'full' || gate.access.role === 'admin', full: level === 'full' || gate.access.role === 'admin' }
  try {
    if (!lotId) {
      const lots = await listLots()
      return NextResponse.json({ ok: true, lots, can, today: ymdET(), buildings: can.full ? await buildingsWithoutLot() : [] })
    }
    const lot = await lotById(lotId)
    if (!lot) return bad('That lot does not exist.', 404)
    const today = ymdET()
    const from = isYmd(sp.get('from')) ? String(sp.get('from')) : addDays(today, -7)
    const to = isYmd(sp.get('to')) ? String(sp.get('to')) : addDays(today, 60)
    if (sp.has('stays')) {
      const stays = await staysForBuilding(lot.building, from, to, String(sp.get('stays') || ''))
      return NextResponse.json({ ok: true, stays: stays.slice(0, 60) })
    }
    if (sp.has('plate')) {
      const v = await judgePlate(lot.id, String(sp.get('plate') || ''), sp.get('spot') || null, isYmd(sp.get('date')) ? String(sp.get('date')) : today)
      return NextResponse.json({ ok: true, ...v })
    }
    if (sp.has('inhouse')) {
      const stays = await inHouseStays(lot.building, today)
      return NextResponse.json({ ok: true, stays: stays.map(s => ({ id: s.id, guest: s.guest, unit: s.unit, canMessage: !!s.conversationId })) })
    }
    const bundle = await lotBundle(lot.id, from, to)
    const lots = await listLots()
    return NextResponse.json({ ok: true, ...bundle, from, to, lots, can, buildings: can.full ? await buildingsWithoutLot() : [] })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const needsFull = ['lot.create', 'lot.update', 'spot.update', 'spot.add', 'booking.delete'].indexOf(action) >= 0
  const gate = await requireLevel('parking', needsFull ? 'full' : 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  try {
    switch (action) {
      case 'lot.create': {
        const r = await createLot({ building: String(body.building || ''), name: body.name, sell: Number(body.sell), hold: Number(body.hold), rateCents: Number(body.rateCents), by })
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'lot.update': {
        const r = await updateLot(String(body.lotId || ''), body.patch || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'spot.update': {
        const r = await updateSpot(String(body.spotId || ''), body.patch || {})
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'spot.add': {
        const r = await addSpot(String(body.lotId || ''), body.kind === 'hold' ? 'hold' : 'sell', body.label)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.suggest': {
        const s = await suggestSpot(String(body.lotId || ''), String(body.startsOn || ''), String(body.endsOn || ''), body.kind || 'guest', body.exceptId)
        return NextResponse.json({ ok: true, spot: s })
      }
      case 'booking.create': {
        const r = await createBooking({ ...body, lotId: String(body.lotId || '') }, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.update': {
        const r = await updateBooking(String(body.bookingId || ''), body.patch || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.delete': {
        const r = await deleteBooking(String(body.bookingId || ''))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.open': {
        // A car flagged by hand from the tab (no sweep): plate, car, where.
        const lotId = String(body.lotId || '')
        let photoPath: string | null = null
        if (body.photo) { const p = await storePhoto(lotId, String(body.photo), String(body.photoMime || 'image/jpeg')); if (p.ok) photoPath = p.path || null }
        const inc = await openIncident({ lotId, spotId: body.spotId || null, spotLabel: body.spotLabel || null, kind: body.kind || 'unregistered', bookingId: body.bookingId || null, plate: body.plate, plateState: body.plateState, make: body.make, model: body.model, color: body.color, photoPath, seenBy: by, notes: body.notes })
        return inc ? NextResponse.json({ ok: true, incident: inc }) : bad('Could not save the flag.')
      }
      case 'incident.noticeText': {
        const inc = await incidentById(String(body.incidentId || ''))
        const lot = inc ? await lotById(inc.lotId) : null
        if (!inc || !lot) return bad('That flag is gone.', 404)
        const stays = await inHouseStays(lot.building, ymdET())
        return NextResponse.json({ ok: true, text: inc.noticeText || noticeTextFor(lot, inc, new Date(Date.now() + lot.noticeMinutes * 60000)), recipients: stays.filter(s => s.conversationId).length, inHouse: stays.length })
      }
      case 'incident.notify': {
        const r = await sendNotice(String(body.incidentId || ''), String(body.text || ''), by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.tow': {
        const r = await draftTowEmail(String(body.incidentId || ''), by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.close': {
        const how = String(body.how || '')
        if (['towed', 'resolved', 'dismissed', 'reopen'].indexOf(how) < 0) return bad('how?')
        const inc = await closeIncident(String(body.incidentId || ''), how as any, by, body.resolution)
        return inc ? NextResponse.json({ ok: true, incident: inc }) : bad('Could not update the flag.')
      }
      case 'incident.note': {
        const inc = await noteIncident(String(body.incidentId || ''), String(body.notes || ''))
        return inc ? NextResponse.json({ ok: true, incident: inc }) : bad('Could not save the note.')
      }
      case 'plate.read': {
        const r = await readPlateFromPhoto(String(body.photo || ''), String(body.photoMime || 'image/jpeg'))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
