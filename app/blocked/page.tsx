import { redirect } from 'next/navigation'
import { CalendarOff } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BlockedUnits } from '@/components/BlockedUnits'

export const dynamic = 'force-dynamic'

export default async function BlockedPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <CalendarOff size={13} /> Inventory
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Blocked Units</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Every unit that cannot be sold, straight from Guesty&apos;s multi-calendar, with the note whoever
          created the block typed in. A blocked night is the one kind of lost revenue nothing announces —
          blocks routinely outlive the repair that caused them. Down longest, first.
        </p>
      </header>
      <BlockedUnits />
    </Shell>
  )
}
