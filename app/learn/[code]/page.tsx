// A PERSON'S TRAINING PAGE (Jon, 2026-10-26): no login — the code in the link is the key. Their
// assigned videos and FAQs, English or Spanish, with a Done button. Scoped to one person.
import { LearnPage } from '@/components/LearnPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Training — Stay Hospitality' }

export default function Learn({ params }: { params: { code: string } }) {
  return <LearnPage code={params.code} />
}
