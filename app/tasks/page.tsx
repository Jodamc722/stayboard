// TASKS & PROJECTS (the board Jon first asked for as "Leadership" on 2026-11-06, renamed and rebuilt
// 2026-11-25). Gated by the 'leadership' feature key, so every role keeps the level it had (admins by
// default; Users → Roles switches it per role). Deep link: /tasks?item=<id> opens that row.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { TaskBoard } from '@/components/TaskBoard'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function TasksPage({ searchParams }: { searchParams?: { item?: string } }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.leadership || (access.role === 'admin' ? 'full' : 'off'))
  if (level === 'off') redirect('/command')
  return (
    <Shell>
      <TaskBoard initialItem={searchParams?.item || null} />
    </Shell>
  )
}
