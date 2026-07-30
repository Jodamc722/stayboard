import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { InspectionsBoard } from '@/components/InspectionsBoard'

export const dynamic = 'force-dynamic'

export default async function InspectionsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <ClipboardCheck size={13} /> Field quality
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Inspections</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Walk a unit, write what you found and who cleaned it. No task, no form to fill in — just the
          record, kept so it can be used later for training. Today&apos;s entries also print on the day sheet.
        </p>
      </header>
      <InspectionsBoard />
    </Shell>
  )
}
