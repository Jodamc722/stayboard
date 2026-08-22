import FieldComplete from '@/components/FieldComplete'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Field tasks', robots: { index: false, follow: false } }

// Share-code page — outside the app Shell, so it carries its own safe-area padding. The list runs
// to the bottom of the glass, so pb-safe as well as px-safe.
export default function FieldPage({ params }: { params: { code: string } }) {
  return (
    <div className="min-h-screen bg-neutral-50 px-safe pb-safe">
      <FieldComplete code={params.code} />
    </div>
  )
}
