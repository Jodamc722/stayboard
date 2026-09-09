// PROJECTS — the Asana frame.
//
// Jon, 2026-09-09: "the project tab should open asana style interface" and, an hour later, "it
// should have a open view full page with a sidebar that we can open for the main app if needed".
// So Projects is an app inside the app: the Lighthouse sidebar steps out of the way (Shell `full`),
// the project rail takes the left edge, and the Lighthouse mark at the top of the rail opens the
// main navigation as a drawer when you need to go somewhere else. The pages themselves no longer
// render <Shell>; this does, once.
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
    <Shell full>
      <div className="h-full flex flex-col lg:flex-row">
        <ProjectsRail />
        <div className="min-w-0 flex-1 overflow-auto overscroll-contain">
          <div className="max-w-[1400px] mx-auto px-3 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 animate-fade-in">{children}</div>
        </div>
      </div>
    </Shell>
  )
}
