import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { LaborSettings } from '@/components/LaborSettings'

export const dynamic = 'force-dynamic'

export default async function LaborSettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-3xl font-bold text-ink">Labor settings</h1>
        <p className="text-sm text-muted mt-1">Per-market thresholds for the Labor board, the Schedule strip and the briefs: labor % bands, clock-in grace, overtime week, attribution gate.</p>
      </header>
      <LaborSettings />
    </Shell>
  )
}
