// The Garden Hotel — Team & access: its own roster, logins and roles (migration 118).
import { Shell } from '@/components/Shell'
import { GardenTeam } from '@/components/GardenTeam'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenTeamPage() {
  const { canEdit } = await gardenPage('staff')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenTeam canEdit={canEdit} />
      </div>
    </Shell>
  )
}
