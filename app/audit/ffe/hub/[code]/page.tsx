import { FfeHub } from '@/components/FfeHub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'FF&E Audit', robots: { index: false, follow: false } }

// The owner (or building) link. Public, like every other /audit/ share page — the code IS the key.
export default function FfeHubPage({ params }: { params: { code: string } }) {
  return <FfeHub code={params.code} />
}
