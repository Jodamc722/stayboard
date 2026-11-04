// The Garden Hotel — today, as the front desk's command page. Gated by the person's hotel role on
// 'today' (lib/garden/access). Marking a verification needs 'calls' edit (the route it posts to);
// starting / finishing a task needs 'rooms' edit — the buttons only show for people who have them.
import { Shell } from '@/components/Shell'
import { GardenFrontDesk } from '@/components/GardenFrontDesk'
import { gardenPage } from '@/lib/garden/access'
import { gAtLeast } from '@/lib/garden/pages'

export const dynamic = 'force-dynamic'

export default async function GardenTodayPage() {
  const { access, canEdit } = await gardenPage('today')
  const lv = access.garden?.levels || ({} as Record<string, string>)
  return (
    <Shell>
      <div className="max-w-[1200px] mx-auto">
        <GardenFrontDesk canEdit={canEdit} canVerify={gAtLeast(lv.calls, 'edit')} canTasks={gAtLeast(lv.rooms, 'edit')} />
      </div>
    </Shell>
  )
}
