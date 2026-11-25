// THE NEW HIRE FORM (Jon, 2026-11-25): a link a manager sends after hiring. No login: the code in the
// link is the key. What is sent waits for approval on Training → People (lib/hire).
import { HireForm } from '@/components/HireForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Welcome to the team — Stay Hospitality' }

export default function Hire({ params }: { params: { code: string } }) {
  return <HireForm code={params.code} />
}
