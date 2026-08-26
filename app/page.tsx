// THE APP LANDS ON THE WORK, NOT ON A DASHBOARD (Jon, 2026-08-24: "when you click into it, it
// should be Today in Ops — home page is a bust").
//
// This route used to render the KPI board: occupancy, ADR, RevPAR, review scores, listing health.
// Good numbers, wrong front door. Opening Lighthouse to a set of month-to-date averages tells you
// nothing you have to act on in the next hour, and on a phone it meant scrolling past a screen of
// figures to reach the thing you actually opened the app for. Today in Ops is what needs a person.
//
// The KPI board is NOT deleted — it moved to /kpi and keeps its `home` feature key, so every
// per-role permission already set against it carries over untouched.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function RootPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  redirect('/plan')
}
