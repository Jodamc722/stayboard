import FieldComplete from '@/components/FieldComplete'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Field tasks', robots: { index: false, follow: false } }

export default function FieldPage({ params }: { params: { code: string } }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <FieldComplete code={params.code} />
    </div>
  )
}
