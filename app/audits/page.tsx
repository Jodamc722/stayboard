import { Shell } from '@/components/Shell'
import { AuditDesk } from '@/components/AuditDesk'

export const dynamic = 'force-dynamic'

// The one-line header (title + counts) lives inside AuditDesk, because the counts do.
export default function AuditsPage() {
  return (
    <Shell>
      <AuditDesk />
    </Shell>
  )
}
