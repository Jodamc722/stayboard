import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { ReservationNoticesBoard } from '@/components/ReservationNoticesBoard'

export const dynamic = 'force-dynamic'

export default async function ReservationEmailsPage() {
  // The settings live on THIS page now (behind the Settings button), so the page has to know
  // whether the viewer may CHANGE them, not merely whether they are signed in.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  // The one-line header (title + counts) is drawn by the board, because the counts load there.
  return (
    <Shell>
      <ReservationNoticesBoard isOwner={isSuperadmin(access.email)} />
    </Shell>
  )
}
