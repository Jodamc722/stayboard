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
// that makes a scanner fail at a gate at 11pm. PNG, JPEG and PDF are stored byte for byte.
//
// Nothing else is accepted, and that is decided by the FIRST FOUR BYTES, not the filename — a
// check on the extension only ever meant "named PNG", which makes the bucket an arbitrary file
// drop for anybody holding the passcode.
import { NextRequest, NextResponse } from 'next/server'
import { parkingGate } from '@/lib/parking-gate'
import { buildParkingBoard, attachPermit, logParking, sniffMime, uploadsInLastHour, UPLOADS_PER_HOUR, writePermitToGuestyWithin } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * A QR is a few kilobytes; this is generous for a scan or a vendor's PDF. It is set BELOW the
 * platform's own 4.5MB request-body ceiling on purpose: an 8MB limit would have been a limit this
 * handler never got to enforce, so the vendor would have seen a raw platform error page instead of
 * a sentence telling them the file is too big.
 */
const MAX_BYTES = 4 * 1024 * 1024
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
  // THE DOOR BEFORE THE BODY. The passcode rides in a header rather than a form field so the gate
  // runs first: reading the multipart body buffers the whole upload in memory, and doing that
  // before checking who is asking means an anonymous caller with a wrong code can still make the
  // server hold their megabytes.
  const gate = await parkingGate(req, String(params.code || ''), String(req.headers.get('x-parking-pass') || ''))
  if (!gate.ok) return gate.res

  // A garage sends a handful of codes a day. Anything near this is somebody filling the bucket.
  if (await uploadsInLastHour(gate.link.code) >= UPLOADS_PER_HOUR) {
    return NextResponse.json({ ok: false, error: 'That is a lot of codes in one hour. Try again later.' }, { status: 429 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: false, error: 'Send the file as a form.' }, { status: 400 })

  // WHO SENT IT. There is no login behind this link, so an unattributed permit is a permit nobody
  // can ask about — the same rule the field board applies to a job filed from the floor.
  const who = String(form.get('who') || '').trim().slice(0, 60) || (gate.who || '')
  if (!who) return NextResponse.json({ ok: false, error: 'Add your name so we know who sent it.' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Attach the QR code.' }, { status: 400 })
  const named = mimeFor(file)
  if (!named) return NextResponse.json({ ok: false, error: 'PNG, JPG or PDF only.' }, { status: 415 })
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.length) return NextResponse.json({ ok: false, error: 'That file was empty.' }, { status: 400 })
  if (bytes.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That file is over 4MB.' }, { status: 413 })
  // THE BYTES DECIDE, NOT THE NAME. Trusting the extension made "PNG, JPG or PDF only" mean "named
  // PNG, JPG or PDF" and the bucket an arbitrary file store for anyone holding the passcode.
  const mime = sniffMime(bytes)
  if (!mime) return NextResponse.json({ ok: false, error: 'That does not look like a PNG, JPG or PDF.' }, { status: 415 })

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

  // MAP IT ONTO THE BOOKING (Jon: "we need to find a way to map that QR code to the reservation in
  // Guesty"). Deliberately AFTER the permit is safely stored and deliberately not able to fail the
  // upload: the vendor has the code in their hand now, and losing it because Guesty is rate-limited
  // would be the worst trade on this page. A failure is recorded on the row and retried later, and
  // the vendor is told plainly rather than shown a success that was only half true.
  let guesty: { ok: boolean; note: string } | null = null
  if (!spare) {
    guesty = await writePermitToGuestyWithin(res.id)
  }

  await logParking({
    code: gate.link.code, action: 'upload', ip: gate.ip,
    detail: (spare ? 'spare' : 'stay ' + reservationId + ' · ' + (stay?.unit || '')) + ' · by ' + who
      + (res.replaced ? ' · replaced an earlier permit' : '')
      + (guesty ? (guesty.ok ? ' · mapped in Guesty' : ' · Guesty write pending: ' + guesty.note) : ''),
  })
  return NextResponse.json({
    ok: true, id: res.id, replaced: res.replaced, spare,
    guesty: guesty ? { ok: guesty.ok, note: guesty.note } : null,
  })
}
