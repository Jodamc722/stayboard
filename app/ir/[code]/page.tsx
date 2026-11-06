// HER INSPECTION REPORT (Jon, 2026-11-06: "Personal link shared by supervisor or managers"). No login —
// the code in the link is the key, like /learn/<code>. Her last five inspections, in her language.
// /r/ is taken by owner reports, so this is /ir/ ("inspection report"). ?preview=1 is the manager's
// look, which does not count as her opening it.
import { InspectionReportPage } from '@/components/InspectionReportPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inspection report — Stay Hospitality', robots: { index: false, follow: false } }

export default function InspectionReport({ params, searchParams }: { params: { code: string }; searchParams: { preview?: string } }) {
  return <InspectionReportPage code={params.code} preview={searchParams?.preview === '1'} />
}
