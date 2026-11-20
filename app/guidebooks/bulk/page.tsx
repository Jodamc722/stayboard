import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ArrowLeft } from 'lucide-react'
import { BulkGuidebookBuilder } from '@/components/BulkGuidebookBuilder'
import { LeanHead } from '@/components/lean'

export const dynamic = 'force-dynamic'

export default async function BulkGuidebookPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      {/* CLEAN-UP (Jon, 2026-11-20): the one-line header every other page has, with the two places
          this page leads back to as buttons. */}
      <LeanHead title="Bulk build a building" sub="Fill the building-level info once and generate a guidebook for every unit.">
        <Link href="/guidebooks/review" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app">Review queue</Link>
        <Link href="/guidebooks" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app"><ArrowLeft size={13} />Guidebooks</Link>
      </LeanHead>
      <div className="max-w-3xl">
        <BulkGuidebookBuilder />
      </div>
    </Shell>
  )
}
