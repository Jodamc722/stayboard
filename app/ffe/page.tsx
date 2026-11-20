import { redirect } from 'next/navigation'
import { Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeTabs } from '@/components/FfeTabs'
import { LeanHead } from '@/components/lean'

export const dynamic = 'force-dynamic'

export default async function FfePage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      {/* CLEAN-UP (Jon, 2026-11-20): the one-line header every other page has (it was an eyebrow, a
          large title and a four-line paragraph). */}
      <LeanHead title="FF&E audit" icon={<Sofa size={18} className="text-muted" />} sub="One link per owner. Room by room: Replace, Keep or Not here. What comes back is a furniture order, not a work order." />
      <FfeTabs />
    </Shell>
  )
}
