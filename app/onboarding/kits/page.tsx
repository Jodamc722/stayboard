// STARTER KITS — the team desk (Jon, 2026-11-10): make a starter kit link for a prospective owner or
// client, sized to their home, and see who opened it and what they sent back. Gated by the
// `onboarding` feature through its path prefix; the API checks the level on every call.
import { Shell } from '@/components/Shell'
import { StarterKitDesk } from '@/components/StarterKitDesk'
export const dynamic = 'force-dynamic'
export default function StarterKitsPage() {
  return (
    <Shell>
      <StarterKitDesk />
    </Shell>
  )
}
