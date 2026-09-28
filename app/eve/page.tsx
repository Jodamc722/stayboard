// EVE'S TAB (Jon, 2026-09-28: "we need to have an Eve tab where open loops are, training questions,
// Eve command center overview"). This page was retired on 2026-08-19 ("Eve does not need her own
// page — a floating icon") and redirected to the command center; the bubble stays for talking to
// her, and this is where her work is read: what needs a person, what she did today, the loops she
// is keeping tabs on, and the questions only a person can answer. Memory, voice and agent mode
// stay in Users & admin → Settings → Eve.
//
// Access: the 'eve' feature (admins by default; Users → Roles switches it per role). The Open
// loops tab follows the 'loops' feature so a role that can read Eve but not loops sees why.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { EveHub } from '@/components/EveHub'
import { getAccess } from '@/lib/access'
import { canUseEve } from '@/lib/eve/run'

export const dynamic = 'force-dynamic'

export default async function EvePage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!canUseEve(access)) redirect('/command')
  const eveLevel = String(access.levels?.eve || (access.role === 'admin' ? 'full' : 'view'))
  const loopsLevel = String(access.levels?.loops || 'off')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <EveHub canEdit={eveLevel === 'edit' || eveLevel === 'full'} loopsLevel={loopsLevel} />
      </div>
    </Shell>
  )
}
