// Money → Revenue App. The boss's revenue app (Netlify DRR) framed inside Lighthouse, so the
// team can move between the two without leaving the sidebar (Jon, 2026-09-25).
//
// The app keeps its own login: the frame shows whatever the browser is signed into over there.
// If the site ever refuses to be framed (an X-Frame-Options header on their side), the frame goes
// blank and the "Open in a new tab" button is the way through — it is always in the header.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { RevenueAppFrame } from '@/components/RevenueAppFrame'

export const dynamic = 'force-dynamic'
const REVENUE_APP_URL = 'https://stay-hospitalitydrr.netlify.app/'

export default async function RevenueAppPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell full>
      <RevenueAppFrame url={REVENUE_APP_URL} />
    </Shell>
  )
}
