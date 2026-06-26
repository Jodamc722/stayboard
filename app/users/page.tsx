// Admin-only user management page. Server component: verifies the caller is an admin via getAccess(),
// then renders the client UsersAdmin UI. Non-admins see an "Admins only" notice.
import { Shell } from '@/components/Shell'
import { getAccess } from '@/lib/access'
import { UsersAdmin } from '@/components/UsersAdmin'
import { ShieldAlert } from 'lucide-react'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Users &amp; access</h1>
        <p className="text-sm text-muted mt-1">Invite teammates, set their role, and control who can sign in to StayBoard.</p>
      </div>
      {access.role !== 'admin' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 inline-flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" /> This page is for admins only. Ask an admin to manage access.
        </div>
      ) : (
        <UsersAdmin myEmail={access.email || ''} />
      )}
    </Shell>
  )
}
