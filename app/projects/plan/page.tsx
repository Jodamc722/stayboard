// PLAN WITH EVE — a brief becomes a project (Jon, 2026-09-30). The layout above already checks the
// projects feature; this page needs edit, because it creates.
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { PlanWithEve } from '@/components/PlanWithEve'

export const dynamic = 'force-dynamic'

export default async function PlanWithEvePage() {
  const access = await getAccess()
  if (!atLeast(access.levels['projects'], 'edit')) redirect('/projects')
  return <PlanWithEve />
}
