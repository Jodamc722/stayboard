import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { RequestDetail } from './RequestDetail'

export const dynamic = 'force-dynamic'

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: req }, { data: comments }] = await Promise.all([
    supabase.from('field_requests').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('field_request_comments').select('*').eq('request_id', params.id).order('created_at')
  ])
  if (!req) notFound()

  return (
    <Shell>
      <Link href="/requests" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-4">← All requests</Link>
      <RequestDetail request={req} comments={comments ?? []} userEmail={user.email ?? null} />
    </Shell>
  )
}
