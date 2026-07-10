import AuditCapture from '@/components/AuditCapture'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Property audit', robots: { index: false, follow: false } }

export default function AuditPage({ params }: { params: { code: string } }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <AuditCapture code={params.code} />
    </div>
  )
}
