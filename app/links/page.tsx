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
        <h1 className="text-xl font-bold text-ink mb-1">Share Links</h1>
        <p className="text-[12.5px] text-muted mb-4">
          Every link anyone outside the app can open, in one place — vendor boards, scheduler links, field boards,
          the reports, custom pages. Each has its <b>own</b> passcode (shown once when made), an optional expiry,
          and a scope that says exactly what it shows. Describe the one you need, or fill the form.
        </p>
        <ShareLinksHub />
      </div>
    </Shell>
  )
}
