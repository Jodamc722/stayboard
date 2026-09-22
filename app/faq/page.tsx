import { Shell } from '@/components/Shell'
import { FaqDesk } from '@/components/FaqDesk'

export const dynamic = 'force-dynamic'

// Each unit's living knowledge base: auto-pulled facts, audit how-tos, onboarding highlights, own FAQ.
export default function FaqPage() {
  return (
    <Shell>
      <FaqDesk showHead />
    </Shell>
  )
}
