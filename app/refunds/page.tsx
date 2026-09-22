import { Shell } from '@/components/Shell'
import { RefundPlaybook } from '@/components/RefundPlaybook'
import { LifeBuoy } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function RefundsPage() {
  return (
    <Shell>
      <header className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><LifeBuoy size={12} /> Operations</div>
        <h1 className="text-3xl font-bold text-ink mt-1">Making it right</h1>
        <p className="text-sm text-muted mt-1">
          How we decide what a guest issue is worth &mdash; the clock on every category, the matrix, who signs what,
          and ten real cases to train on. The same engine that recommends on a glitch card produces every number here.
        </p>
      </header>
      <RefundPlaybook />
    </Shell>
  )
}
