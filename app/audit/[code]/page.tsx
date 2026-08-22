import AuditCapture from '@/components/AuditCapture'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Property audit', robots: { index: false, follow: false } }

// Opened from a text message, never inside the app Shell — so this page gets no safe-area padding
// from anywhere else. px-safe keeps the form off the notch when the phone is turned sideways.
export default function AuditPage({ params }: { params: { code: string } }) {
  return (
    <div className="min-h-screen bg-neutral-50 px-safe">
      <AuditCapture code={params.code} />
    </div>
  )
}
