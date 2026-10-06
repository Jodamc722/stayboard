import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { loadInbox } from '@/lib/inbox-data'
import { LiveInbox } from '@/components/LiveInbox'

export const dynamic = 'force-dynamic'

// THE MESSAGES PAGE. The inbox itself is computed in lib/inbox-data (shared with /api/messages/live,
// which the open page polls so it stays live — Jon, 2026-10-06), and drawn by components/LiveInbox.
export default async function MessagesPage() {
  // MESSAGES ACCESS, NOT JUST A SESSION (2026-09-28 audit, D16). Guest words, phone numbers and
  // complaints are read with the service role, so a signed-in account is not enough: the person
  // must hold at least view on Messages — the same bar /api/eve/guest-drafts already sets.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed) redirect('/no-access')
  if (!atLeast(access.levels['messages'], 'view')) redirect(access.landing || '/no-access')
  const data = await loadInbox()
  return (
    <Shell>
      <LiveInbox initial={data} />
    </Shell>
  )
}
