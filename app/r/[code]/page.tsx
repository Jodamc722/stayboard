// PUBLIC owner report — the unguessable code doubles as the share token (guidebook
// pattern); robots noindex. Logged-in team members get the Edit toolbar on the same URL.
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { hasEditCookie } from '@/lib/edit-access'
import { ReportView } from '@/components/ReportView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const base = { robots: { index: false, follow: false } }
  if (!/^[0-9a-f]{12,32}$/i.test(code)) return base
  const { data } = await supabaseAdmin().from('owner_reports').select('title, scope_label').eq('code', code).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return base
  const title = rep.title || ((rep.scope_label || 'Owner') + ' — Owner Review')
  return { ...base, title, description: 'Owner performance review prepared by Stay Hospitality.' }
}

export default async function PublicReportPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  if (!/^[0-9a-f]{12,32}$/i.test(code)) notFound()
  const { data } = await supabaseAdmin().from('owner_reports').select('*').eq('code', code).limit(1)
  const rep = (data || [])[0]
  if (!rep) notFound()
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const unlocked = hasEditCookie()
  return <ReportView initial={rep} canEdit={!!user || unlocked} isTeam={!!user} />
}
