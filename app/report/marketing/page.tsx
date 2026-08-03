'use client'
// PARTNER SHARE LINK — /report/marketing. Opens without a Lighthouse login, behind the marketing
// password (separate credential from the vendor share password). Guest names arrive shortened.
import { MarketingBoard } from '@/components/MarketingBoard'

export default function MarketingReportPage() {
  return (
    <div className="min-h-screen bg-app">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <MarketingBoard partner />
        <div className="text-center text-[11px] text-muted pb-6">Stay Hospitality · Lighthouse</div>
      </div>
    </div>
  )
}
