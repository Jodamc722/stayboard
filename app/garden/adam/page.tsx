// The Garden Hotel — adam. Gated by the person's hotel role on 'adam' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { AdamAdmin } from '@/components/AdamAdmin'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenAdamPage() {
  const { canEdit, canFull } = await gardenPage('adam')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <AdamAdmin owner={canFull} canEdit={canEdit} />
      </div>
    </Shell>
  )
}
