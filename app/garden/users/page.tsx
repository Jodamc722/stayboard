// The Garden Hotel — Users & admin. THE SAME CONSOLE AS THE VR SIDE (components/AdminConsole):
// People · Roles · Settings, with the hotel's people, roles and settings behind it (Jon, 2026-09-29:
// "It should still be users and settings… same web app, same design, just different API connections").
import { Shell } from '@/components/Shell'
import { AdminConsole } from '@/components/AdminConsole'
import { getAccess, isSuperadmin } from '@/lib/access'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function GardenUsersPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.garden) redirect(access.landing || '/no-access')
  const L = access.garden.levels
  const any = ['users', 'settings', 'setup', 'staff', 'adam'].some(k => L[k] && L[k] !== 'off')
  if (!any) redirect(access.garden.landing)
  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Users &amp; admin</h1>
        <p className="text-sm text-muted mt-1">The Garden Hotel&apos;s people &amp; roles — who sees which pages and what they can do there — plus the hotel&apos;s settings.</p>
      </header>
      <AdminConsole business="garden" gLevels={L} myEmail={access.email || ''} isOwner={isSuperadmin(access.email)} canVr={isSuperadmin(access.email) || access.role === 'admin'} />
    </Shell>
  )
}
