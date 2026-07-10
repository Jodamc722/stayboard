import { Shell } from '@/components/Shell'
import { AuditDesk } from '@/components/AuditDesk'
import { ClipboardList } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function AuditsPage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Property Audits</h1>
        <p className="text-sm text-muted mt-1">Create a unit inspection link for supervisors and managers, review what the team captured, and turn each item into its own Breezeway task — managed and assigned from here.</p>
      </header>
      <AuditDesk />
    </Shell>
  )
}
