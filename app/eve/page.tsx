import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getAccess, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { EveWorkspace } from '@/components/EveWorkspace'

export const dynamic = 'force-dynamic'

export default async function EvePage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const byRole = !!access.accessRole && atLeast((access.levels as any)?.eve, 'view')
  const allowed = isSuperadmin(access.email) || access.role === 'admin' || byRole
  if (!allowed) redirect(access.landing || '/')

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sparkles size={13} /> The brain
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Eve</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Ask her anything about the business — she reads operations, money, quality, labor and guests
          and pulls the real records before answering. What she learns is on the Memory tab, where you
          can edit or delete anything she believes.
        </p>
      </header>
      <EveWorkspace canEdit={isSuperadmin(access.email) || access.role === 'admin'} />
    </Shell>
  )
}
