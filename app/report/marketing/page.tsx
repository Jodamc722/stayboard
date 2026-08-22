'use client'
// PARTNER SHARE LINK — /report/marketing. Opens without a Lighthouse login, behind the marketing
// password (separate credential from the vendor share password). Guest names arrive shortened.
import { MarketingBoard } from '@/components/MarketingBoard'

export default function MarketingReportPage() {
  // NO SHELL AROUND THIS PAGE. A partner opens it on their own phone, so the safe-area padding
  // Shell normally supplies has to come from the page: px-safe so a landscape notch never sits
  // over the report, pb-safe so the last line clears the home indicator. It goes on the OUTER
  // wrapper — px-safe on the inner div would replace its p-4 gutter rather than add to it.
  return (
    <div className="min-h-screen bg-app px-safe pb-safe">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <MarketingBoard partner />
        <div className="text-center text-[11px] text-muted pb-6">Stay Hospitality · Lighthouse</div>
      </div>
    </div>
  )
}
