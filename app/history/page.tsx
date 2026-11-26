// OUR STORY (Jon, 2026-11-26): "like a history page of our stats" — the team's year in numbers.
// Starts with the year to date; the timeline, anniversaries and birthdays come next.
import { Shell } from '@/components/Shell'
import { StoryPage } from '@/components/StoryPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Our Story' }

export default function HistoryPage() {
  return (
    <Shell>
      <StoryPage />
    </Shell>
  )
}
