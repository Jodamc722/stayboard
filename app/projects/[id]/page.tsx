// ONE PROJECT — the page, not a drawer.
//
// Jon, 2026-09-08: an Asana-style board. Asana's project is a page you live in for an hour, not a
// panel you glance at; the difference is the whole feature. The board card still exists for the
// overview, and clicking it lands here.
//
// Server component: access and membership are resolved before anything renders. A non-member is
// sent to the board with no hint that the project exists — same 404 shape as the API.
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getAccess, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { getProject, canSee, canEdit } from '@/lib/projects'
import { ProjectPage } from '@/components/ProjectPage'

export const dynamic = 'force-dynamic'

export default async function OneProject({ params }: { params: { id: string } }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = access.levels['projects']
  if (!atLeast(level, 'view')) redirect('/no-access')

  let p
  try { p = await getProject(params.id) } catch { p = null }
  const viewer = { email: access.email, superadmin: isSuperadmin(access.email) }
  if (!p || !canSee(p.members, viewer)) redirect('/projects')

  return (
    <Shell>
      {/* useSearchParams (the ?task= deep link) wants a Suspense boundary above it. */}
      <Suspense fallback={null}>
      <ProjectPage
        initial={p}
        me={access.email || ''}
        canEdit={atLeast(level, 'edit') && canEdit(p.members, viewer)}
        canFull={atLeast(level, 'full')}
        superadmin={viewer.superadmin}
      />
      </Suspense>
    </Shell>
  )
}
