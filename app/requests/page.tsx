import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { RequestsView } from './RequestsView'

export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('field_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  return (
    <Shell>
      <RequestsView rows={rows ?? []} />
    </Shell>
  )
}
