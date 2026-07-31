import { redirect } from 'next/navigation'
import { Mail } from 'lucide-react'
import { Shell } from '@/components/Shell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { ReservationNoticesBoard } from '@/components/ReservationNoticesBoard'

export const dynamic = 'force-dynamic'

export default async function ReservationEmailsPage() {
  // The settings live on THIS page now (behind the Settings button), so the page has to know
  // whether the viewer may CHANGE them, not merely whether they are signed in.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Mail size={13} /> Building notifications
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Front-Desk Notices</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Buildings that won&apos;t let a guest in until their front desk has been told who is coming.
          Today first &mdash; red means the guest is arriving and nothing has gone out. Recipients,
          wording and what gets created automatically all live under <strong>Settings</strong>.
        </p>
      </header>
      <ReservationNoticesBoard isOwner={isSuperadmin(access.email)} />
    </Shell>
  )
}
