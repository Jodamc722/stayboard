import { Shell } from '@/components/Shell'
import { DailyChecklist } from '@/components/DailyChecklist'

export const dynamic = 'force-dynamic'

export default function DailyChecklistPage() {
  return (
    <Shell>
      <DailyChecklist />
    </Shell>
  )
}
