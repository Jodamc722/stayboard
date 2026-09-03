import { TeamScheduler } from '@/components/TeamScheduler'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team schedule' }

// Public, no Shell: the market team's scheduler, opened from the link Jon sends them.
export default function TeamSchedulePage({ params }: { params: { code: string } }) {
  return <TeamScheduler code={params.code} />
}
