import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CustomFieldsManager } from './CustomFieldsManager'

export const dynamic = 'force-dynamic'

export default async function CustomFieldsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: fields } = await supabase
    .from('guesty_custom_fields')
    .select('*')
    .order('target')
    .order('name')

  const { data: status } = await supabase
    .from('guesty_sync_status')
    .select('*')
    .eq('entity', 'custom_fields')
    .maybeSingle()

  return (
    <Shell>
      <CustomFieldsManager fields={fields ?? []} syncStatus={status} />
    </Shell>
  )
}
