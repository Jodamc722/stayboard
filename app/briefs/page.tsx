// BRIEFS (Jon, 2026-11-25: "We should have a briefs page where we can see the briefs … make changes
// before they go out, add notes"). The plan each team reads in the morning: Broward, Miami, North and
// Customer Care. Gated by the `briefs` key (lib/features): view reads, edit changes and sends.
import { Shell } from '@/components/Shell'
import { BriefsPage } from '@/components/BriefsPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Briefs' }

export default function Briefs() {
  return (
    <Shell>
      <BriefsPage />
    </Shell>
  )
}
