// /revenue/sales — THE SALES REPORT: what we booked today, this week and this month against last
// year and the budget, where it came from, which units are behind pace, and what was cancelled.
// Everything is keyed on the day a booking was MADE (lib/sales-report has the rules); Revenue Center
// next door is the stay-date view of the same reservations.
//
// Gated like the Revenue tab — it sits under /revenue, so the `revenue` feature and the middleware
// cover it with no new permission to set. Dollars additionally need the money permission
// (lib/access canSeeMoney): without it the same page shows bookings and nights, and the amounts are
// zeroed on the server. Wrapped in <Shell> — a page without it is invisible.
import { redirect } from 'next/navigation'
import { getAccess, canSeeMoney } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { SalesReport } from '@/components/SalesReport'
import { buildSalesReport, withoutMoney, type SalesReport as Report } from '@/lib/sales-report'

export const dynamic = 'force-dynamic'
// Seven paged reads over two years of bookings on a cold cache.
export const maxDuration = 60

export default async function SalesPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed || !atLeast(access.levels['revenue'], 'view')) redirect('/command')

  let data: Report | null = null
  let error = ''
  try {
    const full = await buildSalesReport()
    data = canSeeMoney(access) ? full : withoutMoney(full)
  } catch (e: any) {
    error = String((e && e.message) || e).slice(0, 200)
  }
  // Formatted here, not in the browser: the server and the client can print a time differently,
  // and a label that differs between the two is a hydration error.
  const asOfLabel = data
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(data.generatedAt)).replace(/ /g, ' ') + ' ET'
    : ''

  return (
    <Shell>
      <SalesReport data={data} asOfLabel={asOfLabel} error={error || undefined} />
    </Shell>
  )
}
