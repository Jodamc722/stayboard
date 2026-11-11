// THE PROJECTIONS LIBRARY (Jon, 2026-11-11): every building's floor plans and projections on one page,
// edited in place; new sales decks and magazines start from them. Covered by the Sales permission.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ProjectionsLibrary } from '@/components/ProjectionsLibrary'

export const dynamic = 'force-dynamic'

export default async function ProjectionsLibraryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <ProjectionsLibrary />
    </Shell>
  )
}
