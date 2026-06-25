import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { TrendingUp } from 'lucide-react'
import { OptimizeClient } from '@/components/OptimizeClient'

export const dynamic = 'force-dynamic'

const INACTIVE = ['inactive', 'disabled', 'archived', 'deleted']

export default async function OptimizePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, address_city, bedrooms, bathrooms, max_occupancy, amenities, status')
    .limit(1000)

  const listings = (rows ?? []).filter(
    (l: any) => !l.status || !INACTIVE.includes(String(l.status).toLowerCase())
  )

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <TrendingUp size={13} /> Growth
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Listing Optimization</h1>
        <p className="text-sm text-muted mt-1">
          AI-suggested titles and descriptions grounded in OTA best practices and each listing&apos;s real data.
          Review, then copy into Guesty — nothing is written automatically yet.
        </p>
      </header>

      <OptimizeClient listings={listings} />
    </Shell>
  )
}
