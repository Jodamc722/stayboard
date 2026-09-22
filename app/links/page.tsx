// SHARE LINKS — the one place every custom live-data link lives (Jon, 2026-08-18).
import { Shell } from '@/components/Shell'
import { ShareLinksHub } from '@/components/ShareLinksHub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Share Links — Lighthouse' }

// Wrapped in <Shell> 2026-08-20 — without it this page shipped with no navigation, which is why nobody saw the Share Links hub for two days after it went live.
export default function LinksPage() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <ShareLinksHub />
      </div>
    </Shell>
  )
}
