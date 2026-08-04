// Integrations — connected apps (Slack, outbound email) and the health of every background feed.
//
// Gated by the `integrations` feature key, which is deliberately NOT in the ops / cs / data
// workspace bundles: out of the box only Admin and GM can open it. Grant it to someone else on
// /users → Edit access. Middleware enforces the same gate before this ever renders.
import { Shell } from '@/components/Shell'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { IntegrationsAdmin } from '@/components/IntegrationsAdmin'
import { ShieldAlert } from 'lucide-react'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const allowed = isSuperadmin(access.email) || pageAllowed(access.workspace, access.features, 'integrations')

  return (
    <Shell>
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted/70">Setup</p>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="text-sm text-muted mt-1">
          The outside apps Lighthouse talks to, and whether they are actually listening.
        </p>
      </div>

      {!allowed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 inline-flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
          You do not have access to integrations. Ask an admin to turn it on for you on Users &amp; admin.
        </div>
      ) : (
        <IntegrationsAdmin />
      )}
    </Shell>
  )
}
