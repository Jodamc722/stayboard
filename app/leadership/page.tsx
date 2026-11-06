// THE LEADERSHIP BOARD (Jon, 2026-11-06). Gated by the 'leadership' feature (admins by default;
// Users → Roles switches it per role). Deep link: /leadership?item=<id> opens that item.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { LeadershipBoard } from '@/components/LeadershipBoard'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function LeadershipPage({ searchParams }: { searchParams?: { item?: string } }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.leadership || (access.role === 'admin' ? 'full' : 'off'))
  if (level === 'off') redirect('/command')
  return (
    <Shell>
      <LeadershipBoard initialItem={searchParams?.item || null} />
    </Shell>
  )
}
