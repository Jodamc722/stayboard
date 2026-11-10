// /revenue/sales — THE SALES REPORT: what we booked today, this week and this month against last
// year and the budget, where it came from, which units are behind pace, and what was cancelled.
// Everything is keyed on the day a booking was MADE (lib/sales-report has the rules); Revenue Center
// next door is the stay-date view of the same reservations.
//
// THE SHELL RENDERS AT ONCE (2026-11-10). This page used to build the whole report before sending a
// byte — 3.9s and 230KB of HTML. It now only checks who is asking and draws the frame; the report
// arrives from /api/revenue/sales (ten-minute cache) behind a skeleton, the long lists on request.
//
// Gated like the Revenue tab — it sits under /revenue, so the `revenue` feature and the middleware
// cover it with no new permission to set, and the API checks the same level again. Dollars
// additionally need the money permission (lib/access canSeeMoney), applied in the API. Wrapped in
// <Shell> — a page without it is invisible.
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { SalesReport } from '@/components/SalesReport'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed || !atLeast(access.levels['revenue'], 'view')) redirect('/command')
  return (
    <Shell>
      <SalesReport />
    </Shell>
  )
}
