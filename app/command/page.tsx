// COMMAND CENTER v5 — "My day, one screen" (Jon, 2026-09-18: v4 was "not actionable enough,
// wrong content/noise, visual/layout bad, rethink from scratch"). Everything that needs Jon today,
// ranked, in four bands — Decide · Fix · Clear · Yours — each row with its one-tap action. Nothing
// informational above the list; the numbers live behind "How's the day".
//
// The page is a thin server shell: auth, an eyebrow, the client list. Every number comes from
// /api/command/day, which reads the same lib/ops-day picture the board reads — so the list and
// Today in Ops cannot disagree about the same morning. The day verdict IS the header, so there is
// no h1. All of it lives in components/CommandDayList; the v4 sub-components it reuses (the stat
// strip, the tile drawers, inline assign, Completed) stay in components/CommandCockpit.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CommandDayList } from '@/components/CommandDayList'
import { Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Shell>
      <p className="max-w-[760px] mx-auto mb-2 text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
        <Sparkles size={13} /> Command Center
      </p>
      <CommandDayList />
    </Shell>
  )
}
