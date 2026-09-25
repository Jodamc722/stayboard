// Settings → API keys. Each person's own read-only keys for the /api/v1 read API.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ApiKeysPanel } from '@/components/ApiKeysPanel'
import { V1_ENDPOINTS } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  return (
    <Shell>
      <div className="max-w-[900px] mx-auto">
        <ApiKeysPanel email={String(user.email || '')} base={base} endpoints={V1_ENDPOINTS} />
      </div>
    </Shell>
  )
}
