import OwnerApprove from '@/components/OwnerApprove'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'For your approval', robots: { index: false, follow: false } }

export default function ApprovePage({ params }: { params: { code: string } }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <OwnerApprove code={params.code} />
    </div>
  )
}
