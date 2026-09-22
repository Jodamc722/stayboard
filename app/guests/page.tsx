// GUESTS — every guest we have ever hosted, and our profile layer on top (Jon, 2026-08-18).
import { Shell } from '@/components/Shell'
import { GuestsDirectory } from '@/components/GuestsDirectory'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Guests — Lighthouse' }

// Wrapped in <Shell> 2026-08-20 — same cause as /links: built, deployed, and invisible.
export default function GuestsPage() {
  return (
    <Shell>
      <div className="max-w-5xl">
        <GuestsDirectory />
      </div>
    </Shell>
  )
}
