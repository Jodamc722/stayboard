// Open loops — what Eve is keeping tabs on across Slack, the glitch board and Breezeway, as a page.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { OpenLoops } from '@/components/OpenLoops'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function LoopsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.loops || 'off')
  if (level === 'off') redirect('/command')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <OpenLoops canEdit={level === 'edit' || level === 'full'} />
      </div>
    </Shell>
  )
}
