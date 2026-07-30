import { redirect } from 'next/navigation'
import { Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReservationNoticesBoard } from '@/components/ReservationNoticesBoard'

export const dynamic = 'force-dynamic'

export default async function ReservationEmailsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Mail size={13} /> Building notifications
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Reservation emails</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Buildings that won&apos;t let a guest in until their front desk has been told who is coming.
          Soonest arrival first &mdash; red means the guest is arriving and nothing has gone out.
          Recipients and wording live in Users &amp; admin.
        </p>
      </header>
      <ReservationNoticesBoard />
    </Shell>
  )
}
