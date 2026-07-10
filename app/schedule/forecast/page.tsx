// The weekly planner now lives inside the Turnover Schedule one-pager (Weekly planner tab).
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ForecastRedirect() {
  redirect('/schedule?tab=weekly')
}
