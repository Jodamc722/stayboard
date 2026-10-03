// UPKEEP (Jon, 2026-10-03): the recurring programs — PM audits, deep cleans, A/C filters and coil
// cleans, mini-split cleans, batteries, inspections, FF&E audits — as a daily KPI page: late, due
// soon, on track, no record, per program and per unit. A thin server shell; components/UpkeepBoard
// reads /api/upkeep.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { UpkeepBoard } from '@/components/UpkeepBoard'

export const dynamic = 'force-dynamic'

export default async function UpkeepPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <UpkeepBoard />
    </Shell>
  )
}
