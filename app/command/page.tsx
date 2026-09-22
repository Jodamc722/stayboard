// COMMAND CENTER v5 — "My day, one screen" (Jon, 2026-09-18: v4 was "not actionable enough,
// wrong content/noise, visual/layout bad, rethink from scratch"). Everything that needs Jon today,
// ranked, in four bands — Decide · Fix · Clear · Yours — each row with its one-tap action.
//
// A thin server shell: auth and the client list. Every number comes from /api/command/day, which
// reads the same lib/ops-day picture the board reads, so the list and Today in Ops cannot disagree.
// The one-line header (title + verdict pill) lives in components/CommandDayList because it needs
// the data; the v4 sub-components it reuses stay in components/CommandCockpit.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CommandDayList } from '@/components/CommandDayList'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Shell>
      <CommandDayList />
    </Shell>
  )
}
