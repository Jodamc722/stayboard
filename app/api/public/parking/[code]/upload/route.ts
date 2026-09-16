// UPLOAD A QR — the thing the vendor actually came here to do.
//
//   POST multipart { pass, file, who, label?, reservationId? | spare=1 }
//
// Two shapes, one route:
//   • with a reservationId — the permit is bound to that stay
//   • with spare=1         — the permit goes in the pool, for the weekend a guest books late and
//                            the vendor is not working (Jon's own reason for the pool)
//
// ── THE SCOPE GUARD ─────────────────────────────────────────────────────────────────────────────
// The code is the capability and it grants exactly the stays this link covers, never the
// portfolio. So the board is rebuilt and the reservation must be ON it. Its unit, dates and name
// are taken from the board too, not from the request — a caller does not get to decide which stay
// their upload is filed against, or what it is called.
//
// ── WHY THE BYTES ARE NOT RE-ENCODED ────────────────────────────────────────────────────────────
// Every other upload route in this app pushes images through sharp at quality 82. A QR code is a
// machine-readable credential and JPEG ringing around high-contrast modules is exactly the thing
// that makes a scanner fail at a gate at 11pm. PNG, JPEG and PDF are stored byte for byte; nothing
// else is accepted, because a .html "permit" is how phishing gets into a shared drive.
import { NextRequest, NextResponse } from 'next/server'
import { parkingGate } from '@/lib/parking-gate'
import { buildParkingBoard, attachPermit, logParking } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A QR is a few kilobytes. This is generous for a scan or a vendor's PDF, and far below a photo. */
const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'application/pdf': 'pdf',
}
/** Browsers sometimes send application/octet-stream for a perfectly good PNG. Fall back to the name. */
function mimeFor(f: File): string | null {
  const t = String(f.type || '').toLowerCase()
  if (ALLOWED[t]) return t === 'image/jpg' ? 'image/jpeg' : t
  const n = String(f.name || '').toLowerCase()
  if (/\.png$/.test(n)) return 'image/png'
  if (/\.jpe?g$/.test(n)) return 'image/jpeg'
  if (/\.pdf$/.test(n)) return 'application/pdf'
  return null
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: false, error: 'Send the file as a form.' }, { status: 400 })

  const gate = await parkingGate(req, String(params.code || ''), String(form.get('pass') || ''))
  if (!gate.ok) return gate.res

  // WHO SENT IT. There is no login behind this link, so an unattributed permit is a permit nobody
  // can ask about — the same rule the field board applies to a job filed from the floor.
  const who = String(form.get('who') || '').trim().slice(0, 60) || (gate.who || '')
  if (!who) return NextResponse.json({ ok: false, error: 'Add your name so we know who sent it.' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Attach the QR code.' }, { status: 400 })
  const mime = mimeFor(file)
  if (!mime) return NextResponse.json({ ok: false, error: 'PNG, JPG or PDF only.' }, { status: 415 })
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.length) return NextResponse.json({ ok: false, error: 'That file was empty.' }, { status: 400 })
  if (bytes.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That file is over 8MB.' }, { status: 413 })

  const label = String(form.get('label') || '').trim().slice(0, 80) || null
  const spare = String(form.get('spare') || '') === '1'
  const reservationId = String(form.get('reservationId') || '').trim()
  if (!spare && !reservationId) return NextResponse.json({ ok: false, error: 'Pick a stay, or send it to the spare pool.' }, { status: 400 })

  const board = await buildParkingBoard(gate.link)

  let stay: { reservationId: string; listingId: string; unit: string; checkIn: string; checkOut: string } | undefined
  if (!spare) {
    const row = board.rows.find(r => r.reservationId === reservationId)
    if (!row) return NextResponse.json({ ok: false, error: 'That stay is not on this link.' }, { status: 403 })
    stay = { reservationId: row.reservationId, listingId: row.listingId, unit: row.unit, checkIn: row.checkIn, checkOut: row.checkOut }
  }

  const res = await attachPermit({
    link: gate.link, building: board.building, bytes, mime, label, who, stay,
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 })

  await logParking({
    code: gate.link.code, action: 'upload', ip: gate.ip,
    detail: (spare ? 'spare' : 'stay ' + reservationId + ' · ' + (stay?.unit || '')) + ' · by ' + who + (res.replaced ? ' · replaced an earlier permit' : ''),
  })
  return NextResponse.json({ ok: true, id: res.id, replaced: res.replaced, spare })
}
