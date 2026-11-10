// THE STARTER KIT REPORT (Jon, 2026-11-10): what a prospective owner or client opens from the link
// the team sends — everything Stay puts in the home, sized to it, with their choices and a
// Send to Stay. No sign-in; the code is checked on every call by /api/public/starter-kit. noindex.
import { notFound } from 'next/navigation'
import { openKit } from '@/lib/starter-kit-server'
import { StarterKitReport } from '@/components/StarterKitReport'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), false)
  return { robots: { index: false, follow: false }, title: kit ? `Starter kit for ${kit.client} — Stay Hospitality` : 'Stay Hospitality' }
}

export default async function StarterKitPage({ params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), true)
  if (!kit) notFound()
  return <StarterKitReport initial={kit} />
}
