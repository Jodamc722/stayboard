import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { getAccess } from '@/lib/access'
import { VaultBoard } from '@/components/VaultBoard'

export const dynamic = 'force-dynamic'

// Gate codes, front-desk logins, certificates, owner paperwork — the things that otherwise live in
// somebody's phone. Private unless shared; every open is recorded. (Header lives in VaultBoard.)
export default async function VaultPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  return (
    <Shell>
      <VaultBoard />
    </Shell>
  )
}
