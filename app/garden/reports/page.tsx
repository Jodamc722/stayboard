// The Garden Hotel — reports tab. One permission key ('garden') gates the whole set; see lib/garden.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { getAccess, isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function GardenReportsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.garden || 'off')
  if (level === 'off') redirect('/command')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="reports" canEdit={level === 'edit' || level === 'full'} owner={isSuperadmin(access.email)} />
      </div>
    </Shell>
  )
}
