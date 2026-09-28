// The Garden Hotel — Adam's page (his memory, voice, model, chats). Gated by the 'garden' key.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { AdamAdmin } from '@/components/AdamAdmin'
import { getAccess, isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function GardenAdamPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.garden || 'off')
  if (level === 'off') redirect('/command')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <AdamAdmin owner={isSuperadmin(access.email)} canEdit={level === 'edit' || level === 'full'} />
      </div>
    </Shell>
  )
}
