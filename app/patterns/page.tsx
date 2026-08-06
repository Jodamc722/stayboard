import { redirect } from 'next/navigation'
import { Radar } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BuildingPatterns } from '@/components/BuildingPatterns'

export const dynamic = 'force-dynamic'

export default async function PatternsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Radar size={13} /> Prevention
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Building Patterns</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          The same complaint showing up across a building is one cause, not many repairs. Reviews and
          guest-reported issues are counted together per theme, per building — worst first, rising
          flagged, and the units it touches named so the fix targets the cause.
        </p>
      </header>
      <BuildingPatterns />
    </Shell>
  )
}
