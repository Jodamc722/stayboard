import { Shell } from '@/components/Shell'
import { ClaimsBoard } from '@/components/ClaimsBoard'
import { ShieldAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function ClaimsPage() {
  return (
    <Shell>
      <header className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><ShieldAlert size={12} /> Money</div>
        <h1 className="text-3xl font-bold text-ink mt-1">Claims</h1>
        <p className="text-sm text-muted mt-1">
          Damage and theft claims against AirCover, Vrbo and Booking cover, or the guest&rsquo;s card &mdash; built on the reservation,
          evidenced item by item, and filed before the 14-day window closes.
        </p>
      </header>
      <ClaimsBoard />
    </Shell>
  )
}
