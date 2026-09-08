// PROJECTS — the ops team's board for work that is not a task.
//
// Server component so the permission level is resolved before anything renders: view can read the
// board, edit can move cards and log spend, full can archive. The board itself is a client
// component because it is drag-and-drop.
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { ProjectBoard } from '@/components/ProjectBoard'
import { KanbanSquare, ListChecks } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = access.levels['projects']
  if (!atLeast(level, 'view')) redirect('/no-access')

  return (
    <Shell>
      {/* <header> rather than <div>: globals §9 clamps a page description to two lines on a phone
          via `main header h1 + p`, and this block is exactly that block. Desktop is unchanged. */}
      <header className="mb-3">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted inline-flex items-center gap-1.5">
          <KanbanSquare size={12} /> Operations
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Projects</h1>
          <Link href="/projects/mine" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1 text-[12px] font-bold text-muted hover:text-ink">
            <ListChecks size={12} /> My Tasks
          </Link>
        </div>
        <p className="text-[13px] text-muted mt-0.5 max-w-3xl">
          The work that does not fit a task — renovations, rollouts across a building, onboarding a new
          property, anything that runs for weeks and needs someone to own it. Day-to-day jobs stay in
          Today in Ops.
        </p>
      </header>
      <ProjectBoard
        canEdit={atLeast(level, 'edit')}
        canFull={atLeast(level, 'full')}
        me={access.email || ''}
      />
    </Shell>
  )
}
