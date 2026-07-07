import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ArrowLeft } from 'lucide-react'
import { BulkGuidebookBuilder } from '@/components/BulkGuidebookBuilder'

export const dynamic = 'force-dynamic'

export default async function BulkGuidebookPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <Link href="/guidebooks" className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink mb-2"><ArrowLeft size={13} />Guidebooks</Link>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Guests</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Bulk build a building</h1>
        <p className="text-sm text-muted mt-1">Fill the building-level info once and generate a guidebook for every unit.</p>
      </header>
      <div className="max-w-3xl">
        <BulkGuidebookBuilder />
      </div>
    </Shell>
  )
}
