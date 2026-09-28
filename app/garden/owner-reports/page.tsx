// The Garden Hotel — owner-reports. Gated by the hand-picked 'garden' key; see lib/garden.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { GardenOwnerReports } from '@/components/GardenOwnerReports'
import { getAccess, isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function GardenOwnerReportsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.garden || 'off')
  if (level === 'off') redirect('/command')
  const canEdit = level === 'edit' || level === 'full'
  void isSuperadmin
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenOwnerReports canEdit={canEdit} owner={isSuperadmin(access.email)} />
      </div>
    </Shell>
  )
}
