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
        {/* CLEAN-UP (Jon, 2026-11-20): one line; why it is not in Slack is in the hover. */}
        <p className="text-[12.5px] text-muted mb-5 max-w-3xl" title="It runs once a day and reports here rather than in Slack: an alert about the app in a channel people use to run buildings is how a channel gets muted.">
          Lighthouse checking itself once a day: syncs, guests falling through, unanswered reviews, numbers that do not add up.
        </p>
        <SystemHealth />
      </div>
    </Shell>
  )
}
