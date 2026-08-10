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
import { KanbanSquare } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = access.levels['projects']
  if (!atLeast(level, 'view')) redirect('/no-access')

  return (
    <Shell>
      <div className="mb-3">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted inline-flex items-center gap-1.5">
          <KanbanSquare size={12} /> Operations
        </p>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Projects</h1>
        <p className="text-[13px] text-muted mt-0.5 max-w-3xl">
          The work that does not fit a task — renovations, rollouts across a building, onboarding a new
          property, anything that runs for weeks and needs someone to own it. Day-to-day jobs stay in
          Today in Ops.
        </p>
      </div>
      <ProjectBoard
        canEdit={atLeast(level, 'edit')}
        canFull={atLeast(level, 'full')}
        me={access.email || ''}
      />
    </Shell>
  )
}
