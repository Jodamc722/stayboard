// PROJECTS — the Asana frame.
//
// Jon, 2026-09-09: "the project tab should open asana style interface". Every page under /projects
// shares this: the app shell, then a rail of projects on the left and the page on the right. The
// pages themselves no longer render <Shell>; this does, once.
//
// Access is checked here so a page cannot forget to. A person without the projects feature is
// sent away before the rail (which lists project titles) is ever rendered.
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { ProjectsRail } from '@/components/ProjectsRail'

export const dynamic = 'force-dynamic'

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!atLeast(access.levels['projects'], 'view')) redirect('/no-access')
  return (
    <Shell>
      <div className="lg:flex lg:gap-4 lg:items-start">
        <ProjectsRail />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Shell>
  )
}
