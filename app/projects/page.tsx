// PROJECTS HOME — what Asana opens to: what is on you today, and every project as a tile.
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { ProjectsHome } from '@/components/ProjectsHome'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const access = await getAccess()
  return <ProjectsHome me={access.email || ''} canEdit={atLeast(access.levels['projects'], 'edit')} />
}
