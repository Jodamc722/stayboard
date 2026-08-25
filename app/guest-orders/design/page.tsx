import { Shell } from '@/components/Shell'
import { GuestOrderStudio } from '@/components/GuestOrderStudio'
import { getAccess, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Palette } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function GuestOrdersDesignPage() {
  const access = await getAccess()
  const canEdit = atLeast(access.levels['guest-orders'], 'edit')
  return (
    <Shell>
      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Palette size={13} /> Guests · Guest Orders</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Design studio</h1>
          <p className="text-sm text-muted mt-1">The real guest form, live. Tap anything on the phone to change it; nothing goes out until you press Save.</p>
        </div>
        <Link href="/guest-orders" className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">← Back to the board</Link>
      </header>
      <GuestOrderStudio canEdit={canEdit} isOwner={isSuperadmin(access.email)} />
    </Shell>
  )
}
