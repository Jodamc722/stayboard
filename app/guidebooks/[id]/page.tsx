// Single guidebook — full-page viewer/editor (intentionally OUTSIDE Shell so Print/PDF outputs
// clean pages with no app chrome).
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GuidebookView } from '@/components/GuidebookView'

export const dynamic = 'force-dynamic'

export default async function GuidebookPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabaseAdmin().from('guidebooks').select('*').eq('id', params.id).limit(1)
  const gb = (data || [])[0]
  if (!gb) notFound()

  return <GuidebookView initial={gb} />
}
