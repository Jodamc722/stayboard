import { Shell } from '@/components/Shell'
import { FaqDesk } from '@/components/FaqDesk'
import { BookOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function FaqPage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><BookOpen size={13} /> Guests</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">FAQ &amp; How-To</h1>
        <p className="text-sm text-muted mt-1">Each unit's living knowledge base — auto-pulled facts, how-tos captured during audits, onboarding highlights, and your own FAQ entries.</p>
      </header>
      <FaqDesk />
    </Shell>
  )
}
