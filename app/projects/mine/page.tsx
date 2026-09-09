import { getAccess } from '@/lib/access'
import { MyTasks } from '@/components/MyTasks'

export const dynamic = 'force-dynamic'

// Access and the shell come from app/projects/layout.tsx.
export default async function MyTasksPage() {
  const access = await getAccess()
  return <MyTasks me={access.email || ''} />
}
