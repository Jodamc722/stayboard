// Admin console. Server component: verifies the caller is an admin via getAccess(), then renders
// the client admin UI — people & access (roles, workspaces, profiles, notifications, activity),
// review-reply AI voice training, and share links. Non-admins see an "Admins only" notice.
import { Shell } from '@/components/Shell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { UsersAdmin } from '@/components/UsersAdmin'
import { ReviewVoiceAdmin } from '@/components/ReviewVoiceAdmin'
import { ShareLinksCard } from '@/components/ShareLinksCard'
import { ShieldAlert } from 'lucide-react'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Users &amp; admin</h1>
        <p className="text-sm text-muted mt-1">Teammates, workspaces &amp; page access, profiles, notification preferences — and the review-reply AI&apos;s voice.</p>
      </div>
      {access.role !== 'admin' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 inline-flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" /> This page is for admins only. Ask an admin to manage access.
        </div>
      ) : (
        <div className="space-y-5">
          <UsersAdmin myEmail={access.email || ''} isOwner={isSuperadmin(access.email)} />
          <ReviewVoiceAdmin />
          <ShareLinksCard />
        </div>
      )}
    </Shell>
  )
}
