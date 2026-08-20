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
        <h1 className="text-xl font-bold text-ink mb-1">Guests</h1>
        <p className="text-[12.5px] text-muted mb-4">
          Everyone who has stayed in the last two years, aggregated across their reservations — plus
          your own layer: VIP, tags and notes. VIP guests get an automatic pre-arrival inspection.
        </p>
        <GuestsDirectory />
      </div>
    </Shell>
  )
}
