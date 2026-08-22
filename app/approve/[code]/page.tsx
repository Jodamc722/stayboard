import OwnerApprove from '@/components/OwnerApprove'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'For your approval', robots: { index: false, follow: false } }

export default function ApprovePage({ params }: { params: { code: string } }) {
  return (
    // Owners open this from an email on a phone and there is no app Shell here to pad for the
    // notch or the home indicator, so the page does it itself.
    <div className="min-h-screen bg-neutral-50 px-safe pb-safe">
      <OwnerApprove code={params.code} />
    </div>
  )
}
