import { FfeAudit } from '@/components/FfeAudit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'FF&E Audit', robots: { index: false, follow: false } }

// Public, like every other /audit/ share link — the code IS the key and resolves to one unit.
export default function FfeAuditPage({ params }: { params: { code: string } }) {
  return <FfeAudit code={params.code} />
}
