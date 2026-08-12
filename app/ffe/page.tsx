import { redirect } from 'next/navigation'
import { Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeIndex } from '@/components/FfeIndex'

export const dynamic = 'force-dynamic'

export default async function FfePage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sofa size={13} /> Operations
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">FF&amp;E Audit</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          One link per owner, already made. It opens a page of that owner&apos;s units — each with its own link,
          today&apos;s status and a progress bar — so the team can move in and out of units and mark each one complete.
          Room by room, Replace / Keep / Not here, in English or Spanish. What comes back is a furniture order,
          not a work order: nothing here touches Breezeway, maintenance or billing.
        </p>
      </header>
      <FfeIndex />
    </Shell>
  )
}
