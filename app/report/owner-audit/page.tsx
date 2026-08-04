'use client'
// REVIEWER SHARE LINK — /report/owner-audit. Opens without a Lighthouse login, behind the audit
// password (its own credential — see lib/shareAuth). Reviewers can mark rows and comment; the
// API only ever exposes the audit itself, never the rest of the app.
import { OwnerAuditBoard } from '@/components/OwnerAuditBoard'

export default function OwnerAuditReportPage() {
  return (
    <div className="min-h-screen bg-app">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <OwnerAuditBoard share />
        <div className="text-center text-[11px] text-muted pb-6">Stay Hospitality · Lighthouse</div>
      </div>
    </div>
  )
}
