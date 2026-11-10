// THE LINEN CALCULATOR LINK (Jon, 2026-11-10: "linen calculator as a link like this, no need for
// login or password"). /kit/linens — public through the /kit/ prefix, like the need list. It counts
// linen from the standard Jon keeps on Onboarding → Linens, sent to the page without prices, vendors or
// SKUs (lib/linens-public.ts). Each person who opens it gets a blank list of their own; nothing is saved.
import { getSetting } from '@/lib/app-settings'
import { LINEN_STANDARD_KEY, normLinenStandard } from '@/lib/linens'
import { publicLinenStandard } from '@/lib/linens-public'
import { LinenCalculatorPublic } from '@/components/LinenCalculatorPublic'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Linen calculator — Stay Hospitality' }

export default async function LinenCalculatorPage() {
  const raw = await getSetting<any>(LINEN_STANDARD_KEY, null)
  return <LinenCalculatorPublic standard={publicLinenStandard(normLinenStandard(raw))} />
}
