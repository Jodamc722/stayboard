// THE BUSINESS BRAIN (Jon, 2026-11-10: "help us make more informed decisions, property upkeep
// decisions"). One page over the nightly layer of migration 178: which apartments need a decision,
// which systems keep failing, how each owner's units are doing, and what the data is still missing.
// Summary first; every list loads when its tab is opened (/api/brain/data).
//
// Access: admins and the owner. The page is not a feature path of its own, so it checks here.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { BrainView } from '@/components/BrainView'
import { getAccess, isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function BrainPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed || (access.role !== 'admin' && !isSuperadmin(access.email))) redirect('/no-access')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <BrainView />
      </div>
    </Shell>
  )
}
