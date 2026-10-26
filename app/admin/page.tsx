// THE ADMIN DESK (Jon, 2026-10-26) — the administrator's page: what needs them today across
// listings, channels, reviews, photos and blocks; one row per listing; the review report.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { AdminDesk } from '@/components/AdminDesk'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  const access = await getAccess()
  const canEdit = atLeast(access.levels['admin-desk'], 'edit')
  return (
    <Shell>
      <AdminDesk canEdit={canEdit} />
    </Shell>
  )
}
