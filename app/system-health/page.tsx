// SYSTEM HEALTH — where the standing audit reports now that it no longer posts to Slack.
import { Shell } from '@/components/Shell'
import { SystemHealth } from '@/components/SystemHealth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'System health — Lighthouse' }

export default function SystemHealthPage() {
  return (
    <Shell>
      <div className="max-w-5xl">
        <h1 className="text-xl font-bold text-ink mb-1">System health</h1>
        <p className="text-[12.5px] text-muted mb-5 max-w-3xl leading-relaxed">
          Lighthouse checking itself: whether the syncs are current, whether guests are falling through
          the pipeline, whether reviews are going unanswered, and whether the numbers add up. It runs once
          a day and reports here rather than in Slack — an alert about the app in a channel people are in
          to run buildings is how a channel gets muted.
        </p>
        <SystemHealth />
      </div>
    </Shell>
  )
}
