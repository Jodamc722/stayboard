// Money → Projections. Next season's net owner revenue — historical baseline, market-informed
// uplifts, and per-month editable assumptions (occupancy, ADR, LOS) per unit.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ProjectionsBoard } from '@/components/ProjectionsBoard'

export const dynamic = 'force-dynamic'

export default async function ProjectionsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
        <ProjectionsBoard />
      </div>
    </Shell>
  )
}
