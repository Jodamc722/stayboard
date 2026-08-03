import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Shell } from '@/components/Shell'
import { getAccess } from '@/lib/access'
import { VaultBoard } from '@/components/VaultBoard'

export const dynamic = 'force-dynamic'

export default async function VaultPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Lock size={13} /> Restricted
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Vault</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Gate codes, front-desk logins, certificates, owner paperwork &mdash; the things that
          otherwise live in somebody&apos;s phone. Nothing here is visible to the rest of the team
          unless you share it, and every time an item is opened it is recorded.
        </p>
      </header>
      <VaultBoard />
    </Shell>
  )
}
