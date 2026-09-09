// COMMAND CENTER v4 (Jon, 2026-09-09: "cleaner and easier to read, get rid of noise and waste,
// an actionable page, clarity in the day. Think Recommendations, pending, completed. My tasks from
// all boards. In future important emails.") The page is a thin server shell: auth, the header, the
// client cockpit. Every number comes from /api/command/day, which reads the same lib/ops-day
// picture the board reads — so the cockpit and Today in Ops cannot disagree about the same morning.
//
// v3 → v4: the eight tiles became one strip; the single "Do next" list became Recommendations
// (the engine proposes, you commit) and Pending (in motion, follow it); My tasks (every Projects
// board) and Completed today joined on the right; the sticky Eve panel became one line — the
// floating Eve bubble is on every page. All of it lives in components/CommandCockpit.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CommandCockpit } from '@/components/CommandCockpit'
import { Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Shell>
      <header className="mb-4 hidden sm:block">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sparkles size={13} /> Command Center
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Command Center</h1>
      </header>
      <CommandCockpit />
    </Shell>
  )
}
