// RETRY THE PERMIT -> GUESTY WRITES THAT DID NOT LAND.
//
// The vendor's upload route stores the QR and then tries to write /permit/<token> onto the
// reservation. That write is deliberately not allowed to fail — or even to delay — an upload:
// Guesty being slow or rate-limited must never cost us a code somebody is holding. This is the
// other half of that promise. Without it, a permit that missed once stays missing forever and the
// board's "we will retry" is a lie.
//
// AUTHORISED AND THROTTLED, for the reason lib/cron-auth spells out: this job spends a METERED
// third-party resource — up to twenty Guesty reads and twenty Guesty writes per run — and an open
// URL that costs money each time it is fetched is a bill waiting to happen. Left bare, a loop of
// curls from anywhere on the internet would 429 the shared Guesty token and take the booking feed,
// the door codes and the guest-order links down with it, while re-PUTting the custom-field array
// of live reservations on every pass.
import { NextRequest, NextResponse } from 'next/server'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { retryPendingGuestyWrites } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const allow = cronAllowed(req)
  if (!allow.ok) return NextResponse.json({ ok: false, error: 'not authorised' }, { status: 401 })
  // With no CRON_SECRET set, anyone can reach this URL — so the ledger is the ceiling. The worst an
  // anonymous caller achieves is the run that was about to happen anyway.
  if (!allow.viaSecret) {
    const skip = await tooSoon('parking-guesty', 45)
    if (skip) return NextResponse.json({ ok: true, ...skip })
  }
  const started = Date.now()
  try {
    const r = await retryPendingGuestyWrites(20)
    await recordRun({ name: 'parking-guesty', ok: true, itemCount: r.ok, detail: r, ms: Date.now() - started })
    return NextResponse.json({ ok: true, tried: r.tried, written: r.ok, errors: r.errors })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    await recordRun({ name: 'parking-guesty', ok: false, detail: { error: msg }, ms: Date.now() - started })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
