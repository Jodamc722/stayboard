// Admin console. Server component: verifies the caller is an admin via getAccess(), then renders
// the tabbed console (People / Roles / App settings — see components/AdminConsole.tsx).
// Non-admins see an "Admins only" notice.
import { Shell } from '@/components/Shell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { AdminConsole } from '@/components/AdminConsole'
import { ShieldAlert } from 'lucide-react'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Users &amp; admin</h1>
        <p className="text-sm text-muted mt-1">People &amp; roles — who sees which tabs and what they can do there — plus app-wide settings.</p>
      </header>
      {access.role !== 'admin' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 inline-flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" /> This page is for admins only. Ask an admin to manage access.
        </div>
      ) : (<>
        {/* CLEAN-UP (Jon, 2026-11-20): the other admin pages, one click from here. They sat under
            "More" in the sidebar and nowhere in this console, so Settings never led to them. */}
        <nav aria-label="Other admin pages" className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-muted mr-0.5">Also here</span>
          {([
            ['/vault', 'Vault', 'Logins, gate codes and paperwork, revealed after unlock'],
            ['/links', 'Share links', 'Every share link and passcode in one list'],
            ['/api-keys', 'API keys', 'Your personal read-only keys for the API'],
            ['/system-health', 'System health', 'Syncs, feeds and the daily self-audit'],
            ['/brain', 'Business brain', 'Which apartments need a decision, what keeps failing, and data gaps'],
          ] as const).map(([href, label, title]) => (
            <a key={href} href={href} title={title}
              className="rounded-lg border border-line bg-white px-2.5 py-1 font-semibold text-ink hover:bg-app">{label}</a>
          ))}
        </nav>
        <AdminConsole myEmail={access.email || ''} isOwner={isSuperadmin(access.email)} />
      </>)}
    </Shell>
  )
}
