// New Salato bookings by email, by hand (lib/salato-new-bookings.ts). It runs on its own after every
// booking sync; this is for checking it.
//   GET            → dry run: what it would send right now, nothing sent
//   GET ?preview=1 → the email as it looks, with the next stays as sample rows
//   POST           → run it now
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { runSalatoNewBookingEmail, newBookingsEmail } from '@/lib/salato-new-bookings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('salato', 'view')
  if (!gate.ok) return gate.res
  if (req.nextUrl.searchParams.get('preview') === '1') {
    const { html } = newBookingsEmail([{ id: 'x', unit: 'Salato 602', guest: 'Sample Guest', ci: '2026-11-03', co: '2026-11-06', nights: 3, guests: 2, source: 'Airbnb', code: 'HM123SAMPLE' }])
    return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return NextResponse.json(await runSalatoNewBookingEmail({ dryRun: true }))
}

export async function POST() {
  const gate = await requireLevel('salato', 'edit')
  if (!gate.ok) return gate.res
  return NextResponse.json(await runSalatoNewBookingEmail())
}
