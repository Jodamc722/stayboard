import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { MyTasks } from '@/components/MyTasks'

export const dynamic = 'force-dynamic'

export default async function MyTasksPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!atLeast(access.levels['projects'], 'view')) redirect('/no-access')
  return <Shell><MyTasks me={access.email || ''} /></Shell>
}
